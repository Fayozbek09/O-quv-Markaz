import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, negotiateLocale, type AppLocale } from './config';
import { createTranslator, type Translator } from './index';

/**
 * Locale resolution order:
 *   1. explicit cookie (user pressed the switcher)
 *   2. Accept-Language from the browser
 *   3. Uzbek
 */
export const getLocale = cache(async (): Promise<AppLocale> => {
  const store = await cookies();
  const fromCookie = store.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;

  const hdrs = await headers();
  const negotiated = negotiateLocale(hdrs.get('accept-language'));
  return negotiated ?? DEFAULT_LOCALE;
});

export const getTranslator = cache(async (): Promise<Translator> => {
  return createTranslator(await getLocale());
});
