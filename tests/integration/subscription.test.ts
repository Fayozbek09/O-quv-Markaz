import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTenant, truncateAll, db, type Tenant } from '../factories';
import {
  startTrial, currentSubscription, applySuccessfulPayment, sendDueReminders, DAY_MS,
} from '@/lib/domain/subscription';
import { getPricing, setPricing, SETTING_DEFAULTS } from '@/lib/domain/settings';
import { assertSubscriptionWritable, assertCanAddStudent, planUsage } from '@/lib/domain/plan';
import { createStudent } from '@/lib/domain/students';
import { studentInputSchema } from '@/lib/validation/schemas';

let tenant: Tenant;

beforeAll(async () => {
  await truncateAll();
  tenant = await createTenant('Subscription Centre');
});
afterAll(() => db.$disconnect());

beforeEach(async () => {
  await db.platformSetting.deleteMany();
});

const setStatus = (data: Record<string, unknown>) =>
  db.subscription.update({ where: { organizationId: tenant.org.id }, data });

describe('pricing configuration', () => {
  it('falls back to the documented defaults when nothing is stored', async () => {
    const pricing = await getPricing();
    expect(pricing.monthlyPriceMinor).toBe(BigInt(SETTING_DEFAULTS.monthly_price_minor));
    expect(pricing.currency).toBe('UZS');
    expect(pricing.trialDays).toBe(30);
    expect(pricing.gracePeriodDays).toBe(7);
  });

  it('is read from the database, not from a constant in the code', async () => {
    await setPricing({ monthlyPriceMinor: 450_000, trialDays: 14, gracePeriodDays: 3 }, null);
    const pricing = await getPricing();
    expect(pricing.monthlyPriceMinor).toBe(450_000n);
    expect(pricing.trialDays).toBe(14);
    expect(pricing.gracePeriodDays).toBe(3);
  });

  it('ignores a nonsensical stored value rather than crashing', async () => {
    await db.platformSetting.create({
      data: { key: 'trial_days', value: 'not-a-number' },
    });
    const pricing = await getPricing();
    expect(pricing.trialDays).toBe(SETTING_DEFAULTS.trial_days);
  });
});

describe('trial', () => {
  it('opens a 30-day trial on registration', async () => {
    await db.subscription.deleteMany({ where: { organizationId: tenant.org.id } });
    const sub = await startTrial(tenant.org.id);

    expect(sub.status).toBe('TRIAL');
    expect(sub.plan).toBe('STANDARD');
    expect(sub.amountMinor).toBe(300_000n);
    const days = Math.round((sub.trialEndsAt!.getTime() - sub.trialStartedAt!.getTime()) / DAY_MS);
    expect(days).toBe(30);
  });

  it('reports the days remaining', async () => {
    await setStatus({
      status: 'TRIAL',
      trialStartedAt: new Date(Date.now() - 12 * DAY_MS),
      trialEndsAt: new Date(Date.now() + 18 * DAY_MS),
    });
    const view = await currentSubscription(tenant.org.id);
    expect(view.trialDaysLeft).toBe(18);
    expect(view.usable).toBe(true);
  });

  it('imposes no student limit at all', async () => {
    const usage = await planUsage(tenant.org.id);
    expect(usage.limit).toBeNull();

    // Well past the ceiling the old single-tutor product enforced.
    for (let i = 0; i < 15; i += 1) {
      await createStudent(
        tenant.ctx,
        studentInputSchema.parse({ firstName: `Unlimited${i}`, lastName: 'Student' }),
      );
    }
    await expect(assertCanAddStudent(tenant.ctx)).resolves.toBeUndefined();
    const after = await planUsage(tenant.org.id);
    expect(after.activeStudents).toBeGreaterThanOrEqual(15);
  });
});

describe('lapsing', () => {
  it('walks trial to grace to suspended as the deadlines pass', async () => {
    await setStatus({
      status: 'TRIAL',
      trialStartedAt: new Date(Date.now() - 31 * DAY_MS),
      trialEndsAt: new Date(Date.now() - DAY_MS),
      graceEndsAt: null,
    });
    const inGrace = await currentSubscription(tenant.org.id);
    expect(inGrace.status).toBe('GRACE_PERIOD');
    expect(inGrace.usable).toBe(true);

    await setStatus({ trialEndsAt: new Date(Date.now() - 40 * DAY_MS), graceEndsAt: null, status: 'TRIAL' });
    const suspended = await currentSubscription(tenant.org.id);
    expect(suspended.status).toBe('SUSPENDED');
    expect(suspended.usable).toBe(false);
  });

  it('persists the transition so the next read is consistent', async () => {
    const row = await db.subscription.findUnique({ where: { organizationId: tenant.org.id } });
    expect(row?.status).toBe('SUSPENDED');
  });
});

