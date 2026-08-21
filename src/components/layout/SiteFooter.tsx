import Link from 'next/link';
import {
  CONTACT,
  CONTACT_MAIL_HREF,
  CONTACT_TEL_HREF,
  CONTACT_PHONE_DISPLAY,
  CONTACT_TELEGRAM_HANDLE,
  CONTACT_TELEGRAM_HREF,
} from '@/lib/contact';
import { getTranslator } from '@/lib/i18n/server';
import { Logo } from '@/components/ui/Logo';

/**
 * The public site footer.
 *
 * Contact details get a column of their own rather than a line of small print:
 * someone looking for a phone number is usually looking for it in a hurry, and
 * the previous single-row footer put the number between a copyright notice and
 * two legal links where it read as decoration.
 *
 * Every contact row is a real link — `tel:`, `mailto:`, `t.me` — so a tap on a
 * phone dials. The Telegram row appears only when a handle is configured; there
 * is no support channel by default and the footer says nothing rather than
 * pointing at one that does not exist.
 */
function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
        {title}
      </h2>
      <ul className="flex flex-col gap-2 text-[13px] text-ink-soft">{children}</ul>
    </div>
  );
}

const linkClass =
  'rounded-sm hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500';

export async function SiteFooter() {
  const t = await getTranslator();

  return (
    <footer className="border-t border-line bg-canvas">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
          {/* Identity */}
          <div className="lg:pr-8">
            <Logo size={26} />
            <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-ink-soft">
              {t('footer.about')}
            </p>
          </div>

          <Column title={t('footer.platform')}>
            <li>
              <Link href="/#features" className={linkClass}>
                {t('footer.features')}
              </Link>
            </li>
            <li>
              <Link href="/#pricing" className={linkClass}>
                {t('footer.pricing')}
              </Link>
            </li>
            <li>
              <Link href="/register" className={linkClass}>
                {t('landing.ctaPrimary')}
              </Link>
            </li>
            <li>
              <Link href="/login" className={linkClass}>
                {t('auth.login')}
              </Link>
            </li>
          </Column>

          <Column title={t('footer.help')}>
            <li>
              <Link href="/#faq" className={linkClass}>
                {t('footer.faq')}
              </Link>
            </li>
            <li>
              <a href={CONTACT_MAIL_HREF} className={linkClass}>
                {t('footer.support')}
              </a>
            </li>
            <li className="text-ink-faint">{t('footer.supportHours')}</li>
          </Column>

          <Column title={t('footer.contact')}>
            <li>
              <a href={CONTACT_TEL_HREF} className={`tnum font-medium text-ink ${linkClass}`}>
                {CONTACT_PHONE_DISPLAY}
              </a>
            </li>
            <li>
              <a href={CONTACT_MAIL_HREF} className={`break-all ${linkClass}`}>
                {CONTACT.email}
              </a>
            </li>
            {CONTACT_TELEGRAM_HREF && (
              <li>
                <a
                  href={CONTACT_TELEGRAM_HREF}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={linkClass}
                >
                  {CONTACT_TELEGRAM_HANDLE}
                </a>
              </li>
            )}
          </Column>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-line pt-6 text-[12px] text-ink-faint sm:flex-row sm:items-center">
          <p>
            © {new Date().getFullYear()} {t('app.name')}. {t('footer.rights')}
          </p>
          <nav className="flex flex-wrap gap-x-5 gap-y-2 sm:ml-auto" aria-label={t('footer.legal')}>
            <Link href="/privacy" className={linkClass}>
              {t('footer.privacy')}
            </Link>
            <Link href="/terms" className={linkClass}>
              {t('footer.terms')}
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
