import { prisma } from '../db';

/**
 * Platform configuration.
 *
 * Pricing is data, not a constant: the platform admin changes the monthly
 * price, the trial length or the grace window from /admin/settings and no
 * deploy is needed. The defaults below are only the values a fresh install
 * starts with.
 */
export const SETTING_DEFAULTS = {
  monthly_price_minor: 300_000,
  currency: 'UZS',
  trial_days: 30,
  grace_period_days: 7,
} as const;

export type PlatformPricing = {
  monthlyPriceMinor: bigint;
  currency: string;
  trialDays: number;
  gracePeriodDays: number;
};

const asNumber = (value: unknown, fallback: number): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** Reads the live pricing, falling back to the defaults for any missing key. */
export async function getPricing(): Promise<PlatformPricing> {
  const rows = await prisma.platformSetting.findMany({
    where: { key: { in: Object.keys(SETTING_DEFAULTS) } },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const currencyRaw = map.get('currency');
  return {
    monthlyPriceMinor: BigInt(
      Math.round(asNumber(map.get('monthly_price_minor'), SETTING_DEFAULTS.monthly_price_minor)),
    ),
    currency: typeof currencyRaw === 'string' && /^[A-Z]{3}$/.test(currencyRaw)
      ? currencyRaw
      : SETTING_DEFAULTS.currency,
    trialDays: Math.max(0, Math.round(asNumber(map.get('trial_days'), SETTING_DEFAULTS.trial_days))),
    gracePeriodDays: Math.max(
      0,
      Math.round(asNumber(map.get('grace_period_days'), SETTING_DEFAULTS.grace_period_days)),
    ),
  };
}

export async function setPricing(
  input: Partial<{
    monthlyPriceMinor: number;
    currency: string;
    trialDays: number;
    gracePeriodDays: number;
  }>,
  updatedById: string | null,
): Promise<PlatformPricing> {
  const writes: Array<{ key: string; value: unknown; description: string }> = [];
  if (input.monthlyPriceMinor !== undefined) {
    writes.push({
      key: 'monthly_price_minor',
      value: input.monthlyPriceMinor,
      description: 'Flat monthly price for an education centre, in minor units',
    });
  }
  if (input.currency !== undefined) {
    writes.push({ key: 'currency', value: input.currency, description: 'Billing currency' });
  }
  if (input.trialDays !== undefined) {
    writes.push({ key: 'trial_days', value: input.trialDays, description: 'Free trial length in days' });
  }
  if (input.gracePeriodDays !== undefined) {
    writes.push({
      key: 'grace_period_days',
      value: input.gracePeriodDays,
      description: 'Days a centre stays usable after a term lapses',
    });
  }

  await prisma.$transaction(
    writes.map((w) =>
      prisma.platformSetting.upsert({
        where: { key: w.key },
        create: { key: w.key, value: w.value as object, description: w.description, updatedById },
        update: { value: w.value as object, updatedById },
      }),
    ),
  );

  return getPricing();
}
