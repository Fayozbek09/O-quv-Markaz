import { prisma } from '../db';
import { scope, assertAllOwned, teacherScope, type OrgContext } from '../tenant';
import { audit } from '../security/audit';
import { NotFound } from '../errors';
import type { z } from 'zod';
import type { attendanceMarkSchema } from '../validation/schemas';

export async function markAttendance(
  ctx: OrgContext,
  input: z.infer<typeof attendanceMarkSchema>,
) {
  const lesson = await prisma.lesson.findFirst({
    // A register belongs to the person teaching the lesson. Scoped by org
    // alone, any teacher in the centre could mark another teacher's class.
    where: { ...scope.byId(ctx, input.lessonId), ...teacherScope(ctx) },
    include: { group: { include: { members: { where: { leftAt: null } } } } },
  });
  if (!lesson || lesson.deletedAt) throw NotFound();

  // Every student id in the payload must belong to this tenant AND be a current
  // member of the lesson's group - otherwise a crafted request could attach an
  // attendance row to an unrelated student.
  const allowed = new Set(lesson.group.members.map((m) => m.studentId));
  const ids = input.entries.map((e) => e.studentId);
  await assertAllOwned(ctx, 'student', ids);
  if (ids.some((id) => !allowed.has(id))) throw NotFound();

  await prisma.$transaction(
    input.entries.map((entry) =>
      prisma.attendance.upsert({
        where: { lessonId_studentId: { lessonId: input.lessonId, studentId: entry.studentId } },
        create: {
          organizationId: ctx.orgId,
          lessonId: input.lessonId,
          studentId: entry.studentId,
          status: entry.status,
          minutesLate: entry.status === 'LATE' ? (entry.minutesLate ?? null) : null,
          note: entry.note,
          markedByUserId: ctx.actorUserId,
        },
        update: {
          status: entry.status,
          minutesLate: entry.status === 'LATE' ? (entry.minutesLate ?? null) : null,
          note: entry.note,
          markedByUserId: ctx.actorUserId,
        },
      }),
    ),
  );

  // Marking attendance is what turns a scheduled lesson into a completed one.
  if (lesson.status === 'SCHEDULED' && lesson.startsAt <= new Date()) {
    await prisma.lesson.updateMany({
      where: scope.byId(ctx, input.lessonId),
      data: { status: 'COMPLETED' },
    });
  }

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    action: 'attendance.mark',
    entityType: 'lesson',
    entityId: input.lessonId,
    meta: { entries: input.entries.length },
  });
}

export async function attendanceSummary(
  ctx: OrgContext,
  range: { from: Date; until: Date },
  groupId?: string,
) {
  const grouped = await prisma.attendance.groupBy({
    by: ['status'],
    where: {
      ...scope.org(ctx),
      lesson: {
        startsAt: { gte: range.from, lt: range.until },
        // A teacher's attendance rate is their own classes'; without this the
        // figure quietly described the whole centre.
        ...teacherScope(ctx),
        ...(groupId ? { groupId } : {}),
      },
    },
    _count: { _all: true },
  });

  const counts = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 };
  for (const g of grouped) counts[g.status] = g._count._all;
  const base = counts.PRESENT + counts.ABSENT + counts.LATE;
  return { ...counts, rate: base === 0 ? null : (counts.PRESENT + counts.LATE) / base };
}
