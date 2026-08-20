import { prisma } from '@/lib/db';
import { adminMutation, json, readJson } from '@/lib/api';
import { changePasswordSchema } from '@/lib/validation/schemas';
import { hashPassword, passwordIssues, verifyPassword } from '@/lib/auth/password';
import { revokeAllAdminSessions } from '@/lib/auth/admin-session';
import { audit } from '@/lib/security/audit';
import { BadRequest, Unauthorized } from '@/lib/errors';

/** Rotating the platform-admin password. Documented in DEPLOYMENT.md. */
export const POST = adminMutation(async (admin, request) => {
  const body = await readJson(request, changePasswordSchema);

  const issues = passwordIssues(body.newPassword);
  if (issues.length > 0) throw BadRequest(issues[0]);
  if (body.newPassword === body.currentPassword) throw BadRequest('auth.passwordRules.reused');
  // The platform account holds every centre's data: a longer floor than the
  // ten characters a centre user gets.
  if (body.newPassword.length < 16) throw BadRequest('auth.passwordRules.tooShort');

  const row = await prisma.platformAdmin.findUnique({ where: { id: admin.adminId } });
  if (!row) throw Unauthorized();

  const ok = await verifyPassword(row.passwordHash, body.currentPassword);
  if (!ok) {
    await audit({ actorAdminId: admin.adminId, action: 'admin.password.change', outcome: 'failure' });
    throw Unauthorized('auth.invalidCredentials');
  }

  await prisma.platformAdmin.update({
    where: { id: admin.adminId },
    data: { passwordHash: await hashPassword(body.newPassword), mustChangePassword: false },
  });

  // Every admin session everywhere dies, including this one: a rotated admin
  // password means signing back in.
  await revokeAllAdminSessions(admin.adminId);
  await audit({ actorAdminId: admin.adminId, action: 'admin.password.change', outcome: 'success' });

  return json({ ok: true, redirectTo: '/admin/login' });
});
