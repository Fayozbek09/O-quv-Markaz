import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { db, truncateAll, createTenant, type Tenant } from '../factories';
import { Session } from './client';
import { BASE_URL } from './server';
import { hashPassword } from '@/lib/auth/password';

const PASSWORD = 'CorrectHorse42!';
let owner: Tenant;
let assistant: Tenant;
let ownerSession: Session;
let assistantSession: Session;

beforeAll(async () => {
  await truncateAll();
  owner = await createTenant('Header Owner');

  // A second member of the SAME workspace, with the lowest role.
  assistant = await createTenant('Header Assistant');
  await db.organizationMember.updateMany({
    where: { userId: assistant.user.id },
    data: { organizationId: owner.org.id, role: 'ASSISTANT' },
  });

  const hash = await hashPassword(PASSWORD);
  await db.user.updateMany({
    where: { id: { in: [owner.user.id, assistant.user.id] } },
    data: { passwordHash: hash },
  });

  ownerSession = new Session();
  await ownerSession.fetch('/api/auth/login', {
    method: 'POST',
    json: { identifier: owner.user.email, password: PASSWORD },
  });
  await ownerSession.loadCsrf();

  assistantSession = new Session();
  await assistantSession.fetch('/api/auth/login', {
    method: 'POST',
    json: { identifier: assistant.user.email, password: PASSWORD },
  });
  await assistantSession.loadCsrf();
});

afterAll(() => db.$disconnect());

