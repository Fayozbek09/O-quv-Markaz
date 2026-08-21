import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSessionUser } from '@/lib/auth/session';
import { requireStudent } from '@/lib/domain/portal';
import { loadPage } from '@/lib/page';
import { csrfTokenFor } from '@/lib/security/csrf';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { AppProviders } from '@/components/providers/AppProviders';
import { Logo } from '@/components/ui/Logo';
import { PortalBar } from '@/components/layout/PortalBar';

/**
 * The student portal shell.
 *
 * Deliberately its own route group with its own chrome: a student never sees
 * the staff sidebar, and every page below reads through lib/domain/portal.ts,
 * which starts from the session's own user id.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.mustChangePassword) redirect('/change-password');

  // Anyone who is not a linked student — a teacher, a receptionist, an owner
  // who typed the URL — belongs on /forbidden. Left unwrapped, the 403 escaped
  // to the client boundary, which cannot tell a refusal from a crash and showed
  // "Something went wrong" with a Try again button that never would.
  const student = await loadPage(() => requireStudent(user));

  const locale = await getLocale();
  const t = await getTranslator();
  const name = [student.firstName, student.lastName].filter(Boolean).join(' ');

  return (
    <AppProviders locale={locale} csrfToken={csrfTokenFor(user.csrfSecret)}>
      <div className="flex min-h-dvh flex-col bg-surface-muted/40">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex h-14 w-full max-w-[1100px] items-center gap-3 px-3 sm:px-5">
            <Link href="/student" className="flex items-center gap-2">
              <Logo showText={false} size={26} />
              <span className="text-sm font-semibold text-ink">{t('student.title')}</span>
            </Link>
            <div className="ml-auto flex items-center gap-2">
              <PortalBar name={name} studentNo={student.studentNo} />
            </div>
          </div>
        </header>
        <main id="main" className="flex-1 px-3 py-4 sm:px-5 sm:py-6">
          <div className="mx-auto w-full max-w-[1100px]">{children}</div>
        </main>
      </div>
    </AppProviders>
  );
}
