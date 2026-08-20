'use client';

import { useT } from '@/lib/i18n/provider';
import type { TKey } from '@/lib/i18n';

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export function WeekdayPicker({
  value,
  onChange,
  label,
}: {
  value: number[];
  onChange: (next: number[]) => void;
  label: string;
}) {
  const t = useT();

  function toggle(day: number) {
    onChange(value.includes(day) ? value.filter((d) => d !== day) : [...value, day].sort());
  }

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-[13px] font-medium text-ink-soft">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {DAYS.map((day) => {
          const active = value.includes(day);
          return (
            <button
              key={day}
              type="button"
              onClick={() => toggle(day)}
              aria-pressed={active}
              className={
                active
                  ? 'min-w-11 rounded-[var(--radius-field)] bg-brand-500 px-2.5 py-1.5 text-[13px] font-medium text-white'
                  : 'min-w-11 rounded-[var(--radius-field)] border border-line-strong px-2.5 py-1.5 text-[13px] text-ink-soft hover:bg-surface-muted'
              }
            >
              {t(`weekdays.short${day}` as TKey)}
              <span className="sr-only">{t(`weekdays.long${day}` as TKey)}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
