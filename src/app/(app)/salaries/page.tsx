import type { Metadata } from 'next';
import { requireOrg } from '@/lib/tenant';
import { requirePagePermission } from '@/lib/page';
import { salarySheet, ownSalary, listSalaryPayments } from '@/lib/domain/salary';
import { orgTimezone, currentOrg } from '@/lib/domain/org';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/i18n';
import { INTL_LOCALE } from '@/lib/i18n/config';
import { Card, CardHeader } from '@/components/ui/Card';
import { Stat, StatGrid } from '@/components/ui/Stat';
import { EmptyState, TableWrap, Th, Td } from '@/components/ui/Table';
import { PageHeader } from '@/components/layout/PageHeader';
import { PaySalaryButton } from './PaySalaryButton';
import type { TKey } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('salary.title'), robots: { index: false } };
}

type Search = { year?: string; month?: string };

export default async function SalariesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireOrg();
  requirePagePermission(ctx, 'salary.read');

  const params = await searchParams;
  const t = await getTranslator();
  const locale = await getLocale();
  const tz = await orgTimezone(ctx);
  const org = await currentOrg(ctx);

  const now = new Date();
  const year = Number(params.year) || now.getFullYear();
  const month = Number(params.month) || now.getMonth() + 1;
  const money = (v: bigint) => formatMoney(v, org.defaultCurrency, INTL_LOCALE[locale]);

  // A teacher's page is their own line and their own history — never a roster.
  if (ctx.role === 'TEACHER') {
    const own = await ownSalary(ctx, year, month, tz);
    return (
      <>
        <PageHeader title={t('teacher.mySalary')} subtitle={t('salary.ownOnly')} />
        <StatGrid className="mb-4 xl:grid-cols-3">
          <Stat label={t('salary.due')} value={money(own.line?.dueMinor ?? 0n)} tone="brand" />
          <Stat label={t('salary.paid')} value={money(own.line?.paidMinor ?? 0n)} tone="ok" />
          <Stat
            label={t('salary.outstanding')}
            value={money(own.line?.outstandingMinor ?? 0n)}
            tone={(own.line?.outstandingMinor ?? 0n) > 0n ? 'warn' : 'neutral'}
          />
        </StatGrid>
        <Card>
          <CardHeader title={t('salary.history')} />
          {own.history.length === 0 ? (
            <EmptyState title={t('salary.empty')} />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>{t('salary.period')}</Th>
                  <Th>{t('salary.paidOn')}</Th>
                  <Th className="text-right">{t('billing.amount')}</Th>
                </tr>
              </thead>
              <tbody>
                {own.history.map((row) => (
                  <tr key={row.id}>
                    <Td className="tnum text-[13px]">{`${row.periodYear}-${String(row.periodMonth).padStart(2, '0')}`}</Td>
                    <Td className="tnum text-[13px]">{formatDate(row.paidAt, locale, 'dateNumeric', tz)}</Td>
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

  const [sheet, payments] = await Promise.all([
    salarySheet(ctx, { year, month }, tz),
    listSalaryPayments(ctx, year, month),
  ]);
  const canPay = ctx.permissions.has('salary.write');
  const totalDue = sheet.reduce<bigint>((acc, l) => acc + l.dueMinor, 0n);
  const totalPaid = sheet.reduce<bigint>((acc, l) => acc + l.paidMinor, 0n);

  return (
    <>
      <PageHeader title={t('salary.title')} subtitle={`${year}-${String(month).padStart(2, '0')}`} />

      <form method="get" className="mb-4 flex flex-wrap gap-2">
        <input type="number" name="year" defaultValue={year} min={2020} max={2100} className="field h-10 w-28" aria-label={t('finance.year')} />
        <select name="month" defaultValue={month} className="field h-10 w-40" aria-label={t('common.month')}>
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

      <StatGrid className="mb-4 xl:grid-cols-3">
        <Stat label={t('salary.due')} value={money(totalDue)} />
        <Stat label={t('salary.paid')} value={money(totalPaid)} tone="ok" />
        <Stat
          label={t('salary.outstanding')}
          value={money(totalDue - totalPaid)}
          tone={totalDue - totalPaid > 0n ? 'warn' : 'neutral'}
        />
      </StatGrid>

      <Card className="mb-4">
        <CardHeader title={t('salary.title')} />
        {sheet.length === 0 ? (
          <EmptyState title={t('staff.noStaff')} />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>{t('common.name')}</Th>
                <Th>{t('salary.model')}</Th>
                <Th className="text-right">{t('salary.lessonsTaught')}</Th>
                <Th className="text-right">{t('salary.collected')}</Th>
                <Th className="text-right">{t('salary.due')}</Th>
                <Th className="text-right">{t('salary.paid')}</Th>
                <Th className="text-right">{t('salary.outstanding')}</Th>
                {canPay && <Th className="text-right">{t('common.actions')}</Th>}
              </tr>
            </thead>
            <tbody>
              {sheet.map((line) => (
                <tr key={line.memberId}>
                  <Td className="text-sm font-medium">{line.name}</Td>
                  <Td className="text-[13px] text-ink-soft">
                    {t(`salary.${line.model}` as TKey)}
                    {line.model === 'PERCENTAGE' || line.model === 'MIXED' ? ` · ${line.percent}%` : ''}
                  </Td>
                  <Td className="tnum text-right text-[13px]">{line.lessonsTaught}</Td>
                  <Td className="tnum text-right text-[13px]">{money(line.collectedMinor)}</Td>
                  <Td className="tnum text-right text-[13px] font-semibold">{money(line.dueMinor)}</Td>
                  <Td className="tnum text-right text-[13px] text-ok-600">{money(line.paidMinor)}</Td>
                  <Td
                    className={`tnum text-right text-[13px] font-semibold ${
                      line.outstandingMinor > 0n ? 'text-warn-600' : 'text-ink-faint'
                    }`}
                  >
                    {money(line.outstandingMinor)}
                  </Td>
                  {canPay && (
                    <Td className="text-right">
                      <PaySalaryButton
                        memberId={line.memberId}
                        year={year}
                        month={month}
                        suggested={line.outstandingMinor > 0n ? line.outstandingMinor.toString() : '0'}
                        currency={line.currency}
                      />
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <Card>
        <CardHeader title={t('salary.history')} />
        {payments.length === 0 ? (
          <EmptyState title={t('salary.empty')} />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>{t('common.name')}</Th>
                <Th>{t('salary.paidOn')}</Th>
                <Th className="text-right">{t('billing.amount')}</Th>
              </tr>
            </thead>
            <tbody>
              {payments.map((row) => (
                <tr key={row.id}>
                  <Td className="text-[13px]">
                    {[row.member.user.profile?.firstName, row.member.user.profile?.lastName]
                      .filter(Boolean)
                      .join(' ') || '—'}
                  </Td>
                  <Td className="tnum text-[13px]">{formatDate(row.paidAt, locale, 'dateNumeric', tz)}</Td>
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
