import { describe, it, expect } from 'vitest';
import { formatDate, type DateFormat } from '@/lib/i18n';
import { LOCALES } from '@/lib/i18n/config';

/**
 * Chromium ships no `uz` locale data, so Intl there renders "2026 M08 20, Thu".
 * Uzbek dates are therefore composed from the dictionary. These tests pin the
 * output so it cannot silently drift back to Intl.
 */
const TZ = 'Asia/Tashkent';
const AUG_20 = '2026-08-20T13:00:00Z'; // 18:00 Thursday in Tashkent

const FORMATS: DateFormat[] = [
  'date', 'dateLong', 'dateFull', 'dateFullTime', 'dateNumeric', 'dateTime',
  'dateTimeShort', 'time', 'dayMonth', 'dayMonthTime', 'weekdayDayMonth',
  'weekdayDayMonthLong', 'monthYear',
];

describe('Uzbek dates', () => {
  it.each([
    ['date', '20-avg, 2026'],
    ['dateLong', '20-avgust, 2026'],
    ['dateFull', 'payshanba, 20-avgust, 2026'],
    ['dateFullTime', 'payshanba, 20-avgust, 2026, 18:00'],
    ['dateNumeric', '20.08.2026'],
    ['dateTime', '20-avg, 2026, 18:00'],
    ['dateTimeShort', '20.08.2026, 18:00'],
    ['time', '18:00'],
    ['dayMonth', '20-avg'],
    ['dayMonthTime', '20-avg, 18:00'],
    ['weekdayDayMonth', 'Pa, 20-avg'],
    ['weekdayDayMonthLong', 'payshanba, 20-avgust'],
    ['monthYear', 'avgust, 2026'],
  ] as Array<[DateFormat, string]>)('%s renders as %s', (format, expected) => {
    expect(formatDate(AUG_20, 'uz', format, TZ)).toBe(expected);
  });

  it('never falls back to a root-locale month placeholder', () => {
    for (const format of FORMATS) {
      const output = formatDate(AUG_20, 'uz', format, TZ);
      expect(output, format).not.toMatch(/M\d{2}/);
      expect(output, format).not.toMatch(/Thu|Aug/);
    }
  });

  it('respects the timezone rather than the server clock', () => {
    // 21:00 UTC is already the next day in Tashkent.
    expect(formatDate('2026-08-20T21:00:00Z', 'uz', 'dateNumeric', TZ)).toBe('21.08.2026');
    expect(formatDate('2026-08-20T21:00:00Z', 'uz', 'dateNumeric', 'UTC')).toBe('20.08.2026');
  });

  it('formats midnight as 00:00, not 24:00', () => {
    expect(formatDate('2026-08-19T19:00:00Z', 'uz', 'time', TZ)).toBe('00:00');
  });
});

describe('Russian and English dates', () => {
  it('uses Intl, which has reliable data for both', () => {
    expect(formatDate(AUG_20, 'ru', 'monthYear', TZ)).toContain('август');
    expect(formatDate(AUG_20, 'en', 'monthYear', TZ)).toContain('August');
    expect(formatDate(AUG_20, 'en', 'time', TZ)).toBe('18:00');
    expect(formatDate(AUG_20, 'ru', 'time', TZ)).toBe('18:00');
  });
});

describe('every locale and format combination', () => {
  it('produces a non-empty string containing the day number', () => {
    for (const locale of LOCALES) {
      for (const format of FORMATS) {
        const output = formatDate(AUG_20, locale, format, TZ);
        expect(output.length, `${locale}/${format}`).toBeGreaterThan(3);
        if (format !== 'time' && format !== 'monthYear') {
          expect(output, `${locale}/${format}`).toContain('20');
        }
      }
    }
  });
});
