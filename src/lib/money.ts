/**
 * Money is stored as an integer count of minor units plus an ISO-4217 code, so
 * no floating point ever touches a balance. UZS is the launch currency; the
 * shape already supports others.
 */
export type Money = { amountMinor: bigint; currency: string };

export const CURRENCIES: Record<string, { minorUnits: number; symbol: string }> = {
  UZS: { minorUnits: 0, symbol: "so'm" },
  USD: { minorUnits: 2, symbol: '$' },
  RUB: { minorUnits: 2, symbol: '₽' },
  EUR: { minorUnits: 2, symbol: '€' },
};

export const DEFAULT_CURRENCY = 'UZS';

const minorUnits = (currency: string) => CURRENCIES[currency]?.minorUnits ?? 2;

/**
 * Talking to a payment provider.
 *
 * The ledger counts minor units, and for UZS that unit is the so'm itself
 * (`minorUnits: 0`) — there are no tiyin in circulation. Payment gateways do
 * not agree on this: Click quotes the major unit, Payme quotes tiyin. Getting
 * it wrong is a factor-of-100 error in a real charge, so neither adapter is
 * allowed to divide by 100 on a hunch; both go through these.
 */
export const minorUnitsFor = minorUnits;

/** Minor units → a plain decimal string in the currency's major unit. */
export function minorToMajorString(amountMinor: bigint, currency = DEFAULT_CURRENCY): string {
  const exp = minorUnits(currency);
  if (exp === 0) return amountMinor.toString();
  const divisor = BigInt(10 ** exp);
  const whole = amountMinor / divisor;
  const frac = (amountMinor % divisor).toString().padStart(exp, '0');
  return `${whole}.${frac}`;
}

/**
 * Minor units ⇄ hundredths of the major unit, for a provider that quotes in a
 * fixed 1/100 sub-unit (Payme's tiyin) whatever the ledger does.
 */
export function minorToHundredths(amountMinor: bigint, currency = DEFAULT_CURRENCY): bigint {
  const exp = minorUnits(currency);
  return exp >= 2 ? amountMinor : amountMinor * BigInt(10 ** (2 - exp));
}

export function hundredthsToMinor(hundredths: bigint, currency = DEFAULT_CURRENCY): bigint {
  const exp = minorUnits(currency);
  return exp >= 2 ? hundredths : hundredths / BigInt(10 ** (2 - exp));
}

/** "400 000" or "400000,50" (user input) → minor units. */
export function parseAmountToMinor(input: string, currency = DEFAULT_CURRENCY): bigint {
  const cleaned = input.replace(/[\s ']/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) throw new Error('invalid_amount');
  const exp = minorUnits(currency);
  const [whole = '0', frac = ''] = cleaned.split('.');
  const padded = (frac + '0'.repeat(exp)).slice(0, exp);
  return BigInt(whole) * BigInt(10 ** exp) + BigInt(padded || '0');
}

export function formatMoney(
  amountMinor: bigint | number | string,
  currency = DEFAULT_CURRENCY,
  locale = 'uz-UZ',
): string {
  const exp = minorUnits(currency);
  const value = Number(BigInt(amountMinor)) / 10 ** exp;
  const nf = new Intl.NumberFormat(locale, {
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  });
  return `${nf.format(value)} ${CURRENCIES[currency]?.symbol ?? currency}`;
}

/** BigInt is not JSON-serializable — API responses carry decimal strings. */
export const toMinorString = (v: bigint) => v.toString();

export const sumMinor = (values: Array<bigint | null | undefined>) =>
  values.reduce<bigint>((acc, v) => acc + (v ?? 0n), 0n);
