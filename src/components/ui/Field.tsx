'use client';

import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';

/**
 * One labelled control. The label is always a real <label for=…>, errors are
 * wired through aria-describedby and aria-invalid, and required fields carry
 * `required` rather than only a visual asterisk.
 */
type Shared = {
  label: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  className?: string;
};

function Shell({
  id,
  label,
  error,
  hint,
  required,
  className,
  children,
}: Shared & { id: string; children: ReactNode }) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink-soft">
        {label}
        {required && (
          <span aria-hidden="true" className="ml-0.5 text-danger-600">
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error && (
        <p id={hintId} className="text-xs text-ink-faint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextField({
  label, error, hint, required, className, ...rest
}: Shared & InputHTMLAttributes<HTMLInputElement>) {
  const auto = useId();
  const id = rest.id ?? auto;
  return (
    <Shell id={id} label={label} error={error} hint={hint} required={required} className={className}>
      <input
        {...rest}
        id={id}
        required={required}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className="field"
      />
    </Shell>
  );
}

export function TextAreaField({
  label, error, hint, required, className, ...rest
}: Shared & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const auto = useId();
  const id = rest.id ?? auto;
  return (
    <Shell id={id} label={label} error={error} hint={hint} required={required} className={className}>
      <textarea
        {...rest}
        id={id}
        required={required}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className="field min-h-20 resize-y"
      />
    </Shell>
  );
}

export function SelectField({
  label, error, hint, required, className, children, ...rest
}: Shared & SelectHTMLAttributes<HTMLSelectElement>) {
  const auto = useId();
  const id = rest.id ?? auto;
  return (
    <Shell id={id} label={label} error={error} hint={hint} required={required} className={className}>
      <select
        {...rest}
        id={id}
        required={required}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className="field appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 12 12%22><path fill=%22%237a8595%22 d=%22M2 4.5 6 8.5 10 4.5z%22/></svg>')] bg-[length:12px] bg-[right_0.7rem_center] bg-no-repeat pr-8"
      >
        {children}
      </select>
    </Shell>
  );
}

export function CheckboxField({
  label, hint, className, ...rest
}: { label: string; hint?: string; className?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const auto = useId();
  const id = rest.id ?? auto;
  return (
    <div className={clsx('flex items-start gap-2.5', className)}>
      <input
        {...rest}
        id={id}
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 rounded border-line-strong text-brand-500 accent-[var(--color-brand-500)]"
      />
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm text-ink">
          {label}
        </label>
        {hint && <p className="text-xs text-ink-faint">{hint}</p>}
      </div>
    </div>
  );
}
