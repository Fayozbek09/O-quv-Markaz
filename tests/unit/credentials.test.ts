import { describe, it, expect } from 'vitest';
import { slugifyName, generateTempPassword, TEMP_CREDENTIAL_TTL_MS } from '@/lib/auth/credentials';
import { passwordIssues } from '@/lib/auth/password';

describe('username slugs', () => {
  it('strips the apostrophes Uzbek Latin uses', () => {
    expect(slugifyName("G'ulomov")).toBe('gulomov');
    expect(slugifyName('Toshpo‘latov')).toBe('toshpolatov');
  });

  it('transliterates Cyrillic input', () => {
    expect(slugifyName('Каримова')).toBe('karimova');
    expect(slugifyName('Шухрат')).toBe('shuxrat');
  });

  it('collapses separators into single dots', () => {
    expect(slugifyName('  Karimova   Aziza ')).toBe('karimova.aziza');
    expect(slugifyName('a__b--c')).toBe('a.b.c');
  });

  it('drops anything that is not a letter, digit or separator', () => {
    expect(slugifyName('<script>alert(1)</script>')).toBe('scriptalert1script');
    expect(slugifyName('../../etc/passwd')).toBe('etcpasswd');
  });

  it('never exceeds the column length', () => {
    expect(slugifyName('a'.repeat(200)).length).toBeLessThanOrEqual(40);
  });
});

describe('temporary passwords', () => {
  it('satisfies the password policy it will later be checked against', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(passwordIssues(generateTempPassword())).toEqual([]);
    }
  });

  it('never repeats across calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) seen.add(generateTempPassword());
    expect(seen.size).toBe(200);
  });

  it('avoids characters that are misread off a printed slip', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateTempPassword()).not.toMatch(/[0OlI1]/);
    }
  });

  it('always contains a digit and a symbol', () => {
    for (let i = 0; i < 50; i += 1) {
      const password = generateTempPassword();
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[!@#$%*?]/);
    }
  });

  it('expires rather than living forever', () => {
    expect(TEMP_CREDENTIAL_TTL_MS).toBeGreaterThan(0);
    expect(TEMP_CREDENTIAL_TTL_MS).toBeLessThanOrEqual(30 * 86_400_000);
  });
});
