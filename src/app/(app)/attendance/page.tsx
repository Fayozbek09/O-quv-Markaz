import type { Metadata } from 'next';
import { requireOrg, isUuid } from '@/lib/tenant';
import { requirePagePermission } from '@/lib/page';
import { prisma } from '@/lib/db';
import { getLesson } from '@/lib/domain/lessons';
import { orgTimezone } from '@/lib/domain/org';
import { zonedDateIso, dayBounds } from '@/lib/domain/time';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { formatDate } from '@/lib/i18n';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/Table';
import { Dot, Badge } from '@/components/ui/Badge';
import { AttendanceSheet } from './AttendanceSheet';
import Link from 'next/link';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('attendance.title'), robots: { index: false } };
}

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireOrg();
  requirePagePermission(ctx, 'attendance.read');
  const t = await getTranslator();
  const locale = await getLocale();
  const tz = await orgTimezone(ctx);
  const raw = await searchParams;

  const lessonId = typeof raw.lessonId === 'string' && isUuid(raw.lessonId) ? raw.lessonId : null;

  if (lessonId) {
    const lesson = await getLesson(ctx, lessonId);
    const existing = new Map(lesson.attendance.map((a) => [a.studentId, a]));

    return (
      <>
        <nav className="mb-3 text-[13px] text-ink-faint">
          <Link href="/attendance" className="hover:text-ink hover:underline">
            {t('attendance.title')}
          </Link>
          <span className="mx-1.5">/</span>
          <span className="text-ink-soft">{lesson.group.name}</span>
        </nav>

        <AttendanceSheet
          lessonId={lesson.id}
          groupName={lesson.group.name}
          groupColor={lesson.group.color}
          when={formatDate(lesson.startsAt, locale, 'dateFullTime', tz)}
          students={lesson.group.members
            .filter((m) => m.student.status !== 'ARCHIVED')
            .map((m) => ({
              id: m.student.id,
              name: [m.student.firstName, m.student.lastName].filter(Boolean).join(' '),
              status: existing.get(m.student.id)?.status ?? null,
              minutesLate: existing.get(m.student.id)?.minutesLate ?? null,
            }))}
        />
      </>
    );
  }

  // No lesson chosen: show today's lessons to pick from.
  const todayIso = zonedDateIso(new Date(), tz);
  const [from, until] = dayBounds(todayIso, tz);

  const lessons = await prisma.lesson.findMany({
    where: {
      organizationId: ctx.orgId,
      deletedAt: null,
      startsAt: { gte: from, lt: until },
      status: { not: 'CANCELLED' },
    },
    orderBy: { startsAt: 'asc' },
    include: {
      group: { select: { name: true, color: true, _count: { select: { members: { where: { leftAt: null } } } } } },
      _count: { select: { attendance: true } },
    },
  });

  return (
    <>
      <PageHeader
        title={t('attendance.title')}
        subtitle={formatDate(new Date(), locale, 'dateFull', tz)}
      />

      <Card>
        <CardHeader title={t('attendance.pickLesson')} />
        {lessons.length === 0 ? (
          <EmptyState
            title={t('dashboard.noLessonsToday')}
            hint={t('calendar.title')}
          />
        ) : (
          <ul className="divide-y divide-line">
            {lessons.map((lesson) => (
              <li key={lesson.id}>
                <Link
                  href={`/attendance?lessonId=${lesson.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-surface-muted sm:px-5"
                >
                  <span className="tnum w-12 shrink-0 text-[13px] font-medium text-ink-soft">
                    {formatDate(lesson.startsAt, locale, 'time', tz)}
                  </span>
                  <Dot color={lesson.group.color} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{lesson.group.name}</span>
                  <span className="tnum text-[13px] text-ink-faint">{lesson.group._count.members}</span>
                  {lesson._count.attendance > 0 ? (
                    <Badge tone="ok">{t('common.saved')}</Badge>
                  ) : (
                    <Badge tone="warn">{t('attendance.notMarked')}</Badge>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
