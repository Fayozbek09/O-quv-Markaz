import { prisma } from '../db';
import { scope, type OrgContext } from '../tenant';

/**
 * Balance model
 * -------------
 *   expected = sum of non-void invoices
 *   paid     = sum of COMPLETED payments
 *   adjusted = sum of adjustment deltas (negative for reversals/discounts)
 *   debt     = expected - (paid + adjusted)
 *
 * Nothing is ever deleted: a reversal is a new adjustment row, so the ledger
 * stays auditable.
 */
export type Balance = {
  expectedMinor: bigint;
  paidMinor: bigint;
  adjustedMinor: bigint;
  debtMinor: bigint;
};

const zero: Balance = { expectedMinor: 0n, paidMinor: 0n, adjustedMinor: 0n, debtMinor: 0n };

type PeriodFilter = { year?: number; month?: number; from?: Date; until?: Date };

export async function orgBalance(ctx: OrgContext, period?: PeriodFilter): Promise<Balance> {
  const invoiceWhere = {
    ...scope.org(ctx),
    status: { not: 'VOID' as const },
    ...(period?.year && period.month
      ? { periodYear: period.year, periodMonth: period.month }
      : {}),
  };
  const paymentWhere = {
    ...scope.org(ctx),
    status: 'COMPLETED' as const,
    ...(period?.from || period?.until
      ? { paidAt: { ...(period.from ? { gte: period.from } : {}), ...(period.until ? { lt: period.until } : {}) } }
      : {}),
  };

  const [inv, pay, adj] = await Promise.all([
    prisma.invoice.aggregate({ where: invoiceWhere, _sum: { amountMinor: true } }),
    prisma.payment.aggregate({ where: paymentWhere, _sum: { amountMinor: true } }),
    prisma.paymentAdjustment.aggregate({ where: scope.org(ctx), _sum: { deltaMinor: true } }),
  ]);

  const expectedMinor = inv._sum.amountMinor ?? 0n;
  const paidMinor = pay._sum.amountMinor ?? 0n;
  const adjustedMinor = adj._sum.deltaMinor ?? 0n;
  return {
    expectedMinor,
    paidMinor,
    adjustedMinor,
    debtMinor: expectedMinor - (paidMinor + adjustedMinor),
  };
}

export async function studentBalance(ctx: OrgContext, studentId: string): Promise<Balance> {
  const [inv, pay, adj] = await Promise.all([
    prisma.invoice.aggregate({
      where: { ...scope.org(ctx), studentId, status: { not: 'VOID' } },
      _sum: { amountMinor: true },
    }),
    prisma.payment.aggregate({
      where: { ...scope.org(ctx), studentId, status: 'COMPLETED' },
      _sum: { amountMinor: true },
    }),
    prisma.paymentAdjustment.aggregate({
      where: { ...scope.org(ctx), payment: { studentId } },
      _sum: { deltaMinor: true },
    }),
  ]);

  const expectedMinor = inv._sum.amountMinor ?? 0n;
  const paidMinor = pay._sum.amountMinor ?? 0n;
  const adjustedMinor = adj._sum.deltaMinor ?? 0n;
  return {
    expectedMinor,
    paidMinor,
    adjustedMinor,
    debtMinor: expectedMinor - (paidMinor + adjustedMinor),
  };
}

export type DebtorRow = {
  studentId: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  parentName: string | null;
  parentPhone: string | null;
  parentTelegramLinked: boolean;
  expectedMinor: bigint;
  paidMinor: bigint;
  debtMinor: bigint;
  oldestDueDate: Date | null;
  daysOverdue: number;
};

/**
 * "Who owes me money?" — one aggregate per student, computed in the database.
 * The organization id is bound as a parameter, never interpolated.
 */
