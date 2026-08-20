import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/admin';
import { isUuid } from '@/lib/tenant';
import { currentSubscription } from '@/lib/domain/subscription';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/i18n';
import { INTL_LOCALE } from '@/lib/i18n/config';
import { Stat, StatGrid } from '@/components/ui/Stat';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, TableWrap, Th, Td } from '@/components/ui/Table';
import { PageHeader } from '@/components/layout/PageHeader';
import { CenterActions } from './CenterActions';
import type { TKey } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('admin.center') };
}

export default async function AdminCenterPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const org = await prisma.organization.findFirst({
    where: { id, deletedAt: null },
    include: {
      _count: { select: { students: true, groups: true, courses: true, lessons: true } },
      members: {
        where: { removedAt: null },
        orderBy: { joinedAt: 'asc' },
        select: {
          id: true, role: true, status: true,
          user: {
            select: {
              username: true, email: true, phone: true, lastLoginAt: true,
              profile: { select: { firstName: true, lastName: true } },
            },
          },
        },
      },
    },
  });
  if (!org) notFound();

  const t = await getTranslator();
  const locale = await getLocale();

  const [subscription, payments, revenue, outstanding, subPayments, recentAudit] = await Promise.all([
    currentSubscription(org.id),
    prisma.payment.count({ where: { organizationId: org.id } }),
    prisma.payment.aggregate({
      _sum: { amountMinor: true },
      where: { organizationId: org.id, status: 'COMPLETED' },
    }),
    prisma.invoice.aggregate({
      _sum: { amountMinor: true },
      where: { organizationId: org.id, status: 'OPEN' },
    }),
    prisma.subscriptionPayment.findMany({
      where: { organizationId: org.id },
      orderBy: { createdAt: 'desc' },
      take: 12,
    }),
    prisma.auditLog.findMany({
      where: { organizationId: org.id },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: {
        id: true, action: true, createdAt: true, isOverride: true, outcome: true,
        actorAdmin: { select: { fullName: true } },
        actor: { select: { profile: { select: { firstName: true, lastName: true } } } },
      },
    }),
  ]);

  const money = (v: bigint) => formatMoney(v, org.defaultCurrency, INTL_LOCALE[locale]);

  return (
    <>
      <PageHeader
        title={org.name}
        subtitle={[org.city, org.district, org.phone].filter(Boolean).join(' · ')}
        actions={
          <CenterActions
            centerId={org.id}
            centerName={org.name}
            status={org.status}
            currency={org.defaultCurrency}
          />
        }
      />

      {org.status === 'SUSPENDED' && (
        <div className="mb-4 rounded-[var(--radius-card)] border border-danger-50 bg-danger-50 px-4 py-3 text-[13px] text-danger-600">
          <strong className="font-semibold">{t('center.suspendedTitle')}</strong>
          {org.suspendedReason ? ` — ${org.suspendedReason}` : ''}
        </div>
      )}

      <StatGrid className="mb-4">
        <Stat label={t('nav.students')} value={org._count.students} />
        <Stat label={t('nav.groups')} value={org._count.groups} sub={`${t('nav.courses')}: ${org._count.courses}`} />
        <Stat label={t('admin.totalRevenue')} value={money(revenue._sum.amountMinor ?? 0n)} sub={`${payments} ${t('nav.payments').toLowerCase()}`} />
        <Stat
          label={t('center.outstanding')}
          value={money(outstanding._sum.amountMinor ?? 0n)}
          tone={(outstanding._sum.amountMinor ?? 0n) > 0n ? 'warn' : 'neutral'}
        />
      </StatGrid>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={t('billing.title')}
            action={<Badge tone={subscription.status === 'ACTIVE' ? 'ok' : subscription.status === 'SUSPENDED' ? 'danger' : 'brand'}>
              {t(`billing.${subscription.status}` as TKey)}
            </Badge>}
          />
          <CardBody className="grid grid-cols-2 gap-3 text-[13px]">
            <div>
              <p className="text-ink-faint">{t('billing.amount')}</p>
              <p className="tnum font-semibold text-ink">{money(subscription.amountMinor)}</p>
            </div>
            <div>
              <p className="text-ink-faint">{t('billing.paidUntil')}</p>
              <p className="tnum font-semibold text-ink">
                {subscription.subscriptionEndsAt
                  ? formatDate(subscription.subscriptionEndsAt, locale, 'date')
                  : subscription.trialEndsAt
                    ? formatDate(subscription.trialEndsAt, locale, 'date')
                    : '—'}
              </p>
            </div>
            <div>
              <p className="text-ink-faint">{t('billing.lastPayment')}</p>
              <p className="tnum font-semibold text-ink">
                {subscription.lastPaymentAt ? formatDate(subscription.lastPaymentAt, locale, 'date') : '—'}
              </p>
            </div>
            <div>
              <p className="text-ink-faint">{t('common.date')}</p>
              <p className="tnum font-semibold text-ink">{formatDate(org.createdAt, locale, 'date')}</p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('billing.history')} />
          {subPayments.length === 0 ? (
            <EmptyState title={t('common.empty')} />
          ) : (
            <TableWrap className="px-1 pb-1">
              <thead>
                <tr>
                  <Th>{t('common.date')}</Th>
                  <Th>{t('billing.provider')}</Th>
                  <Th>{t('billing.status')}</Th>
                  <Th className="text-right">{t('billing.amount')}</Th>
                </tr>
              </thead>
              <tbody>
                {subPayments.map((p) => (
                  <tr key={p.id}>
                    <Td className="tnum whitespace-nowrap text-[13px]">
                      {formatDate(p.paidAt ?? p.createdAt, locale, 'dateNumeric')}
                    </Td>
                    <Td className="text-[13px]">{p.provider}</Td>
                    <Td>
                      <Badge tone={p.status === 'PAID' ? 'ok' : p.status === 'FAILED' ? 'danger' : 'neutral'}>
                        {t(`billing.${p.status}` as TKey)}
                      </Badge>
                    </Td>
                    <Td className="tnum text-right text-[13px] font-semibold">
                      {formatMoney(p.amountMinor, p.currency, INTL_LOCALE[locale])}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('staff.title')} />
          {org.members.length === 0 ? (
            <EmptyState title={t('staff.noStaff')} />
          ) : (
            <TableWrap className="px-1 pb-1">
              <thead>
                <tr>
                  <Th>{t('common.name')}</Th>
                  <Th>{t('staff.role')}</Th>
                  <Th>{t('staff.username')}</Th>
                  <Th>{t('staff.lastLogin')}</Th>
                </tr>
              </thead>
              <tbody>
                {org.members.map((m) => (
                  <tr key={m.id}>
                    <Td className="text-[13px]">
                      {[m.user.profile?.firstName, m.user.profile?.lastName].filter(Boolean).join(' ') || '—'}
                    </Td>
                    <Td>
                      <Badge tone={m.role === 'OWNER' ? 'brand' : 'neutral'}>
                        {t(`roles.${m.role}` as TKey)}
                      </Badge>
                    </Td>
                    <Td className="font-mono text-[12px] text-ink-soft">{m.user.username ?? '—'}</Td>
                    <Td className="tnum whitespace-nowrap text-[12px] text-ink-faint">
                      {m.user.lastLoginAt
                        ? formatDate(m.user.lastLoginAt, locale, 'dateNumeric')
                        : t('staff.neverLoggedIn')}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>

        <Card>
          <CardHeader
            title={t('admin.audit')}
            action={
              <Link
                href={`/admin/audit?organizationId=${org.id}`}
                className="text-[13px] font-medium text-brand-600 hover:underline"
              >
                {t('dashboard.viewAll')}
              </Link>
            }
          />
          {recentAudit.length === 0 ? (
            <EmptyState title={t('common.empty')} />
          ) : (
            <ul className="divide-y divide-line">
              {recentAudit.map((row) => (
                <li key={row.id} className="flex items-center gap-3 px-4 py-2 text-[13px] sm:px-5">
                  <span className="min-w-0 flex-1 truncate font-medium">{row.action}</span>
                  {row.isOverride && <Badge tone="danger">{t('nav.admin')}</Badge>}
                  <span className="shrink-0 truncate text-[12px] text-ink-faint">
                    {row.actorAdmin?.fullName ??
                      [row.actor?.profile?.firstName, row.actor?.profile?.lastName].filter(Boolean).join(' ')}
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
