import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getAdminSession } from '@/lib/auth/admin-session';
import { csrfTokenFor } from '@/lib/security/csrf';
import { getTranslator } from '@/lib/i18n/server';
import { CsrfProvider } from '@/components/providers/CsrfProvider';
import { AdminTwoFactorForm } from './AdminTwoFactorForm';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('admin.twoFactor'), robots: { index: false, follow: false } };
}

/**
 * The second-factor challenge.
 *
 * Sits outside the (guarded) segment on purpose: a session awaiting its code is
 * refused everywhere else, so this page has to be reachable without one.
 */
export default async function AdminTwoFactorPage() {
  const admin = await getAdminSession();
  if (!admin) redirect('/admin/login');
  // Already satisfied — or never required. Nothing to ask for.
  if (!admin.awaitingSecondFactor) {
    redirect(admin.mustChangePassword ? '/admin/change-password' : '/admin');
  }

  return (
    <CsrfProvider token={csrfTokenFor(admin.csrfSecret)}>
      <main
        id="main"
        className="flex min-h-dvh items-center justify-center bg-surface-muted/40 px-4 py-10"
      >
        <div className="w-full max-w-sm">
          <AdminTwoFactorForm />
        </div>
      </main>
    </CsrfProvider>
  );
}