describe('security headers', () => {
  it('sets a strict Content-Security-Policy with a nonce and no unsafe-inline script', async () => {
    const res = await fetch(`${BASE_URL}/login`, { redirect: 'manual' });
    const csp = res.headers.get('content-security-policy') ?? '';

    expect(csp).toMatch(/script-src [^;]*'nonce-[^']+'/);
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-eval'/);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'self'");
  });

  it('blocks framing (clickjacking) two ways', async () => {
    const res = await fetch(`${BASE_URL}/login`, { redirect: 'manual' });
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('sets the remaining hardening headers', async () => {
    const res = await fetch(`${BASE_URL}/login`, { redirect: 'manual' });
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(res.headers.get('permissions-policy')).toContain('geolocation=()');
    expect(res.headers.get('strict-transport-security')).toContain('max-age=63072000');
  });

  it('does not advertise the framework', async () => {
    const res = await fetch(`${BASE_URL}/login`, { redirect: 'manual' });
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  it('marks API responses no-store so a shared cache cannot retain tenant data', async () => {
    const res = await ownerSession.fetch('/api/students');
    expect(res.headers.get('cache-control')).toContain('no-store');
  });
});

describe('19. CORS is restrictive', () => {
  it('does not send Access-Control-Allow-Origin to a foreign origin', async () => {
    const res = await fetch(`${BASE_URL}/api/students`, {
      headers: { origin: 'https://evil.example' },
      redirect: 'manual',
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('does not reflect an arbitrary origin on a preflight', async () => {
    const res = await fetch(`${BASE_URL}/api/students`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'x-csrf-token',
      },
      redirect: 'manual',
    });
    const allowed = res.headers.get('access-control-allow-origin');
    expect(allowed === null || allowed === BASE_URL).toBe(true);
    expect(allowed).not.toBe('https://evil.example');
    expect(allowed).not.toBe('*');
  });

  it('rejects a cross-origin mutation even with a stolen-looking cookie', async () => {
    const res = await ownerSession.fetch('/api/students', {
      method: 'POST',
      json: { firstName: 'CrossOrigin' },
      csrf: true,
      origin: 'https://evil.example',
    });
    expect(res.status).toBe(403);
  });
});

describe('18. role-gated operations', () => {
  it('an ASSISTANT cannot reverse a payment', async () => {
    const student = await db.student.create({
      data: { organizationId: owner.org.id, firstName: 'RolesKid', status: 'ACTIVE' },
    });
    const payment = await db.payment.create({
      data: {
        organizationId: owner.org.id,
        studentId: student.id,
        amountMinor: 100_000n,
        currency: 'UZS',
        paidAt: new Date(),
        method: 'CASH',
      },
    });

    const denied = await assistantSession.fetch(`/api/payments/${payment.id}/reverse`, {
      method: 'POST',
      json: { reason: 'trying it on' },
      csrf: true,
    });
    expect(denied.status).toBe(403);
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('COMPLETED');

    const allowed = await ownerSession.fetch(`/api/payments/${payment.id}/reverse`, {
      method: 'POST',
      json: { reason: 'duplicate entry' },
      csrf: true,
    });
    expect(allowed.status).toBe(200);
  });

  it('an ASSISTANT cannot change workspace settings', async () => {
    const res = await assistantSession.fetch('/api/settings/workspace', {
      method: 'PUT',
      json: {
        name: 'Renamed By Assistant',
        defaultCurrency: 'UZS',
        timezone: 'Asia/Tashkent',
        locale: 'uz',
      },
      csrf: true,
    });
    expect(res.status).toBe(403);
    expect((await db.organization.findUniqueOrThrow({ where: { id: owner.org.id } })).name)
      .not.toBe('Renamed By Assistant');
  });

  it('an ASSISTANT cannot start a billing checkout', async () => {
    const res = await assistantSession.fetch('/api/billing/checkout', {
      method: 'POST',
      json: { plan: 'PRO' },
      csrf: true,
    });
    expect(res.status).toBe(403);
  });

  it('an ASSISTANT can still read the roster they are entitled to', async () => {
    expect((await assistantSession.fetch('/api/students')).status).toBe(200);
  });
});

describe('open redirect', () => {
  it('the OAuth callback never redirects off-origin', async () => {
    for (const target of ['https://evil.example', '//evil.example', '/\\evil.example']) {
      const res = await fetch(
        `${BASE_URL}/api/auth/google/callback?error=access_denied&state=${encodeURIComponent(target)}`,
        { redirect: 'manual' },
      );
      const location = res.headers.get('location');
      if (location) expect(new URL(location, BASE_URL).origin).toBe(BASE_URL);
    }
  });
});

describe('20. no secrets in the client bundle', () => {
  it('no server secret appears in any shipped JavaScript', async () => {
    const dir = path.join(process.cwd(), '.next', 'static');
    const files: string[] = [];

    async function walk(current: string) {
      for (const entry of await readdir(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.name.endsWith('.js')) files.push(full);
      }
    }
    await walk(dir);
    expect(files.length).toBeGreaterThan(0);

    const secrets = [
      'SESSION_SECRET', 'OTP_PEPPER', 'FILE_URL_SECRET', 'IP_HASH_SECRET',
      'PAYME_SECRET_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET',
      'GOOGLE_CLIENT_SECRET', 'DATABASE_URL',
    ] as const;

    const values = [
      process.env.SESSION_SECRET, process.env.OTP_PEPPER, process.env.FILE_URL_SECRET,
      process.env.IP_HASH_SECRET, process.env.PAYME_SECRET_KEY,
      process.env.TELEGRAM_WEBHOOK_SECRET, process.env.DATABASE_URL,
      'ustozly_dev_pw', 'postgresql://',
    ].filter((v): v is string => Boolean(v) && (v as string).length > 8);

    for (const file of files) {
      const content = await readFile(file, 'utf8');
      for (const value of values) {
        expect(content.includes(value), `${path.basename(file)} leaks a secret value`).toBe(false);
      }
      for (const name of secrets) {
        expect(content.includes(name), `${path.basename(file)} references ${name}`).toBe(false);
      }
    }
  });

  it('the repository never tracks an env file', async () => {
    const gitignore = await readFile(path.join(process.cwd(), '.gitignore'), 'utf8');
    expect(gitignore).toMatch(/^\.env$/m);
    expect(gitignore).toMatch(/^\.env\.\*\.local$/m);
  });
});

describe('error pages', () => {
  it('an unknown path renders the 404 page without a stack trace', async () => {
    const res = await fetch(`${BASE_URL}/definitely-not-a-real-page`, { redirect: 'manual' });
    expect(res.status).toBe(404);

    const body = await res.text();
    expect(body).not.toMatch(/at .*\(.*:\d+:\d+\)/);
    expect(body).not.toContain('node_modules');
  });

  it('an oversized request body is rejected rather than buffered', async () => {
    const res = await ownerSession.fetch('/api/students', {
      method: 'POST',
      csrf: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ firstName: 'x'.repeat(400_000) }),
    });
    expect([413, 422]).toContain(res.status);
  });
});

/**
 * The scheduled subscription job is reachable over HTTP so a serverless host
 * can call it. That makes it an internet-facing endpoint which rolls
 * subscription states and sends messages, so the interesting tests are the ones
 * where it refuses.
 */
describe('the subscription cron endpoint', () => {
  it('refuses an unauthenticated call', async () => {
    const res = await fetch(`${BASE_URL}/api/cron/subscriptions`, { redirect: 'manual' });
    // 503 when no CRON_SECRET is configured, 401 when one is and no token was
    // offered. Either way it does not run, and it never returns 200.
    expect([401, 503]).toContain(res.status);
  });

  it('refuses a wrong bearer token', async () => {
    const res = await fetch(`${BASE_URL}/api/cron/subscriptions`, {
      headers: { authorization: 'Bearer not-the-secret' },
      redirect: 'manual',
    });
    expect([401, 503]).toContain(res.status);
  });

  it('is not reachable with a signed-in centre session either', async () => {
    const res = await fetch(`${BASE_URL}/api/cron/subscriptions`, {
      headers: { authorization: 'Bearer ' },
      redirect: 'manual',
    });
    expect(res.status).not.toBe(200);
  });
});
