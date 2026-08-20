import type { Metadata } from 'next';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { INTL_LOCALE } from '@/lib/i18n/config';
import { googleConfigured, isProd } from '@/lib/env';
import { getPricing } from '@/lib/domain/settings';
import { formatMoney } from '@/lib/money';
import { RegisterForm } from './RegisterForm';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('auth.register'), robots: { index: false } };
}

export default async function RegisterPage() {
  // The price is read from platform settings rather than written into the
  // interface, so changing it at /admin/pricing changes what a centre is told
  // here too.
  const [pricing, locale] = await Promise.all([getPricing(), getLocale()]);

  return (
    <RegisterForm
      googleEnabled={googleConfigured}
      showDevCode={!isProd}
      priceLabel={formatMoney(pricing.monthlyPriceMinor, pricing.currency, INTL_LOCALE[locale])}
    />
  );
}
