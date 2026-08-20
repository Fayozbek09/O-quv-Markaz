import { describe, it, expect } from 'vitest';
import { parseAmountToMinor, formatMoney, sumMinor } from '@/lib/money';

describe('money', () => {
  it('parses plain and grouped UZS amounts to minor units', () => {
    expect(parseAmountToMinor('400000', 'UZS')).toBe(400000n);
    expect(parseAmountToMinor('400 000', 'UZS')).toBe(400000n);
    expect(parseAmountToMinor("400'000", 'UZS')).toBe(400000n);
  });

  it('respects the minor-unit exponent of the currency', () => {
    expect(parseAmountToMinor('12.34', 'USD')).toBe(1234n);
    expect(parseAmountToMinor('12,3', 'USD')).toBe(1230n);
    // UZS has no subunit, so a decimal part is truncated rather than scaled.
    expect(parseAmountToMinor('1000', 'UZS')).toBe(1000n);
  });

  it('rejects anything that is not a number', () => {
    for (const bad of ['abc', '', '-5', '1e10', '1..2', "'; DROP TABLE payments; --"]) {
      expect(() => parseAmountToMinor(bad, 'UZS')).toThrow();
    }
  });

  it('never loses precision on large sums', () => {
    // 9 007 199 254 740 993 exceeds Number.MAX_SAFE_INTEGER; BigInt keeps it exact.
    const huge = 9_007_199_254_740_993n;
    expect(sumMinor([huge, 1n])).toBe(9_007_199_254_740_994n);
  });

  it('formats with a currency symbol', () => {
    expect(formatMoney(400000n, 'UZS', 'en-US')).toContain("so'm");
    expect(formatMoney(1234n, 'USD', 'en-US')).toBe('12.34 $');
  });
});
