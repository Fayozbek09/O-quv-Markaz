import { prisma } from '../db';
import { scope, findOwned, assertAllOwned, teacherScope, type OrgContext } from '../tenant';
import { audit } from '../security/audit';
import { Conflict, NotFound } from '../errors';
import { notify, groupStudentUserIds } from '../notifications/notify';
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
      // A teacher's calendar is their own timetable, not the centre's.
      ...teacherScope(ctx),
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
    // The lesson carries its group's roster, so another teacher's class is a
    // 404 rather than a readable register.
    where: { ...scope.byId(ctx, id), ...teacherScope(ctx) },
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

/**
 * Scheduling conflicts.
 *
 * Three things cannot be in two places at once: a group, a teacher and a room.
 * The check is a true interval overlap (`newStart < existingEnd && newEnd >
 * existingStart`), not an equal-start-time comparison — a 18:00–19:30 lesson
 * and a 19:00–20:30 lesson in the same room clash even though neither starts
 * when the other does.
 *
 * Cancelled lessons free their slot, and the lesson being edited is excluded
 * from its own check.
 */
export type ScheduleConflict = {
  kind: 'group' | 'teacher' | 'room';
  lessonId: string;
  startsAt: Date;
  endsAt: Date;
  groupName: string;
};

export async function findScheduleConflict(
  ctx: OrgContext,
  input: {
    groupId: string;
    teacherId?: string | null;
    room?: string | null;
    startsAt: Date;
    endsAt: Date;
    excludeLessonId?: string;
  },
): Promise<ScheduleConflict | null> {
  const overlapping = await prisma.lesson.findMany({
    where: {
      organizationId: ctx.orgId,
      deletedAt: null,
      status: { not: 'CANCELLED' },
      startsAt: { lt: input.endsAt },
      endsAt: { gt: input.startsAt },
      ...(input.excludeLessonId ? { NOT: { id: input.excludeLessonId } } : {}),
      OR: [
        { groupId: input.groupId },
        ...(input.teacherId ? [{ teacherId: input.teacherId }] : []),
        ...(input.room ? [{ room: input.room }] : []),
      ],
    },
    select: {
      id: true, startsAt: true, endsAt: true, groupId: true, teacherId: true, room: true,
      group: { select: { name: true } },
    },
    orderBy: { startsAt: 'asc' },
    take: 1,
  });

  const clash = overlapping[0];
  if (!clash) return null;

  const kind: ScheduleConflict['kind'] =
    clash.groupId === input.groupId
      ? 'group'
      : input.teacherId && clash.teacherId === input.teacherId
        ? 'teacher'
        : 'room';

  return {
    kind,
    lessonId: clash.id,
    startsAt: clash.startsAt,
    endsAt: clash.endsAt,
    groupName: clash.group.name,
  };
}

export async function createLesson(ctx: OrgContext, input: LessonInput, timeZone: string) {
  await assertAllOwned(ctx, 'group', [input.groupId]);
  if (input.teacherId) await assertMembership(ctx, input.teacherId);

  const startsAt = zonedTimeToUtc(input.date, input.startTime, timeZone);
  const endsAt = zonedTimeToUtc(input.date, input.endTime, timeZone);

  const clash = await findScheduleConflict(ctx, {
    groupId: input.groupId,
    teacherId: input.teacherId ?? null,
    room: input.room ?? null,
    startsAt,
    endsAt,
  });
  if (clash) throw Conflict(`lessons.conflict.${clash.kind}`);

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
    actorUserId: ctx.actorUserId,
    action: 'lesson.create',
    entityType: 'lesson',
    entityId: lesson.id,
  });
  return lesson;
}

export async function updateLesson(ctx: OrgContext, id: string, input: LessonInput, timeZone: string) {
  const before = await findOwned<{ id: string; startsAt: Date; endsAt: Date; room: string | null }>(
    ctx,
    'lesson',
    id,
    { deletedAt: null, ...teacherScope(ctx) },
  );
  await assertAllOwned(ctx, 'group', [input.groupId]);

  const startsAt = zonedTimeToUtc(input.date, input.startTime, timeZone);
  const endsAt = zonedTimeToUtc(input.date, input.endTime, timeZone);

  const clash = await findScheduleConflict(ctx, {
    groupId: input.groupId,
    teacherId: input.teacherId ?? null,
    room: input.room ?? null,
    startsAt,
    endsAt,
    excludeLessonId: id,
  });
  if (clash) throw Conflict(`lessons.conflict.${clash.kind}`);

  const moved = before.startsAt.getTime() !== startsAt.getTime();

  const res = await prisma.lesson.updateMany({
    where: { ...scope.byId(ctx, id), ...teacherScope(ctx) },
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

  // A moved lesson is only useful to a student if they hear about it.
  if (moved) {
    await notify({
      organizationId: ctx.orgId,
      userIds: await groupStudentUserIds(ctx.orgId, input.groupId),
      type: 'LESSON_RESCHEDULED',
      titleKey: 'notifications.lessonRescheduled',
      payload: { lessonId: id, startsAt: startsAt.toISOString() },
    });
  }

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    action: 'lesson.update',
    entityType: 'lesson',
    entityId: id,
    meta: { moved },
  });
  return prisma.lesson.findFirst({ where: { ...scope.byId(ctx, id), ...teacherScope(ctx) } });
}

export async function setLessonStatus(
  ctx: OrgContext,
  id: string,
  input: z.infer<typeof lessonStatusSchema>,
) {
  const lesson = await findOwned<{ id: string; groupId: string; status: string }>(
    ctx,
    'lesson',
    id,
    // Cancelling is a teacher permission; cancelling somebody else's class is not.
    { deletedAt: null, ...teacherScope(ctx) },
  );

  const res = await prisma.lesson.updateMany({
    where: { ...scope.byId(ctx, id), ...teacherScope(ctx) },
    data: {
      status: input.status,
      cancelReason: input.status === 'CANCELLED' ? input.cancelReason : null,
    },
  });
  if (res.count === 0) throw NotFound();

  // The student portal already shows a CANCELLED badge; this makes sure nobody
  // has to open it to find out.
  if (input.status === 'CANCELLED' && lesson.status !== 'CANCELLED') {
    await notify({
      organizationId: ctx.orgId,
      userIds: await groupStudentUserIds(ctx.orgId, lesson.groupId),
      type: 'LESSON_CANCELLED',
      titleKey: 'notifications.lessonCancelled',
      payload: { lessonId: id },
    });
  }
  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    action: 'lesson.status',
    entityType: 'lesson',
    entityId: id,
    meta: { status: input.status },
  });
}

export async function deleteLesson(ctx: OrgContext, id: string) {
  const res = await prisma.lesson.updateMany({
    where: { ...scope.byId(ctx, id), ...teacherScope(ctx) },
    data: { deletedAt: new Date(), status: 'CANCELLED' },
  });
  if (res.count === 0) throw NotFound();
  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
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
