'use client';

import { useEffect, useState } from 'react';
import { createTranslator } from '@/lib/i18n';
import { DEFAULT_LOCALE, type AppLocale } from '@/lib/i18n/config';

/**
 * Root error boundary.
 *
 * It replaces the whole tree, providers included, so there is no locale in
 * context to read. The language is recovered from the `lang` the root layout
 * put on <html> — and if even that is missing, the product default stands. The
 * one thing this component must never do is throw, so it reads a single DOM
 * attribute and nothing else.
 *
 * The reader sees a fixed message and a digest; a stack trace or an internal
 * detail never reaches the page.
 */
function localeFromDocument(): AppLocale {
  if (typeof document === 'undefined') return DEFAULT_LOCALE;
  const lang = document.documentElement.lang || '';
  if (lang.startsWith('ru')) return 'ru';
  if (lang.startsWith('en')) return 'en';
  return DEFAULT_LOCALE;
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Resolved after mount: the server render has no document to read from, and
  // a mismatch between the two would be a hydration error inside the component
  // whose job is to survive one.
  const [locale, setLocale] = useState<AppLocale>(DEFAULT_LOCALE);
  useEffect(() => setLocale(localeFromDocument()), []);

  useEffect(() => {
    console.error('[boundary]', error.digest ?? error.message);
  }, [error]);

  const t = createTranslator(locale);

  return (
    <main
      id="main"
      className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center"
    >
      <h1 className="text-lg font-semibold">{t('pages.serverErrorTitle')}</h1>
      <p className="max-w-sm text-sm text-ink-soft">{t('pages.serverErrorText')}</p>
      {error.digest && <p className="font-mono text-xs text-ink-faint">ref: {error.digest}</p>}
      <button
        type="button"
        onClick={reset}
        className="mt-2 rounded-[var(--radius-field)] bg-brand-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
      >
        {t('common.retry')}
      </button>
    </main>
  );
}
