import { prisma } from '@/lib/db';
import { json, readJson, userMutation } from '@/lib/api';
import { deleteAccountSchema } from '@/lib/validation/schemas';
import { verifyPassword } from '@/lib/auth/password';
import { destroySession, revokeAllSessions } from '@/lib/auth/session';
import { deleteObject } from '@/lib/files/storage';
import { audit } from '@/lib/security/audit';
import { Unauthorized } from '@/lib/errors';

/**
 * Account deletion. Workspaces the user solely owns are removed with their
 * data; workspaces shared with others keep running and the user is only
 * detached from them.
 */
export const DELETE = userMutation(async (user, request) => {
  const body = await readJson(request, deleteAccountSchema);

  const row = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
  if (row.passwordHash) {
    const ok = body.password ? await verifyPassword(row.passwordHash, body.password) : false;
    if (!ok) throw Unauthorized('auth.invalidCredentials');
  }

  const owned = await prisma.organizationMember.findMany({
    where: { userId: user.userId, role: 'OWNER', removedAt: null },
    select: { organizationId: true },
  });

  const soleOwned: string[] = [];
  for (const { organizationId } of owned) {
    const others = await prisma.organizationMember.count({
      where: { organizationId, removedAt: null, NOT: { userId: user.userId } },
    });
    if (others === 0) soleOwned.push(organizationId);
  }

  const files = await prisma.file.findMany({
    where: { OR: [{ organizationId: { in: soleOwned } }, { ownerUserId: user.userId }] },
    select: { storageKey: true },
  });

  await prisma.$transaction(async (tx) => {
    // Cascades defined in the schema remove students, lessons, payments, etc.
    if (soleOwned.length > 0) {
      await tx.organization.deleteMany({ where: { id: { in: soleOwned } } });
    }
    await tx.organizationMember.deleteMany({ where: { userId: user.userId } });
    await tx.user.delete({ where: { id: user.userId } });
  });

  for (const file of files) await deleteObject(file.storageKey);

  await revokeAllSessions(user.userId);
  await destroySession();
  await audit({ action: 'account.delete', meta: { organizationsDeleted: soleOwned.length } });

  return json({ ok: true });
});
