import { prisma } from '../db';
import { scope, assertPermission, type OrgContext } from '../tenant';
import { audit } from '../security/audit';
import { parseAmountToMinor } from '../money';
import { monthBounds } from './time';
import { BadRequest } from '../errors';
import type { z } from 'zod';
import type { expenseInputSchema } from '../validation/schemas';

export type MonthFinance = {
  year: number;
  month: number;
  revenueMinor: bigint;
  invoicedMinor: bigint;
  outstandingMinor: bigint;
  salaryMinor: bigint;
  expenseMinor: bigint;
  netMinor: bigint;
};

/**
 * Twelve months of money for one calendar year, in five grouped queries rather
 * than 12 × 5 round trips. Adjustments are applied to revenue so a reversed
 * payment does not keep inflating the total.
 */
export async function yearlyFinance(
  ctx: OrgContext,
  year: number,
  timeZone: string,
): Promise<{ months: MonthFinance[]; totals: MonthFinance }> {
  const [yearFrom] = monthBounds(year, 1, timeZone);
  const [yearUntil] = monthBounds(year + 1, 1, timeZone);

  const [payments, adjustments, invoices, salaries, expenses] = await Promise.all([
    prisma.payment.findMany({
      where: { ...scope.org(ctx), status: 'COMPLETED', paidAt: { gte: yearFrom, lt: yearUntil } },
      select: { amountMinor: true, paidAt: true },
    }),
    prisma.paymentAdjustment.findMany({
      where: { ...scope.org(ctx), createdAt: { gte: yearFrom, lt: yearUntil } },
      select: { deltaMinor: true, createdAt: true },
    }),
    prisma.invoice.findMany({
      where: { ...scope.org(ctx), periodYear: year, status: { not: 'VOID' } },
      select: { amountMinor: true, periodMonth: true, status: true },
    }),
    prisma.salaryPayment.findMany({
      where: { ...scope.org(ctx), periodYear: year },
      select: { amountMinor: true, periodMonth: true },
    }),
    prisma.expense.findMany({
      where: { ...scope.org(ctx), spentAt: { gte: yearFrom, lt: yearUntil } },
      select: { amountMinor: true, spentAt: true },
    }),
  ]);

  const monthOf = (date: Date) =>
    Number(
      new Intl.DateTimeFormat('en-GB', { timeZone, month: 'numeric' }).format(date),
    );

  const months: MonthFinance[] = Array.from({ length: 12 }, (_, i) => ({
    year,
    month: i + 1,
    revenueMinor: 0n,
    invoicedMinor: 0n,
    outstandingMinor: 0n,
    salaryMinor: 0n,
    expenseMinor: 0n,
    netMinor: 0n,
  }));

  const at = (m: number) => months[m - 1]!;

  for (const p of payments) at(monthOf(p.paidAt)).revenueMinor += p.amountMinor;
  for (const a of adjustments) at(monthOf(a.createdAt)).revenueMinor += a.deltaMinor;
  for (const i of invoices) {
    at(i.periodMonth).invoicedMinor += i.amountMinor;
    if (i.status === 'OPEN') at(i.periodMonth).outstandingMinor += i.amountMinor;
  }
  for (const s of salaries) at(s.periodMonth).salaryMinor += s.amountMinor;
  for (const e of expenses) at(monthOf(e.spentAt)).expenseMinor += e.amountMinor;

  for (const m of months) {
    m.netMinor = m.revenueMinor - m.salaryMinor - m.expenseMinor;
  }

  const totals = months.reduce<MonthFinance>(
    (acc, m) => ({
      year,
      month: 0,
      revenueMinor: acc.revenueMinor + m.revenueMinor,
      invoicedMinor: acc.invoicedMinor + m.invoicedMinor,
      outstandingMinor: acc.outstandingMinor + m.outstandingMinor,
      salaryMinor: acc.salaryMinor + m.salaryMinor,
      expenseMinor: acc.expenseMinor + m.expenseMinor,
      netMinor: acc.netMinor + m.netMinor,
    }),
    {
      year, month: 0, revenueMinor: 0n, invoicedMinor: 0n, outstandingMinor: 0n,
      salaryMinor: 0n, expenseMinor: 0n, netMinor: 0n,
    },
  );

  return { months, totals };
}

/** Today / week / month / year takings, for the owner's dashboard header. */
export async function revenueSnapshot(ctx: OrgContext, timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const weekdayIndex = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday'));

  const dayStart = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00+05:00`);
  const weekStart = new Date(dayStart.getTime() - Math.max(0, weekdayIndex) * 86_400_000);
  const [monthStart] = monthBounds(year, month, timeZone);
  const [yearStart] = monthBounds(year, 1, timeZone);

  const sum = async (gte: Date) => {
    const agg = await prisma.payment.aggregate({
      _sum: { amountMinor: true },
      where: { ...scope.org(ctx), status: 'COMPLETED', paidAt: { gte } },
    });
    return agg._sum.amountMinor ?? 0n;
  };

  const [today, week, month_, year_] = await Promise.all([
    sum(dayStart), sum(weekStart), sum(monthStart), sum(yearStart),
  ]);
  return { todayMinor: today, weekMinor: week, monthMinor: month_, yearMinor: year_, year, month };
}

export async function listExpenses(ctx: OrgContext, year: number, month?: number, timeZone = 'Asia/Tashkent') {
  assertPermission(ctx, 'expenses.read');
  const [from, until] = month ? monthBounds(year, month, timeZone) : [
    monthBounds(year, 1, timeZone)[0],
    monthBounds(year + 1, 1, timeZone)[0],
  ];
  return prisma.expense.findMany({
    where: { ...scope.org(ctx), spentAt: { gte: from, lt: until } },
    orderBy: { spentAt: 'desc' },
  });
}

export async function createExpense(ctx: OrgContext, input: z.infer<typeof expenseInputSchema>) {
  // Checked here as well as at the route: the domain layer is called directly
  // by jobs and by tests, and a permission check that only lives in a wrapper
  // is one refactor away from being lost.
  assertPermission(ctx, 'expenses.write');

  const amountMinor = parseAmountToMinor(input.amount, input.currency);
  if (amountMinor <= 0n) throw BadRequest('errors.invalidAmount');

  const expense = await prisma.expense.create({
    data: {
      organizationId: ctx.orgId,
      category: input.category,
      title: input.title,
      amountMinor,
      currency: input.currency,
      spentAt: new Date(`${input.spentAt}T12:00:00Z`),
      note: input.note,
      createdByUserId: ctx.actorUserId,
    },
  });

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    actorAdminId: ctx.admin?.adminId ?? null,
    isOverride: ctx.isOverride,
    action: 'expense.create',
    entityType: 'expense',
    entityId: expense.id,
    meta: { amountMinor: amountMinor.toString(), category: input.category },
  });
  return expense;
}
