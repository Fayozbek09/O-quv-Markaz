import { prisma } from '../db';
import { scope, assertAllOwned, findOwned, type OrgContext } from '../tenant';
import { audit } from '../security/audit';
import { parseAmountToMinor } from '../money';
import { BadRequest, Conflict, NotFound } from '../errors';
import type { z } from 'zod';
import type {
  generateInvoicesSchema, paymentInputSchema, paymentListQuerySchema,
} from '../validation/schemas';

export async function listPayments(ctx: OrgContext, query: z.infer<typeof paymentListQuerySchema>) {
  const where = {
    ...scope.org(ctx),
    ...(query.studentId ? { studentId: query.studentId } : {}),
    ...(query.groupId ? { groupId: query.groupId } : {}),
    ...(query.method !== 'ALL' ? { method: query.method } : {}),
    ...(query.from || query.until
      ? {
          paidAt: {
            ...(query.from ? { gte: new Date(`${query.from}T00:00:00Z`) } : {}),
            ...(query.until ? { lte: new Date(`${query.until}T23:59:59Z`) } : {}),
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { paidAt: 'desc' },
      skip: (query.page - 1) * query.perPage,
      take: query.perPage,
      include: {
        student: { select: { id: true, firstName: true, lastName: true } },
        group: { select: { id: true, name: true } },
        adjustments: true,
      },
    }),
    prisma.payment.count({ where }),
  ]);

  return { rows, total, page: query.page, perPage: query.perPage };
}

export async function recordPayment(ctx: OrgContext, input: z.infer<typeof paymentInputSchema>) {
  await assertAllOwned(ctx, 'student', [input.studentId]);
  if (input.groupId) await assertAllOwned(ctx, 'group', [input.groupId]);
  if (input.invoiceId) await findOwned(ctx, 'invoice', input.invoiceId);

  const amountMinor = parseAmountToMinor(input.amount, input.currency);
  if (amountMinor <= 0n) throw BadRequest('errors.invalidAmount');

  // When the teacher does not pick a specific charge, apply the payment to the
  // oldest open one for that student (and group, if given). Without this a
  // charge would stay OPEN even after the student has paid in full.
  const invoiceId = input.invoiceId ?? (await oldestOpenInvoiceId(ctx, input.studentId, input.groupId ?? null));

  const payment = await prisma.payment.create({
    data: {
      organizationId: ctx.orgId,
      studentId: input.studentId,
      groupId: input.groupId ?? null,
      invoiceId,
      amountMinor,
      currency: input.currency,
      paidAt: new Date(`${input.paidAt}T12:00:00Z`),
      method: input.method,
      note: input.note,
      receiptNo: input.receiptNo,
      createdByUserId: ctx.user.userId,
    },
  });

  if (invoiceId) await settleInvoiceIfPaid(ctx, invoiceId);

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.user.userId,
    action: 'payment.create',
    entityType: 'payment',
    entityId: payment.id,
    meta: { studentId: input.studentId, amountMinor: amountMinor.toString(), method: input.method },
  });
  return payment;
}

/**
 * Payments are never deleted or edited. A reversal writes a compensating
 * adjustment and flips the payment's status, so the original amount, date and
 * author stay on record.
 */
export async function reversePayment(ctx: OrgContext, paymentId: string, reason: string) {
  const payment = await prisma.payment.findFirst({ where: scope.byId(ctx, paymentId) });
  if (!payment) throw NotFound();
  if (payment.status === 'REVERSED') throw Conflict();

  await prisma.$transaction(async (tx) => {
    const flipped = await tx.payment.updateMany({
      where: { id: paymentId, organizationId: ctx.orgId, status: 'COMPLETED' },
      data: { status: 'REVERSED' },
    });
    // Guard against two concurrent reversals both writing an adjustment.
    if (flipped.count !== 1) throw Conflict();

    await tx.paymentAdjustment.create({
      data: {
        organizationId: ctx.orgId,
        paymentId,
        invoiceId: payment.invoiceId,
        type: 'REVERSAL',
        // The payment no longer counts toward `paid`, so the delta is zero here;
        // the negative signal is the status change. The row exists for the audit trail.
        deltaMinor: 0n,
        currency: payment.currency,
        reason,
        createdByUserId: ctx.user.userId,
      },
    });

    if (payment.invoiceId) {
      await tx.invoice.updateMany({
        where: { id: payment.invoiceId, organizationId: ctx.orgId },
        data: { status: 'OPEN' },
      });
    }
  });

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.user.userId,
    action: 'payment.reverse',
    entityType: 'payment',
    entityId: paymentId,
    meta: { reason },
  });
}

/**
 * Creates the expected charge for every active student in every active group
 * for one month. Re-running it is safe: the (student, group, period) unique
 * index makes it idempotent.
 */
export async function generateInvoices(
  ctx: OrgContext,
  input: z.infer<typeof generateInvoicesSchema>,
) {
  const groups = await prisma.group.findMany({
    where: {
      ...scope.orgLive(ctx),
      status: 'ACTIVE',
      ...(input.groupId ? { id: input.groupId } : {}),
    },
    include: {
      members: {
        where: { leftAt: null, student: { status: 'ACTIVE', deletedAt: null } },
        include: { student: { select: { id: true } } },
      },
    },
  });

  const dueDate = new Date(
    Date.UTC(input.year, input.month - 1, Math.min(input.dueDay, 28)),
  );

  const rows = groups.flatMap((group) =>
    group.members
      .map((member) => ({
        organizationId: ctx.orgId,
        studentId: member.studentId,
        groupId: group.id,
        periodYear: input.year,
        periodMonth: input.month,
        amountMinor: member.feeOverrideMinor ?? group.monthlyFeeMinor,
        currency: group.currency,
        dueDate,
      }))
      .filter((row) => row.amountMinor > 0n),
  );

  const result = await prisma.invoice.createMany({ data: rows, skipDuplicates: true });

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.user.userId,
    action: 'invoice.generate',
    entityType: 'organization',
    entityId: ctx.orgId,
    meta: { year: input.year, month: input.month, created: result.count },
  });
  return { created: result.count };
}

export async function listInvoices(ctx: OrgContext, year: number, month: number) {
  return prisma.invoice.findMany({
    where: { ...scope.org(ctx), periodYear: year, periodMonth: month },
    orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
    include: {
      student: { select: { id: true, firstName: true, lastName: true } },
      group: { select: { id: true, name: true } },
      payments: { where: { status: 'COMPLETED' }, select: { amountMinor: true } },
    },
    take: 500,
  });
}

async function oldestOpenInvoiceId(
  ctx: OrgContext,
  studentId: string,
  groupId: string | null,
): Promise<string | null> {
  const invoice = await prisma.invoice.findFirst({
    where: {
      ...scope.org(ctx),
      studentId,
      status: 'OPEN',
      ...(groupId ? { groupId } : {}),
    },
    orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }],
    select: { id: true },
  });
  return invoice?.id ?? null;
}

async function settleInvoiceIfPaid(ctx: OrgContext, invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: scope.byId(ctx, invoiceId),
    include: { payments: { where: { status: 'COMPLETED' }, select: { amountMinor: true } } },
  });
  if (!invoice) return;
  const paid = invoice.payments.reduce((sum, p) => sum + p.amountMinor, 0n);
  if (paid >= invoice.amountMinor && invoice.status === 'OPEN') {
    await prisma.invoice.updateMany({ where: scope.byId(ctx, invoiceId), data: { status: 'PAID' } });
  }
}
