import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLocale } from '@/lib/i18n/server';
import { getSessionUser } from '@/lib/auth/session';
import { AppProviders } from '@/components/providers/AppProviders';
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';
import { Logo } from '@/components/ui/Logo';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // A signed-in visitor has no business on the login screen.
  const user = await getSessionUser();
  if (user) redirect(user.activeOrgId ? '/dashboard' : '/onboarding');

  const locale = await getLocale();

  return (
    <AppProviders locale={locale}>
      <div className="flex min-h-dvh flex-col bg-canvas">
        <header className="flex h-14 items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="Ustozly">
            <Logo size={26} />
          </Link>
          <LanguageSwitcher compact />
        </header>

        <main id="main" className="flex flex-1 items-start justify-center px-4 py-6 sm:items-center sm:py-10">
          <div className="w-full max-w-[26rem]">{children}</div>
        </main>

        <footer className="px-4 py-6 text-center text-[12px] text-ink-faint">
          <Link href="/privacy" className="hover:underline">
            Privacy
          </Link>
          <span className="mx-2">·</span>
          <Link href="/terms" className="hover:underline">
            Terms
          </Link>
        </footer>
      </div>
    </AppProviders>
  );
}
