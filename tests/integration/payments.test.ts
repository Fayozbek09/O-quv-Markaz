import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTenant, makeStudent, makeGroup, truncateAll, db, type Tenant } from '../factories';
import { recordPayment, reversePayment, generateInvoices, listPayments } from '@/lib/domain/payments';
import { studentBalance, orgBalance, listDebtors } from '@/lib/domain/billing';
import { paymentInputSchema, paymentListQuerySchema } from '@/lib/validation/schemas';

let tenant: Tenant;
let student: Awaited<ReturnType<typeof makeStudent>>;
let group: Awaited<ReturnType<typeof makeGroup>>;

beforeAll(async () => {
  await truncateAll();
  tenant = await createTenant();
  student = await makeStudent(tenant, 'Payer');
  group = await makeGroup(tenant, 'Paying Group', 400_000n);
  await db.groupMember.create({
    data: { organizationId: tenant.org.id, groupId: group.id, studentId: student.id },
  });
});
afterAll(() => db.$disconnect());

const payment = (over: Record<string, unknown> = {}) =>
  paymentInputSchema.parse({
    studentId: student.id,
    groupId: group.id,
    amount: '200000',
    currency: 'UZS',
    paidAt: '2026-08-10',
    method: 'CASH',
    ...over,
  });

describe('invoices', () => {
  it('creates one charge per active member and is idempotent on re-run', async () => {
    const first = await generateInvoices(tenant.ctx, { year: 2026, month: 8, dueDay: 5 });
    expect(first.created).toBe(1);

    const second = await generateInvoices(tenant.ctx, { year: 2026, month: 8, dueDay: 5 });
    expect(second.created).toBe(0);

    expect(await db.invoice.count({ where: { organizationId: tenant.org.id } })).toBe(1);
  });

  it('honours a per-student fee override', async () => {
    const other = await makeStudent(tenant, 'Discounted');
    await db.groupMember.create({
      data: {
        organizationId: tenant.org.id,
        groupId: group.id,
        studentId: other.id,
        feeOverrideMinor: 250_000n,
      },
    });

    await generateInvoices(tenant.ctx, { year: 2026, month: 9, dueDay: 5 });
    const invoice = await db.invoice.findFirstOrThrow({
      where: { studentId: other.id, periodMonth: 9 },
    });
    expect(invoice.amountMinor).toBe(250_000n);
  });
});

describe('debt arithmetic', () => {
  // Its own tenant, so no other test's charges can shift these numbers.
  let solo: Tenant;
  let soloStudent: Awaited<ReturnType<typeof makeStudent>>;
  let soloGroup: Awaited<ReturnType<typeof makeGroup>>;
  let soloInvoiceId: string;

  beforeAll(async () => {
    solo = await createTenant('Debt Math');
    soloStudent = await makeStudent(solo, 'Solo');
    soloGroup = await makeGroup(solo, 'Solo Group', 400_000n);
    await db.groupMember.create({
      data: { organizationId: solo.org.id, groupId: soloGroup.id, studentId: soloStudent.id },
    });
    await generateInvoices(solo.ctx, { year: 2026, month: 8, dueDay: 5 });
    soloInvoiceId = (
      await db.invoice.findFirstOrThrow({ where: { studentId: soloStudent.id } })
    ).id;
  });

  const soloPayment = (over: Record<string, unknown> = {}) =>
    paymentInputSchema.parse({
      studentId: soloStudent.id,
      groupId: soloGroup.id,
      amount: '200000',
      currency: 'UZS',
      paidAt: '2026-08-10',
      method: 'CASH',
      ...over,
    });

  it('expected minus paid is the debt', async () => {
    await recordPayment(solo.ctx, soloPayment());

    const balance = await studentBalance(solo.ctx, soloStudent.id);
    expect(balance.expectedMinor).toBe(400_000n);
    expect(balance.paidMinor).toBe(200_000n);
    expect(balance.debtMinor).toBe(200_000n);
  });

  it('shows a partially-paying student in the debtor report', async () => {
    const debtors = await listDebtors(solo.ctx, { limit: 50 });
    const row = debtors.rows.find((d) => d.studentId === soloStudent.id);
    expect(row?.debtMinor).toBe(200_000n);
  });

  it('settles the invoice once it is fully covered', async () => {
    await recordPayment(solo.ctx, soloPayment({ invoiceId: soloInvoiceId, amount: '200000' }));

    expect((await db.invoice.findUniqueOrThrow({ where: { id: soloInvoiceId } })).status).toBe('PAID');
    expect((await studentBalance(solo.ctx, soloStudent.id)).debtMinor).toBe(0n);
  });

  it('lists only students who actually owe money', async () => {
    const debtors = await listDebtors(solo.ctx, { limit: 50 });
    expect(debtors.rows.map((d) => d.studentId)).not.toContain(soloStudent.id);
  });

  it('rejects a zero or negative amount', async () => {
    await expect(recordPayment(tenant.ctx, payment({ amount: '0' }))).rejects.toMatchObject({ status: 400 });
    expect(() => payment({ amount: '-100' })).toThrow();
  });
});

