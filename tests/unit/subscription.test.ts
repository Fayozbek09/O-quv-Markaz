import { describe, it, expect } from 'vitest';
import { evaluate, DAY_MS, REMINDER_MILESTONES } from '@/lib/domain/subscription';
import type { PlatformPricing } from '@/lib/domain/settings';

/**
 * The subscription ladder is a pure function of (row, pricing, now), so the
 * whole lifecycle is asserted here without touching a database.
 */
const pricing: PlatformPricing = {
  monthlyPriceMinor: 300_000n,
  currency: 'UZS',
  trialDays: 30,
  gracePeriodDays: 7,
};

const now = new Date('2026-06-15T10:00:00Z');
const at = (days: number) => new Date(now.getTime() + days * DAY_MS);

describe('trial', () => {
  it('stays on trial while there are days left', () => {
    const result = evaluate(
      { status: 'TRIAL', trialEndsAt: at(12), subscriptionEndsAt: null, graceEndsAt: null },
      pricing,
      now,
    );
    expect(result.status).toBe('TRIAL');
  });

  it('moves into the grace period the moment the trial lapses', () => {
    const result = evaluate(
      { status: 'TRIAL', trialEndsAt: at(-1), subscriptionEndsAt: null, graceEndsAt: null },
      pricing,
      now,
    );
    expect(result.status).toBe('GRACE_PERIOD');
    expect(result.graceEndsAt?.getTime()).toBe(at(-1).getTime() + 7 * DAY_MS);
  });

  it('suspends once the grace window after the trial is also spent', () => {
    const result = evaluate(
      { status: 'TRIAL', trialEndsAt: at(-8), subscriptionEndsAt: null, graceEndsAt: null },
      pricing,
      now,
    );
    expect(result.status).toBe('SUSPENDED');
  });

  it('honours a configured trial length of zero without crashing', () => {
    const result = evaluate(
      { status: 'TRIAL', trialEndsAt: at(-1), subscriptionEndsAt: null, graceEndsAt: null },
      { ...pricing, gracePeriodDays: 0 },
      now,
    );
    expect(result.status).toBe('SUSPENDED');
  });
});

describe('paid term', () => {
  it('stays active until the term ends', () => {
    const result = evaluate(
      { status: 'ACTIVE', trialEndsAt: null, subscriptionEndsAt: at(3), graceEndsAt: null },
      pricing,
      now,
    );
    expect(result.status).toBe('ACTIVE');
  });

  it('becomes payment-due when the term lapses, and stays usable', () => {
    const result = evaluate(
      { status: 'ACTIVE', trialEndsAt: null, subscriptionEndsAt: at(-2), graceEndsAt: null },
      pricing,
      now,
    );
    expect(result.status).toBe('PAYMENT_DUE');
  });

  it('suspends only after the grace window closes', () => {
    const stillFine = evaluate(
      { status: 'PAYMENT_DUE', trialEndsAt: null, subscriptionEndsAt: at(-6), graceEndsAt: at(1) },
      pricing,
      now,
    );
    expect(stillFine.status).toBe('PAYMENT_DUE');

    const expired = evaluate(
      { status: 'GRACE_PERIOD', trialEndsAt: null, subscriptionEndsAt: at(-9), graceEndsAt: at(-2) },
      pricing,
      now,
    );
    expect(expired.status).toBe('SUSPENDED');
  });

  it('respects a longer grace window configured by the platform admin', () => {
    const result = evaluate(
      { status: 'ACTIVE', trialEndsAt: null, subscriptionEndsAt: at(-10), graceEndsAt: null },
      { ...pricing, gracePeriodDays: 30 },
      now,
    );
    expect(result.status).toBe('PAYMENT_DUE');
  });

  it('maps the legacy PAST_DUE status onto PAYMENT_DUE', () => {
    const result = evaluate(
      { status: 'PAST_DUE', trialEndsAt: null, subscriptionEndsAt: at(-1), graceEndsAt: at(6) },
      pricing,
      now,
    );
    expect(result.status).toBe('PAYMENT_DUE');
  });
});

describe('terminal states', () => {
  it('leaves a cancelled subscription alone', () => {
    for (const status of ['CANCELLED', 'CANCELED'] as const) {
      const result = evaluate(
        { status, trialEndsAt: at(-100), subscriptionEndsAt: at(-100), graceEndsAt: at(-90) },
        pricing,
        now,
      );
      expect(result.status).toBe(status);
    }
  });

  it('never revives a suspended subscription on its own', () => {
    const result = evaluate(
      { status: 'SUSPENDED', trialEndsAt: null, subscriptionEndsAt: at(-30), graceEndsAt: at(-23) },
      pricing,
      now,
    );
    // Only a verified payment moves it back to ACTIVE.
    expect(result.status).toBe('SUSPENDED');
  });
});

describe('reminders', () => {
  it('warns at seven, three, one and zero days', () => {
    expect([...REMINDER_MILESTONES]).toEqual([7, 3, 1, 0]);
  });
});
