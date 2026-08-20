'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';

type Tone = 'ok' | 'error' | 'info';
type Toast = { id: number; message: string; tone: Tone };

const ToastContext = createContext<{ push: (message: string, tone?: Tone) => void }>({
  push: () => {},
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, tone: Tone = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Announced to screen readers without stealing focus. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              'pointer-events-auto rounded-[var(--radius-field)] border px-3.5 py-2.5 text-sm shadow-[var(--shadow-pop)]',
              t.tone === 'ok' && 'border-ok-50 bg-ok-50 text-ok-600',
              t.tone === 'error' && 'border-danger-50 bg-danger-50 text-danger-600',
              t.tone === 'info' && 'border-line bg-surface text-ink',
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
