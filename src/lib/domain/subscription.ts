import { prisma } from '../db';
import { getPricing, type PlatformPricing } from './settings';
import { notify, centerStaffUserIds } from '../notifications/notify';
import { audit } from '../security/audit';
import type { SubscriptionStatus } from '@/generated/prisma/enums';

/**
 * Subscription lifecycle.
 *
 *   TRIAL          registration + trial_days, everything unlocked, no limits
 *   ACTIVE         a term has been paid for
 *   PAYMENT_DUE    the term has lapsed; still fully usable
 *   GRACE_PERIOD   grace_period_days after that; still fully usable, warned
 *   SUSPENDED      grace is over: data intact and exportable, writes held
 *   CANCELLED      the centre asked to stop
 *
 * The subscription belongs to the centre, not to a person, and its price does
 * not vary with how many students, teachers or groups the centre has.
 */

export const DAY_MS = 86_400_000;

/** Statuses that still allow ordinary day-to-day work. */
const USABLE: ReadonlySet<SubscriptionStatus> = new Set<SubscriptionStatus>([
  'TRIAL', 'ACTIVE', 'PAYMENT_DUE', 'GRACE_PERIOD',
  // Legacy rows from the single-tutor product are treated as usable.
  'TRIALING', 'PAST_DUE',
]);

export type SubscriptionView = {
  id: string;
  organizationId: string;
  status: SubscriptionStatus;
  amountMinor: bigint;
  currency: string;
  trialEndsAt: Date | null;
  subscriptionEndsAt: Date | null;
  graceEndsAt: Date | null;
  lastPaymentAt: Date | null;
  nextPaymentAt: Date | null;
  /** Whole days left in the trial; null when not on trial. */
  trialDaysLeft: number | null;
  /** Whole days left before suspension; null when nothing is running out. */
  daysLeft: number | null;
  /** True while the centre may perform ordinary writes. */
  usable: boolean;
  /** True when the owner should be shown a payment call to action. */
  needsPayment: boolean;
};

const daysBetween = (from: Date, to: Date) => Math.ceil((to.getTime() - from.getTime()) / DAY_MS);

/** Creates the trial row for a brand-new centre. */
export async function startTrial(organizationId: string, pricing?: PlatformPricing) {
  const config = pricing ?? (await getPricing());
  const now = new Date();
  return prisma.subscription.upsert({
    where: { organizationId },
    create: {
      organizationId,
      plan: 'STANDARD',
      status: 'TRIAL',
      trialStartedAt: now,
      trialEndsAt: new Date(now.getTime() + config.trialDays * DAY_MS),
      amountMinor: config.monthlyPriceMinor,
      currency: config.currency,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + config.trialDays * DAY_MS),
      nextPaymentAt: new Date(now.getTime() + config.trialDays * DAY_MS),
    },
    update: {},
  });
}

/**
 * Reads the subscription and rolls it forward if a deadline has passed.
 *
 * The transition is evaluated on read rather than only in a scheduled job, so
 * a centre whose term lapsed overnight is in the right state on the very next
 * request even if no cron ran.
 */
export async function currentSubscription(
  organizationId: string,
  now = new Date(),
): Promise<SubscriptionView> {
  let sub = await prisma.subscription.findUnique({ where: { organizationId } });
  if (!sub) sub = await startTrial(organizationId);

  const pricing = await getPricing();
  const next = evaluate(
    {
      status: sub.status,
      trialEndsAt: sub.trialEndsAt,
      subscriptionEndsAt: sub.subscriptionEndsAt,
      graceEndsAt: sub.graceEndsAt,
    },
    pricing,
    now,
  );

  if (next.status !== sub.status || next.graceEndsAt?.getTime() !== sub.graceEndsAt?.getTime()) {
    sub = await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: next.status, graceEndsAt: next.graceEndsAt },
    });
    await audit({
      organizationId,
      action: 'subscription.status',
      entityType: 'subscription',
      entityId: sub.id,
      meta: { to: next.status },
    });
  }

  return toView(sub, now);
}

