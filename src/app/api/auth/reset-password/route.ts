import { headers } from 'next/headers';
import { prisma } from '@/lib/db';
import { json, publicRoute, readJson } from '@/lib/api';
import { resetPasswordSchema } from '@/lib/validation/schemas';
import { normalizePhone } from '@/lib/validation/common';
import { verifyOtp } from '@/lib/auth/otp';
import { hashPassword, passwordIssues } from '@/lib/auth/password';
import { clientIp, revokeAllSessions } from '@/lib/auth/session';
import { audit } from '@/lib/security/audit';
import { BadRequest } from '@/lib/errors';

export const POST = publicRoute(async (request: Request) => {
  const hdrs = await headers();
  const ip = clientIp(hdrs);
  const body = await readJson(request, resetPasswordSchema);

  const issues = passwordIssues(body.password);
  if (issues.length > 0) throw BadRequest(issues[0]);

  const identifier =
    body.channel === 'SMS' ? normalizePhone(body.identifier) : body.identifier.toLowerCase();
  if (!identifier) throw BadRequest('auth.invalidCode');

  const verdict = await verifyOtp({ identifier, purpose: 'PASSWORD_RESET', code: body.code, ip });
  if (verdict !== 'ok') {
    await audit({ action: 'auth.reset.failed', outcome: 'failure', meta: { verdict } });
    throw BadRequest('auth.invalidCode');
  }

  const user = await prisma.user.findFirst({
    where: body.channel === 'SMS' ? { phone: identifier } : { email: identifier },
  });
  if (!user || user.deletedAt) throw BadRequest('auth.invalidCode');

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(body.password),
      // The person has just proved control of the phone or e-mail and chosen
      // their own secret, so the forced-change gate and the temporary-credential
      // expiry both lift — exactly as they do in /api/auth/change-password.
      // Leaving `credentialsExpireAt` set would lock out the one group that
      // most needs this route: someone whose issued password expired unused.
      mustChangePassword: false,
      credentialsExpireAt: null,
    },
  });

  // A password reset invalidates every existing session, everywhere.
  await revokeAllSessions(user.id);
  await audit({ actorUserId: user.id, action: 'auth.reset.complete' });

  return json({ ok: true });
});
