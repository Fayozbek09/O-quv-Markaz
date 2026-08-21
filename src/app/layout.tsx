import type { Metadata, Viewport } from 'next';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import './globals.css';

/**
 * The favicon is the same open book as `components/ui/Logo`, inlined as a data
 * URI so the tab icon needs no request and cannot 404. Kept literally in step
 * with the component: if one changes, change both.
 */
const FAVICON =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>" +
  "<rect width='32' height='32' rx='8' fill='%232f62d8'/>" +
  "<path d='M16 11.6c-1.9-1.6-4.3-2.4-7.1-2.4a1 1 0 0 0-1 1v10.6a1 1 0 0 0 1 1c2.8 0 5.2.8 7.1 2.4 1.9-1.6 4.3-2.4 7.1-2.4a1 1 0 0 0 1-1V10.2a1 1 0 0 0-1-1c-2.8 0-5.2.8-7.1 2.4Z' fill='white'/>" +
  "<path d='M16 11.6v12.6' stroke='%232f62d8' stroke-width='1.5' stroke-linecap='round'/>" +
  '</svg>';

export const metadata: Metadata = {
  title: { default: "O'quv Markaz", template: "%s — O'quv Markaz" },
  description: "A complete management platform for education centres in Uzbekistan.",
  applicationName: "O'quv Markaz",
  formatDetection: { telephone: false },
  robots: { index: true, follow: true },
  icons: { icon: [{ url: FAVICON, type: 'image/svg+xml' }] },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#ffffff',
};

const HTML_LANG: Record<string, string> = { uz: 'uz-Latn-UZ', ru: 'ru-RU', en: 'en' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = await getTranslator();

  return (
    <html lang={HTML_LANG[locale] ?? 'uz'}>
      <body>
        {/* First tab stop on every page: jumps past the navigation. */}
        <a href="#main" className="skip-link">
          {t('common.skipToContent')}
        </a>
        {children}
      </body>
    </html>
  );
}
