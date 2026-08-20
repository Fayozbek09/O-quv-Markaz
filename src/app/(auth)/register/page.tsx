import type { Metadata } from 'next';
import { getTranslator } from '@/lib/i18n/server';
import { googleConfigured, isProd } from '@/lib/env';
import { RegisterForm } from './RegisterForm';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('auth.register'), robots: { index: false } };
}

export default function RegisterPage() {
  return <RegisterForm googleEnabled={googleConfigured} showDevCode={!isProd} />;
}
