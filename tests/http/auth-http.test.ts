import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, truncateAll, createTenant, makeStudent, type Tenant } from '../factories';
import { Session } from './client';
import { BASE_URL } from './server';
import { hashPassword } from '@/lib/auth/password';
import { SESSION_COOKIE } from '@/lib/auth/session';
import { requestOtp } from '@/lib/auth/otp';

/**
 * These run against a real `next start` process, so they cover the middleware,
 * cookie flags, CSRF handling and error shapes as a browser would see them.
 */
const PASSWORD = 'CorrectHorse42!';

let alice: Tenant;
let bob: Tenant;
let aliceSession: Session;
let bobSession: Session;
let bobStudentId: string;

async function login(tenant: Tenant): Promise<Session> {
  const session = new Session();
  const res = await session.fetch('/api/auth/login', {
    method: 'POST',
    json: { identifier: tenant.user.email, password: PASSWORD },
  });
  expect(res.status, await res.text()).toBe(200);
  await session.loadCsrf();
  return session;
}

beforeAll(async () => {
  await truncateAll();
  alice = await createTenant('Alice HTTP');
  bob = await createTenant('Bob HTTP');

  const hash = await hashPassword(PASSWORD);
  await db.user.updateMany({
    where: { id: { in: [alice.user.id, bob.user.id] } },
    data: { passwordHash: hash },
  });

  bobStudentId = (await makeStudent(bob, 'BobsKid')).id;
  await makeStudent(alice, 'AlicesKid');

  aliceSession = await login(alice);
  bobSession = await login(bob);
});

afterAll(() => db.$disconnect());

