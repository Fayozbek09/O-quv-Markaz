import { prisma } from '../db';
import { scope, assertAllOwned, type OrgContext } from '../tenant';
import { audit } from '../security/audit';
import { notify, groupStudentUserIds } from '../notifications/notify';
import { BadRequest, Forbidden, NotFound } from '../errors';
import type { z } from 'zod';
import type {
  homeworkInputSchema, homeworkListQuerySchema, submissionMarkSchema,
} from '../validation/schemas';

/**
 * A teacher may only touch homework for a group they teach. Owners, admins and
 * receptionists (read-only) see the whole centre.
 */
async function assertGroupAccess(ctx: OrgContext, groupId: string) {
  const group = await prisma.group.findFirst({
    where: { ...scope.byId(ctx, groupId), deletedAt: null },
    select: { id: true, teacherId: true, name: true },
  });
  if (!group) throw NotFound();
  if (ctx.role === 'TEACHER' && group.teacherId !== ctx.memberId) throw Forbidden();
  return group;
}

export async function listHomework(ctx: OrgContext, query: z.infer<typeof homeworkListQuerySchema>) {
  const where = {
    ...scope.orgLive(ctx),
    ...(query.groupId ? { groupId: query.groupId } : {}),
    ...(query.status === 'ALL' ? {} : { status: query.status }),
    // A teacher's list is scoped to their own groups by the query itself, not
    // by hiding rows in the UI.
    ...(ctx.role === 'TEACHER' && ctx.memberId ? { group: { teacherId: ctx.memberId } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.homework.findMany({
      where,
      orderBy: { dueAt: 'desc' },
      skip: (query.page - 1) * query.perPage,
      take: query.perPage,
      include: {
        group: { select: { id: true, name: true } },
        teacher: { select: { id: true, user: { select: { profile: { select: { firstName: true, lastName: true } } } } } },
        _count: { select: { submissions: true, attachments: true } },
      },
    }),
    prisma.homework.count({ where }),
  ]);
  return { rows, total, page: query.page, perPage: query.perPage };
}

export async function getHomework(ctx: OrgContext, id: string) {
  const homework = await prisma.homework.findFirst({
    where: { ...scope.byId(ctx, id), deletedAt: null },
    include: {
      group: { select: { id: true, name: true, teacherId: true } },
      attachments: { include: { file: { select: { id: true, mimeType: true, sizeBytes: true } } } },
      submissions: {
        include: { student: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { student: { lastName: 'asc' } },
      },
    },
  });
  if (!homework) throw NotFound();
  if (ctx.role === 'TEACHER' && homework.group.teacherId !== ctx.memberId) throw NotFound();
  return homework;
}

/**
 * Creating homework also creates one submission row per current group member,
 * so "who has not handed it in" is a query rather than a set difference.
 */
export async function createHomework(ctx: OrgContext, input: z.infer<typeof homeworkInputSchema>) {
  const group = await assertGroupAccess(ctx, input.groupId);
  const dueAt = new Date(input.dueAt);
  if (Number.isNaN(dueAt.getTime())) throw BadRequest('errors.invalidDate');
  if (input.fileIds.length > 0) {
    const owned = await prisma.file.count({
      where: { id: { in: input.fileIds }, organizationId: ctx.orgId, deletedAt: null },
    });
    if (owned !== new Set(input.fileIds).size) throw NotFound();
  }

  const members = await prisma.groupMember.findMany({
    where: { organizationId: ctx.orgId, groupId: group.id, leftAt: null },
    select: { studentId: true },
  });

  const homework = await prisma.$transaction(async (tx) => {
    const created = await tx.homework.create({
      data: {
        organizationId: ctx.orgId,
        groupId: group.id,
        teacherId: ctx.memberId,
        title: input.title,
        description: input.description,
        dueAt,
        status: input.status,
        maxScore: input.maxScore,
        attachments: { create: input.fileIds.map((fileId) => ({ fileId })) },
      },
    });
    if (members.length > 0) {
      await tx.homeworkSubmission.createMany({
        data: members.map((m) => ({
          organizationId: ctx.orgId,
          homeworkId: created.id,
          studentId: m.studentId,
          status: 'ASSIGNED' as const,
        })),
        skipDuplicates: true,
      });
    }
    return created;
  });

  if (input.status === 'PUBLISHED') {
    await notify({
      organizationId: ctx.orgId,
      userIds: await groupStudentUserIds(ctx.orgId, group.id),
      type: 'HOMEWORK_ASSIGNED',
      titleKey: 'notifications.homeworkAssigned',
      payload: { homeworkId: homework.id, groupName: group.name },
    });
  }

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    actorAdminId: ctx.admin?.adminId ?? null,
    isOverride: ctx.isOverride,
    action: 'homework.create',
    entityType: 'homework',
    entityId: homework.id,
  });
  return homework;
}

export async function updateHomework(
  ctx: OrgContext,
  id: string,
  input: z.infer<typeof homeworkInputSchema>,
) {
  const existing = await getHomework(ctx, id);
  await assertGroupAccess(ctx, input.groupId);

  const homework = await prisma.homework.update({
    where: { id: existing.id },
    data: {
      groupId: input.groupId,
      title: input.title,
      description: input.description,
      dueAt: new Date(input.dueAt),
      status: input.status,
      maxScore: input.maxScore,
    },
  });

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    actorAdminId: ctx.admin?.adminId ?? null,
    isOverride: ctx.isOverride,
    action: 'homework.update',
    entityType: 'homework',
    entityId: homework.id,
  });
  return homework;
}

export async function deleteHomework(ctx: OrgContext, id: string) {
  const existing = await getHomework(ctx, id);
  await prisma.homework.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    actorAdminId: ctx.admin?.adminId ?? null,
    isOverride: ctx.isOverride,
    action: 'homework.delete',
    entityType: 'homework',
    entityId: existing.id,
  });
}

/** Teacher marks who handed in what. */
export async function markSubmissions(
  ctx: OrgContext,
  homeworkId: string,
  input: z.infer<typeof submissionMarkSchema>,
) {
  const homework = await getHomework(ctx, homeworkId);
  const studentIds = input.entries.map((e) => e.studentId);
  await assertAllOwned(ctx, 'student', studentIds);

  // Every named student must actually be in the group this homework belongs to.
  const members = await prisma.groupMember.findMany({
    where: { organizationId: ctx.orgId, groupId: homework.groupId, studentId: { in: studentIds } },
    select: { studentId: true },
  });
  const allowed = new Set(members.map((m) => m.studentId));
  if (studentIds.some((id) => !allowed.has(id))) throw NotFound();

  const now = new Date();
  await prisma.$transaction(
    input.entries.map((entry) =>
      prisma.homeworkSubmission.upsert({
        where: { homeworkId_studentId: { homeworkId: homework.id, studentId: entry.studentId } },
        create: {
          organizationId: ctx.orgId,
          homeworkId: homework.id,
          studentId: entry.studentId,
          status: entry.status,
          score: entry.score ?? null,
          feedback: entry.feedback,
          markedByUserId: ctx.actorUserId,
          submittedAt: entry.status === 'SUBMITTED' || entry.status === 'LATE' ? now : null,
        },
        update: {
          status: entry.status,
          score: entry.score ?? null,
          feedback: entry.feedback,
          markedByUserId: ctx.actorUserId,
        },
      }),
    ),
  );

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    actorAdminId: ctx.admin?.adminId ?? null,
    isOverride: ctx.isOverride,
    action: 'homework.mark',
    entityType: 'homework',
    entityId: homework.id,
    meta: { count: input.entries.length },
  });
}
