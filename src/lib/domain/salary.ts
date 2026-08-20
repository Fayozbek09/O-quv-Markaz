import { prisma } from '../db';
import { scope, findOwned, assertPermission, type OrgContext } from '../tenant';
import { audit } from '../security/audit';
import { parseAmountToMinor } from '../money';
import { notify } from '../notifications/notify';
import { monthBounds } from './time';
import { BadRequest, Forbidden } from '../errors';
import type { z } from 'zod';
import type { salaryPaymentSchema, salaryQuerySchema } from '../validation/schemas';

export type SalaryLine = {
  memberId: string;
  name: string;
  role: string;
  model: string;
  dueMinor: bigint;
  paidMinor: bigint;
  outstandingMinor: bigint;
  currency: string;
  lessonsTaught: number;
  collectedMinor: bigint;
  percent: number;
};

/**
 * Computes what each teacher is owed for a month.
 *
 *   FIXED       — the agreed monthly amount
 *   PER_LESSON  — amount × lessons actually delivered (cancelled ones excluded)
 *   PERCENTAGE  — share of payments collected for the groups they teach
 *   MIXED       — the fixed part plus the percentage part
 *
 * Everything is derived here on the server; the figure is never posted from a
 * form. A payout writes an immutable row and does not alter this calculation.
 */
