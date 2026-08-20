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
