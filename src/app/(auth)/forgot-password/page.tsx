import type { Metadata } from 'next';
import { getTranslator } from '@/lib/i18n/server';
import { ForgotForm } from './ForgotForm';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('auth.forgotTitle'), robots: { index: false } };
}

export default function ForgotPasswordPage() {
  return <ForgotForm />;
}
