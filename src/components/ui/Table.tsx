import clsx from 'clsx';
import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react';

/** Wide tables scroll inside their own container, never the page body. */
export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('w-full overflow-x-auto', className)}>
      <table className="w-full min-w-[640px] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ className, children, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={clsx(
        'border-b border-line bg-surface-muted/60 px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-ink-faint',
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({ className, children, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={clsx('border-b border-line px-3 py-2.5 align-middle', className)} {...rest}>
      {children}
    </td>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="max-w-sm text-[13px] text-ink-soft">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