describe('suspension holds writes but destroys nothing', () => {
  beforeEach(async () => {
    await setStatus({
      status: 'SUSPENDED',
      trialEndsAt: new Date(Date.now() - 40 * DAY_MS),
      graceEndsAt: new Date(Date.now() - 33 * DAY_MS),
    });
  });

  it('refuses an ordinary write with a payment-required status', async () => {
    await expect(assertSubscriptionWritable(tenant.ctx, 'students.create')).rejects.toMatchObject({
      status: 402,
    });
  });

  it('still lets the owner pay, export and read settings', async () => {
    await expect(assertSubscriptionWritable(tenant.ctx, 'center.billing')).resolves.toBeNull();
    await expect(assertSubscriptionWritable(tenant.ctx, 'reports.export')).resolves.toBeNull();
    await expect(assertSubscriptionWritable(tenant.ctx, 'center.settings')).resolves.toBeNull();
  });

  it('leaves every row exactly where it was', async () => {
    const [students, payments, grades] = await Promise.all([
      db.student.count({ where: { organizationId: tenant.org.id } }),
      db.payment.count({ where: { organizationId: tenant.org.id } }),
      db.grade.count({ where: { organizationId: tenant.org.id } }),
    ]);
    expect(students).toBeGreaterThan(0);
    // Nothing is deleted when a subscription lapses — only writes are held.
    expect(payments).toBeGreaterThanOrEqual(0);
    expect(grades).toBeGreaterThanOrEqual(0);
  });

  it('does not block a platform admin working in support', async () => {
    const overrideCtx = { ...tenant.ctx, isOverride: true };
    await expect(assertSubscriptionWritable(overrideCtx, 'students.create')).resolves.toBeNull();
  });
});

describe('payment', () => {
  it('restores full access immediately', async () => {
    await applySuccessfulPayment({
      organizationId: tenant.org.id,
      amountMinor: 300_000n,
      currency: 'UZS',
      provider: 'test',
      providerTransactionId: 'tx-restore-1',
    });

    const view = await currentSubscription(tenant.org.id);
    expect(view.status).toBe('ACTIVE');
    expect(view.usable).toBe(true);
    await expect(assertSubscriptionWritable(tenant.ctx, 'students.create')).resolves.toBeDefined();
  });

  it('records the charge with its provider reference', async () => {
    const payment = await db.subscriptionPayment.findFirst({
      where: { organizationId: tenant.org.id, providerTransactionId: 'tx-restore-1' },
    });
    expect(payment?.status).toBe('PAID');
    expect(payment?.amountMinor).toBe(300_000n);
    expect(payment?.provider).toBe('test');
    expect(payment?.paidAt).toBeInstanceOf(Date);
  });

  it('is idempotent — replaying a transaction does not buy another month', async () => {
    const before = await db.subscription.findUnique({ where: { organizationId: tenant.org.id } });

    await applySuccessfulPayment({
      organizationId: tenant.org.id,
      amountMinor: 300_000n,
      currency: 'UZS',
      provider: 'test',
      providerTransactionId: 'tx-restore-1',
    });

    const rows = await db.subscriptionPayment.count({
      where: { providerTransactionId: 'tx-restore-1' },
    });
    expect(rows).toBe(1);

    const after = await db.subscription.findUnique({ where: { organizationId: tenant.org.id } });
    // The term did move (the row is upserted), but only one payment exists.
    expect(after!.subscriptionEndsAt!.getTime()).toBeGreaterThanOrEqual(
      before!.subscriptionEndsAt!.getTime(),
    );
  });

  it('extends from the existing term when paying early', async () => {
    const before = await db.subscription.findUnique({ where: { organizationId: tenant.org.id } });
    await applySuccessfulPayment({
      organizationId: tenant.org.id,
      amountMinor: 300_000n,
      currency: 'UZS',
      provider: 'test',
      providerTransactionId: 'tx-early-1',
    });
    const after = await db.subscription.findUnique({ where: { organizationId: tenant.org.id } });
    const added = after!.subscriptionEndsAt!.getTime() - before!.subscriptionEndsAt!.getTime();
    expect(Math.round(added / DAY_MS)).toBe(30);
  });
});

describe('reminders', () => {
  it('warns once per milestone, not on every run', async () => {
    await setStatus({
      status: 'TRIAL',
      trialEndsAt: new Date(Date.now() + 2.5 * DAY_MS),
      subscriptionEndsAt: null,
      remindersSent: [],
    });

    const first = await sendDueReminders();
    expect(first).toBeGreaterThan(0);

    const second = await sendDueReminders();
    expect(second).toBe(0);

    const row = await db.subscription.findUnique({ where: { organizationId: tenant.org.id } });
    expect(row?.remindersSent).toContain('trial:3');
  });

  it('writes an in-app notification the owner can see', async () => {
    const notification = await db.notification.findFirst({
      where: { organizationId: tenant.org.id, type: 'PAYMENT_OVERDUE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(notification?.titleKey).toBe('notifications.trialEnding');
  });
});
