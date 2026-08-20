import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth/session';
import { csrfTokenFor } from '@/lib/security/csrf';
import { signFileUrl } from '@/lib/files/storage';
import { getLocale } from '@/lib/i18n/server';
import { AppProviders } from '@/components/providers/AppProviders';
import { Sidebar } from '@/components/layout/Sidebar';
import { AppTopbar } from '@/components/layout/AppTopbar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!user.activeOrgId) redirect('/onboarding');

  const [org, unread] = await Promise.all([
    prisma.organization.findFirst({
      where: { id: user.activeOrgId, deletedAt: null },
      select: { name: true, logoFileId: true },
    }),
    prisma.notification.count({ where: { userId: user.userId, readAt: null } }),
  ]);
  if (!org) redirect('/onboarding');

  const locale = await getLocale();
  const userName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.firstName;

  return (
    <AppProviders locale={locale} csrfToken={csrfTokenFor(user.csrfSecret)}>
      <div className="flex min-h-dvh">
        <Sidebar
          workspaceName={org.name}
          logoUrl={org.logoFileId ? signFileUrl(org.logoFileId, 30 * 60_000) : null}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppTopbar userName={userName} workspaceName={org.name} unreadCount={unread} />
          <main id="main" className="flex-1 px-3 py-4 sm:px-5 sm:py-6">
            <div className="mx-auto w-full max-w-[1400px]">{children}</div>
          </main>
        </div>
      </div>
    </AppProviders>
  );
}
