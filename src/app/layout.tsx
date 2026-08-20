import type { Metadata, Viewport } from 'next';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Ustozly', template: '%s — Ustozly' },
  description: "A tutor's lessons, attendance and payments in one place.",
  applicationName: 'Ustozly',
  formatDetection: { telephone: false },
  robots: { index: true, follow: true },
  icons: {
    icon: [
      {
        url:
          "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>" +
          "<rect width='32' height='32' rx='8' fill='%232f62d8'/>" +
          "<path d='M9 8v11a7 7 0 0 0 14 0V8' stroke='white' stroke-width='2.6' fill='none' stroke-linecap='round'/>" +
          '</svg>',
        type: 'image/svg+xml',
      },
    ],
  },
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
