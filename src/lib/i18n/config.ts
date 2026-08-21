export const LOCALES = ['uz', 'ru', 'en'] as const;
export type AppLocale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = 'uz';
export const LOCALE_COOKIE = 'omarkaz_locale';

export const LOCALE_LABEL: Record<AppLocale, string> = {
  uz: "O'zbekcha",
  ru: 'Русский',
  en: 'English',
};

export const LOCALE_SHORT: Record<AppLocale, string> = { uz: 'UZ', ru: 'RU', en: 'EN' };

/** Maps the Intl/date-fns tag used for numbers and dates. */
export const INTL_LOCALE: Record<AppLocale, string> = {
  uz: 'uz-UZ',
  ru: 'ru-RU',
  en: 'en-US',
};

export const DB_LOCALE: Record<AppLocale, 'UZ' | 'RU' | 'EN'> = { uz: 'UZ', ru: 'RU', en: 'EN' };
export const FROM_DB_LOCALE: Record<'UZ' | 'RU' | 'EN', AppLocale> = { UZ: 'uz', RU: 'ru', EN: 'en' };

export const isLocale = (v: unknown): v is AppLocale =>
  typeof v === 'string' && (LOCALES as readonly string[]).includes(v);

/** Picks the best supported locale from an Accept-Language header. */
export function negotiateLocale(acceptLanguage: string | null | undefined): AppLocale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return { tag: tag.toLowerCase(), q: q ? Number.parseFloat(q.split('=')[1] ?? '1') : 1 };
    })
    .filter((r) => r.tag && Number.isFinite(r.q))
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    const base = tag.split('-')[0];
    if (base === 'uz') return 'uz';
    if (base === 'ru') return 'ru';
    if (base === 'en') return 'en';
    // Uzbek users frequently browse with Karakalpak or Tajik locales set.
    if (base === 'kaa' || base === 'tg') return 'uz';
  }
  return DEFAULT_LOCALE;
}
