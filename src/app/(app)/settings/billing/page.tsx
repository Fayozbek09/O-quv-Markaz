import type { Metadata } from 'next';
import { requireOrg } from '@/lib/tenant';
import { planUsage } from '@/lib/domain/plan';
import { currentOrg } from '@/lib/domain/org';
import { PLANS } from '@/lib/payments/provider';
import { paymentProvider } from '@/lib/payments';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/i18n';
import { INTL_LOCALE } from '@/lib/i18n/config';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { BillingActions } from './BillingActions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('settings.billingTitle'), robots: { index: false } };
}

export default async function BillingSettingsPage() {
  const ctx = await requireOrg();
  const t = await getTranslator();
  const locale = await getLocale();

  const [usage, org] = await Promise.all([planUsage(ctx.orgId), currentOrg(ctx)]);
  const money = (v: bigint) => formatMoney(v, 'UZS', INTL_LOCALE[locale]);

  const planLabel = {
    FREE: t('settings.planFree'),
    PRO: t('settings.planPro'),
    ANNUAL: t('settings.planAnnual'),
  } as const;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title={t('settings.billingTitle')}
          subtitle={t('settings.billingSubtitle')}
          action={<Badge tone="brand">{planLabel[usage.subscription.plan]}</Badge>}
        />
        <CardBody className="flex flex-col gap-2">
          <p className="text-sm">
            {usage.limit === null
              ? `${t('settings.studentUsage', { used: usage.activeStudents, limit: 0 }).split('/')[0]} · ${t('settings.unlimited')}`
              : t('settings.studentUsage', { used: usage.activeStudents, limit: usage.limit })}
          </p>

          {usage.limit !== null && (
            <div className="h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-line">
              <div
                className={usage.activeStudents >= usage.limit ? 'h-full bg-warn-600' : 'h-full bg-brand-500'}
                style={{ width: `${Math.min(100, (usage.activeStudents / usage.limit) * 100)}%` }}
              />
            </div>
          )}

          {usage.subscription.currentPeriodEnd && (
            <p className="text-[13px] text-ink-soft">
              {t('reports.period')}:{' '}
              {formatDate(usage.subscription.currentPeriodEnd, locale, { dateStyle: 'medium' }, org.timezone)}
            </p>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        {(['FREE', 'PRO', 'ANNUAL'] as const).map((plan) => (
          <Card key={plan} className={usage.subscription.plan === plan ? 'border-brand-500 ring-1 ring-brand-500' : ''}>
            <CardBody className="flex h-full flex-col gap-2">
              <p className="text-[13px] font-semibold uppercase tracking-wide text-ink-faint">
                {planLabel[plan]}
              </p>
              <p className="tnum text-xl font-semibold">
                {money(PLANS[plan].priceMinor)}
                <span className="text-[13px] font-normal text-ink-faint">
                  {plan === 'PRO' ? t('landing.perMonth') : plan === 'ANNUAL' ? t('landing.perYear') : ''}
                </span>
              </p>
              <p className="text-[13px] text-ink-soft">
                {PLANS[plan].studentLimit === null
                  ? t('settings.unlimited')
                  : t('landing.priceFreeDesc')}
              </p>
              <div className="mt-auto pt-2">
                {usage.subscription.plan === plan ? (
                  <Badge tone="brand">{t('settings.currentPlan')}</Badge>
                ) : plan === 'FREE' ? null : (
                  <BillingActions
                    plan={plan}
                    canManage={ctx.role === 'OWNER'}
                    providerConfigured={paymentProvider.configured}
                  />
                )}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      {!paymentProvider.configured && (
        <p className="rounded-[var(--radius-card)] border border-warn-50 bg-warn-50 px-4 py-3 text-[13px] text-warn-600">
          {t('settings.billingNotConfigured')}
        </p>
      )}
    </div>
  );
}
