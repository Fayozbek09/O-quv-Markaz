'use client';

import { useEffect } from 'react';

/**
 * Client error boundary. The user sees a fixed message; the digest is the only
 * identifier shown, so no stack trace or internal detail leaks.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[boundary]', error.digest ?? error.message);
  }, [error]);

  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="max-w-sm text-sm text-ink-soft">
        We could not complete that request. Please try again.
      </p>
      {error.digest && <p className="font-mono text-xs text-ink-faint">ref: {error.digest}</p>}
      <button
        type="button"
        onClick={reset}
        className="mt-2 rounded-[var(--radius-field)] bg-brand-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
      >
        Try again
      </button>
    </main>
  );
}