describe('5. unauthenticated API access', () => {
  const endpoints: Array<[string, string]> = [
    ['GET', '/api/students'],
    ['POST', '/api/students'],
    ['GET', '/api/groups'],
    ['GET', '/api/payments'],
    ['GET', '/api/debt'],
    ['GET', '/api/reports?year=2026&month=8'],
    ['POST', '/api/attendance'],
    ['GET', '/api/notifications'],
    ['GET', '/api/telegram/link'],
    ['POST', '/api/billing/checkout'],
    ['GET', '/api/account/export'],
    ['PUT', '/api/settings/profile'],
  ];

  it.each(endpoints)('%s %s returns 401 without a session', async (method, path) => {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { origin: BASE_URL, 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : '{}',
      redirect: 'manual',
    });
    expect([401, 403]).toContain(res.status);
  });

  it('an app page redirects to the login screen instead of rendering data', async () => {
    const res = await fetch(`${BASE_URL}/dashboard`, { redirect: 'manual' });
    expect([302, 307]).toContain(res.status);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('an error response carries a translation key, never a stack trace', async () => {
    const res = await fetch(`${BASE_URL}/api/students`, { redirect: 'manual' });
    const body = await res.text();
    expect(body).not.toMatch(/at .*\(.*:\d+:\d+\)/);
    expect(body).not.toContain('prisma');
    expect(JSON.parse(body)).toHaveProperty('messageKey');
  });
});

describe('session cookie hardening', () => {
  it('is httpOnly, Secure, SameSite=Lax and uses the __Host- prefix', async () => {
    const probe = new Session();
    const res = await probe.fetch('/api/auth/login', {
      method: 'POST',
      json: { identifier: alice.user.email, password: PASSWORD },
    });

    const cookie = (res.headers.getSetCookie?.() ?? []).find((c) => c.includes('omarkaz_session'));
    expect(cookie).toBeDefined();
    expect(cookie).toContain('__Host-');
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//i);
  });

  it('issues a different session token on every login (no fixation)', async () => {
    const first = new Session();
    await first.fetch('/api/auth/login', { method: 'POST', json: { identifier: alice.user.email, password: PASSWORD } });
    const second = new Session();
    await second.fetch('/api/auth/login', { method: 'POST', json: { identifier: alice.user.email, password: PASSWORD } });

    expect(first.cookieHeader).not.toBe(second.cookieHeader);
    expect(first.cookieHeader.length).toBeGreaterThan(20);
  });

  it('a forged session token is rejected', async () => {
    // The cookie name comes from the source, not a string literal. It used to
    // be spelled out by hand and the spelling went stale, so the request
    // carried a cookie the server does not read: the 401 was "no session at
    // all", and a genuinely forged token had never been tested.
    const res = await fetch(`${BASE_URL}/api/students`, {
      headers: { cookie: `${SESSION_COOKIE}=forged-token-value-000000000000` },
      redirect: 'manual',
    });
    expect(res.status).toBe(401);
  });

  it('a token belonging to a real session, tampered with, is rejected', async () => {
    const session = await login(alice);
    const real = session.cookieHeader.split(`${SESSION_COOKIE}=`)[1]?.split(';')[0] ?? '';
    expect(real.length).toBeGreaterThan(20);

    // Flip the last character to one it cannot already be.
    const tampered = `${real.slice(0, -1)}${real.endsWith('A') ? 'B' : 'A'}`;
    expect(tampered).not.toBe(real);

    const res = await fetch(`${BASE_URL}/api/students`, {
      headers: { cookie: `${SESSION_COOKIE}=${tampered}` },
      redirect: 'manual',
    });
    expect(res.status).toBe(401);
  });

  it('logout invalidates the session server-side', async () => {
    const session = await login(bob);
    expect((await session.fetch('/api/students')).status).toBe(200);

    const cookieBefore = session.cookieHeader;
    await session.fetch('/api/auth/logout', { method: 'POST', csrf: true });

    // Replaying the old cookie must not work: the row was revoked, not just cleared.
    const replay = await fetch(`${BASE_URL}/api/students`, {
      headers: { cookie: cookieBefore },
      redirect: 'manual',
    });
    expect(replay.status).toBe(401);
  });
});

describe('CSRF protection', () => {
  it('rejects a state-changing request with no CSRF token', async () => {
    const res = await aliceSession.fetch('/api/students', {
      method: 'POST',
      json: { firstName: 'NoToken' },
    });
    expect(res.status).toBe(403);
  });

  it('rejects a wrong CSRF token', async () => {
    const res = await aliceSession.fetch('/api/students', {
      method: 'POST',
      json: { firstName: 'BadToken' },
      csrf: 'f'.repeat(64),
    });
    expect(res.status).toBe(403);
  });

  it('rejects a cross-origin request before it reaches the route', async () => {
    const res = await aliceSession.fetch('/api/students', {
      method: 'POST',
      json: { firstName: 'CrossSite' },
      csrf: true,
      origin: 'https://evil.example',
    });
    expect(res.status).toBe(403);
  });

  it("rejects another session's CSRF token", async () => {
    const res = await aliceSession.fetch('/api/students', {
      method: 'POST',
      json: { firstName: 'BorrowedToken' },
      csrf: bobSession.csrfToken as string,
    });
    expect(res.status).toBe(403);
  });

  it('accepts a correctly formed request', async () => {
    const res = await aliceSession.fetch('/api/students', {
      method: 'POST',
      json: { firstName: 'Legit', status: 'ACTIVE' },
      csrf: true,
    });
    expect(res.status).toBe(201);
  });

  it('does not require a token for a read', async () => {
    expect((await aliceSession.fetch('/api/students')).status).toBe(200);
  });
});

describe('4. IDOR over HTTP', () => {
  it("cannot read another tenant's student by id", async () => {
    const res = await aliceSession.fetch(`/api/students/${bobStudentId}`);
    expect(res.status).toBe(404);
  });

  it("cannot update another tenant's student by id", async () => {
    const res = await aliceSession.fetch(`/api/students/${bobStudentId}`, {
      method: 'PUT',
      json: { firstName: 'Pwned', status: 'ACTIVE' },
      csrf: true,
    });
    expect(res.status).toBe(404);

    const untouched = await db.student.findUniqueOrThrow({ where: { id: bobStudentId } });
    expect(untouched.firstName).toBe('BobsKid');
  });

  it("cannot archive another tenant's student by id", async () => {
    const res = await aliceSession.fetch(`/api/students/${bobStudentId}`, {
      method: 'DELETE',
      csrf: true,
    });
    expect(res.status).toBe(404);
  });

  it('a guessed or malformed id returns 404, not a server error', async () => {
    for (const id of ['00000000-0000-4000-8000-000000000000', 'not-a-uuid', '../../etc/passwd', '1 OR 1=1']) {
      const res = await aliceSession.fetch(`/api/students/${encodeURIComponent(id)}`);
      expect([400, 404], `id=${id}`).toContain(res.status);
    }
  });

  it('a list response never contains another tenant id', async () => {
    const body = await (await aliceSession.fetch('/api/students?status=ALL&perPage=100')).text();
    expect(body).not.toContain(bobStudentId);
    expect(body).not.toContain('BobsKid');
  });
});

describe('10. password reset throttling', () => {
  it('answers identically for a known and an unknown account', async () => {
    const known = await fetch(`${BASE_URL}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE_URL },
      body: JSON.stringify({ identifier: alice.user.email }),
      redirect: 'manual',
    });
    const unknown = await fetch(`${BASE_URL}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE_URL },
      body: JSON.stringify({ identifier: 'nobody-at-all@example.test' }),
      redirect: 'manual',
    });

    expect(known.status).toBe(unknown.status);
    expect(await known.text()).toBe(await unknown.text());
  });

  it('rate limits repeated reset requests for the same identifier', async () => {
    const identifier = 'throttle-target@example.test';
    let limited = false;

    for (let i = 0; i < 8; i += 1) {
      const res = await fetch(`${BASE_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE_URL },
        body: JSON.stringify({ identifier }),
        redirect: 'manual',
      });
      if (res.status === 429) {
        limited = true;
        expect(res.headers.get('retry-after')).toBeTruthy();
        break;
      }
    }
    expect(limited).toBe(true);
  });
});

describe('verification codes never travel in a response', () => {
  /**
   * The development build returns the code so a developer can register without
   * a gateway. This suite runs the production build, where the only way to the
   * code is the SMS or the e-mail — asserted here rather than assumed.
   */
  it('omits the code from the registration response', async () => {
    await db.rateLimitCounter.deleteMany();
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE_URL },
      body: JSON.stringify({ email: `otp-leak-${Date.now()}@example.test` }),
      redirect: 'manual',
    });
    expect(res.status).toBe(200);

    const raw = await res.text();
    expect(JSON.parse(raw)).not.toHaveProperty('devCode');
    // Nor anywhere else in the payload under a different name.
    expect(raw).not.toMatch(/\b\d{6}\b/);
  });

  it('omits it from the password-reset response too', async () => {
    await db.rateLimitCounter.deleteMany();
    const res = await fetch(`${BASE_URL}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE_URL },
      body: JSON.stringify({ identifier: alice.user.email }),
      redirect: 'manual',
    });
    const raw = await res.text();
    expect(raw).not.toMatch(/\b\d{6}\b/);
    expect(JSON.parse(raw)).not.toHaveProperty('devCode');
  });
});

