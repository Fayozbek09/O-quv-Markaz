import type { Metadata } from 'next';
import { getLocale } from '@/lib/i18n/server';
import { getTranslator } from '@/lib/i18n/server';
import { AppProviders } from '@/components/providers/AppProviders';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  // The admin area is never indexed and never linked from the public site.
  return { title: { default: t('admin.title'), template: `%s · ${t('admin.title')}` }, robots: { index: false, follow: false } };
}

/**
 * Outer shell for /admin. Deliberately carries no session logic: the guard
 * lives in the (guarded) segment so the login and password-rotation screens can
 * render without one.
 */
export default async function AdminRootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return <AppProviders locale={locale}>{children}</AppProviders>;
}
