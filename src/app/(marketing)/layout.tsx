import Link from 'next/link';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import {
  CONTACT, CONTACT_MAIL_HREF, CONTACT_TEL_HREF, CONTACT_PHONE_DISPLAY,
} from '@/lib/contact';
import { AppProviders } from '@/components/providers/AppProviders';
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';
import { Logo } from '@/components/ui/Logo';

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = await getTranslator();

  return (
    <AppProviders locale={locale}>
      <div className="flex min-h-dvh flex-col bg-surface">
        <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
            <Link href="/" aria-label="Ustozly">
              <Logo size={26} />
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

        <footer className="border-t border-line bg-canvas">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-8 text-[13px] text-ink-soft sm:px-6">
            <Logo size={22} />
            <span className="text-ink-faint">
              © {new Date().getFullYear()} Ustozly. {t('landing.footerRights')}
            </span>
            <div className="flex-1" />
            <a href={CONTACT_MAIL_HREF} className="hover:text-ink hover:underline">
              {CONTACT.email}
            </a>
            <a href={CONTACT_TEL_HREF} className="tnum hover:text-ink hover:underline">
              {CONTACT_PHONE_DISPLAY}
            </a>
            <Link href="/privacy" className="hover:text-ink hover:underline">
              {t('legal.privacyTitle')}
            </Link>
            <Link href="/terms" className="hover:text-ink hover:underline">
              {t('legal.termsTitle')}
            </Link>
          </div>
        </footer>
      </div>
    </AppProviders>
  );
}