describe('a temporary password is gated at the API, not only at the page', () => {
  /**
   * The layouts redirect a forced-change account to /change-password, but a
   * redirect only governs a browser following it. The same session with the
   * issued password used to be able to work the whole API and never change it.
   */
  it('refuses centre endpoints until the person picks their own password', async () => {
    const suffix = Date.now().toString(36);
    const username = `temp.staff.${suffix}`;
    const account = await db.user.create({
      data: {
        username,
        passwordHash: await hashPassword(PASSWORD),
        mustChangePassword: true,
        profile: { create: { firstName: 'Temp', lastName: 'Staff' } },
      },
    });
    await db.organizationMember.create({
      data: { organizationId: alice.org.id, userId: account.id, role: 'RECEPTIONIST' },
    });

    await db.rateLimitCounter.deleteMany();
    const session = new Session();
    const login = await session.fetch('/api/auth/login', {
      method: 'POST',
      json: { identifier: username, password: PASSWORD },
    });
    expect(login.status).toBe(200);
    expect((await login.json()).redirectTo).toBe('/change-password');
    await session.loadCsrf();

    const blocked = await session.fetch('/api/students');
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).messageKey).toBe('auth.mustChangePassword');

    // Changing it is the one thing that still works.
    const changed = await session.fetch('/api/auth/change-password', {
      method: 'POST',
      json: { currentPassword: PASSWORD, newPassword: 'Chosen-Now-8823!' },
      csrf: true,
    });
    expect(changed.status, await changed.clone().text()).toBe(200);

    await session.loadCsrf();
    const allowed = await session.fetch('/api/students');
    expect(allowed.status, await allowed.clone().text()).toBe(200);
  });
});

