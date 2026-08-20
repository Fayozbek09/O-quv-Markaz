import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAdminSession } from '@/lib/auth/admin-session';
import { csrfTokenFor } from '@/lib/security/csrf';
import { getTranslator } from '@/lib/i18n/server';
import { CsrfProvider } from '@/components/providers/CsrfProvider';
import { AdminNav } from './AdminNav';

/**
 * Guard for every administrative page.
 *
 * A centre session is not merely unwelcome here — it is invisible: this reads
 * the admin cookie only, so a signed-in teacher hitting /admin is bounced to
 * the admin login exactly like an anonymous visitor.
 */
export default async function AdminGuardedLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdminSession();
  if (!admin) redirect('/admin/login');
  if (admin.mustChangePassword) redirect('/admin/change-password');

  const t = await getTranslator();

  return (
    <CsrfProvider token={csrfTokenFor(admin.csrfSecret)}>
      <div className="flex min-h-dvh flex-col bg-surface-muted/40">
        <header className="border-b border-line bg-ink text-white">
          <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-4 px-3 sm:px-5">
            <Link href="/admin" className="text-sm font-semibold">
              {t('admin.title')}
            </Link>
            <AdminNav />
            <span className="ml-auto hidden text-[13px] text-white/70 sm:block">
              {admin.fullName}
            </span>
            <AdminNav logoutOnly />
          </div>
        </header>

        {admin.impersonatingOrgId && (
          <div className="bg-danger-600 px-4 py-2 text-[13px] font-semibold text-white">
            {t('admin.impersonating', { center: '—' })}{' '}
            <Link href="/center" className="underline">
              {t('admin.viewCenter')}
            </Link>
          </div>
        )}

        <main id="main" className="flex-1 px-3 py-4 sm:px-5 sm:py-6">
          <div className="mx-auto w-full max-w-[1400px]">{children}</div>
        </main>
      </div>
    </CsrfProvider>
  );
}
