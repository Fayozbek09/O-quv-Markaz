import Link from 'next/link';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { AppProviders } from '@/components/providers/AppProviders';
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';
import { Logo } from '@/components/ui/Logo';
import { SiteFooter } from '@/components/layout/SiteFooter';

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = await getTranslator();

  return (
    <AppProviders locale={locale}>
      <div className="flex min-h-dvh flex-col bg-surface">
        <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
            <Link href="/" aria-label="O'quv Markaz">
              <Logo size={26} textClassName="hidden min-[380px]:inline" />
            </Link>
            <div className="flex-1" />
            <LanguageSwitcher compact />
            <Link
              href="/login"
              className="hidden rounded-[var(--radius-field)] px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-surface-muted hover:text-ink sm:block"
            >
              {t('auth.login')}
            </Link>
            <Link
              href="/register"
              className="rounded-[var(--radius-field)] bg-brand-500 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-brand-600"
            >
              {t('landing.ctaPrimary')}
            </Link>
          </div>
        </header>

        <main id="main" className="flex-1">
          {children}
        </main>

        <SiteFooter />
      </div>
    </AppProviders>
  );
}