describe('data export is scoped to what the caller may read', () => {
  /**
   * Belonging to a centre is not a right to read the centre. Before this was
   * enforced, a student portal login could download every student, payment and
   * invoice the centre held — the whole tenant, through a route that looked
   * like a personal "export my data" button.
   */
  let studentSession: Session;
  let ownStudentName: string;

  beforeAll(async () => {
    const suffix = Date.now().toString(36);
    ownStudentName = `Exportee${suffix}`;

    const record = await db.student.create({
      data: {
        organizationId: alice.org.id,
        firstName: ownStudentName,
        lastName: 'Portal',
        status: 'ACTIVE',
      },
    });
    const account = await db.user.create({
      data: {
        username: `export.student.${suffix}`,
        passwordHash: await hashPassword(PASSWORD),
        profile: { create: { firstName: ownStudentName, lastName: 'Portal' } },
      },
    });
    await db.organizationMember.create({
      data: { organizationId: alice.org.id, userId: account.id, role: 'STUDENT' },
    });
    await db.student.update({ where: { id: record.id }, data: { userId: account.id } });

    await db.rateLimitCounter.deleteMany();
    studentSession = new Session();
    const res = await studentSession.fetch('/api/auth/login', {
      method: 'POST',
      json: { identifier: `export.student.${suffix}`, password: PASSWORD },
    });
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it('gives a student their own rows and nothing about anyone else', async () => {
    const res = await studentSession.fetch('/api/account/export');
    expect(res.status).toBe(200);
    const body = await res.text();
    const data = JSON.parse(body) as {
      scope: string;
      students?: unknown[];
      payments?: unknown[];
      me: { student: { firstName: string } | null };
    };

    expect(data.scope).toBe('personal');
    // The centre-wide sections are absent, not merely empty.
    expect(data.students).toBeUndefined();
    expect(data.payments).toBeUndefined();
    expect(data.me.student?.firstName).toBe(ownStudentName);
    // No other student in the centre appears anywhere in the document.
    expect(body).not.toContain('AlicesKid');
  });

  it("never reaches into another centre's data either", async () => {
    const body = await (await studentSession.fetch('/api/account/export')).text();
    expect(body).not.toContain(bobStudentId);
    expect(body).not.toContain('BobsKid');
  });

  it('still gives an owner the whole centre', async () => {
    const res = await aliceSession.fetch('/api/account/export');
    expect(res.status).toBe(200);
    const data = (await res.json()) as { scope: string; students: unknown[] };
    expect(data.scope).toBe('centre');
    expect(data.students.length).toBeGreaterThan(0);
  });
});

describe('password reset recovers an expired temporary credential', () => {
  /**
   * The group this route exists for: an account issued a temporary password
   * that lapsed before it was ever used. Login refuses such a credential, so a
   * reset that left `credentialsExpireAt` set would lock the person out for
   * good — they would set a new password and still be turned away.
   */
  it('clears the expiry and the forced-change gate, and the new password works', async () => {
    const email = `expired-temp-${Date.now()}@example.test`;
    const user = await db.user.create({
      data: {
        email,
        username: `expired.temp.${Date.now().toString(36)}`,
        passwordHash: await hashPassword('Issued-Temp-9271!'),
        mustChangePassword: true,
        credentialsExpireAt: new Date(Date.now() - 86_400_000),
      },
    });

    // The lapsed password is refused, which is what makes reset the only way back.
    const before = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE_URL },
      body: JSON.stringify({ identifier: email, password: 'Issued-Temp-9271!' }),
      redirect: 'manual',
    });
    expect(before.status).toBe(401);

    await db.rateLimitCounter.deleteMany();
    const { devCode } = await requestOtp({
      identifier: email,
      channel: 'EMAIL',
      purpose: 'PASSWORD_RESET',
    });

    const reset = await fetch(`${BASE_URL}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE_URL },
      body: JSON.stringify({
        identifier: email,
        channel: 'EMAIL',
        code: devCode,
        password: 'Chosen-By-Me-4417!',
      }),
      redirect: 'manual',
    });
    expect(reset.status, await reset.clone().text()).toBe(200);

    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.credentialsExpireAt).toBeNull();
    expect(row.mustChangePassword).toBe(false);

    await db.rateLimitCounter.deleteMany();
    const after = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE_URL },
      body: JSON.stringify({ identifier: email, password: 'Chosen-By-Me-4417!' }),
      redirect: 'manual',
    });
    expect(after.status, await after.clone().text()).toBe(200);
    // Straight to their own area, not bounced back to change-password.
    expect((await after.json()).redirectTo).not.toBe('/change-password');
  });
});

describe('login throttling', () => {
  it('locks out after repeated wrong passwords and never says which part was wrong', async () => {
    const identifier = 'lockout-target@example.test';
    await db.user.create({
      data: {
        email: identifier,
        emailVerified: new Date(),
        passwordHash: await hashPassword(PASSWORD),
        profile: { create: { firstName: 'Lock' } },
      },
    });

    let limited = false;
    for (let i = 0; i < 12; i += 1) {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE_URL },
        body: JSON.stringify({ identifier, password: `wrong-${i}` }),
        redirect: 'manual',
      });

      if (res.status === 429) {
        limited = true;
        break;
      }
      expect(res.status).toBe(401);
      expect((await res.json()).messageKey).toBe('auth.invalidCredentials');
    }
    expect(limited).toBe(true);
  });

  it('does not reveal whether an account exists', async () => {
    const missing = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE_URL },
      body: JSON.stringify({ identifier: 'ghost@example.test', password: 'whatever123' }),
      redirect: 'manual',
    });
    expect(missing.status).toBe(401);
    expect((await missing.json()).messageKey).toBe('auth.invalidCredentials');
  });
});

describe('detail pages answer 404, not 500, for a foreign id', () => {
  it('renders not-found rather than an error page for another tenant', async () => {
    // The API already answers 404; a server component that lets the domain
    // error escape would render a 500 instead, which is both wrong and a hint
    // that something unusual happened.
    const res = await aliceSession.fetch(`/students/${bobStudentId}`);
    expect(res.status).toBe(404);
  });

  it('renders not-found for a malformed id', async () => {
    const res = await aliceSession.fetch('/students/not-a-uuid');
    expect(res.status).toBe(404);
  });
});
