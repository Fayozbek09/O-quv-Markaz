import { describe, it, expect } from 'vitest';
import { createTranslator, DICTIONARIES } from '@/lib/i18n';
import { negotiateLocale, LOCALES } from '@/lib/i18n/config';
import { en } from '@/lib/i18n/dictionaries/en';

/** Collects every dotted key path of a dictionary. */
function keysOf(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix];
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    keysOf(value, prefix ? `${prefix}.${key}` : key),
  );
}

describe('translations', () => {
  const expected = keysOf(en).sort();

  it.each(LOCALES)('%s has exactly the same keys as English', (locale) => {
    expect(keysOf(DICTIONARIES[locale]).sort()).toEqual(expected);
  });

  it.each(LOCALES)('%s has no empty strings', (locale) => {
    const t = createTranslator(locale);
    for (const key of expected) {
      expect(t(key as never).trim().length, `${locale}:${key}`).toBeGreaterThan(0);
    }
  });

  it('interpolates named parameters', () => {
    const t = createTranslator('uz');
    expect(t('onboarding.stepOf', { current: 2, total: 7 })).toContain('2');
    expect(t('onboarding.stepOf', { current: 2, total: 7 })).not.toContain('{current}');
  });

  it('leaves an unknown placeholder untouched rather than printing "undefined"', () => {
    const t = createTranslator('en');
    expect(t('debt.daysOverdue', {})).toContain('{days}');
  });

  it('falls back to English for a missing key instead of showing the raw key', () => {
    const t = createTranslator('ru');
    expect(t('app.name')).toBe("O'quv Markaz");
  });
});

describe('locale negotiation', () => {
  it('picks the highest-quality supported language', () => {
    expect(negotiateLocale('ru-RU,ru;q=0.9,en;q=0.8')).toBe('ru');
    expect(negotiateLocale('en-GB,en;q=0.9')).toBe('en');
    expect(negotiateLocale('uz-UZ')).toBe('uz');
  });

  it('maps neighbouring regional locales to Uzbek', () => {
    expect(negotiateLocale('kaa;q=1.0')).toBe('uz');
    expect(negotiateLocale('tg-TJ')).toBe('uz');
  });

  it('defaults to Uzbek for unknown or missing headers', () => {
    expect(negotiateLocale(null)).toBe('uz');
    expect(negotiateLocale('de-DE,fr;q=0.7')).toBe('uz');
    expect(negotiateLocale('')).toBe('uz');
  });
});
