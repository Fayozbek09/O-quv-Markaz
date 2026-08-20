import Link from 'next/link';
import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requireAdmin, platformStats, systemHealth } from '@/lib/admin';
import { getPricing } from '@/lib/domain/settings';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/i18n';
import { INTL_LOCALE } from '@/lib/i18n/config';
import { Stat, StatGrid } from '@/components/ui/Stat';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/Table';
import { PageHeader } from '@/components/layout/PageHeader';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('admin.dashboard') };
}

export default async function AdminDashboardPage() {
  await requireAdmin();
  const t = await getTranslator();
  const locale = await getLocale();

  const [stats, pricing, health, recentCenters, recentActivity] = await Promise.all([
    platformStats(),
    getPricing(),
    systemHealth(),
    prisma.organization.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true, name: true, city: true, status: true, createdAt: true,
        subscription: { select: { status: true, trialEndsAt: true } },
        _count: { select: { students: true } },
      },
    }),
    prisma.auditLog.findMany({
      where: { OR: [{ isOverride: true }, { action: { startsWith: 'admin.' } }] },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true, action: true, createdAt: true, outcome: true,
        organization: { select: { name: true } },
        actorAdmin: { select: { fullName: true } },
      },
    }),
  ]);

  const money = (v: bigint) => formatMoney(v, pricing.currency, INTL_LOCALE[locale]);

  return (
    <>
      <PageHeader
        title={t('admin.dashboard')}
        actions={
          <Link href="/admin/centers" className="btn btn-primary h-9 px-3 text-[13px]">
            {t('admin.centers')}
          </Link>
        }
      />

      <StatGrid className="mb-4">
        <Stat label={t('admin.totalCenters')} value={stats.centers} sub={`${t('admin.registrations')}: ${stats.registrations30d}`} />
        <Stat label={t('admin.activeCenters')} value={stats.activeCenters} tone="ok" />
        <Stat label={t('admin.suspendedCenters')} value={stats.suspendedCenters} tone={stats.suspendedCenters > 0 ? 'warn' : 'neutral'} />
        <Stat label={t('admin.mrr')} value={money(stats.mrrMinor)} tone="brand" sub={`${t('common.month')}: ${money(stats.monthCollectedMinor)}`} />
      </StatGrid>

      <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
        {t('billing.title')}
      </h3>
      <StatGrid className="mb-4 xl:grid-cols-5">
        <Stat label={t('admin.trialCenters')} value={stats.subscriptions.trial} tone="brand" />
        <Stat label={t('admin.payingCenters')} value={stats.subscriptions.active} tone="ok" />
        <Stat label={t('admin.paymentDue')} value={stats.subscriptions.paymentDue} tone={stats.subscriptions.paymentDue > 0 ? 'warn' : 'neutral'} />
        <Stat label={t('admin.gracePeriod')} value={stats.subscriptions.grace} tone={stats.subscriptions.grace > 0 ? 'warn' : 'neutral'} />
        <Stat label={t('billing.SUSPENDED')} value={stats.subscriptions.suspended} tone={stats.subscriptions.suspended > 0 ? 'danger' : 'neutral'} />
      </StatGrid>

      <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
        {t('admin.title')}
      </h3>
      <StatGrid className="mb-6 xl:grid-cols-5">
        <Stat label={t('admin.totalTeachers')} value={stats.teachers} />
        <Stat label={t('admin.totalStudents')} value={stats.students} />
        <Stat label={t('admin.totalGroups')} value={stats.groups} />
        <Stat label={t('admin.totalRevenue')} value={money(stats.revenueMinor)} />
        <Stat
          label={t('admin.systemHealth')}
          value={health.database ? t('admin.healthy') : t('admin.degraded')}
          tone={health.database ? 'ok' : 'danger'}
          sub={`${t('admin.database')}: ${health.latencyMs} ms`}
        />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={t('admin.centers')}
            action={
              <Link href="/admin/centers" className="text-[13px] font-medium text-brand-600 hover:underline">
                {t('dashboard.viewAll')}
              </Link>
            }
          />
          {recentCenters.length === 0 ? (
            <EmptyState title={t('common.empty')} />
          ) : (
            <ul className="divide-y divide-line">
              {recentCenters.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                  <Link
                    href={`/admin/centers/${c.id}`}
                    className="min-w-0 flex-1 truncate text-sm font-medium hover:text-brand-600 hover:underline"
                  >
                    {c.name}
                  </Link>
                  <span className="hidden shrink-0 text-[12px] text-ink-faint sm:block">{c.city}</span>
                  <span className="tnum shrink-0 text-[12px] text-ink-faint">{c._count.students}</span>
                  <Badge tone={c.status === 'ACTIVE' ? 'ok' : 'danger'}>
                    {c.subscription?.status
                      ? t(`billing.${c.subscription.status}` as 'billing.ACTIVE')
                      : t(`admin.${c.status === 'ACTIVE' ? 'activeCenters' : 'suspendedCenters'}` as 'admin.activeCenters')}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title={t('admin.audit')} subtitle={t('admin.overridesOnly')} />
          {recentActivity.length === 0 ? (
            <EmptyState title={t('common.empty')} />
          ) : (
            <ul className="divide-y divide-line">
              {recentActivity.map((row) => (
                <li key={row.id} className="flex items-center gap-3 px-4 py-2 text-[13px] sm:px-5">
                  <span className="min-w-0 flex-1 truncate font-medium">{row.action}</span>
                  <span className="hidden shrink-0 truncate text-[12px] text-ink-faint sm:block">
                    {row.organization?.name ?? '—'}
                  </span>
                  <span className="shrink-0 truncate text-[12px] text-ink-faint">
                    {row.actorAdmin?.fullName ?? '—'}
                  </span>
                  <span className="tnum shrink-0 text-[12px] text-ink-faint">
                    {formatDate(row.createdAt, locale, 'dayMonthTime')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
