import Link from 'next/link';
import type { Metadata } from 'next';
import { requireOrg } from '@/lib/tenant';
import { dashboardData } from '@/lib/domain/dashboard';
import { orgTimezone, currentOrg } from '@/lib/domain/org';
import { planUsage } from '@/lib/domain/plan';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { formatMoney } from '@/lib/money';
import { formatPercent, formatDate } from '@/lib/i18n';
import { INTL_LOCALE } from '@/lib/i18n/config';
import { Stat, StatGrid } from '@/components/ui/Stat';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Badge, Dot } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/Table';
import { QuickActions } from '@/components/layout/QuickActions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('dashboard.title'), robots: { index: false } };
}

export default async function DashboardPage() {
  const ctx = await requireOrg();
  const t = await getTranslator();
  const locale = await getLocale();
  const tz = await orgTimezone(ctx);

  const [data, org, usage] = await Promise.all([
    dashboardData(ctx, tz),
    currentOrg(ctx),
    planUsage(ctx.orgId),
  ]);

  const money = (v: bigint) => formatMoney(v, org.defaultCurrency, INTL_LOCALE[locale]);
  const time = (d: Date) =>
    formatDate(d, locale, 'time', tz);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('dashboard.greeting', { name: ctx.user.firstName })}</h2>
          <p className="mt-0.5 text-[13px] text-ink-soft">
            {formatDate(new Date(), locale, 'weekdayDayMonthLong', tz)}
          </p>
        </div>
        <QuickActions />
      </div>

      {usage.limit !== null && usage.activeStudents >= usage.limit && (
        <div className="mb-4 rounded-[var(--radius-card)] border border-warn-50 bg-warn-50 px-4 py-3 text-[13px] text-warn-600">
          {t('students.limitReached', { limit: usage.limit })}{' '}
          <Link href="/settings/billing" className="font-medium underline">
            {t('settings.upgrade')}
          </Link>
        </div>
      )}

      {/* today */}
      <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
        {t('dashboard.todayTitle')}
      </h3>
      <StatGrid className="mb-6">
        <Stat label={t('dashboard.todayLessons')} value={data.todayLessons.length} />
        <Stat label={t('dashboard.todayStudents')} value={data.todayStudentCount} />
        <Stat
          label={t('dashboard.todayAttendance')}
          value={
            data.todayAttendance.PRESENT + data.todayAttendance.LATE + data.todayAttendance.ABSENT
          }
          sub={data.unmarkedToday > 0 ? t('dashboard.unmarked') : undefined}
          tone={data.unmarkedToday > 0 ? 'warn' : 'neutral'}
        />
        <Stat label={t('dashboard.activeStudents')} value={data.activeStudents} />
      </StatGrid>

      {/* this month */}
      <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
        {t('dashboard.monthTitle')}
      </h3>
      <StatGrid className="mb-6">
        <Stat label={t('dashboard.monthIncome')} value={money(data.monthBalance.paidMinor)} tone="ok" />
        <Stat label={t('dashboard.monthExpected')} value={money(data.monthExpectedMinor)} />
        <Stat
          label={t('dashboard.monthDebt')}
          value={money(data.monthBalance.debtMinor > 0n ? data.monthBalance.debtMinor : 0n)}
          tone={data.monthBalance.debtMinor > 0n ? 'warn' : 'neutral'}
        />
        <Stat
          label={t('dashboard.collectionRate')}
          value={data.collectionRate === null ? '—' : formatPercent(data.collectionRate, locale)}
          sub={
            data.monthAttendance.rate === null
              ? undefined
              : `${t('dashboard.monthAttendance')}: ${formatPercent(data.monthAttendance.rate, locale)}`
          }
        />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* today's lessons */}
        <Card>
          <CardHeader
            title={t('dashboard.todayLessons')}
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
              {data.todayLessons.map((lesson) => {
                const marked = lesson._count.attendance > 0;
                return (
                  <li key={lesson.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                    <span className="tnum w-11 shrink-0 text-[13px] font-medium text-ink-soft">
                      {time(lesson.startsAt)}
                    </span>
                    <Dot color={lesson.group.color} />
                    <span className="min-w-0 flex-1 truncate text-sm">{lesson.group.name}</span>
                    <span className="tnum text-[13px] text-ink-faint">
                      {lesson.group._count.members}
                    </span>
                    {lesson.status === 'CANCELLED' ? (
                      <Badge tone="danger">{t('lessons.statusCancelled')}</Badge>
                    ) : marked ? (
                      <Badge tone="ok">{t('attendance.title')}</Badge>
                    ) : (
                      <Link
                        href={`/attendance?lessonId=${lesson.id}`}
                        className="rounded-[6px] border border-line-strong px-2 py-1 text-[12px] font-medium text-ink-soft hover:bg-surface-muted"
                      >
                        {t('attendance.mark')}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* debtors */}
        <Card>
          <CardHeader
            title={t('dashboard.debtors')}
            subtitle={t('debt.whoOwes')}
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

        {/* upcoming */}
        <Card className="lg:col-span-2">
          <CardHeader title={t('dashboard.upcoming')} />
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
      </div>
    </>
  );
}