export async function listDebtors(
  ctx: OrgContext,
  opts: { overdueOnly?: boolean; q?: string; limit?: number; offset?: number } = {},
): Promise<{ rows: DebtorRow[]; total: number }> {
  const limit = Math.min(opts.limit ?? 25, 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const search = opts.q?.trim() ? `%${opts.q.trim()}%` : null;
  const today = new Date();

  const rows = await prisma.$queryRaw<
    Array<{
      student_id: string;
      first_name: string;
      last_name: string | null;
      phone: string | null;
      parent_name: string | null;
      parent_phone: string | null;
      parent_tg: boolean;
      expected: bigint;
      paid: bigint;
      adjusted: bigint;
      oldest_due: Date | null;
    }>
  >`
    SELECT s.id                                  AS student_id,
           s."firstName"                         AS first_name,
           s."lastName"                          AS last_name,
           s.phone                               AS phone,
           p."fullName"                          AS parent_name,
           p.phone                               AS parent_phone,
           COALESCE(p."telegramChatId" IS NOT NULL, false) AS parent_tg,
           COALESCE(i.expected, 0)               AS expected,
           COALESCE(pm.paid, 0)                  AS paid,
           COALESCE(aj.adjusted, 0)              AS adjusted,
           i.oldest_due                          AS oldest_due
      FROM students s
      LEFT JOIN LATERAL (
            SELECT SUM(inv."amountMinor") AS expected,
                   MIN(inv."dueDate") FILTER (WHERE inv.status = 'OPEN') AS oldest_due
              FROM invoices inv
             WHERE inv."studentId" = s.id
               AND inv."organizationId" = ${ctx.orgId}::uuid
               AND inv.status <> 'VOID'
           ) i ON TRUE
      LEFT JOIN LATERAL (
            SELECT SUM(pay."amountMinor") AS paid
              FROM payments pay
             WHERE pay."studentId" = s.id
               AND pay."organizationId" = ${ctx.orgId}::uuid
               AND pay.status = 'COMPLETED'
           ) pm ON TRUE
      LEFT JOIN LATERAL (
            SELECT SUM(a."deltaMinor") AS adjusted
              FROM payment_adjustments a
              JOIN payments pay2 ON pay2.id = a."paymentId"
             WHERE pay2."studentId" = s.id
               AND a."organizationId" = ${ctx.orgId}::uuid
           ) aj ON TRUE
      LEFT JOIN LATERAL (
            SELECT sp."fullName", sp.phone, sp."telegramChatId"
              FROM student_parents sp
             WHERE sp."studentId" = s.id
             ORDER BY sp."isPrimary" DESC, sp."createdAt" ASC
             LIMIT 1
           ) p ON TRUE
     WHERE s."organizationId" = ${ctx.orgId}::uuid
       AND s."deletedAt" IS NULL
       AND (${search}::text IS NULL
            OR s."firstName" ILIKE ${search}
            OR COALESCE(s."lastName", '') ILIKE ${search}
            OR COALESCE(s.phone, '') ILIKE ${search})
       AND COALESCE(i.expected, 0) - (COALESCE(pm.paid, 0) + COALESCE(aj.adjusted, 0)) > 0
       AND (${opts.overdueOnly ?? false}::boolean = false OR i.oldest_due < ${today}::date)
     ORDER BY (COALESCE(i.expected, 0) - (COALESCE(pm.paid, 0) + COALESCE(aj.adjusted, 0))) DESC
     LIMIT ${limit} OFFSET ${offset}
  `;

  const mapped: DebtorRow[] = rows.map((r) => {
    const debtMinor = BigInt(r.expected ?? 0n) - (BigInt(r.paid ?? 0n) + BigInt(r.adjusted ?? 0n));
    const daysOverdue = r.oldest_due
      ? Math.max(0, Math.floor((today.getTime() - new Date(r.oldest_due).getTime()) / 86_400_000))
      : 0;
    return {
      studentId: r.student_id,
      firstName: r.first_name,
      lastName: r.last_name,
      phone: r.phone,
      parentName: r.parent_name,
      parentPhone: r.parent_phone,
      parentTelegramLinked: Boolean(r.parent_tg),
      expectedMinor: BigInt(r.expected ?? 0n),
      paidMinor: BigInt(r.paid ?? 0n) + BigInt(r.adjusted ?? 0n),
      debtMinor,
      oldestDueDate: r.oldest_due ? new Date(r.oldest_due) : null,
      daysOverdue,
    };
  });

  return { rows: mapped, total: mapped.length };
}

export { zero as zeroBalance };
