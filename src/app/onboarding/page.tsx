import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getSessionUser } from '@/lib/auth/session';
import { csrfTokenFor } from '@/lib/security/csrf';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { AppProviders } from '@/components/providers/AppProviders';
import { OnboardingWizard } from './OnboardingWizard';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('onboarding.title'), robots: { index: false } };
}

export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.activeOrgId) redirect('/dashboard');

  const locale = await getLocale();

  return (
    <AppProviders locale={locale} csrfToken={csrfTokenFor(user.csrfSecret)}>
      <OnboardingWizard initialFirstName={user.firstName} />
    </AppProviders>
  );
}
