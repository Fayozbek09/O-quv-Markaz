import { describe, it, expect } from 'vitest';
import {
  generateTotpSecret, generateRecoveryCodes, base32Decode, totpAt, currentStep, verifyTotp, totpUri,
} from '@/lib/auth/totp';

/**
 * TOTP, the platform administrator's second factor.
 *
 * The RFC 6238 vectors are checked first: an implementation that pairs with an
 * authenticator app but computes a different code is worse than none, because
 * it locks the account rather than protecting it.
 */
describe('RFC 6238 test vectors', () => {
  // The RFC's SHA-1 key is the ASCII "12345678901234567890"; base32 of that.
  const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const STEP = 30;

  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('at t=%i produces %s', (seconds, expected) => {
    expect(totpAt(SECRET, Math.floor(seconds / STEP))).toBe(expected);
  });
});

describe('base32', () => {
  it('round-trips a generated secret', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(base32Decode(secret)).toHaveLength(20); // 160 bits
  });

  it('refuses a string that is not base32 rather than decoding rubbish', () => {
    expect(() => base32Decode('not-base32!')).toThrow();
  });

  it('produces a different secret every time', () => {
    const seen = new Set(Array.from({ length: 25 }, () => generateTotpSecret()));
    expect(seen.size).toBe(25);
  });
});

describe('verification', () => {
  const secret = generateTotpSecret();

  it('accepts the current code', () => {
    const now = new Date();
    const code = totpAt(secret, currentStep(now));
    expect(verifyTotp(secret, code, { at: now })).toMatchObject({ ok: true });
  });

  it('accepts a code one step old, for a clock that has slipped', () => {
    const now = new Date();
    const code = totpAt(secret, currentStep(now) - 1);
    expect(verifyTotp(secret, code, { at: now }).ok).toBe(true);
  });

  it('refuses a code two steps old', () => {
    const now = new Date();
    const code = totpAt(secret, currentStep(now) - 2);
    expect(verifyTotp(secret, code, { at: now }).ok).toBe(false);
  });

  it('refuses a code from another secret', () => {
    const now = new Date();
    const code = totpAt(generateTotpSecret(), currentStep(now));
    // A collision would be one in a million; assert on the common case.
    const mine = totpAt(secret, currentStep(now));
    if (code === mine) return;
    expect(verifyTotp(secret, code, { at: now }).ok).toBe(false);
  });

  it('refuses anything that is not six digits, without throwing', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 5', '../../etc']) {
      expect(verifyTotp(secret, bad).ok).toBe(false);
    }
  });

  it('tolerates the spaces an authenticator app displays', () => {
    const now = new Date();
    const code = totpAt(secret, currentStep(now));
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(verifyTotp(secret, spaced, { at: now }).ok).toBe(true);
  });

  it('reports which step matched, so the caller can burn it', () => {
    const now = new Date();
    const step = currentStep(now);
    const verdict = verifyTotp(secret, totpAt(secret, step), { at: now });
    expect(verdict).toEqual({ ok: true, step });
  });

  it('refuses a step that has already been used — a code seen once is spent', () => {
    const now = new Date();
    const step = currentStep(now);
    const code = totpAt(secret, step);

    expect(verifyTotp(secret, code, { at: now, lastUsedStep: null }).ok).toBe(true);
    // The same code, inside its own thirty-second window, is now refused.
    expect(verifyTotp(secret, code, { at: now, lastUsedStep: step }).ok).toBe(false);
  });

  it('refuses an older step once a newer one has been used', () => {
    const now = new Date();
    const step = currentStep(now);
    const older = totpAt(secret, step - 1);
    expect(verifyTotp(secret, older, { at: now, lastUsedStep: step }).ok).toBe(false);
  });
});

describe('the enrolment URI', () => {
  it('is an otpauth link an authenticator app can read', () => {
    const secret = generateTotpSecret();
    const uri = totpUri(secret, 'f.iskandarov');
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain(`secret=${secret}`);
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });

  it('escapes the label rather than letting a name break the URI', () => {
    const uri = totpUri(generateTotpSecret(), 'name with spaces/and:colons');
    expect(uri.split('?')[0]).not.toContain(' ');
  });
});

describe('recovery codes', () => {
  it('issues distinct, readable codes', () => {
    const codes = generateRecoveryCodes(8);
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    for (const code of codes) expect(code).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
  });

  it('does not repeat across separate issues', () => {
    const a = new Set(generateRecoveryCodes(8));
    const b = generateRecoveryCodes(8);
    expect(b.some((code) => a.has(code))).toBe(false);
  });
});
