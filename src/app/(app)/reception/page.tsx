import Link from 'next/link';
import type { Metadata } from 'next';
import { requireOrg, assertPermission } from '@/lib/tenant';
import { receptionOverview } from '@/lib/domain/roleDashboards';
import { orgTimezone, currentOrg } from '@/lib/domain/org';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/i18n';
import { INTL_LOCALE } from '@/lib/i18n/config';
import { Stat, StatGrid } from '@/components/ui/Stat';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge, Dot } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/Table';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('reception.title'), robots: { index: false } };
}

/** The desk view: built for speed — search, take payment, place a student. */
export default async function ReceptionPage() {
  const ctx = await requireOrg();
  assertPermission(ctx, 'students.read');

  const t = await getTranslator();
  const locale = await getLocale();
  const tz = await orgTimezone(ctx);
  const [data, org] = await Promise.all([receptionOverview(ctx, tz), currentOrg(ctx)]);

  const money = (v: bigint) => formatMoney(v, org.defaultCurrency, INTL_LOCALE[locale]);
  const time = (d: Date) => formatDate(d, locale, 'time', tz);

  const actions: Array<{ href: string; label: string; permission: boolean }> = [
    { href: '/students?new=1', label: t('reception.quickStudent'), permission: ctx.permissions.has('students.create') },
    { href: '/payments?new=1', label: t('reception.quickPayment'), permission: ctx.permissions.has('payments.create') },
    { href: '/groups', label: t('reception.quickGroup'), permission: ctx.permissions.has('groups.members') },
    { href: '/calendar', label: t('nav.calendar'), permission: ctx.permissions.has('lessons.read') },
  ];

  return (
    <>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-ink">{t('reception.todayTitle')}</h2>
        <p className="mt-0.5 text-[13px] text-ink-soft">
          {formatDate(new Date(), locale, 'weekdayDayMonthLong', tz)}
        </p>
      </div>

      {/* Fast student search — the single most-used control at a front desk. */}
      <form action="/students" method="get" className="mb-4 flex gap-2">
        <input
          type="search"
          name="q"
          placeholder={t('reception.quickSearch')}
          aria-label={t('reception.quickSearch')}
          className="field h-11 flex-1 text-[15px]"
        />
        <button type="submit" className="btn btn-primary h-11 px-5">
          {t('common.search')}
        </button>
      </form>

      <div className="mb-6 flex flex-wrap gap-2">
        {actions
          .filter((a) => a.permission)
          .map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="rounded-[var(--radius-field)] border border-line-strong bg-surface px-3 py-2 text-[13px] font-medium text-ink-soft hover:bg-surface-muted"
            >
              {a.label}
            </Link>
          ))}
      </div>

      <StatGrid className="mb-6">
        <Stat label={t('reception.todayPayments')} value={money(data.todayPaidMinor)} tone="ok" />
        <Stat label={t('center.todayLessons')} value={data.todayLessons.length} />
        <Stat label={t('reception.debtors')} value={data.debtors.length} tone={data.debtors.length > 0 ? 'warn' : 'neutral'} />
        <Stat label={t('nav.groups')} value={data.groups} />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('center.todayLessons')} />
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
                  {lesson.group.room && (
                    <span className="shrink-0 text-[12px] text-ink-faint">{lesson.group.room}</span>
                  )}
                  {lesson.status === 'CANCELLED' && <Badge tone="danger">{t('lessons.statusCancelled')}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title={t('reception.debtors')}
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
                  <span className="tnum shrink-0 text-sm font-semibold text-warn-600">
                    {money(d.debtMinor)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title={t('reception.todayPayments')} />
          {data.todayPayments.length === 0 ? (
            <EmptyState title={t('payments.empty')} />
          ) : (
            <ul className="divide-y divide-line">
              {data.todayPayments.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                  <span className="tnum w-11 shrink-0 text-[12px] text-ink-faint">{time(p.paidAt)}</span>
                  <Link
                    href={`/students/${p.student.id}`}
                    className="min-w-0 flex-1 truncate text-sm hover:text-brand-600 hover:underline"
                  >
                    {[p.student.firstName, p.student.lastName].filter(Boolean).join(' ')}
                  </Link>
                  <span className="tnum shrink-0 text-sm font-semibold text-ok-600">
                    {money(p.amountMinor)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title={t('reception.newRegistrations')} />
          {data.recentStudents.length === 0 ? (
            <EmptyState title={t('students.empty')} />
          ) : (
            <ul className="divide-y divide-line">
              {data.recentStudents.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                  <Link
                    href={`/students/${s.id}`}
                    className="min-w-0 flex-1 truncate text-sm hover:text-brand-600 hover:underline"
                  >
                    {[s.firstName, s.lastName].filter(Boolean).join(' ')}
                  </Link>
                  {s.studentNo && <Badge tone="neutral">{s.studentNo}</Badge>}
                  <span className="tnum shrink-0 text-[12px] text-ink-faint">
                    {formatDate(s.createdAt, locale, 'dayMonth', tz)}
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
