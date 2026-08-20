'use client';

import { useId } from 'react';
import { useT } from '@/lib/i18n/provider';
import { CURRENCIES } from '@/lib/money';
import { INTL_LOCALE } from '@/lib/i18n/config';

/**
 * Amount entry. Digits are grouped as the user types so a six-figure so'm
 * amount stays readable; the grouping is stripped before it is sent.
 */
export function MoneyField({
  label,
  value,
  onChange,
  currency = 'UZS',
  error,
  required,
  hint,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  currency?: string;
  error?: string | null;
  required?: boolean;
  hint?: string;
}) {
  const t = useT();
  const id = useId();
  const symbol = CURRENCIES[currency]?.symbol ?? currency;

  function handle(raw: string) {
    const digits = raw.replace(/[^\d]/g, '').slice(0, 15);
    if (!digits) {
      onChange('');
      return;
    }
    onChange(new Intl.NumberFormat(INTL_LOCALE[t.locale]).format(Number(digits)));
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-ink-soft">
        {label}
        {required && <span aria-hidden="true" className="ml-0.5 text-danger-600">*</span>}
      </label>
      <div className="relative">
        <input
          id={id}
          value={value}
          onChange={(e) => handle(e.target.value)}
          inputMode="numeric"
          required={required}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="field pr-16 text-right tabular-nums"
          placeholder="0"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-faint">
          {symbol}
        </span>
      </div>
      {hint && !error && <p className="text-xs text-ink-faint">{hint}</p>}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-danger-600">
          {error}
        </p>
      )}
    </div>
  );
}