export async function salarySheet(
  ctx: OrgContext,
  query: z.infer<typeof salaryQuerySchema>,
  timeZone: string,
): Promise<SalaryLine[]> {
  const [from, until] = monthBounds(query.year, query.month, timeZone);

  const members = await prisma.organizationMember.findMany({
    where: {
      ...scope.org(ctx),
      removedAt: null,
      role: { in: ['TEACHER', 'ADMIN', 'RECEPTIONIST', 'ASSISTANT', 'OWNER'] },
      ...(query.memberId ? { id: query.memberId } : {}),
    },
    select: {
      id: true, role: true, salaryModel: true, salaryAmountMinor: true,
      salaryPercentBp: true, currency: true,
      user: { select: { profile: { select: { firstName: true, lastName: true } } } },
    },
    orderBy: { joinedAt: 'asc' },
  });

  const memberIds = members.map((m) => m.id);
  if (memberIds.length === 0) return [];

  const [lessonCounts, groupsByTeacher, payouts] = await Promise.all([
    prisma.lesson.groupBy({
      by: ['teacherId'],
      where: {
        ...scope.orgLive(ctx),
        teacherId: { in: memberIds },
        startsAt: { gte: from, lt: until },
        status: { not: 'CANCELLED' },
      },
      _count: { _all: true },
    }),
    prisma.group.findMany({
      where: { ...scope.orgLive(ctx), teacherId: { in: memberIds } },
      select: { id: true, teacherId: true },
    }),
    prisma.salaryPayment.groupBy({
      by: ['memberId'],
      where: {
        ...scope.org(ctx),
        memberId: { in: memberIds },
        periodYear: query.year,
        periodMonth: query.month,
      },
      _sum: { amountMinor: true },
    }),
  ]);

  const groupIds = groupsByTeacher.map((g) => g.id);
  const collected = groupIds.length
    ? await prisma.payment.groupBy({
        by: ['groupId'],
        where: {
          ...scope.org(ctx),
          status: 'COMPLETED',
          groupId: { in: groupIds },
          paidAt: { gte: from, lt: until },
        },
        _sum: { amountMinor: true },
      })
    : [];

  const lessonsBy = new Map(lessonCounts.map((r) => [r.teacherId, r._count._all]));
  const paidBy = new Map(payouts.map((r) => [r.memberId, r._sum.amountMinor ?? 0n]));
  const collectedByGroup = new Map(collected.map((r) => [r.groupId, r._sum.amountMinor ?? 0n]));

  return members.map((member) => {
    const lessons = lessonsBy.get(member.id) ?? 0;
    const teacherGroups = groupsByTeacher.filter((g) => g.teacherId === member.id);
    const collectedMinor = teacherGroups.reduce<bigint>(
      (acc, g) => acc + (collectedByGroup.get(g.id) ?? 0n),
      0n,
    );

    const fixed = member.salaryAmountMinor;
    const share = (collectedMinor * BigInt(member.salaryPercentBp)) / 10000n;

    let dueMinor = 0n;
    switch (member.salaryModel) {
      case 'FIXED': dueMinor = fixed; break;
      case 'PER_LESSON': dueMinor = fixed * BigInt(lessons); break;
      case 'PERCENTAGE': dueMinor = share; break;
      case 'MIXED': dueMinor = fixed + share; break;
    }

    const paidMinor = paidBy.get(member.id) ?? 0n;
    const profile = member.user.profile;
    return {
      memberId: member.id,
      name: [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || '—',
      role: member.role,
      model: member.salaryModel,
      dueMinor,
      paidMinor,
      outstandingMinor: dueMinor - paidMinor,
      currency: member.currency,
      lessonsTaught: lessons,
      collectedMinor,
      percent: member.salaryPercentBp / 100,
    };
  });
}

/** A teacher's own line only. Never anyone else's. */
export async function ownSalary(ctx: OrgContext, year: number, month: number, timeZone: string) {
  if (!ctx.memberId) throw Forbidden();
  const [line] = await salarySheet(ctx, { year, month, memberId: ctx.memberId }, timeZone);
  const history = await prisma.salaryPayment.findMany({
    where: { ...scope.org(ctx), memberId: ctx.memberId },
    orderBy: { paidAt: 'desc' },
    take: 24,
  });
  return { line: line ?? null, history };
}

export async function recordSalaryPayment(
  ctx: OrgContext,
  input: z.infer<typeof salaryPaymentSchema>,
) {
  assertPermission(ctx, 'salary.write');
  const member = await findOwned<{ id: string; userId: string; salaryModel: string }>(
    ctx,
    'organizationMember',
    input.memberId,
    { removedAt: null },
  );

  const amountMinor = parseAmountToMinor(input.amount, input.currency);
  if (amountMinor <= 0n) throw BadRequest('errors.invalidAmount');

  const payment = await prisma.salaryPayment.create({
    data: {
      organizationId: ctx.orgId,
      memberId: member.id,
      periodYear: input.year,
      periodMonth: input.month,
      amountMinor,
      currency: input.currency,
      model: member.salaryModel as 'FIXED' | 'PER_LESSON' | 'PERCENTAGE' | 'MIXED',
      paidAt: new Date(`${input.paidAt}T12:00:00Z`),
      note: input.note,
      createdByUserId: ctx.actorUserId,
    },
  });

  await notify({
    organizationId: ctx.orgId,
    userIds: [member.userId],
    type: 'SALARY_PAID',
    titleKey: 'notifications.salaryPaid',
    payload: { year: input.year, month: input.month },
  });

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    actorAdminId: ctx.admin?.adminId ?? null,
    isOverride: ctx.isOverride,
    action: 'salary.pay',
    entityType: 'salary_payment',
    entityId: payment.id,
    meta: { memberId: member.id, amountMinor: amountMinor.toString(), period: `${input.year}-${input.month}` },
  });

  return payment;
}

export async function listSalaryPayments(ctx: OrgContext, year: number, month?: number) {
  return prisma.salaryPayment.findMany({
    where: {
      ...scope.org(ctx),
      periodYear: year,
      ...(month ? { periodMonth: month } : {}),
      ...(ctx.role === 'TEACHER' ? { memberId: ctx.memberId ?? '' } : {}),
    },
    orderBy: { paidAt: 'desc' },
    include: {
      member: { select: { id: true, role: true, user: { select: { profile: { select: { firstName: true, lastName: true } } } } } },
    },
  });
}
