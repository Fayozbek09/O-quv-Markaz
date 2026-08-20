import { z } from 'zod';
import { cookies } from 'next/headers';
import { json, publicRoute, readJson } from '@/lib/api';
import { LOCALE_COOKIE, localeCookieOptions } from '@/lib/i18n/cookie';

const schema = z.object({ locale: z.enum(['uz', 'ru', 'en']) }).strict();

/** Locale is a display preference, not a privilege - no CSRF token required. */
export const POST = publicRoute(async (request: Request) => {
  const { locale } = await readJson(request, schema);
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, localeCookieOptions());
  return json({ locale });
});
