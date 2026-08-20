'use client';

import type { ReactNode } from 'react';
import { I18nProvider } from '@/lib/i18n/provider';
import type { AppLocale } from '@/lib/i18n/config';
import { CsrfProvider } from './CsrfProvider';
import { ToastProvider } from './ToastProvider';

export function AppProviders({
  locale,
  csrfToken = '',
  children,
}: {
  locale: AppLocale;
  csrfToken?: string;
  children: ReactNode;
}) {
  return (
    <I18nProvider locale={locale}>
      <CsrfProvider token={csrfToken}>
        <ToastProvider>{children}</ToastProvider>
      </CsrfProvider>
    </I18nProvider>
  );
}
