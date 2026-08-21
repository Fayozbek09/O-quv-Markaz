import { headers } from 'next/headers';
import { prisma } from '@/lib/db';
import { json, publicRoute, readJson } from '@/lib/api';
import { adminTotpChallengeSchema } from '@/lib/validation/schemas';
import { verifyTotp } from '@/lib/auth/totp';
import { verifyPassword } from '@/lib/auth/password';
import { getAdminSession, completeSecondFactor } from '@/lib/auth/admin-session';
import { assertCsrf } from '@/lib/security/csrf';
import { clientIp } from '@/lib/auth/session';
import { enforceAll } from '@/lib/security/rate-limit';
import { audit } from '@/lib/security/audit';
import { BadRequest, Unauthorized } from '@/lib/errors';

/**
 * The challenge itself: a session that has passed the password offers a code.
 *
 * Not `adminMutation`, because that path now refuses a session awaiting its
 * second factor — this is the one route such a session must still reach. It
 * therefore does its own CSRF check against the session it already holds.
 *
 * A recovery code is accepted in place of a TOTP code and is burned on use.
 */
export const POST = publicRoute(async (request: Request) => {
  const admin = await getAdminSession();
  if (!admin) throw Unauthorized();
  await assertCsrf(admin.csrfSecret);

  const hdrs = await headers();
  await enforceAll([
    ['admin:2fa:account', admin.adminId],
    ['admin:2fa:ip', clientIp(hdrs) ?? undefined],
  ]);

  const body = await readJson(request, adminTotpChallengeSchema);
  const row = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: admin.adminId } });
  if (!row.totpEnabledAt || !row.totpSecret) throw BadRequest('admin.twoFactorNotOn');

  const verdict = verifyTotp(row.totpSecret, body.code, { lastUsedStep: row.totpLastStep });
  if (verdict.ok) {
    // Burning the step stops a code seen over a shoulder from being replayed
    // inside its own thirty-second window.
    await prisma.platformAdmin.update({
      where: { id: row.id },
      data: { totpLastStep: verdict.step },
    });
    await completeSecondFactor(admin.sessionId);
    await audit({ actorAdminId: row.id, action: 'admin.2fa.challenge', outcome: 'success' });
    return json({ ok: true, redirectTo: row.mustChangePassword ? '/admin/change-password' : '/admin' });
  }

  // Recovery codes are checked one at a time against their Argon2id hashes.
  const hashes = Array.isArray(row.totpRecoveryHashes)
    ? (row.totpRecoveryHashes as unknown[]).filter((h): h is string => typeof h === 'string')
    : [];
  const candidate = body.code.trim().toUpperCase();

  for (const hash of hashes) {
    if (!(await verifyPassword(hash, candidate))) continue;

    // Single use: the hash is dropped, and a fresh one is never re-issued
    // silently — the admin is told how many are left.
    const remaining = hashes.filter((h) => h !== hash);
    await prisma.platformAdmin.update({
      where: { id: row.id },
      data: { totpRecoveryHashes: remaining },
    });
    await completeSecondFactor(admin.sessionId);
    await audit({
      actorAdminId: row.id,
      action: 'admin.2fa.recovery',
      outcome: 'success',
      meta: { remaining: remaining.length },
    });
    return json({
      ok: true,
      usedRecoveryCode: true,
      recoveryCodesLeft: remaining.length,
      redirectTo: row.mustChangePassword ? '/admin/change-password' : '/admin',
    });
  }

  await audit({ actorAdminId: row.id, action: 'admin.2fa.challenge', outcome: 'failure' });
  throw Unauthorized('admin.twoFactorBadCode');
});
