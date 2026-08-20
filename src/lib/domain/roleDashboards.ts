import { prisma } from '../db';
import { scope, type OrgContext } from '../tenant';
import { listDebtors, orgBalance } from './billing';
import { revenueSnapshot } from './finance';
import { salarySheet } from './salary';
import { dayBounds, monthBounds, zonedDateIso } from './time';

/** Owner view: money first, then the day, then anything that needs attention. */
export async function centerOverview(ctx: OrgContext, timeZone: string) {
  const now = new Date();
  const todayIso = zonedDateIso(now, timeZone);
  const [dayStart, dayEnd] = dayBounds(todayIso, timeZone);
  const year = Number(todayIso.slice(0, 4));
  const month = Number(todayIso.slice(5, 7));
  const [monthStart, monthEnd] = monthBounds(year, month, timeZone);

  const [
    revenue, students, teachers, receptionists, groups, courses,
    todayLessons, cancelledToday, upcoming, debtors, balance, activity, expenseAgg,
  ] = await Promise.all([
    revenueSnapshot(ctx, timeZone, now),
    prisma.student.count({ where: { ...scope.orgLive(ctx), status: 'ACTIVE' } }),
    prisma.organizationMember.count({ where: { ...scope.org(ctx), role: 'TEACHER', removedAt: null } }),
    prisma.organizationMember.count({
      where: { ...scope.org(ctx), role: { in: ['RECEPTIONIST', 'ASSISTANT'] }, removedAt: null },
    }),
    prisma.group.count({ where: { ...scope.orgLive(ctx), status: 'ACTIVE' } }),
    prisma.course.count({ where: { ...scope.orgLive(ctx), isActive: true } }),
    prisma.lesson.findMany({
      where: { ...scope.orgLive(ctx), startsAt: { gte: dayStart, lt: dayEnd } },
      orderBy: { startsAt: 'asc' },
      include: {
        group: {
          select: {
            id: true, name: true, color: true,
            _count: { select: { members: { where: { leftAt: null } } } },
          },
        },
        teacher: { select: { user: { select: { profile: { select: { firstName: true, lastName: true } } } } } },
        _count: { select: { attendance: true } },
      },
    }),
    prisma.lesson.count({
      where: { ...scope.orgLive(ctx), status: 'CANCELLED', startsAt: { gte: dayStart, lt: dayEnd } },
    }),
    prisma.lesson.findMany({
      where: { ...scope.orgLive(ctx), startsAt: { gte: dayEnd }, status: 'SCHEDULED' },
      orderBy: { startsAt: 'asc' },
      take: 6,
      include: { group: { select: { id: true, name: true, color: true } } },
    }),
    listDebtors(ctx, { limit: 6 }).then((r) => r.rows),
    orgBalance(ctx, { year, month, from: monthStart, until: monthEnd }),
    prisma.auditLog.findMany({
      where: { ...scope.org(ctx) },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true, action: true, createdAt: true, isOverride: true,
        actor: { select: { profile: { select: { firstName: true, lastName: true } } } },
        actorAdmin: { select: { fullName: true } },
      },
    }),
    prisma.expense.aggregate({
      _sum: { amountMinor: true },
      where: { ...scope.org(ctx), spentAt: { gte: monthStart, lt: monthEnd } },
    }),
  ]);

  const salaries = await salarySheet(ctx, { year, month }, timeZone);
  const salaryDueMinor = salaries.reduce<bigint>((acc, line) => acc + line.dueMinor, 0n);
  const salaryPaidMinor = salaries.reduce<bigint>((acc, line) => acc + line.paidMinor, 0n);
  const expenseMinor = expenseAgg._sum.amountMinor ?? 0n;

  return {
    revenue,
    counts: { students, teachers, receptionists, groups, courses },
    todayLessons,
    cancelledToday,
    upcoming,
    debtors,
    balance,
    activity,
    salaryDueMinor,
    salaryPaidMinor,
    expenseMinor,
    netMinor: revenue.monthMinor - salaryPaidMinor - expenseMinor,
  };
}

