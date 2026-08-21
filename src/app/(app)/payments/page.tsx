import Link from 'next/link';
import type { Metadata } from 'next';
import { requireOrgPage, requirePagePermission } from '@/lib/page';
import { prisma } from '@/lib/db';
import { listPayments } from '@/lib/domain/payments';
import { listDebtors, orgBalance } from '@/lib/domain/billing';
import { currentOrg } from '@/lib/domain/org';
import { paymentListQuerySchema } from '@/lib/validation/schemas';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/i18n';
import { INTL_LOCALE } from '@/lib/i18n/config';
import { Card } from '@/components/ui/Card';
import { Stat, StatGrid } from '@/components/ui/Stat';
import { TableWrap, Th, Td, EmptyState } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Pagination } from '@/components/ui/Pagination';
import { PaymentsToolbar } from './PaymentsToolbar';
import { PaymentRowActions } from './PaymentRowActions';
import { DebtRowActions } from './DebtRowActions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('payments.title'), robots: { index: false } };
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireOrgPage();
  requirePagePermission(ctx, 'payments.read');
  const t = await getTranslator();
  const locale = await getLocale();
  const raw = await searchParams;

  const tab = raw.tab === 'debt' ? 'debt' : 'payments';
  const overdueOnly = raw.overdue === '1';

  const parsed = paymentListQuerySchema.safeParse(
    Object.fromEntries(
      Object.entries(raw)
        .filter(([key]) => ['page', 'perPage', 'studentId', 'groupId', 'from', 'until', 'method'].includes(key))
        .map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])
        .filter(([, value]) => value !== undefined && value !== ''),
    ),
  );
  const query = parsed.success ? parsed.data : paymentListQuerySchema.parse({});

  const [org, totals, students, groups] = await Promise.all([
    currentOrg(ctx),
    orgBalance(ctx),
    prisma.student.findMany({
      where: { organizationId: ctx.orgId, deletedAt: null, status: { not: 'ARCHIVED' } },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: 'asc' }],
      take: 500,
    }),
    prisma.group.findMany({
      where: { organizationId: ctx.orgId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const money = (v: bigint) => formatMoney(v, org.defaultCurrency, INTL_LOCALE[locale]);

  const [payments, debtors] = await Promise.all([
    tab === 'payments' ? listPayments(ctx, query) : Promise.resolve(null),
    tab === 'debt'
      ? listDebtors(ctx, {
          overdueOnly,
          limit: query.perPage,
          offset: (query.page - 1) * query.perPage,
        })
      : Promise.resolve(null),
  ]);

  return (
    <>
      <PaymentsToolbar
        tab={tab}
        overdueOnly={overdueOnly}
        openNew={raw.new === '1'}
        students={students.map((s) => ({
          id: s.id,
          name: [s.firstName, s.lastName].filter(Boolean).join(' '),
        }))}
        groups={groups}
        currency={org.defaultCurrency}
        canReverse={ctx.role === 'OWNER' || ctx.role === 'ADMIN'}
      />

      <StatGrid className="mb-4">
        <Stat label={t('debt.totalExpected')} value={money(totals.expectedMinor)} />
        <Stat label={t('debt.totalPaid')} value={money(totals.paidMinor + totals.adjustedMinor)} tone="ok" />
        <Stat
          label={t('debt.totalDebt')}
          value={money(totals.debtMinor > 0n ? totals.debtMinor : 0n)}
          tone={totals.debtMinor > 0n ? 'warn' : 'neutral'}
        />
        <Stat
          label={t('reports.collectionRate')}
          value={
            totals.expectedMinor > 0n
              ? `${Math.round((Number(totals.paidMinor) / Number(totals.expectedMinor)) * 100)}%`
              : '—'
          }
        />
      </StatGrid>

      <Card>
        {tab === 'payments' && payments && (
          payments.rows.length === 0 ? (
            <EmptyState title={t('payments.empty')} />
          ) : (
            <>
              <TableWrap>
                <thead>
                  <tr>
                    <Th>{t('payments.paidAt')}</Th>
                    <Th>{t('payments.student')}</Th>
                    <Th>{t('payments.group')}</Th>
                    <Th>{t('payments.method')}</Th>
                    <Th className="text-right">{t('payments.amount')}</Th>
                    <Th className="w-px" />
                  </tr>
                </thead>
                <tbody>
                  {payments.rows.map((payment) => (
                    <tr key={payment.id} className="hover:bg-surface-muted/50">
                      <Td className="tnum whitespace-nowrap text-ink-soft">
                        {formatDate(payment.paidAt, locale, 'date', org.timezone)}
                      </Td>
                      <Td>
                        <Link href={`/students/${payment.student.id}`} className="font-medium hover:text-brand-600 hover:underline">
                          {[payment.student.firstName, payment.student.lastName].filter(Boolean).join(' ')}
                        </Link>
                      </Td>
                      <Td className="text-ink-soft">{payment.group?.name ?? '—'}</Td>
                      <Td>
                        {payment.status === 'REVERSED' ? (
                          <Badge tone="danger">{t('payments.statusReversed')}</Badge>
                        ) : (
                          <span className="text-[13px] text-ink-soft">{payment.method}</span>
                        )}
                      </Td>
                      <Td className={`tnum text-right font-semibold ${payment.status === 'REVERSED' ? 'text-ink-faint line-through' : ''}`}>
                        {money(payment.amountMinor)}
                      </Td>
                      <Td>
                        {payment.status === 'COMPLETED' && (ctx.role === 'OWNER' || ctx.role === 'ADMIN') && (
                          <PaymentRowActions paymentId={payment.id} />
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
              <Pagination page={payments.page} perPage={payments.perPage} total={payments.total} />
            </>
          )
        )}

        {tab === 'debt' && debtors && (
          debtors.rows.length === 0 ? (
            <EmptyState title={t('debt.noDebt')} />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>{t('payments.student')}</Th>
                  <Th>{t('students.parentName')}</Th>
                  <Th className="text-right">{t('payments.expected')}</Th>
                  <Th className="text-right">{t('payments.paid')}</Th>
                  <Th className="text-right">{t('payments.remaining')}</Th>
                  <Th className="w-px text-right">{t('common.actions')}</Th>
                </tr>
              </thead>
              <tbody>
                {debtors.rows.map((row) => (
                  <tr key={row.studentId} className="hover:bg-surface-muted/50">
                    <Td>
                      <Link href={`/students/${row.studentId}`} className="font-medium hover:text-brand-600 hover:underline">
                        {[row.firstName, row.lastName].filter(Boolean).join(' ')}
                      </Link>
                      {row.daysOverdue > 0 && (
                        <Badge tone="warn" className="ml-2">
                          {t('debt.daysOverdue', { days: row.daysOverdue })}
                        </Badge>
                      )}
                    </Td>
                    <Td className="text-[13px] text-ink-soft">
                      {row.parentName ?? '—'}
                      {row.parentTelegramLinked && <Badge tone="ok" className="ml-1.5">TG</Badge>}
                    </Td>
                    <Td className="tnum text-right text-ink-soft">{money(row.expectedMinor)}</Td>
                    <Td className="tnum text-right text-ok-600">{money(row.paidMinor)}</Td>
                    <Td className="tnum text-right font-semibold text-warn-600">{money(row.debtMinor)}</Td>
                    <Td className="text-right">
                      <DebtRowActions
                        studentId={row.studentId}
                        studentName={[row.firstName, row.lastName].filter(Boolean).join(' ')}
                        parentLinked={row.parentTelegramLinked}
                      />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )
        )}
      </Card>
    </>
  );
}
