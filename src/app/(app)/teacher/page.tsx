import Link from 'next/link';
import type { Metadata } from 'next';
import { requireOrg } from '@/lib/tenant';
import { teacherOverview } from '@/lib/domain/roleDashboards';
import { orgTimezone, currentOrg } from '@/lib/domain/org';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/i18n';
import { INTL_LOCALE } from '@/lib/i18n/config';
import { Stat, StatGrid } from '@/components/ui/Stat';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { announcementsForMember } from '@/lib/domain/announcements';
import { Badge, Dot } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/Table';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('teacher.title'), robots: { index: false } };
}

/**
 * The teacher's own workspace. Every query behind it is scoped to their
 * membership id, so another teacher's groups, students and pay are not merely
 * hidden — they are never fetched.
 */
export default async function TeacherPage() {
  const ctx = await requireOrg();
  const t = await getTranslator();
  const locale = await getLocale();
  const tz = await orgTimezone(ctx);
  const [data, org, announcements] = await Promise.all([
    teacherOverview(ctx, tz),
    currentOrg(ctx),
    announcementsForMember(ctx, 5),
  ]);

  const money = (v: bigint) => formatMoney(v, org.defaultCurrency, INTL_LOCALE[locale]);
  const time = (d: Date) => formatDate(d, locale, 'time', tz);
  const canSeeSalary = ctx.permissions.has('salary.read') && data.salary;

  return (
    <>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-ink">{t('teacher.title')}</h2>
        <p className="mt-0.5 text-[13px] text-ink-soft">
          {formatDate(new Date(), locale, 'weekdayDayMonthLong', tz)}
        </p>
      </div>

      <StatGrid className="mb-6">
        <Stat label={t('teacher.todayLessons')} value={data.todayLessons.length} />
        <Stat label={t('teacher.myGroups')} value={data.groups.length} />
        <Stat label={t('teacher.myStudents')} value={data.studentCount} />
        {canSeeSalary ? (
          <Stat
            label={t('teacher.mySalary')}
            value={money(data.salary!.dueMinor)}
            sub={`${t('salary.paid')}: ${money(data.salary!.paidMinor)}`}
            tone="brand"
          />
        ) : (
          <Stat label={t('homework.title')} value={data.homework.length} />
        )}
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={t('teacher.todayLessons')}
            action={
              <Link href="/calendar" className="text-[13px] font-medium text-brand-600 hover:underline">
                {t('dashboard.viewAll')}
              </Link>
            }
          />
          {data.todayLessons.length === 0 ? (
            <EmptyState title={t('teacher.noLessonsToday')} />
          ) : (
            <ul className="divide-y divide-line">
              {data.todayLessons.map((lesson) => (
                <li key={lesson.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                  <span className="tnum w-11 shrink-0 text-[13px] font-medium text-ink-soft">
                    {time(lesson.startsAt)}
                  </span>
                  <Dot color={lesson.group.color} />
                  <span className="min-w-0 flex-1 truncate text-sm">{lesson.group.name}</span>
                  {lesson.status === 'CANCELLED' ? (
                    <Badge tone="danger">{t('lessons.statusCancelled')}</Badge>
                  ) : lesson._count.attendance > 0 ? (
                    <Badge tone="ok">{t('attendance.title')}</Badge>
                  ) : (
                    <Link
                      href={`/attendance?lessonId=${lesson.id}`}
                      className="rounded-[6px] border border-line-strong px-2 py-1 text-[12px] font-medium text-ink-soft hover:bg-surface-muted"
                    >
                      {t('teacher.markAttendance')}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title={t('homework.title')}
            action={
              <Link href="/homework" className="text-[13px] font-medium text-brand-600 hover:underline">
                {t('dashboard.viewAll')}
              </Link>
            }
          />
          {data.homework.length === 0 ? (
            <EmptyState title={t('homework.empty')} />
          ) : (
            <ul className="divide-y divide-line">
              {data.homework.map((hw) => {
                const overdue = hw.dueAt < new Date();
                return (
                  <li key={hw.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                    <Link
                      href={`/homework/${hw.id}`}
                      className="min-w-0 flex-1 truncate text-sm hover:text-brand-600 hover:underline"
                    >
                      {hw.title}
                    </Link>
                    <span className="shrink-0 truncate text-[12px] text-ink-faint">{hw.group.name}</span>
                    <Badge tone={overdue ? 'warn' : 'neutral'}>
                      {formatDate(hw.dueAt, locale, 'dayMonth', tz)}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {announcements.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader title={t('announcements.title')} />
            <ul className="divide-y divide-line">
              {announcements.map((a) => (
                <li key={a.id} className="flex flex-col gap-1 px-4 py-3 sm:px-5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-ink">{a.title}</span>
                    {a.pinned && <Badge tone="brand">{t('announcements.pin')}</Badge>}
                    {a.group && <Badge tone="neutral">{a.group.name}</Badge>}
                  </span>
                  {/* Written by staff; rendered as text, never as markup. */}
                  <span className="whitespace-pre-wrap text-[13px] text-ink-soft">{a.body}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card className="lg:col-span-2">
          <CardHeader title={t('teacher.myGroups')} />
          {data.groups.length === 0 ? (
            <EmptyState title={t('groups.empty')} />
          ) : (
            <CardBody className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {data.groups.map((group) => (
                <Link
                  key={group.id}
                  href={`/groups/${group.id}`}
                  className="flex items-center gap-2.5 rounded-[var(--radius-field)] border border-line px-3 py-2.5 hover:bg-surface-muted"
                >
                  <Dot color={group.color} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{group.name}</span>
                    <span className="block truncate text-[12px] text-ink-faint">
                      {[group.subject, group.room, group.startTime].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="tnum shrink-0 text-[13px] text-ink-soft">
                    {group._count.members}
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