/** Reception view: the desk's day — who paid, who owes, who just joined. */
export async function receptionOverview(ctx: OrgContext, timeZone: string) {
  const now = new Date();
  const todayIso = zonedDateIso(now, timeZone);
  const [dayStart, dayEnd] = dayBounds(todayIso, timeZone);

  const [todayPayments, todayPaymentSum, todayLessons, debtors, recentStudents, groups] =
    await Promise.all([
      prisma.payment.findMany({
        where: { ...scope.org(ctx), status: 'COMPLETED', paidAt: { gte: dayStart, lt: dayEnd } },
        orderBy: { paidAt: 'desc' },
        take: 10,
        include: { student: { select: { id: true, firstName: true, lastName: true } } },
      }),
      prisma.payment.aggregate({
        _sum: { amountMinor: true },
        where: { ...scope.org(ctx), status: 'COMPLETED', paidAt: { gte: dayStart, lt: dayEnd } },
      }),
      prisma.lesson.findMany({
        where: { ...scope.orgLive(ctx), startsAt: { gte: dayStart, lt: dayEnd } },
        orderBy: { startsAt: 'asc' },
        include: {
          group: { select: { id: true, name: true, color: true, room: true } },
          teacher: { select: { user: { select: { profile: { select: { firstName: true, lastName: true } } } } } },
        },
      }),
      listDebtors(ctx, { limit: 10 }).then((r) => r.rows),
      prisma.student.findMany({
        where: { ...scope.orgLive(ctx) },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { id: true, firstName: true, lastName: true, studentNo: true, createdAt: true },
      }),
      prisma.group.count({ where: { ...scope.orgLive(ctx), status: 'ACTIVE' } }),
    ]);

  return {
    todayPayments,
    todayPaidMinor: todayPaymentSum._sum.amountMinor ?? 0n,
    todayLessons,
    debtors,
    recentStudents,
    groups,
  };
}

/** Teacher view: strictly their own groups, lessons, homework and pay. */
export async function teacherOverview(ctx: OrgContext, timeZone: string) {
  const memberId = ctx.memberId;
  const now = new Date();
  const todayIso = zonedDateIso(now, timeZone);
  const [dayStart, dayEnd] = dayBounds(todayIso, timeZone);
  const year = Number(todayIso.slice(0, 4));
  const month = Number(todayIso.slice(5, 7));

  const mine = memberId ? { teacherId: memberId } : { teacherId: '' };

  const [todayLessons, groups, upcoming, homework, studentCount] = await Promise.all([
    prisma.lesson.findMany({
      where: { ...scope.orgLive(ctx), ...mine, startsAt: { gte: dayStart, lt: dayEnd } },
      orderBy: { startsAt: 'asc' },
      include: {
        group: {
          select: {
            id: true, name: true, color: true, room: true,
            _count: { select: { members: { where: { leftAt: null } } } },
          },
        },
        _count: { select: { attendance: true } },
      },
    }),
    prisma.group.findMany({
      where: { ...scope.orgLive(ctx), ...mine, status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, color: true, subject: true, room: true,
        weekdays: true, startTime: true, endTime: true,
        _count: { select: { members: { where: { leftAt: null } } } },
      },
    }),
    prisma.lesson.findMany({
      where: { ...scope.orgLive(ctx), ...mine, startsAt: { gte: dayEnd }, status: 'SCHEDULED' },
      orderBy: { startsAt: 'asc' },
      take: 6,
      include: { group: { select: { id: true, name: true, color: true } } },
    }),
    prisma.homework.findMany({
      where: {
        ...scope.orgLive(ctx),
        ...(memberId ? { group: { teacherId: memberId } } : { id: '' }),
        status: 'PUBLISHED',
      },
      orderBy: { dueAt: 'asc' },
      take: 6,
      include: {
        group: { select: { id: true, name: true } },
        _count: { select: { submissions: true } },
      },
    }),
    memberId
      ? prisma.groupMember.count({
          where: { ...scope.org(ctx), leftAt: null, group: { teacherId: memberId } },
        })
      : Promise.resolve(0),
  ]);

  const salary = memberId ? (await salarySheet(ctx, { year, month, memberId }, timeZone))[0] ?? null : null;

  return { todayLessons, groups, upcoming, homework, studentCount, salary, year, month };
}
