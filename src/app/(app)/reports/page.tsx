import type { Metadata } from 'next';
import { requireOrgPage, requirePagePermission } from '@/lib/page';
import { prisma } from '@/lib/db';
import { monthlyReport } from '@/lib/domain/reports';
import { currentOrg, orgTimezone } from '@/lib/domain/org';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { formatMoney } from '@/lib/money';
import { formatDate, formatPercent } from '@/lib/i18n';
import { INTL_LOCALE } from '@/lib/i18n/config';
import { Card, CardHeader } from '@/components/ui/Card';
import { Stat, StatGrid } from '@/components/ui/Stat';
import { TableWrap, Th, Td, EmptyState } from '@/components/ui/Table';
import { ReportsToolbar } from './ReportsToolbar';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('reports.title'), robots: { index: false } };
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireOrgPage();
  requirePagePermission(ctx, 'reports.read');
  const t = await getTranslator();
  const locale = await getLocale();
  const tz = await orgTimezone(ctx);
  const raw = await searchParams;

  const now = new Date();
  const year = Number(raw.year) || now.getUTCFullYear();
  const month = Number(raw.month) || now.getUTCMonth() + 1;
  const groupId = typeof raw.groupId === 'string' && raw.groupId ? raw.groupId : undefined;

  const [report, org, groups] = await Promise.all([
    monthlyReport(ctx, year, month, tz, groupId),
    currentOrg(ctx),
    prisma.group.findMany({
      where: { organizationId: ctx.orgId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const money = (v: bigint, currency = org.defaultCurrency) =>
    formatMoney(v, currency, INTL_LOCALE[locale]);

  const periodLabel = formatDate(
    `${year}-${String(month).padStart(2, '0')}-01T12:00:00Z`,
    locale,
    'monthYear',
    'UTC',
  );

  return (
    <>
      <ReportsToolbar year={year} month={month} groupId={groupId ?? ''} groups={groups} />

      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-[15px] font-semibold">
          {t('reports.monthly')} — {periodLabel}
        </h3>
        <p className="text-[12px] text-ink-faint no-print">
          {t('reports.generatedAt', { date: formatDate(now, locale, 'date', tz) })}
        </p>
      </div>

      <StatGrid className="mb-4">
        <Stat label={t('reports.expectedRevenue')} value={money(report.balance.expectedMinor)} />
        <Stat label={t('reports.receivedRevenue')} value={money(report.balance.paidMinor)} tone="ok" />
        <Stat
          label={t('reports.debt')}
          value={money(report.balance.debtMinor > 0n ? report.balance.debtMinor : 0n)}
          tone={report.balance.debtMinor > 0n ? 'warn' : 'neutral'}
        />
        <Stat
          label={t('reports.collectionRate')}
          value={report.collectionRate === null ? '—' : formatPercent(report.collectionRate, locale)}
        />
      </StatGrid>

      <StatGrid className="mb-4">
        <Stat label={t('reports.students')} value={report.activeStudents} />
        <Stat label={t('reports.lessons')} value={report.lessonCount} />
        <Stat
          label={t('reports.attendance')}
          value={report.attendance.rate === null ? '—' : formatPercent(report.attendance.rate, locale)}
          sub={t('attendance.summary', {
            present: report.attendance.PRESENT,
            absent: report.attendance.ABSENT,
            late: report.attendance.LATE,
            excused: report.attendance.EXCUSED,
          })}
        />
        <Stat label={t('groups.title')} value={report.groups.length} />
      </StatGrid>

      <Card>
        <CardHeader title={t('reports.byGroup')} />
        {report.groups.length === 0 ? (
          <EmptyState title={t('reports.empty')} />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>{t('groups.one')}</Th>
                <Th className="text-right">{t('reports.students')}</Th>
                <Th className="text-right">{t('reports.lessons')}</Th>
                <Th className="text-right">{t('reports.expectedRevenue')}</Th>
                <Th className="text-right">{t('reports.receivedRevenue')}</Th>
                <Th className="text-right">{t('reports.debt')}</Th>
              </tr>
            </thead>
            <tbody>
              {report.groups.map((group) => (
                <tr key={group.id}>
                  <Td className="font-medium">{group.name}</Td>
                  <Td className="tnum text-right">{group.students}</Td>
                  <Td className="tnum text-right">{group.lessons}</Td>
                  <Td className="tnum text-right">{money(group.expectedMinor, group.currency)}</Td>
                  <Td className="tnum text-right text-ok-600">{money(group.receivedMinor, group.currency)}</Td>
                  <Td className={`tnum text-right ${group.debtMinor > 0n ? 'font-semibold text-warn-600' : 'text-ink-faint'}`}>
                    {money(group.debtMinor > 0n ? group.debtMinor : 0n, group.currency)}
                  </Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-surface-muted/60 font-semibold">
                <Td>{t('common.total')}</Td>
                <Td className="tnum text-right">{report.activeStudents}</Td>
                <Td className="tnum text-right">{report.lessonCount}</Td>
                <Td className="tnum text-right">{money(report.balance.expectedMinor)}</Td>
                <Td className="tnum text-right text-ok-600">{money(report.balance.paidMinor)}</Td>
                <Td className="tnum text-right text-warn-600">
                  {money(report.balance.debtMinor > 0n ? report.balance.debtMinor : 0n)}
                </Td>
              </tr>
            </tfoot>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
