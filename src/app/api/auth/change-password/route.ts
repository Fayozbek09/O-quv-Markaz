import { prisma } from '@/lib/db';
import { json, readJson, userMutation } from '@/lib/api';
import { changePasswordSchema } from '@/lib/validation/schemas';
import { hashPassword, passwordIssues, verifyPassword } from '@/lib/auth/password';
import { revokeAllSessions } from '@/lib/auth/session';
import { audit } from '@/lib/security/audit';
import { BadRequest, Unauthorized } from '@/lib/errors';

export const POST = userMutation(async (user, request) => {
  const body = await readJson(request, changePasswordSchema);

  const issues = passwordIssues(body.newPassword);
  if (issues.length > 0) throw BadRequest(issues[0]);

  const row = await prisma.user.findUnique({ where: { id: user.userId } });
  if (!row?.passwordHash) throw BadRequest('errors.badRequest');

  const ok = await verifyPassword(row.passwordHash, body.currentPassword);
  if (!ok) {
    await audit({ actorUserId: user.userId, action: 'auth.password.change', outcome: 'failure' });
    throw Unauthorized('auth.invalidCredentials');
  }

  await prisma.user.update({
    where: { id: user.userId },
    data: { passwordHash: await hashPassword(body.newPassword) },
  });

  // Keep the current device signed in, drop every other session.
  await revokeAllSessions(user.userId, user.sessionId);
  await audit({ actorUserId: user.userId, action: 'auth.password.change', outcome: 'success' });

  return json({ ok: true });
});
