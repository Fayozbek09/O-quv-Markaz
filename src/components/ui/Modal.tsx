'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * Native <dialog> so the browser handles focus trapping, Escape and the
 * top-layer stacking - no bespoke focus management to get wrong.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        // Clicking the backdrop (the dialog element itself) closes it.
        if (e.target === ref.current) onClose();
      }}
      className={`m-auto w-[calc(100vw-2rem)] rounded-[var(--radius-card)] border border-line bg-surface p-0 text-ink shadow-[var(--shadow-pop)] backdrop:bg-ink/35 ${
        wide ? 'max-w-3xl' : 'max-w-lg'
      }`}
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 id={titleId} className="text-[15px] font-semibold">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-[6px] p-1.5 text-ink-faint hover:bg-surface-muted hover:text-ink"
        >
          <svg viewBox="0 0 20 20" className="size-4" fill="none" aria-hidden="true">
            <path d="M5 5l10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone = 'danger',
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  tone?: 'danger' | 'brand';
  busy?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm text-ink-soft">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-[var(--radius-field)] border border-line-strong px-4 py-2 text-sm font-medium hover:bg-surface-muted"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className={
            tone === 'danger'
              ? 'rounded-[var(--radius-field)] bg-danger-600 px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-60'
              : 'rounded-[var(--radius-field)] bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60'
          }
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
