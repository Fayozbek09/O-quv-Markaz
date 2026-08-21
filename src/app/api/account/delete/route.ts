import { prisma } from '@/lib/db';
import { json, readJson, userMutation } from '@/lib/api';
import { deleteAccountSchema } from '@/lib/validation/schemas';
import { verifyPassword } from '@/lib/auth/password';
import { destroySession, revokeAllSessions } from '@/lib/auth/session';
import { deleteObject } from '@/lib/files/storage';
import { audit } from '@/lib/security/audit';
import { BadRequest, Unauthorized } from '@/lib/errors';

/**
 * Account closure.
 *
 * The person stops existing to the application: the login identifiers are
 * released, the profile is scrubbed and no session survives. What is *not*
 * destroyed is the centre's books. Payments, invoices, attendance, grades and
 * payroll are records of money and of attendance that a centre is required to
 * keep, and they belong to the centre rather than to whoever happens to hold
 * the owner account — so a centre is closed the same way a platform
 * administrator closes one, with `deletedAt`, and its rows stay put.
 *
 * The previous version cascaded: deleting the account deleted the organization
 * and every student, payment, grade and attendance row under it, and deleting
 * the membership rows took the salary history with them — in shared centres
 * too. Nothing here deletes a business record any more.
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

  // A centre with staff and students in it must not be left with nobody able
  // to run it. Either hand it over, or empty it first.
  const soleOwned: string[] = [];
  for (const { organizationId } of owned) {
    const others = await prisma.organizationMember.count({
      where: { organizationId, removedAt: null, NOT: { userId: user.userId } },
    });
    if (others === 0) {
      soleOwned.push(organizationId);
      continue;
    }
    const otherOwners = await prisma.organizationMember.count({
      where: {
        organizationId,
        removedAt: null,
        role: { in: ['OWNER', 'ADMIN'] },
        NOT: { userId: user.userId },
      },
    });
    if (otherOwners === 0) throw BadRequest('settings.deleteAccountLastOwner');
  }

  // Only the person's own picture goes. Files that belong to a centre — logos,
  // homework attachments — stay with the centre that still holds the records
  // they are attached to.
  const avatar = row.id
    ? await prisma.profile.findUnique({
        where: { userId: user.userId },
        select: { avatar: { select: { id: true, storageKey: true } } },
      })
    : null;

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    if (soleOwned.length > 0) {
      await tx.organization.updateMany({
        where: { id: { in: soleOwned } },
        data: { deletedAt: now, status: 'SUSPENDED', suspendedReason: 'owner_account_closed' },
      });
      await tx.session.updateMany({
        where: { activeOrgId: { in: soleOwned }, revokedAt: null },
        data: { revokedAt: now },
      });
    }

    // Marked as left, not erased: a lesson still knows who taught it and a
    // payroll row still knows who was paid.
    await tx.organizationMember.updateMany({
      where: { userId: user.userId, removedAt: null },
      data: { removedAt: now },
    });

    // A portal login is detached from the student record; the student stays.
    await tx.student.updateMany({ where: { userId: user.userId }, data: { userId: null } });

    await tx.profile.updateMany({
      where: { userId: user.userId },
      data: {
        firstName: 'Deleted',
        lastName: null,
        bio: null,
        teachingSubject: null,
        avatarFileId: null,
      },
    });

    // Identifiers are released so the handle, e-mail and number are free again
    // and nothing personal is left on the row.
    await tx.user.update({
      where: { id: user.userId },
      data: {
        deletedAt: now,
        isActive: false,
        username: null,
        email: null,
        phone: null,
        emailVerified: null,
        phoneVerified: null,
        passwordHash: null,
        googleSub: null,
        mustChangePassword: false,
        credentialsExpireAt: null,
      },
    });

    if (avatar?.avatar) {
      await tx.file.update({ where: { id: avatar.avatar.id }, data: { deletedAt: now } });
    }
    // Their own chat stops receiving centre messages. The row is revoked, not
    // dropped, because consent history is what makes the messaging auditable.
    await tx.telegramAccount.updateMany({
      where: { linkedByUserId: user.userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.notificationPreference.deleteMany({ where: { userId: user.userId } });
  });

  if (avatar?.avatar) await deleteObject(avatar.avatar.storageKey);

  await revokeAllSessions(user.userId);
  await destroySession();
  await audit({
    action: 'account.delete',
    meta: { centersClosed: soleOwned.length, retention: 'soft_delete_records_retained' },
  });

  return json({ ok: true });
});