/** Pure state transition — unit-tested directly, no database involved. */
export function evaluate(
  sub: {
    status: SubscriptionStatus;
    trialEndsAt: Date | null;
    subscriptionEndsAt: Date | null;
    graceEndsAt: Date | null;
  },
  pricing: PlatformPricing,
  now: Date,
): { status: SubscriptionStatus; graceEndsAt: Date | null } {
  if (sub.status === 'CANCELLED' || sub.status === 'CANCELED') {
    return { status: sub.status, graceEndsAt: sub.graceEndsAt };
  }

  const graceMs = pricing.gracePeriodDays * DAY_MS;

  if (sub.status === 'TRIAL' || sub.status === 'TRIALING') {
    if (sub.trialEndsAt && sub.trialEndsAt <= now) {
      const graceEndsAt = new Date(sub.trialEndsAt.getTime() + graceMs);
      // A lapsed trial goes straight into the same PAYMENT_DUE → GRACE →
      // SUSPENDED ladder as a lapsed paid term.
      if (graceEndsAt <= now) return { status: 'SUSPENDED', graceEndsAt };
      return { status: 'GRACE_PERIOD', graceEndsAt };
    }
    return { status: sub.status, graceEndsAt: null };
  }

  if (sub.status === 'ACTIVE') {
    if (sub.subscriptionEndsAt && sub.subscriptionEndsAt <= now) {
      const graceEndsAt = new Date(sub.subscriptionEndsAt.getTime() + graceMs);
      if (graceEndsAt <= now) return { status: 'SUSPENDED', graceEndsAt };
      return { status: 'PAYMENT_DUE', graceEndsAt };
    }
    return { status: 'ACTIVE', graceEndsAt: null };
  }

  if (sub.status === 'PAYMENT_DUE' || sub.status === 'GRACE_PERIOD' || sub.status === 'PAST_DUE') {
    const graceEndsAt =
      sub.graceEndsAt ??
      (sub.subscriptionEndsAt ? new Date(sub.subscriptionEndsAt.getTime() + graceMs) : null);
    if (graceEndsAt && graceEndsAt <= now) return { status: 'SUSPENDED', graceEndsAt };
    return { status: sub.status === 'PAST_DUE' ? 'PAYMENT_DUE' : sub.status, graceEndsAt };
  }

  return { status: sub.status, graceEndsAt: sub.graceEndsAt };
}

function toView(
  sub: {
    id: string; organizationId: string; status: SubscriptionStatus; amountMinor: bigint;
    currency: string; trialEndsAt: Date | null; subscriptionEndsAt: Date | null;
    graceEndsAt: Date | null; lastPaymentAt: Date | null; nextPaymentAt: Date | null;
  },
  now: Date,
): SubscriptionView {
  const onTrial = sub.status === 'TRIAL' || sub.status === 'TRIALING';
  const trialDaysLeft = onTrial && sub.trialEndsAt ? Math.max(0, daysBetween(now, sub.trialEndsAt)) : null;

  const deadline = onTrial ? sub.trialEndsAt : (sub.graceEndsAt ?? sub.subscriptionEndsAt);
  return {
    ...sub,
    trialDaysLeft,
    daysLeft: deadline ? Math.max(0, daysBetween(now, deadline)) : null,
    usable: USABLE.has(sub.status),
    needsPayment:
      sub.status === 'PAYMENT_DUE' ||
      sub.status === 'GRACE_PERIOD' ||
      sub.status === 'SUSPENDED' ||
      (trialDaysLeft !== null && trialDaysLeft <= 7),
  };
}

/**
 * Applies a *verified* payment. The only caller is the webhook/reconcile path;
 * nothing reachable from a browser can invoke it with an unverified outcome.
 */
