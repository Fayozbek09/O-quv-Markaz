import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getAdminSession } from '@/lib/auth/admin-session';
import { getTranslator } from '@/lib/i18n/server';
import { AdminLoginForm } from './AdminLoginForm';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('admin.signIn'), robots: { index: false, follow: false } };
}

export default async function AdminLoginPage() {
  const admin = await getAdminSession();
  if (admin) redirect(admin.mustChangePassword ? '/admin/change-password' : '/admin');
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center bg-surface-muted/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <AdminLoginForm />
      </div>
    </main>
  );
}
