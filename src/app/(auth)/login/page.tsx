import type { Metadata } from 'next';
import { getTranslator } from '@/lib/i18n/server';
import { googleConfigured } from '@/lib/env';
import { LoginForm } from './LoginForm';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('auth.login'), robots: { index: false } };
}

export default async function LoginPage() {
  return <LoginForm googleEnabled={googleConfigured} />;
}
