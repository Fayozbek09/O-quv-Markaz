import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, truncateAll, createTenant, makeStudent, type Tenant } from '../factories';
import { Session } from './client';
import { BASE_URL } from './server';
import { hashPassword } from '@/lib/auth/password';

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
    const res = await fetch(`${BASE_URL}/api/students`, {
      headers: { cookie: '__Host-ustozly_session=forged-token-value-000000000000' },
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
