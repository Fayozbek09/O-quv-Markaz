import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/admin';
import { getPricing } from '@/lib/domain/settings';
import { getTranslator } from '@/lib/i18n/server';
import { PageHeader } from '@/components/layout/PageHeader';
import { PricingForm } from './PricingForm';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('admin.pricing') };
}

export default async function AdminPricingPage() {
  await requireAdmin();
  const t = await getTranslator();
  const pricing = await getPricing();

  return (
    <>
      <PageHeader title={t('admin.pricing')} subtitle={t('admin.pricingHint')} />
      <div className="max-w-lg">
        <PricingForm
          initial={{
            monthlyPriceMinor: Number(pricing.monthlyPriceMinor),
            currency: pricing.currency,
            trialDays: pricing.trialDays,
            gracePeriodDays: pricing.gracePeriodDays,
          }}
        />
      </div>
    </>
  );
}
