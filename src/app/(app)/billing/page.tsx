import type { Metadata } from 'next';
import { requireOrgPage, requirePagePermission } from '@/lib/page';
import { currentSubscription } from '@/lib/domain/subscription';
import { getPricing } from '@/lib/domain/settings';
import { planUsage } from '@/lib/domain/plan';
import { prisma } from '@/lib/db';
import { scope } from '@/lib/tenant';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/i18n';
import { INTL_LOCALE } from '@/lib/i18n/config';
import { paymentProvider } from '@/lib/payments';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Stat, StatGrid } from '@/components/ui/Stat';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, TableWrap, Th, Td } from '@/components/ui/Table';
import { PageHeader } from '@/components/layout/PageHeader';
import { PayButton } from './PayButton';
import type { TKey } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('billing.title'), robots: { index: false } };
}

const TONE: Record<string, 'ok' | 'warn' | 'danger' | 'brand' | 'neutral'> = {
  TRIAL: 'brand', TRIALING: 'brand', ACTIVE: 'ok',
  PAYMENT_DUE: 'warn', PAST_DUE: 'warn', GRACE_PERIOD: 'warn',
  SUSPENDED: 'danger', CANCELLED: 'neutral', CANCELED: 'neutral',
};

export default async function BillingPage() {
  const ctx = await requireOrgPage();
  requirePagePermission(ctx, 'center.billing');

  const t = await getTranslator();
  const locale = await getLocale();

  const [subscription, pricing, usage, payments] = await Promise.all([
    currentSubscription(ctx.orgId),
    getPricing(),
    planUsage(ctx.orgId),
    prisma.subscriptionPayment.findMany({
      where: scope.org(ctx),
      orderBy: { createdAt: 'desc' },
      take: 24,
    }),
  ]);

  const money = (v: bigint) => formatMoney(v, subscription.currency, INTL_LOCALE[locale]);
  const price = money(subscription.amountMinor);
  const onTrial = subscription.status === 'TRIAL' || subscription.status === 'TRIALING';

  return (
    <>
      <PageHeader title={t('billing.title')} subtitle={t('billing.forWholeCenter')} />

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title={`${t('billing.standard')} — ${price} ${t('billing.perMonth')}`}
            subtitle={t('billing.unlimited')}
            action={<Badge tone={TONE[subscription.status] ?? 'neutral'}>{t(`billing.${subscription.status}` as TKey)}</Badge>}
          />
          <CardBody className="flex flex-col gap-3">
            {onTrial && (
              <p className="rounded-[var(--radius-field)] border border-brand-100 bg-brand-50 px-3 py-2 text-[13px] text-brand-700">
                {subscription.trialDaysLeft === 0
                  ? t('billing.trialLastDay')
                  : t('billing.trialLeft', { days: subscription.trialDaysLeft ?? 0 })}
              </p>
            )}
            {subscription.status === 'SUSPENDED' && (
              <p className="rounded-[var(--radius-field)] border border-danger-50 bg-danger-50 px-3 py-2 text-[13px] text-danger-600">
                {t('billing.subscriptionSuspended')}
              </p>
            )}
            {(subscription.status === 'PAYMENT_DUE' ||
              subscription.status === 'GRACE_PERIOD' ||
              subscription.status === 'PAST_DUE') && (
              <p className="rounded-[var(--radius-field)] border border-warn-50 bg-warn-50 px-3 py-2 text-[13px] text-warn-600">
                {t('billing.gracePeriodWarning', { days: subscription.daysLeft ?? 0 })}
              </p>
            )}

            <p className="text-[13px] text-ink-soft">{t('billing.dataSafe')}</p>

            <PayButton
              price={price}
              configured={paymentProvider.configured}
              notConfiguredMessage={t('billing.providerNotConfigured')}
            />
          </CardBody>
        </Card>

        <div className="grid gap-3">
          <Stat
            label={t('billing.paidUntil')}
            value={
              subscription.subscriptionEndsAt
                ? formatDate(subscription.subscriptionEndsAt, locale, 'date')
                : onTrial && subscription.trialEndsAt
                  ? formatDate(subscription.trialEndsAt, locale, 'date')
                  : '—'
            }
          />
          <Stat
            label={t('billing.lastPayment')}
            value={
              subscription.lastPaymentAt ? formatDate(subscription.lastPaymentAt, locale, 'date') : '—'
            }
          />
          <Stat label={t('admin.trialDays')} value={pricing.trialDays} sub={`${t('admin.graceDays')}: ${pricing.gracePeriodDays}`} />
        </div>
      </div>

      {/* Usage is shown for information only — no plan caps any of these. */}
      <StatGrid className="mb-4 xl:grid-cols-3">
        <Stat label={t('nav.students')} value={usage.activeStudents} sub={t('billing.unlimited')} />
        <Stat label={t('staff.teachers')} value={usage.teachers} />
        <Stat label={t('nav.groups')} value={usage.groups} />
      </StatGrid>

      <Card>
        <CardHeader title={t('billing.history')} />
        {payments.length === 0 ? (
          <EmptyState title={t('common.empty')} />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>{t('common.date')}</Th>
                <Th>{t('billing.provider')}</Th>
                <Th>{t('billing.status')}</Th>
                <Th className="text-right">{t('billing.amount')}</Th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
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
                  <Td className="tnum text-right text-sm font-semibold">
                    {formatMoney(p.amountMinor, p.currency, INTL_LOCALE[locale])}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
