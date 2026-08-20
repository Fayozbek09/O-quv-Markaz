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

export function formatDate(
  value: Date | string | number,
  locale: AppLocale,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
  timeZone = 'Asia/Tashkent',
): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { ...options, timeZone }).format(
    new Date(value),
  );
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
