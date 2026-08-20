import { prisma } from '../db';
import { scope, type OrgContext } from '../tenant';
import { orgBalance, listDebtors } from './billing';
import { attendanceSummary } from './attendance';
import { dayBounds, monthBounds, zonedDateIso } from './time';

export async function dashboardData(ctx: OrgContext, timeZone: string) {
  const now = new Date();
  const todayIso = zonedDateIso(now, timeZone);
  const [dayStart, dayEnd] = dayBounds(todayIso, timeZone);
  const year = Number(todayIso.slice(0, 4));
  const month = Number(todayIso.slice(5, 7));
  const [monthStart, monthEnd] = monthBounds(year, month, timeZone);

  const [todayLessons, activeStudents, monthBal, todayAttendance, monthAttendance, debtors, upcoming] =
    await Promise.all([
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
          _count: { select: { attendance: true } },
        },
      }),
      prisma.student.count({ where: { ...scope.orgLive(ctx), status: 'ACTIVE' } }),
      orgBalance(ctx, { year, month, from: monthStart, until: monthEnd }),
      attendanceSummary(ctx, { from: dayStart, until: dayEnd }),
      attendanceSummary(ctx, { from: monthStart, until: monthEnd }),
      listDebtors(ctx, { limit: 5 }),
      prisma.lesson.findMany({
        where: { ...scope.orgLive(ctx), startsAt: { gte: dayEnd }, status: 'SCHEDULED' },
        orderBy: { startsAt: 'asc' },
        take: 5,
        include: { group: { select: { id: true, name: true, color: true } } },
      }),
    ]);

  const expectedThisMonth = await prisma.invoice.aggregate({
    where: { ...scope.org(ctx), periodYear: year, periodMonth: month, status: { not: 'VOID' } },
    _sum: { amountMinor: true },
  });

  const expectedMinor = expectedThisMonth._sum.amountMinor ?? 0n;
  const collectionRate =
    expectedMinor > 0n ? Number(monthBal.paidMinor) / Number(expectedMinor) : null;

  const unmarkedToday = todayLessons.filter(
    (l) => l._count.attendance === 0 && l.startsAt <= now && l.status !== 'CANCELLED',
  ).length;

  return {
    todayIso, year, month,
    todayLessons,
    todayStudentCount: todayLessons.reduce((n, l) => n + l.group._count.members, 0),
    unmarkedToday,
    activeStudents,
    monthBalance: monthBal,
    monthExpectedMinor: expectedMinor,
    collectionRate,
    todayAttendance,
    monthAttendance,
    debtors: debtors.rows,
    upcoming,
  };
}
