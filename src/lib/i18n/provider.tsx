'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createTranslator, type Translator } from './index';
import type { AppLocale } from './config';

const I18nContext = createContext<Translator | null>(null);

export function I18nProvider({ locale, children }: { locale: AppLocale; children: ReactNode }) {
  // The dictionaries are static objects, so building the translator per locale
  // change is cheap and needs no network round-trip.
  const translator = useMemo(() => createTranslator(locale), [locale]);
  return <I18nContext.Provider value={translator}>{children}</I18nContext.Provider>;
}

export function useT(): Translator {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT must be used inside <I18nProvider>');
  return ctx;
}

export function useLocale(): AppLocale {
  return useT().locale;
}
