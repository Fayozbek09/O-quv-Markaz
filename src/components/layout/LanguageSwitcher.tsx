'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useT } from '@/lib/i18n/provider';
import { LOCALES, LOCALE_LABEL, LOCALE_SHORT, type AppLocale } from '@/lib/i18n/config';

/**
 * Writes the locale cookie through a route handler so the choice survives a
 * reload and is applied during server rendering, not only in the browser.
 */
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function change(next: AppLocale) {
    await fetch('/api/locale', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ locale: next }),
    });
    startTransition(() => router.refresh());
  }

  if (compact) {
    return (
      <div className="inline-flex rounded-[var(--radius-field)] border border-line-strong bg-surface p-0.5">
        {LOCALES.map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => void change(code)}
            disabled={pending}
            aria-current={t.locale === code ? 'true' : undefined}
            aria-label={LOCALE_LABEL[code]}
            className={
              t.locale === code
                ? 'rounded-[6px] bg-brand-500 px-2 py-1 text-[11px] font-semibold text-white'
                : 'rounded-[6px] px-2 py-1 text-[11px] font-medium text-ink-soft hover:bg-surface-muted'
            }
          >
            {LOCALE_SHORT[code]}
          </button>
        ))}
      </div>
    );
  }

  return (
    <label className="flex items-center gap-2 text-[13px] text-ink-soft">
      <span className="sr-only">{t('common.language')}</span>
      <select
        value={t.locale}
        disabled={pending}
        onChange={(e) => void change(e.target.value as AppLocale)}
        className="field h-8 w-auto py-0 text-[13px]"
      >
        {LOCALES.map((code) => (
          <option key={code} value={code}>
            {LOCALE_LABEL[code]}
          </option>
        ))}
      </select>
    </label>
  );
}
