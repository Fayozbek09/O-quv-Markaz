import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, truncateAll } from '../factories';
import { Session } from './client';
import { hashPassword } from '@/lib/auth/password';
import {
  generateTotpSecret, totpAt, currentStep, generateRecoveryCodes,
} from '@/lib/auth/totp';

/**
 * The platform administrator's second factor, over HTTP.
 *
 * The point of the whole feature is one property: a stolen password is not a
 * way in. So the tests that matter are the ones where the password is correct
 * and the session still cannot reach anything — including through the API,
 * which a redirect does not govern.
 */
const ADMIN_USERNAME = 'f.twofactor.test';
const ADMIN_PASSWORD = 'AdminPassword-2026-Long!';

let adminId: string;
let secret: string;

async function signIn(): Promise<{ session: Session; body: Record<string, unknown> }> {
  await db.rateLimitCounter.deleteMany();
  const session = new Session();
  const res = await session.fetch('/api/admin/login', {
    method: 'POST',
    json: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });
  expect(res.status, await res.clone().text()).toBe(200);
  await session.loadCsrf();
  return { session, body: (await res.json()) as Record<string, unknown> };
}

const codeNow = () => totpAt(secret, currentStep());

beforeAll(async () => {
  await truncateAll();
  secret = generateTotpSecret();
  const admin = await db.platformAdmin.create({
    data: {
      username: ADMIN_USERNAME,
      fullName: 'Two Factor Tester',
      passwordHash: await hashPassword(ADMIN_PASSWORD),
      totpSecret: secret,
      totpEnabledAt: new Date(),
    },
  });
  adminId = admin.id;
});

afterAll(() => db.$disconnect());

describe('a correct password is not enough', () => {
  it('login succeeds but routes to the challenge', async () => {
    const { body } = await signIn();
    expect(body.ok).toBe(true);
    expect(body.twoFactorRequired).toBe(true);
    expect(body.redirectTo).toBe('/admin/2fa');
  });

  it('the API refuses that session everywhere else', async () => {
    const { session } = await signIn();

    for (const path of ['/api/admin/audit', '/api/admin/centers', '/api/admin/settings']) {
      const res = await session.fetch(path);
      expect(res.status, `${path} let a half-authenticated session through`).toBe(403);
    }
  });

  it('the guarded pages send it to the challenge, not to the dashboard', async () => {
    const { session } = await signIn();
    const res = await session.fetch('/admin');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/admin/2fa');
  });

  it('the challenge page itself is reachable — it is the one door left open', async () => {
    const { session } = await signIn();
    expect((await session.fetch('/admin/2fa')).status).toBe(200);
  });
});

describe('the challenge', () => {
  it('opens the account for a valid code', async () => {
    const { session } = await signIn();
    await db.platformAdmin.update({ where: { id: adminId }, data: { totpLastStep: null } });

    const res = await session.fetch('/api/admin/2fa/verify', {
      method: 'POST',
      csrf: true,
      json: { code: codeNow() },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await res.json()).redirectTo).toBe('/admin');

    // And now the rest of the area answers.
    expect((await session.fetch('/api/admin/audit')).status).toBe(200);
  });

  it('refuses a wrong code and leaves the session shut', async () => {
    const { session } = await signIn();
    const res = await session.fetch('/api/admin/2fa/verify', {
      method: 'POST',
      csrf: true,
      json: { code: '000000' },
    });
    expect(res.status).toBe(401);
    expect((await session.fetch('/api/admin/audit')).status).toBe(403);
  });

  it('refuses a code without the session CSRF token', async () => {
    const { session } = await signIn();
    const res = await session.fetch('/api/admin/2fa/verify', {
      method: 'POST',
      json: { code: codeNow() },
    });
    expect(res.status).toBe(403);
  });

  it('will not accept the same code twice, even inside its own window', async () => {
    await db.platformAdmin.update({ where: { id: adminId }, data: { totpLastStep: null } });
    const code = codeNow();

    const first = await signIn();
    expect(
      (await first.session.fetch('/api/admin/2fa/verify', { method: 'POST', csrf: true, json: { code } })).status,
    ).toBe(200);

    // A second session offering the code someone just watched being typed.
    const second = await signIn();
    const res = await second.session.fetch('/api/admin/2fa/verify', {
      method: 'POST',
      csrf: true,
      json: { code },
    });
    expect(res.status).toBe(401);
  });

  it('throttles guessing', async () => {
    const { session } = await signIn();
    let limited = false;

    for (let i = 0; i < 15; i += 1) {
      const res = await session.fetch('/api/admin/2fa/verify', {
        method: 'POST',
        csrf: true,
        json: { code: String(100000 + i) },
      });
      if (res.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });
});

describe('recovery codes', () => {
  it('let a lost phone back in, once each', async () => {
    await db.rateLimitCounter.deleteMany();
    const codes = generateRecoveryCodes(3);
    await db.platformAdmin.update({
      where: { id: adminId },
      data: { totpRecoveryHashes: await Promise.all(codes.map((c) => hashPassword(c))) },
    });

    const { session } = await signIn();
    const res = await session.fetch('/api/admin/2fa/verify', {
      method: 'POST',
      csrf: true,
      json: { code: codes[0] },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { usedRecoveryCode: boolean; recoveryCodesLeft: number };
    expect(body.usedRecoveryCode).toBe(true);
    expect(body.recoveryCodesLeft).toBe(2);

    expect((await session.fetch('/api/admin/audit')).status).toBe(200);

    // Burned: the same code does not work again.
    await db.rateLimitCounter.deleteMany();
    const again = await signIn();
    expect(
      (await again.session.fetch('/api/admin/2fa/verify', { method: 'POST', csrf: true, json: { code: codes[0] } })).status,
    ).toBe(401);
  });

  it('are stored only as hashes', async () => {
    const codes = generateRecoveryCodes(2);
    await db.platformAdmin.update({
      where: { id: adminId },
      data: { totpRecoveryHashes: await Promise.all(codes.map((c) => hashPassword(c))) },
    });

    const row = await db.platformAdmin.findUniqueOrThrow({ where: { id: adminId } });
    const stored = JSON.stringify(row.totpRecoveryHashes);
    for (const code of codes) expect(stored).not.toContain(code);
    expect(stored).toContain('$argon2id$');
  });
});

describe('an account with no second factor is untouched', () => {
  it('goes straight to the dashboard', async () => {
    await db.rateLimitCounter.deleteMany();
    await db.platformAdmin.create({
      data: {
        username: 'f.nofactor.test',
        fullName: 'No Factor',
        passwordHash: await hashPassword(ADMIN_PASSWORD),
      },
    });

    const session = new Session();
    const res = await session.fetch('/api/admin/login', {
      method: 'POST',
      json: { username: 'f.nofactor.test', password: ADMIN_PASSWORD },
    });
    const body = (await res.json()) as { twoFactorRequired: boolean; redirectTo: string };

    expect(body.twoFactorRequired).toBe(false);
    expect(body.redirectTo).toBe('/admin');
    expect((await session.fetch('/api/admin/audit')).status).toBe(200);
  });
});
