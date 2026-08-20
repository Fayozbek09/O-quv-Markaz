import type { ReactNode } from 'react';

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="card p-6 sm:p-7">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-1 text-[13px] text-ink-soft">{subtitle}</p>}
      <div className="mt-5">{children}</div>
      {footer && <div className="mt-5 border-t border-line pt-4 text-center text-[13px]">{footer}</div>}
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-[var(--radius-field)] border border-danger-50 bg-danger-50 px-3 py-2 text-[13px] font-medium text-danger-600"
    >
      {message}
    </p>
  );
}

export function FormNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-[var(--radius-field)] border border-brand-100 bg-brand-50 px-3 py-2 text-[13px] text-brand-700">
      {message}
    </p>
  );
}
