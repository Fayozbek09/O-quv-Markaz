import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getSessionUser } from '@/lib/auth/session';
import { csrfTokenFor } from '@/lib/security/csrf';
import { getTranslator } from '@/lib/i18n/server';
import { ROLE_HOME } from '@/lib/rbac';
import { ChangePasswordForm } from './ChangePasswordForm';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('changePassword.title'), robots: { index: false } };
}

/**
 * The forced first-login change. Every layout redirects here while
 * `mustChangePassword` is set, so a temporary password cannot be used to browse
 * the app — only to replace itself.
 */
export default async function ChangePasswordPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!user.mustChangePassword) redirect(user.role ? ROLE_HOME[user.role] : '/onboarding');

  return <ChangePasswordForm csrfToken={csrfTokenFor(user.csrfSecret)} />;
}
