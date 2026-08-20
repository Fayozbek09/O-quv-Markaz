import type { Metadata } from 'next';
import { requireOrg, assertPermission } from '@/lib/tenant';
import { yearlyFinance } from '@/lib/domain/finance';
import { orgTimezone, currentOrg } from '@/lib/domain/org';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { formatMoney } from '@/lib/money';
import { INTL_LOCALE } from '@/lib/i18n/config';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Stat, StatGrid } from '@/components/ui/Stat';
import { TableWrap, Th, Td } from '@/components/ui/Table';
import { PageHeader } from '@/components/layout/PageHeader';
import { RevenueChart } from './RevenueChart';
import type { TKey } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('finance.title'), robots: { index: false } };
}

type Search = { year?: string };

export default async function FinancePage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireOrg();
  assertPermission(ctx, 'reports.read');

  const params = await searchParams;
  const t = await getTranslator();
  const locale = await getLocale();
  const tz = await orgTimezone(ctx);
  const org = await currentOrg(ctx);

  const year = Number(params.year) || new Date().getFullYear();
  const { months, totals } = await yearlyFinance(ctx, year, tz);
  const money = (v: bigint) => formatMoney(v, org.defaultCurrency, INTL_LOCALE[locale]);
  const canExport = ctx.permissions.has('reports.export');

  return (
    <>
      <PageHeader
        title={t('finance.title')}
        subtitle={t('finance.yearTotal', { year })}
        actions={
          canExport ? (
            <a
              href={`/api/finance?year=${year}&format=csv`}
              className="btn btn-secondary h-9 px-3 text-[13px]"
            >
              {t('common.export')}
            </a>
          ) : null
        }
      />

      <form method="get" className="mb-4 flex gap-2">
        <input
          type="number"
          name="year"
          defaultValue={year}
          min={2020}
          max={2100}
          className="field h-10 w-28"
          aria-label={t('finance.year')}
        />
        <button type="submit" className="btn btn-primary h-10 px-4 text-[13px]">
          {t('common.apply')}
        </button>
      </form>

      <StatGrid className="mb-4">
        <Stat label={t('finance.revenue')} value={money(totals.revenueMinor)} tone="ok" />
        <Stat label={t('finance.salaries')} value={money(totals.salaryMinor)} />
        <Stat label={t('finance.expenses')} value={money(totals.expenseMinor)} />
        <Stat
          label={t('finance.net')}
          value={money(totals.netMinor)}
          tone={totals.netMinor >= 0n ? 'ok' : 'danger'}
        />
      </StatGrid>

      <Card className="mb-4">
        <CardHeader title={t('finance.chartRevenue')} />
        <CardBody>
          <RevenueChart
            months={months.map((m) => ({
              month: m.month,
              label: t(`months.m${m.month}` as TKey).slice(0, 3),
              revenue: Number(m.revenueMinor),
              cost: Number(m.salaryMinor + m.expenseMinor),
              net: Number(m.netMinor),
            }))}
            labels={{
              revenue: t('finance.revenue'),
              cost: `${t('finance.salaries')} + ${t('finance.expenses')}`,
            }}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('finance.monthly')} />
        <TableWrap>
          <thead>
            <tr>
              <Th>{t('common.month')}</Th>
              <Th className="text-right">{t('finance.revenue')}</Th>
              <Th className="text-right">{t('finance.invoiced')}</Th>
              <Th className="text-right">{t('finance.outstanding')}</Th>
              <Th className="text-right">{t('finance.salaries')}</Th>
              <Th className="text-right">{t('finance.expenses')}</Th>
              <Th className="text-right">{t('finance.net')}</Th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month}>
                <Td className="text-[13px] font-medium">{t(`months.m${m.month}` as TKey)}</Td>
                <Td className="tnum text-right text-[13px] text-ok-600">{money(m.revenueMinor)}</Td>
                <Td className="tnum text-right text-[13px]">{money(m.invoicedMinor)}</Td>
                <Td className="tnum text-right text-[13px] text-warn-600">{money(m.outstandingMinor)}</Td>
                <Td className="tnum text-right text-[13px]">{money(m.salaryMinor)}</Td>
                <Td className="tnum text-right text-[13px]">{money(m.expenseMinor)}</Td>
                <Td
                  className={`tnum text-right text-[13px] font-semibold ${
                    m.netMinor >= 0n ? 'text-ink' : 'text-danger-600'
                  }`}
                >
                  {money(m.netMinor)}
                </Td>
              </tr>
            ))}
            <tr className="bg-surface-muted/60">
              <Td className="text-[13px] font-semibold">{t('common.total')}</Td>
              <Td className="tnum text-right text-[13px] font-semibold">{money(totals.revenueMinor)}</Td>
              <Td className="tnum text-right text-[13px] font-semibold">{money(totals.invoicedMinor)}</Td>
              <Td className="tnum text-right text-[13px] font-semibold">{money(totals.outstandingMinor)}</Td>
              <Td className="tnum text-right text-[13px] font-semibold">{money(totals.salaryMinor)}</Td>
              <Td className="tnum text-right text-[13px] font-semibold">{money(totals.expenseMinor)}</Td>
              <Td className="tnum text-right text-[13px] font-semibold">{money(totals.netMinor)}</Td>
            </tr>
          </tbody>
        </TableWrap>
      </Card>
    </>
  );
}