export async function applySuccessfulPayment(input: {
  organizationId: string;
  amountMinor: bigint;
  currency: string;
  provider: string;
  providerTransactionId: string | null;
  paidAt?: Date;
}) {
  const sub = await prisma.subscription.findUnique({
    where: { organizationId: input.organizationId },
  });
  if (!sub) throw new Error('subscription_missing');

  const paidAt = input.paidAt ?? new Date();
  // Extend from whichever is later: the unexpired term, or now. Paying early
  // adds a month; paying late starts a fresh month rather than burning days.
  const base =
    sub.subscriptionEndsAt && sub.subscriptionEndsAt > paidAt ? sub.subscriptionEndsAt : paidAt;
  const periodEnd = new Date(base.getTime() + 30 * DAY_MS);

  await prisma.$transaction(async (tx) => {
    await tx.subscriptionPayment.upsert({
      where: {
        provider_providerTransactionId: {
          provider: input.provider,
          providerTransactionId: input.providerTransactionId ?? `manual:${sub.id}:${paidAt.toISOString()}`,
        },
      },
      create: {
        organizationId: input.organizationId,
        subscriptionId: sub.id,
        amountMinor: input.amountMinor,
        currency: input.currency,
        provider: input.provider,
        providerTransactionId:
          input.providerTransactionId ?? `manual:${sub.id}:${paidAt.toISOString()}`,
        status: 'PAID',
        periodStart: base,
        periodEnd,
        paidAt,
      },
      // Replaying the same provider transaction must not extend the term twice.
      update: {},
    });

    await tx.subscription.update({
      where: { id: sub.id },
      data: {
        status: 'ACTIVE',
        plan: 'STANDARD',
        subscriptionStartedAt: sub.subscriptionStartedAt ?? paidAt,
        subscriptionEndsAt: periodEnd,
        currentPeriodStart: base,
        currentPeriodEnd: periodEnd,
        graceEndsAt: null,
        lastPaymentAt: paidAt,
        nextPaymentAt: periodEnd,
        provider: input.provider,
        remindersSent: [],
      },
    });
  });

  await notify({
    organizationId: input.organizationId,
    userIds: await centerStaffUserIds(input.organizationId, ['OWNER', 'ADMIN']),
    type: 'PAYMENT_RECEIVED',
    titleKey: 'notifications.subscriptionPaid',
    payload: { until: periodEnd.toISOString() },
  });

  await audit({
    organizationId: input.organizationId,
    action: 'subscription.payment.applied',
    entityType: 'subscription',
    entityId: sub.id,
    meta: {
      provider: input.provider,
      amountMinor: input.amountMinor.toString(),
      until: periodEnd.toISOString(),
    },
  });

  return periodEnd;
}

/**
 * Trial and renewal reminders at 7 / 3 / 1 / 0 days.
 * Idempotent: each milestone is recorded on the subscription row.
 */
export const REMINDER_MILESTONES = [7, 3, 1, 0] as const;

export async function sendDueReminders(now = new Date()): Promise<number> {
  const subs = await prisma.subscription.findMany({
    where: {
      status: { in: ['TRIAL', 'TRIALING', 'ACTIVE', 'PAYMENT_DUE', 'GRACE_PERIOD'] },
      organization: { deletedAt: null, status: 'ACTIVE' },
    },
    select: {
      id: true, organizationId: true, status: true, trialEndsAt: true,
      subscriptionEndsAt: true, remindersSent: true,
    },
  });

  let sent = 0;
  for (const sub of subs) {
    const onTrial = sub.status === 'TRIAL' || sub.status === 'TRIALING';
    const deadline = onTrial ? sub.trialEndsAt : sub.subscriptionEndsAt;
    if (!deadline) continue;

    const daysLeft = daysBetween(now, deadline);
    const milestone = REMINDER_MILESTONES.find((m) => daysLeft <= m && daysLeft > m - 1);
    if (milestone === undefined) continue;

    const already = Array.isArray(sub.remindersSent) ? (sub.remindersSent as unknown[]) : [];
    const key = `${onTrial ? 'trial' : 'term'}:${milestone}`;
    if (already.includes(key)) continue;

    const count = await notify({
      organizationId: sub.organizationId,
      userIds: await centerStaffUserIds(sub.organizationId, ['OWNER']),
      type: 'PAYMENT_OVERDUE',
      titleKey: onTrial ? 'notifications.trialEnding' : 'notifications.subscriptionEnding',
      payload: { daysLeft: Math.max(0, daysLeft) },
    });
    sent += count;

    await prisma.subscription.update({
      where: { id: sub.id },
      data: { remindersSent: [...already, key] as object },
    });
  }
  return sent;
}
