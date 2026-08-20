import clsx from 'clsx';
import type { ReactNode } from 'react';

/**
 * A single number with its label. Deliberately plain: the value is the largest
 * thing in the tile, and nothing animates.
 */
export function Stat({
  label,
  value,
  sub,
  tone = 'neutral',
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'brand';
  className?: string;
}) {
  const valueTone = {
    neutral: 'text-ink',
    ok: 'text-ok-600',
    warn: 'text-warn-600',
    danger: 'text-danger-600',
    brand: 'text-brand-600',
  }[tone];

  return (
    <div className={clsx('card px-4 py-3.5', className)}>
      <p className="text-[12px] font-medium uppercase tracking-wide text-ink-faint">{label}</p>
      <p className={clsx('tnum mt-1.5 text-[22px] font-semibold leading-tight', valueTone)}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[12px] text-ink-soft">{sub}</p>}
    </div>
  );
}

export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('grid gap-3 sm:grid-cols-2 xl:grid-cols-4', className)}>{children}</div>
  );
}
