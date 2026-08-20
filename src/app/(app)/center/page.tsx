import Link from 'next/link';
import type { Metadata } from 'next';
import { requireOrg, assertPermission } from '@/lib/tenant';
import { centerOverview } from '@/lib/domain/roleDashboards';
import { orgTimezone, currentOrg } from '@/lib/domain/org';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/i18n';
import { INTL_LOCALE } from '@/lib/i18n/config';
import { Stat, StatGrid } from '@/components/ui/Stat';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Badge, Dot } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/Table';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('center.dashboard'), robots: { index: false } };
}

export default async function CenterDashboardPage() {
  const ctx = await requireOrg();
  // The owner dashboard shows the whole centre's money, so it needs the
  // reporting permission rather than merely a session.
  assertPermission(ctx, 'reports.read');

  const t = await getTranslator();
  const locale = await getLocale();
  const tz = await orgTimezone(ctx);
  const [data, org] = await Promise.all([centerOverview(ctx, tz), currentOrg(ctx)]);

  const money = (v: bigint) => formatMoney(v, org.defaultCurrency, INTL_LOCALE[locale]);
  const time = (d: Date) => formatDate(d, locale, 'time', tz);

  return (
    <>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-ink">{org.name}</h2>
        <p className="mt-0.5 text-[13px] text-ink-soft">
          {formatDate(new Date(), locale, 'weekdayDayMonthLong', tz)}
          {org.city ? ` · ${org.city}` : ''}
        </p>
      </div>

      <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
        {t('finance.revenue')}
      </h3>
      <StatGrid className="mb-6">
        <Stat label={t('center.revenueToday')} value={money(data.revenue.todayMinor)} tone="ok" />
        <Stat label={t('center.revenueWeek')} value={money(data.revenue.weekMinor)} />
        <Stat label={t('center.revenueMonth')} value={money(data.revenue.monthMinor)} tone="brand" />
        <Stat label={t('center.revenueYear')} value={money(data.revenue.yearMinor)} />
      </StatGrid>

      <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
        {t('finance.title')} — {formatDate(new Date(), locale, 'monthYear', tz)}
      </h3>
      <StatGrid className="mb-6">
        <Stat
          label={t('center.outstanding')}
          value={money(data.balance.debtMinor > 0n ? data.balance.debtMinor : 0n)}
          tone={data.balance.debtMinor > 0n ? 'warn' : 'neutral'}
        />
        <Stat label={t('finance.salaries')} value={money(data.salaryPaidMinor)} sub={`${t('salary.due')}: ${money(data.salaryDueMinor)}`} />
        <Stat label={t('finance.expenses')} value={money(data.expenseMinor)} />
        <Stat
          label={t('center.netRevenue')}
          value={money(data.netMinor)}
          tone={data.netMinor >= 0n ? 'ok' : 'danger'}
        />
      </StatGrid>

      <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
        {t('center.title')}
      </h3>
      <StatGrid className="mb-6 xl:grid-cols-5">
        <Stat label={t('nav.students')} value={data.counts.students} />
        <Stat label={t('staff.teachers')} value={data.counts.teachers} />
        <Stat label={t('center.receptionists')} value={data.counts.receptionists} />
        <Stat label={t('nav.groups')} value={data.counts.groups} />
        <Stat label={t('nav.courses')} value={data.counts.courses} />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={t('center.todayLessons')}
            subtitle={data.cancelledToday > 0 ? `${t('center.cancelledLessons')}: ${data.cancelledToday}` : undefined}
            action={
              <Link href="/calendar" className="text-[13px] font-medium text-brand-600 hover:underline">
                {t('dashboard.viewAll')}
              </Link>
            }
          />
          {data.todayLessons.length === 0 ? (
            <EmptyState title={t('dashboard.noLessonsToday')} />
          ) : (
            <ul className="divide-y divide-line">
              {data.todayLessons.map((lesson) => (
                <li key={lesson.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                  <span className="tnum w-11 shrink-0 text-[13px] font-medium text-ink-soft">
                    {time(lesson.startsAt)}
                  </span>
                  <Dot color={lesson.group.color} />
                  <span className="min-w-0 flex-1 truncate text-sm">{lesson.group.name}</span>
                  <span className="hidden truncate text-[12px] text-ink-faint sm:block">
                    {[lesson.teacher?.user.profile?.firstName, lesson.teacher?.user.profile?.lastName]
                      .filter(Boolean)
                      .join(' ')}
                  </span>
                  {lesson.status === 'CANCELLED' ? (
                    <Badge tone="danger">{t('lessons.statusCancelled')}</Badge>
                  ) : lesson._count.attendance > 0 ? (
                    <Badge tone="ok">{t('attendance.title')}</Badge>
                  ) : (
                    <Badge tone="neutral">{lesson.group._count.members}</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title={t('center.outstanding')}
            action={
              <Link href="/payments?tab=debt" className="text-[13px] font-medium text-brand-600 hover:underline">
                {t('dashboard.viewAll')}
              </Link>
            }
          />
          {data.debtors.length === 0 ? (
            <EmptyState title={t('debt.noDebt')} />
          ) : (
            <ul className="divide-y divide-line">
              {data.debtors.map((d) => (
                <li key={d.studentId} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                  <Link
                    href={`/students/${d.studentId}`}
                    className="min-w-0 flex-1 truncate text-sm hover:text-brand-600 hover:underline"
                  >
                    {[d.firstName, d.lastName].filter(Boolean).join(' ')}
                  </Link>
                  {d.daysOverdue > 0 && (
                    <Badge tone="warn">{t('debt.daysOverdue', { days: d.daysOverdue })}</Badge>
                  )}
                  <span className="tnum shrink-0 text-sm font-semibold text-warn-600">
                    {money(d.debtMinor)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title={t('center.upcomingLessons')} />
          {data.upcoming.length === 0 ? (
            <EmptyState title={t('lessons.empty')} />
          ) : (
            <CardBody className="flex flex-wrap gap-2">
              {data.upcoming.map((lesson) => (
                <Link
                  key={lesson.id}
                  href={`/calendar?date=${lesson.startsAt.toISOString().slice(0, 10)}`}
                  className="flex items-center gap-2 rounded-[var(--radius-field)] border border-line px-3 py-2 text-[13px] hover:bg-surface-muted"
                >
                  <Dot color={lesson.group.color} />
                  <span className="font-medium">{lesson.group.name}</span>
                  <span className="tnum text-ink-faint">
                    {formatDate(lesson.startsAt, locale, 'dayMonthTime', tz)}
                  </span>
                </Link>
              ))}
            </CardBody>
          )}
        </Card>

        <Card>
          <CardHeader title={t('center.recentActivity')} />
          {data.activity.length === 0 ? (
            <EmptyState title={t('common.empty')} />
          ) : (
            <ul className="divide-y divide-line">
              {data.activity.map((row) => (
                <li key={row.id} className="flex items-center gap-3 px-4 py-2 text-[13px] sm:px-5">
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{row.action}</span>
                  {row.isOverride && <Badge tone="danger">{t('nav.admin')}</Badge>}
                  <span className="shrink-0 truncate text-[12px] text-ink-faint">
                    {row.actorAdmin?.fullName ??
                      [row.actor?.profile?.firstName, row.actor?.profile?.lastName]
                        .filter(Boolean)
                        .join(' ')}
                  </span>
                  <span className="tnum shrink-0 text-[12px] text-ink-faint">
                    {formatDate(row.createdAt, locale, 'dayMonthTime', tz)}
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
