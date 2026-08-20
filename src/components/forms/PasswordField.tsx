'use client';

import { useId, useMemo, useState } from 'react';
import { useT } from '@/lib/i18n/provider';

/**
 * Password entry with a reveal toggle and a strength hint. The hint mirrors the
 * server policy (length + letter + digit) plus a rough variety bonus - it is
 * guidance, and the server is what actually enforces the rule.
 */
function score(pw: string): 0 | 1 | 2 | 3 {
  if (pw.length < 10) return 0;
  let variety = 0;
  if (/[a-z]/.test(pw)) variety += 1;
  if (/[A-Z]/.test(pw)) variety += 1;
  if (/\d/.test(pw)) variety += 1;
  if (/[^\w\s]/.test(pw)) variety += 1;
  if (pw.length >= 16 && variety >= 3) return 3;
  if (pw.length >= 12 && variety >= 3) return 2;
  return 1;
}

export function PasswordField({
  label,
  value,
  onChange,
  autoComplete = 'new-password',
  error,
  showMeter = true,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  autoComplete?: string;
  error?: string | null;
  showMeter?: boolean;
}) {
  const t = useT();
  const id = useId();
  const [visible, setVisible] = useState(false);
  const strength = useMemo(() => score(value), [value]);

  const labels = [
    t('auth.passwordRules.weak'),
    t('auth.passwordRules.fair'),
    t('auth.passwordRules.good'),
    t('auth.passwordRules.strong'),
  ] as const;
  const colors = ['bg-danger-600', 'bg-warn-600', 'bg-brand-500', 'bg-ok-600'] as const;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-ink-soft">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required
          minLength={10}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${id}-error` : showMeter ? `${id}-meter` : undefined}
          className="field pr-11"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={label}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded-[6px] p-2 text-ink-faint hover:bg-surface-muted hover:text-ink-soft"
        >
          <svg viewBox="0 0 20 20" className="size-4" fill="none" aria-hidden="true">
            {visible ? (
              <path d="M3 3l14 14M8.2 8.3a2.5 2.5 0 0 0 3.5 3.5M6.1 6.2C4.3 7.3 2.8 9 2 10c1.6 2.7 4.6 5 8 5 1.3 0 2.6-.35 3.7-.95M11.2 5.2c-.4-.1-.8-.15-1.2-.15-1 0-1.9.2-2.7.5"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            ) : (
              <>
                <path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="10" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.5" />
              </>
            )}
          </svg>
        </button>
      </div>

      {showMeter && value.length > 0 && (
        <div id={`${id}-meter`} className="flex items-center gap-2">
          <div className="flex h-1 flex-1 gap-1" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={`h-full flex-1 rounded-full ${i <= strength ? colors[strength] : 'bg-line'}`}
              />
            ))}
          </div>
          <span className="text-[11px] text-ink-faint">{labels[strength]}</span>
        </div>
      )}

      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-danger-600">
          {error}
        </p>
      )}
    </div>
  );
}
