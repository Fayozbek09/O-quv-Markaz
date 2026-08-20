import type { Metadata } from 'next';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { LegalDoc } from '@/components/LegalDoc';
import { LEGAL_LAST_UPDATED, TERMS } from '@/lib/legal/content';
import { formatDate } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('legal.termsTitle') };
}

export default async function TermsPage() {
  const t = await getTranslator();
  const locale = await getLocale();
  return (
    <LegalDoc
      title={t('legal.termsTitle')}
      lastUpdated={t('legal.lastUpdated', {
        date: formatDate(`${LEGAL_LAST_UPDATED}T00:00:00Z`, locale, { dateStyle: 'long' }, 'UTC'),
      })}
      doc={TERMS[locale]}
    />
  );
}
