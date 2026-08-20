import clsx from 'clsx';
import type { ReactNode } from 'react';

type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'danger';

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-muted text-ink-soft border-line',
  brand: 'bg-brand-50 text-brand-700 border-brand-100',
  ok: 'bg-ok-50 text-ok-600 border-ok-50',
  warn: 'bg-warn-50 text-warn-600 border-warn-50',
  danger: 'bg-danger-50 text-danger-600 border-danger-50',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-5',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A coloured dot used to key a group in tables and the calendar. */
export function Dot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={clsx('inline-block size-2 shrink-0 rounded-full', className)}
      style={{ backgroundColor: color }}
    />
  );
}
