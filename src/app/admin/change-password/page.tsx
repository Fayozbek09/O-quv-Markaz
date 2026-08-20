import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getAdminSession } from '@/lib/auth/admin-session';
import { csrfTokenFor } from '@/lib/security/csrf';
import { getTranslator } from '@/lib/i18n/server';
import { CsrfProvider } from '@/components/providers/CsrfProvider';
import { AdminChangePasswordForm } from './AdminChangePasswordForm';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('changePassword.title'), robots: { index: false, follow: false } };
}

export default async function AdminChangePasswordPage() {
  const admin = await getAdminSession();
  if (!admin) redirect('/admin/login');

  return (
    <CsrfProvider token={csrfTokenFor(admin.csrfSecret)}>
      <main id="main" className="flex min-h-dvh items-center justify-center bg-surface-muted/40 px-4 py-10">
        <div className="w-full max-w-sm">
          <AdminChangePasswordForm />
        </div>
      </main>
    </CsrfProvider>
  );
}
