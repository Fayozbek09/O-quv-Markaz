import type { Metadata } from 'next';
import { requireOrgPage, requirePagePermission } from '@/lib/page';
import { listExpenses } from '@/lib/domain/finance';
import { orgTimezone, currentOrg } from '@/lib/domain/org';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/i18n';
import { INTL_LOCALE } from '@/lib/i18n/config';
import { Card } from '@/components/ui/Card';
import { Stat, StatGrid } from '@/components/ui/Stat';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, TableWrap, Th, Td } from '@/components/ui/Table';
import { PageHeader } from '@/components/layout/PageHeader';
import { ExpenseDialog } from './ExpenseDialog';
import type { TKey } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('expenses.title'), robots: { index: false } };
}

type Search = { year?: string; month?: string };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireOrgPage();
  requirePagePermission(ctx, 'expenses.read');

  const params = await searchParams;
  const t = await getTranslator();
  const locale = await getLocale();
  const tz = await orgTimezone(ctx);
  const org = await currentOrg(ctx);

  const now = new Date();
  const year = Number(params.year) || now.getFullYear();
  const month = params.month === 'all' ? undefined : Number(params.month) || now.getMonth() + 1;

  const rows = await listExpenses(ctx, year, month, tz);
  const total = rows.reduce<bigint>((acc, r) => acc + r.amountMinor, 0n);
  const money = (v: bigint) => formatMoney(v, org.defaultCurrency, INTL_LOCALE[locale]);

  return (
    <>
      <PageHeader
        title={t('expenses.title')}
        actions={ctx.permissions.has('expenses.write') ? <ExpenseDialog /> : null}
      />

      <form method="get" className="mb-4 flex flex-wrap gap-2">
        <input type="number" name="year" defaultValue={year} min={2020} max={2100} className="field h-10 w-28" aria-label={t('finance.year')} />
        <select name="month" defaultValue={month ?? 'all'} className="field h-10 w-40" aria-label={t('common.month')}>
          <option value="all">{t('common.all')}</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {t(`months.m${m}` as TKey)}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary h-10 px-4 text-[13px]">
          {t('common.apply')}
        </button>
      </form>

      <StatGrid className="mb-4 xl:grid-cols-2">
        <Stat label={t('common.total')} value={money(total)} tone="warn" />
        <Stat label={t('expenses.title')} value={rows.length} />
      </StatGrid>

      <Card>
        {rows.length === 0 ? (
          <EmptyState title={t('expenses.empty')} />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>{t('expenses.spentAt')}</Th>
                <Th>{t('expenses.expenseTitle')}</Th>
                <Th>{t('expenses.category')}</Th>
                <Th className="text-right">{t('billing.amount')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <Td className="tnum whitespace-nowrap text-[13px]">
                    {formatDate(row.spentAt, locale, 'dateNumeric', tz)}
                  </Td>
                  <Td className="text-sm">{row.title}</Td>
                  <Td>
                    <Badge tone="neutral">{t(`expenses.${row.category}` as TKey)}</Badge>
                  </Td>
                  <Td className="tnum text-right text-sm font-semibold">{money(row.amountMinor)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
