import { headers } from 'next/headers';
import { prisma } from '@/lib/db';
import { adminMutation, json, readJson } from '@/lib/api';
import { adminTotpEnrolSchema, adminTotpVerifySchema } from '@/lib/validation/schemas';
import {
  generateTotpSecret, generateRecoveryCodes, totpUri, verifyTotp,
} from '@/lib/auth/totp';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { getAdminSession, completeSecondFactor, revokeAllAdminSessions } from '@/lib/auth/admin-session';
import { clientIp } from '@/lib/auth/session';
import { enforceAll } from '@/lib/security/rate-limit';
import { audit } from '@/lib/security/audit';
import { BadRequest, Unauthorized } from '@/lib/errors';

/**
 * The platform administrator's second factor.
 *
 * This is the account that can reach every centre's data, so it is the one
 * account where a password on its own is not enough. Centre roles are
 * deliberately not covered: a receptionist locked out of a till by a lost phone
 * is a real cost, and their blast radius is one centre.
 *
 * POST   — begin enrolment: hand back a secret and its otpauth URI.
 * PUT    — confirm enrolment with a working code, and issue recovery codes.
 * DELETE — turn it off, which requires the password *and* a current code.
 */
export const POST = adminMutation(async (admin) => {
  const row = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: admin.adminId } });
  if (row.totpEnabledAt) throw BadRequest('admin.twoFactorAlreadyOn');

  // A fresh secret on every attempt: an abandoned enrolment must not leave a
  // usable one behind.
  const secret = generateTotpSecret();
  await prisma.platformAdmin.update({
    where: { id: admin.adminId },
    data: { totpSecret: secret, totpEnabledAt: null, totpLastStep: null },
  });

  await audit({ actorAdminId: admin.adminId, action: 'admin.2fa.enrol.start' });

  // The secret leaves the server exactly once, to the screen that shows the QR
  // code. It is never written to an audit row or a log.
  return json({ secret, uri: totpUri(secret, row.username) });
});

export const PUT = adminMutation(async (admin, request) => {
  const body = await readJson(request, adminTotpEnrolSchema);
  const row = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: admin.adminId } });

  if (!row.totpSecret) throw BadRequest('admin.twoFactorNotStarted');
  if (row.totpEnabledAt) throw BadRequest('admin.twoFactorAlreadyOn');

  const verdict = verifyTotp(row.totpSecret, body.code);
  if (!verdict.ok) {
    await audit({ actorAdminId: admin.adminId, action: 'admin.2fa.enrol', outcome: 'failure' });
    throw BadRequest('admin.twoFactorBadCode');
  }

  const codes = generateRecoveryCodes();
  const hashes = await Promise.all(codes.map((code) => hashPassword(code)));

  await prisma.platformAdmin.update({
    where: { id: admin.adminId },
    data: {
      totpEnabledAt: new Date(),
      totpLastStep: verdict.step,
      totpRecoveryHashes: hashes,
    },
  });
  // The session that switched it on has plainly just proved the factor.
  await completeSecondFactor(admin.sessionId);

  await audit({ actorAdminId: admin.adminId, action: 'admin.2fa.enrol', outcome: 'success' });

  // Shown once. Only Argon2id hashes are kept.
  return json({ ok: true, recoveryCodes: codes });
});

export const DELETE = adminMutation(async (admin, request) => {
  const body = await readJson(request, adminTotpVerifySchema);
  const hdrs = await headers();
  await enforceAll([['admin:2fa:account', admin.adminId], ['admin:2fa:ip', clientIp(hdrs) ?? undefined]]);

  const row = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: admin.adminId } });
  if (!row.totpEnabledAt || !row.totpSecret) throw BadRequest('admin.twoFactorNotOn');

  // Turning the second factor off is exactly what an attacker holding a live
  // session would want, so it costs the password as well as a code.
  const passwordOk = body.password ? await verifyPassword(row.passwordHash, body.password) : false;
  const codeOk = verifyTotp(row.totpSecret, body.code, { lastUsedStep: row.totpLastStep }).ok;
  if (!passwordOk || !codeOk) {
    await audit({ actorAdminId: admin.adminId, action: 'admin.2fa.disable', outcome: 'failure' });
    throw Unauthorized('auth.invalidCredentials');
  }

  await prisma.platformAdmin.update({
    where: { id: admin.adminId },
    data: {
      totpSecret: null,
      totpEnabledAt: null,
      totpLastStep: null,
      totpRecoveryHashes: [],
    },
  });
  // Every other session loses the factor it was holding; sign in again.
  await revokeAllAdminSessions(admin.adminId);

  await audit({ actorAdminId: admin.adminId, action: 'admin.2fa.disable', outcome: 'success' });
  return json({ ok: true });
});

/** Reports whether the signed-in administrator has the factor switched on. */
export async function GET() {
  const admin = await getAdminSession();
  if (!admin) return json({ error: 'unauthorized' }, { status: 401 });
  const row = await prisma.platformAdmin.findUniqueOrThrow({
    where: { id: admin.adminId },
    select: { totpEnabledAt: true },
  });
  return json({ enabled: Boolean(row.totpEnabledAt) });
}
