import { prisma } from '../db';
import { scope, findOwned, assertAllOwned, type OrgContext } from '../tenant';
import { audit } from '../security/audit';
import { Conflict, NotFound } from '../errors';
import { dayBounds, zonedTimeToUtc } from './time';
import type { z } from 'zod';
import type { calendarQuerySchema, lessonInputSchema, lessonStatusSchema } from '../validation/schemas';

type LessonInput = z.infer<typeof lessonInputSchema>;

export async function listLessons(
  ctx: OrgContext,
  query: z.infer<typeof calendarQuerySchema>,
  timeZone: string,
) {
  const [from] = dayBounds(query.from, timeZone);
  const [, until] = dayBounds(query.until, timeZone);

  return prisma.lesson.findMany({
    where: {
      ...scope.orgLive(ctx),
      startsAt: { gte: from, lt: until },
      ...(query.groupId ? { groupId: query.groupId } : {}),
    },
    orderBy: { startsAt: 'asc' },
    include: {
      group: { select: { id: true, name: true, color: true, subject: true } },
      _count: { select: { attendance: true } },
    },
    take: 1000,
  });
}

export async function getLesson(ctx: OrgContext, id: string) {
  const lesson = await prisma.lesson.findFirst({
    where: scope.byId(ctx, id),
    include: {
      group: {
        include: {
          members: {
            where: { leftAt: null },
            include: {
              student: { select: { id: true, firstName: true, lastName: true, status: true } },
            },
          },
        },
      },
      attendance: true,
    },
  });
  if (!lesson || lesson.deletedAt) throw NotFound();
  return lesson;
}

export async function createLesson(ctx: OrgContext, input: LessonInput, timeZone: string) {
  await assertAllOwned(ctx, 'group', [input.groupId]);
  if (input.teacherId) await assertMembership(ctx, input.teacherId);

  const startsAt = zonedTimeToUtc(input.date, input.startTime, timeZone);
  const endsAt = zonedTimeToUtc(input.date, input.endTime, timeZone);

  const clash = await prisma.lesson.findFirst({
    where: { organizationId: ctx.orgId, groupId: input.groupId, startsAt, deletedAt: null },
  });
  if (clash) throw Conflict('lessons.conflict');

  const lesson = await prisma.lesson.create({
    data: {
      organizationId: ctx.orgId,
      groupId: input.groupId,
      teacherId: input.teacherId ?? null,
      startsAt,
      endsAt,
      room: input.room,
      topic: input.topic,
    },
  });

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.user.userId,
    action: 'lesson.create',
    entityType: 'lesson',
    entityId: lesson.id,
  });
  return lesson;
}

export async function updateLesson(ctx: OrgContext, id: string, input: LessonInput, timeZone: string) {
  await findOwned(ctx, 'lesson', id, { deletedAt: null });
  await assertAllOwned(ctx, 'group', [input.groupId]);

  const startsAt = zonedTimeToUtc(input.date, input.startTime, timeZone);
  const endsAt = zonedTimeToUtc(input.date, input.endTime, timeZone);

  const clash = await prisma.lesson.findFirst({
    where: { organizationId: ctx.orgId, groupId: input.groupId, startsAt, NOT: { id }, deletedAt: null },
  });
  if (clash) throw Conflict('lessons.conflict');

  const res = await prisma.lesson.updateMany({
    where: scope.byId(ctx, id),
    data: {
      groupId: input.groupId,
      teacherId: input.teacherId ?? null,
      startsAt,
      endsAt,
      room: input.room,
      topic: input.topic,
    },
  });
  if (res.count === 0) throw NotFound();

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.user.userId,
    action: 'lesson.update',
    entityType: 'lesson',
    entityId: id,
  });
  return prisma.lesson.findFirst({ where: scope.byId(ctx, id) });
}

export async function setLessonStatus(
  ctx: OrgContext,
  id: string,
  input: z.infer<typeof lessonStatusSchema>,
) {
  const res = await prisma.lesson.updateMany({
    where: scope.byId(ctx, id),
    data: {
      status: input.status,
      cancelReason: input.status === 'CANCELLED' ? input.cancelReason : null,
    },
  });
  if (res.count === 0) throw NotFound();
  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.user.userId,
    action: 'lesson.status',
    entityType: 'lesson',
    entityId: id,
    meta: { status: input.status },
  });
}

export async function deleteLesson(ctx: OrgContext, id: string) {
  const res = await prisma.lesson.updateMany({
    where: scope.byId(ctx, id),
    data: { deletedAt: new Date(), status: 'CANCELLED' },
  });
  if (res.count === 0) throw NotFound();
  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.user.userId,
    action: 'lesson.delete',
    entityType: 'lesson',
    entityId: id,
  });
}

async function assertMembership(ctx: OrgContext, memberId: string) {
  const member = await prisma.organizationMember.findFirst({
    where: { id: memberId, organizationId: ctx.orgId, removedAt: null },
  });
  if (!member) throw NotFound();
}
