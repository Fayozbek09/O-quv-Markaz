import { headers } from 'next/headers';
import { prisma } from '@/lib/db';
import { json, publicRoute, readJson } from '@/lib/api';
import { adminLoginSchema } from '@/lib/validation/schemas';
import { fakeVerify, verifyPassword } from '@/lib/auth/password';
import { createAdminSession } from '@/lib/auth/admin-session';
import { clientIp } from '@/lib/auth/session';
import { enforceAll } from '@/lib/security/rate-limit';
import { audit } from '@/lib/security/audit';
import { Unauthorized } from '@/lib/errors';

/** Consecutive failures before the account is frozen for a while. */
const LOCK_THRESHOLD = 8;
const LOCK_MS = 15 * 60_000;

/**
 * Platform-administrator login. Isolated from /api/auth/login: a different
 * table, a different cookie, a different rate-limit bucket and a per-account
 * lockout, because this is the one account worth grinding at.
 */
export const POST = publicRoute(async (request: Request) => {
  const hdrs = await headers();
  const ip = clientIp(hdrs);
  const body = await readJson(request, adminLoginSchema);
  const username = body.username.toLowerCase();

  await enforceAll([
    ['admin:login:username', username],
    ['admin:login:ip', ip ?? undefined],
  ]);

  const admin = await prisma.platformAdmin.findUnique({ where: { username } });

  if (!admin || !admin.isActive) {
    await fakeVerify(body.password);
    await audit({ action: 'admin.login', outcome: 'failure' });
    throw Unauthorized('auth.invalidCredentials');
  }

  if (admin.lockedUntil && admin.lockedUntil > new Date()) {
    await audit({
      actorAdminId: admin.id,
      action: 'admin.login',
      outcome: 'denied',
      meta: { reason: 'locked' },
    });
    throw Unauthorized('auth.invalidCredentials');
  }

  const ok = await verifyPassword(admin.passwordHash, body.password);
  if (!ok) {
    const attempts = admin.failedAttempts + 1;
    await prisma.platformAdmin.update({
      where: { id: admin.id },
      data: {
        failedAttempts: attempts,
        lockedUntil: attempts >= LOCK_THRESHOLD ? new Date(Date.now() + LOCK_MS) : null,
      },
    });
    await audit({ actorAdminId: admin.id, action: 'admin.login', outcome: 'failure' });
    throw Unauthorized('auth.invalidCredentials');
  }

  await prisma.platformAdmin.update({
    where: { id: admin.id },
    data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await createAdminSession(admin.id);
  await audit({ actorAdminId: admin.id, action: 'admin.login', outcome: 'success' });

  // The session exists but carries no second factor yet, so it reaches the
  // challenge and nothing else. Saying a factor is required is not a
  // disclosure: the caller has already proved the password.
  const twoFactorRequired = Boolean(admin.totpEnabledAt && admin.totpSecret);

  return json({
    ok: true,
    twoFactorRequired,
    mustChangePassword: admin.mustChangePassword,
    redirectTo: twoFactorRequired
      ? '/admin/2fa'
      : admin.mustChangePassword
        ? '/admin/change-password'
        : '/admin',
  });
});
