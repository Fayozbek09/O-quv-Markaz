import { en, type Dictionary } from './dictionaries/en';
import { uz } from './dictionaries/uz';
import { ru } from './dictionaries/ru';
import { INTL_LOCALE, type AppLocale } from './config';

export const DICTIONARIES: Record<AppLocale, Dictionary> = { uz, ru, en };

/** Dotted key paths of the dictionary, e.g. "students.add". */
type Leaves<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}`;
}[keyof T & string];

export type TKey = Leaves<Dictionary>;
export type TParams = Record<string, string | number>;
export type Translator = ((key: TKey, params?: TParams) => string) & {
  locale: AppLocale;
  dict: Dictionary;
};

function lookup(dict: Dictionary, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** Replaces {name} placeholders. Values are inserted as text, never as HTML. */
function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

export function createTranslator(locale: AppLocale): Translator {
  const dict = DICTIONARIES[locale] ?? en;
  const t = ((key: TKey, params?: TParams) => {
    // Fall back to English rather than showing a raw key to a user.
    const template = lookup(dict, key) ?? lookup(en, key) ?? key;
    return interpolate(template, params);
  }) as Translator;
  t.locale = locale;
  t.dict = dict;
  return t;
}

/**
 * Named date formats.
 *
 * Dates are NOT handed to `Intl` for Uzbek. Chromium ships no `uz` locale data
 * and falls back to a root pattern - `2026 M08 20, Thu` instead of
 * `payshanba, 20-avgust, 2026`. Node has full ICU, so the same call produced
 * different text on the server and in the browser, which both broke the layout
 * for the primary market and caused a hydration mismatch.
 *
 * Uzbek is therefore composed from the dictionary, and Russian and English use
 * `Intl`, where the data is present and correct everywhere.
 */
export type DateFormat =
  | 'date'            // 20-avg, 2026
  | 'dateLong'        // 20-avgust, 2026
  | 'dateFull'        // payshanba, 20-avgust, 2026
  | 'dateFullTime'    // payshanba, 20-avgust, 2026, 18:00
  | 'dateNumeric'     // 20.08.2026
  | 'dateTime'        // 20-avg, 2026, 18:00
  | 'dateTimeShort'   // 20.08.2026, 18:00
  | 'time'            // 18:00
  | 'dayMonth'        // 20-avg
  | 'dayMonthTime'    // 20-avg, 18:00
  | 'weekdayDayMonth' // Pay, 20-avg
  | 'weekdayDayMonthLong' // payshanba, 20-avgust
  | 'monthYear';      // avgust, 2026

const INTL_OPTIONS: Record<DateFormat, Intl.DateTimeFormatOptions> = {
  date: { dateStyle: 'medium' },
  dateLong: { dateStyle: 'long' },
  dateFull: { dateStyle: 'full' },
  dateFullTime: { dateStyle: 'full', timeStyle: 'short', hour12: false },
  dateNumeric: { dateStyle: 'short' },
  dateTime: { dateStyle: 'medium', timeStyle: 'short', hour12: false },
  dateTimeShort: { dateStyle: 'short', timeStyle: 'short', hour12: false },
  time: { hour: '2-digit', minute: '2-digit', hour12: false },
  dayMonth: { day: 'numeric', month: 'short' },
  dayMonthTime: { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false },
  weekdayDayMonth: { weekday: 'short', day: 'numeric', month: 'short' },
  weekdayDayMonthLong: { weekday: 'long', day: 'numeric', month: 'long' },
  monthYear: { month: 'long', year: 'numeric' },
};

type DateParts = {
  year: number;
  month: number; // 1-12
  day: number;
  weekday: number; // 1 = Monday
  hour: string;
  minute: string;
};

/**
 * Numeric parts in a timezone. `en-GB` with explicit numeric fields is used
 * only as a carrier - every engine agrees on digits, so this is stable
 * everywhere regardless of which locale data is bundled.
 */
function partsIn(value: Date, timeZone: string): DateParts {
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
    weekday: 'short',
  });
  const parts = Object.fromEntries(dtf.formatToParts(value).map((p) => [p.type, p.value]));
  const weekdayIndex = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday ?? 'Mon');

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: weekdayIndex === -1 ? 1 : weekdayIndex + 1,
    // 24:00 is emitted by some engines for midnight; normalize it.
    hour: parts.hour === '24' ? '00' : (parts.hour ?? '00'),
    minute: parts.minute ?? '00',
  };
}

/** Uzbek patterns, composed from the dictionary. */
function formatUz(p: DateParts, format: DateFormat, dict: Dictionary): string {
  const monthLong = dict.months[`m${p.month}` as keyof Dictionary['months']];
  // Uzbek abbreviates a month to its first three letters: avgust -> avg.
  const monthShort = monthLong.slice(0, 3).toLowerCase();
  const weekdayLong = dict.weekdays[`long${p.weekday}` as keyof Dictionary['weekdays']].toLowerCase();
  const weekdayShort = dict.weekdays[`short${p.weekday}` as keyof Dictionary['weekdays']];
  const time = `${p.hour}:${p.minute}`;
  const numeric = `${String(p.day).padStart(2, '0')}.${String(p.month).padStart(2, '0')}.${p.year}`;

  switch (format) {
    case 'time': return time;
    case 'dateNumeric': return numeric;
    case 'dateTimeShort': return `${numeric}, ${time}`;
    case 'dayMonth': return `${p.day}-${monthShort}`;
    case 'dayMonthTime': return `${p.day}-${monthShort}, ${time}`;
    case 'weekdayDayMonth': return `${weekdayShort}, ${p.day}-${monthShort}`;
    case 'weekdayDayMonthLong': return `${weekdayLong}, ${p.day}-${monthLong.toLowerCase()}`;
    case 'monthYear': return `${monthLong.toLowerCase()}, ${p.year}`;
    case 'dateLong': return `${p.day}-${monthLong.toLowerCase()}, ${p.year}`;
    case 'dateFull': return `${weekdayLong}, ${p.day}-${monthLong.toLowerCase()}, ${p.year}`;
    case 'dateFullTime': return `${weekdayLong}, ${p.day}-${monthLong.toLowerCase()}, ${p.year}, ${time}`;
    case 'dateTime': return `${p.day}-${monthShort}, ${p.year}, ${time}`;
    case 'date':
    default: return `${p.day}-${monthShort}, ${p.year}`;
  }
}

export function formatDate(
  value: Date | string | number,
  locale: AppLocale,
  format: DateFormat = 'date',
  timeZone = 'Asia/Tashkent',
): string {
  const date = new Date(value);

  if (locale === 'uz') {
    return formatUz(partsIn(date, timeZone), format, DICTIONARIES.uz);
  }
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    ...INTL_OPTIONS[format],
    timeZone,
  }).format(date);
}

export function formatNumber(value: number, locale: AppLocale, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(INTL_LOCALE[locale], options).format(value);
}

export const formatPercent = (ratio: number, locale: AppLocale) =>
  new Intl.NumberFormat(INTL_LOCALE[locale], {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(ratio);

export type { Dictionary };