describe('payments are immutable', () => {
  it('a reversal keeps the original row and adds a ledger entry', async () => {
    const created = await recordPayment(tenant.ctx, payment({ amount: '50000' }));
    const before = await orgBalance(tenant.ctx);

    await reversePayment(tenant.ctx, created.id, 'entered twice by mistake');

    const original = await db.payment.findUniqueOrThrow({ where: { id: created.id } });
    expect(original.amountMinor).toBe(50_000n);
    expect(original.status).toBe('REVERSED');

    const adjustment = await db.paymentAdjustment.findFirstOrThrow({ where: { paymentId: created.id } });
    expect(adjustment.type).toBe('REVERSAL');
    expect(adjustment.reason).toBe('entered twice by mistake');
    expect(adjustment.createdByUserId).toBe(tenant.user.id);

    // A reversed payment no longer counts toward the received total.
    const after = await orgBalance(tenant.ctx);
    expect(after.paidMinor).toBe(before.paidMinor - 50_000n);
  });

  it('refuses to reverse the same payment twice', async () => {
    const created = await recordPayment(tenant.ctx, payment({ amount: '10000' }));
    await reversePayment(tenant.ctx, created.id, 'first');
    await expect(reversePayment(tenant.ctx, created.id, 'second')).rejects.toMatchObject({ status: 409 });
  });

  it('only one of two concurrent reversals succeeds', async () => {
    const created = await recordPayment(tenant.ctx, payment({ amount: '10000' }));
    const results = await Promise.allSettled([
      reversePayment(tenant.ctx, created.id, 'a'),
      reversePayment(tenant.ctx, created.id, 'b'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.paymentAdjustment.count({ where: { paymentId: created.id } })).toBe(1);
  });

  it('reopens the invoice a reversed payment was settling', async () => {
    const invoice = await db.invoice.findFirstOrThrow({ where: { studentId: student.id, periodMonth: 8 } });
    const created = await recordPayment(tenant.ctx, payment({ invoiceId: invoice.id, amount: '400000' }));
    await reversePayment(tenant.ctx, created.id, 'chargeback');

    expect((await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('OPEN');
  });
});

describe('payment listing', () => {
  it('filters by student and by date range', async () => {
    const all = await listPayments(tenant.ctx, paymentListQuerySchema.parse({ perPage: 100 }));
    expect(all.rows.every((p) => p.organizationId === tenant.org.id)).toBe(true);

    const scoped = await listPayments(
      tenant.ctx,
      paymentListQuerySchema.parse({ studentId: student.id, from: '2026-08-01', until: '2026-08-31' }),
    );
    expect(scoped.rows.every((p) => p.studentId === student.id)).toBe(true);
  });
});
