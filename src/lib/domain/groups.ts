import { prisma } from '../db';
import { scope, findOwned, assertAllOwned, type OrgContext } from '../tenant';
import { audit } from '../security/audit';
import { parseAmountToMinor } from '../money';
import { Conflict, NotFound } from '../errors';
import { eachDateIso, zonedTimeToUtc, zonedWeekday } from './time';
import type { z } from 'zod';
import type { generateLessonsSchema, groupInputSchema } from '../validation/schemas';

type GroupInput = z.infer<typeof groupInputSchema>;

export async function listGroups(ctx: OrgContext, includeArchived = false) {
  return prisma.group.findMany({
    where: {
      ...scope.orgLive(ctx),
      ...(includeArchived ? {} : { status: 'ACTIVE' as const }),
    },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    include: {
      _count: { select: { members: { where: { leftAt: null } } } },
      teacher: { include: { user: { include: { profile: true } } } },
    },
  });
}

export async function getGroup(ctx: OrgContext, id: string) {
  const group = await prisma.group.findFirst({
    where: scope.byId(ctx, id),
    include: {
      members: {
        where: { leftAt: null },
        include: { student: { select: { id: true, firstName: true, lastName: true, phone: true, status: true } } },
        orderBy: { joinedAt: 'asc' },
      },
      teacher: { include: { user: { include: { profile: true } } } },
    },
  });
  if (!group || group.deletedAt) throw NotFound();
  return group;
}

export async function createGroup(ctx: OrgContext, input: GroupInput) {
  if (input.teacherId) await assertMembership(ctx, input.teacherId);

  const existing = await prisma.group.findFirst({
    where: { organizationId: ctx.orgId, name: input.name },
  });
  if (existing) throw Conflict();

  const group = await prisma.group.create({
    data: {
      organizationId: ctx.orgId,
      name: input.name,
      subject: input.subject,
      teacherId: input.teacherId ?? null,
      monthlyFeeMinor: parseAmountToMinor(input.monthlyFee, input.currency),
      currency: input.currency,
      color: input.color,
      weekdays: input.weekdays,
      startTime: input.startTime ?? null,
      endTime: input.endTime ?? null,
      room: input.room,
      status: input.status,
    },
  });

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    action: 'group.create',
    entityType: 'group',
    entityId: group.id,
  });
  return group;
}

export async function updateGroup(ctx: OrgContext, id: string, input: GroupInput) {
  await findOwned(ctx, 'group', id, { deletedAt: null });
  if (input.teacherId) await assertMembership(ctx, input.teacherId);

  const clash = await prisma.group.findFirst({
    where: { organizationId: ctx.orgId, name: input.name, NOT: { id } },
  });
  if (clash) throw Conflict();

  const res = await prisma.group.updateMany({
    where: scope.byId(ctx, id),
    data: {
      name: input.name,
      subject: input.subject,
      teacherId: input.teacherId ?? null,
      monthlyFeeMinor: parseAmountToMinor(input.monthlyFee, input.currency),
      currency: input.currency,
      color: input.color,
      weekdays: input.weekdays,
      startTime: input.startTime ?? null,
      endTime: input.endTime ?? null,
      room: input.room,
      status: input.status,
      archivedAt: input.status === 'ARCHIVED' ? new Date() : null,
    },
  });
  if (res.count === 0) throw NotFound();

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    action: 'group.update',
    entityType: 'group',
    entityId: id,
  });
  return prisma.group.findFirst({ where: scope.byId(ctx, id) });
}

export async function addMember(
  ctx: OrgContext,
  groupId: string,
  studentId: string,
  feeOverride?: string | null,
) {
  // Both sides must belong to this tenant before they can be joined.
  await assertAllOwned(ctx, 'group', [groupId]);
  await assertAllOwned(ctx, 'student', [studentId]);

  const group = await prisma.group.findFirstOrThrow({ where: scope.byId(ctx, groupId) });

  const existing = await prisma.groupMember.findUnique({
    where: { groupId_studentId: { groupId, studentId } },
  });

  const feeOverrideMinor =
    feeOverride && feeOverride.trim() !== '' ? parseAmountToMinor(feeOverride, group.currency) : null;

  if (existing) {
    await prisma.groupMember.update({
      where: { id: existing.id },
      data: { leftAt: null, feeOverrideMinor },
    });
  } else {
    await prisma.groupMember.create({
      data: { organizationId: ctx.orgId, groupId, studentId, feeOverrideMinor },
    });
  }

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    action: 'group.member.add',
    entityType: 'group',
    entityId: groupId,
    meta: { studentId },
  });
}

export async function removeMember(ctx: OrgContext, groupId: string, studentId: string) {
  const res = await prisma.groupMember.updateMany({
    where: { organizationId: ctx.orgId, groupId, studentId, leftAt: null },
    data: { leftAt: new Date() },
  });
  if (res.count === 0) throw NotFound();
  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    action: 'group.member.remove',
    entityType: 'group',
    entityId: groupId,
    meta: { studentId },
  });
}

/** Materializes the recurring schedule into concrete lessons. */
export async function generateLessons(
  ctx: OrgContext,
  groupId: string,
  range: z.infer<typeof generateLessonsSchema>,
  timeZone: string,
) {
  const group = await prisma.group.findFirst({ where: scope.byId(ctx, groupId) });
  if (!group) throw NotFound();
  if (!group.startTime || !group.endTime || group.weekdays.length === 0) return { created: 0 };

  const seriesId = crypto.randomUUID();
  const rows = eachDateIso(range.from, range.until)
    .map((dateIso) => {
      const startsAt = zonedTimeToUtc(dateIso, group.startTime as string, timeZone);
      return { dateIso, startsAt };
    })
    .filter(({ startsAt }) => group.weekdays.includes(zonedWeekday(startsAt, timeZone)))
    .map(({ dateIso, startsAt }) => ({
      organizationId: ctx.orgId,
      groupId,
      teacherId: group.teacherId,
      startsAt,
      endsAt: zonedTimeToUtc(dateIso, group.endTime as string, timeZone),
      room: group.room,
      seriesId,
    }));

  // skipDuplicates leans on the (groupId, startsAt) unique index, so re-running
  // the generator is safe.
  const result = await prisma.lesson.createMany({ data: rows, skipDuplicates: true });

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    action: 'group.lessons.generate',
    entityType: 'group',
    entityId: groupId,
    meta: { created: result.count, from: range.from, until: range.until },
  });
  return { created: result.count };
}

async function assertMembership(ctx: OrgContext, memberId: string) {
  const member = await prisma.organizationMember.findFirst({
    where: { id: memberId, organizationId: ctx.orgId, removedAt: null },
  });
  if (!member) throw NotFound();
}
