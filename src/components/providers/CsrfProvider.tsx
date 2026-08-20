'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * The per-session CSRF token. It is rendered into the app shell by a server
 * component and echoed back in the X-CSRF-Token header on every mutation.
 * Same-origin script can read it; a cross-site page cannot.
 */
const CsrfContext = createContext<string>('');

export function CsrfProvider({ token, children }: { token: string; children: ReactNode }) {
  return <CsrfContext.Provider value={token}>{children}</CsrfContext.Provider>;
}

export const useCsrfToken = () => useContext(CsrfContext);
