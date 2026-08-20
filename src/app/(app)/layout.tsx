import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth/session';
import { getAdminSession } from '@/lib/auth/admin-session';
import { requireOrg } from '@/lib/tenant';
import { csrfTokenFor } from '@/lib/security/csrf';
import { signFileUrl } from '@/lib/files/storage';
import { getLocale } from '@/lib/i18n/server';
import { formatMoney } from '@/lib/money';
import { INTL_LOCALE } from '@/lib/i18n/config';
import { navFor } from '@/lib/nav';
import { ROLE_HOME } from '@/lib/rbac';
import { currentSubscription } from '@/lib/domain/subscription';
import { AppProviders } from '@/components/providers/AppProviders';
import { Sidebar } from '@/components/layout/Sidebar';
import { AppTopbar } from '@/components/layout/AppTopbar';
import { BillingBanner, ImpersonationBanner } from '@/components/layout/StatusBanners';

/**
 * The staff shell.
 *
 * Three gates run before anything renders: a session must exist, the account
 * must not still be holding a temporary password, and a student session is sent
 * to its own portal rather than into the staff area.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  const admin = user ? null : await getAdminSession();

  if (!user && !admin?.impersonatingOrgId) redirect('/login');
  if (user?.mustChangePassword) redirect('/change-password');
  if (user && !user.activeOrgId) redirect('/onboarding');
  if (user?.role === 'STUDENT') redirect('/student');

  const ctx = await requireOrg();

  const [org, unread, subscription] = await Promise.all([
    prisma.organization.findFirst({
      where: { id: ctx.orgId, deletedAt: null },
      select: { name: true, logoFileId: true, defaultCurrency: true },
    }),
    user
      ? prisma.notification.count({ where: { userId: user.userId, readAt: null } })
      : Promise.resolve(0),
    currentSubscription(ctx.orgId),
  ]);
  if (!org) redirect('/onboarding');

  const locale = await getLocale();
  const userName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.firstName
    : (admin?.fullName ?? '');

  const items = navFor(ctx.role, ctx.permissions).map((item) => ({
    key: item.key,
    href: item.href,
    labelKey: item.labelKey,
  }));

  return (
    <AppProviders locale={locale} csrfToken={csrfTokenFor(ctx.csrfSecret)}>
      <div className="flex min-h-dvh flex-col">
        {ctx.isOverride && <ImpersonationBanner centerName={org.name} />}
        <BillingBanner
          status={subscription.status}
          trialDaysLeft={subscription.trialDaysLeft}
          daysLeft={subscription.daysLeft}
          price={formatMoney(subscription.amountMinor, subscription.currency, INTL_LOCALE[locale])}
          canPay={ctx.permissions.has('center.billing')}
        />
        <div className="flex min-h-0 flex-1">
          <Sidebar
            workspaceName={org.name}
            logoUrl={org.logoFileId ? signFileUrl(org.logoFileId, 30 * 60_000) : null}
            items={items}
            homeHref={ROLE_HOME[ctx.role]}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <AppTopbar
              userName={userName}
              workspaceName={org.name}
              unreadCount={unread}
              items={items}
            />
            <main id="main" className="flex-1 px-3 py-4 sm:px-5 sm:py-6">
              <div className="mx-auto w-full max-w-[1400px]">{children}</div>
            </main>
          </div>
        </div>
      </div>
    </AppProviders>
  );
}
