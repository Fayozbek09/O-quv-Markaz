import { prisma } from '@/lib/db';
import { json, orgMutation, readJson } from '@/lib/api';
import { issueCredentialsSchema } from '@/lib/validation/schemas';
import { buildTempCredentials } from '@/lib/auth/credentials';
import { audit } from '@/lib/security/audit';
import { scope } from '@/lib/tenant';
import { DEFAULT_NOTIFICATION_TYPES } from '@/lib/notifications/notify';
import { Conflict, NotFound } from '@/lib/errors';

type Params = { id: string };

/**
 * Issues (or re-issues) a student's portal login.
 *
 * The account created here is a plain `users` row linked one-to-one to the
 * student. It gets the STUDENT membership role, which carries no centre
 * permissions at all — the portal reads through lib/domain/portal.ts instead.
 */
export const POST = orgMutation<Params>(async (ctx, request, { id }) => {
  const body = await readJson(request, issueCredentialsSchema);

  const student = await prisma.student.findFirst({
    where: { ...scope.byId(ctx, id), deletedAt: null },
    include: { user: { select: { id: true, username: true } } },
  });
  if (!student) throw NotFound();

  const credentials = await buildTempCredentials({
    firstName: student.firstName,
    lastName: student.lastName,
    role: 'STUDENT',
    preferred: body.username,
  });

  const username = student.user
    ? (body.username ? credentials.username : (student.user.username ?? credentials.username))
    : credentials.username;

  if (student.user) {
    // Re-issue: same account, new secret, every live session dropped.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: student.user.id },
        data: {
          username,
          passwordHash: credentials.passwordHash,
          mustChangePassword: true,
          credentialsExpireAt: credentials.credentialsExpireAt,
        },
      }),
      prisma.session.updateMany({
        where: { userId: student.user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  } else {
    if (student.email) {
      const clash = await prisma.user.findFirst({
        where: { email: student.email, deletedAt: null },
        select: { id: true },
      });
      if (clash) throw Conflict('students.emailTaken');
    }
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username,
          email: student.email,
          passwordHash: credentials.passwordHash,
          mustChangePassword: true,
          credentialsExpireAt: credentials.credentialsExpireAt,
          profile: {
            create: { firstName: student.firstName, lastName: student.lastName },
          },
        },
      });
      await tx.notificationPreference.createMany({
        data: DEFAULT_NOTIFICATION_TYPES.map((type) => ({
          userId: user.id, type, inApp: true, telegram: false, email: false,
        })),
        skipDuplicates: true,
      });
      await tx.organizationMember.create({
        data: { organizationId: ctx.orgId, userId: user.id, role: 'STUDENT' },
      });
      await tx.student.update({ where: { id: student.id }, data: { userId: user.id } });
    });
  }

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    actorAdminId: ctx.admin?.adminId ?? null,
    isOverride: ctx.isOverride,
    action: 'student.credentials.issue',
    entityType: 'student',
    entityId: student.id,
  });

  return json({
    username,
    password: credentials.password,
    expiresAt: credentials.credentialsExpireAt,
    usernameWasTaken: credentials.wasTaken,
    requestedUsername: credentials.requested,
  });
}, 'students.credentials');
