import type { Metadata } from 'next';
import { requireOrg } from '@/lib/tenant';
import { prisma } from '@/lib/db';
import { listLessons } from '@/lib/domain/lessons';
import { orgTimezone } from '@/lib/domain/org';
import { zonedDateIso } from '@/lib/domain/time';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { CalendarView } from './CalendarView';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('calendar.title'), robots: { index: false } };
}

type View = 'day' | 'week' | 'month';

/** Returns the [from, until] ISO dates covering a view anchored on `date`. */
function rangeFor(view: View, dateIso: string): { from: string; until: string } {
  const base = new Date(`${dateIso}T00:00:00Z`);
  if (view === 'day') return { from: dateIso, until: dateIso };

  if (view === 'week') {
    const weekday = (base.getUTCDay() + 6) % 7; // Monday = 0
    const start = new Date(base.getTime() - weekday * 86_400_000);
    const end = new Date(start.getTime() + 6 * 86_400_000);
    return { from: start.toISOString().slice(0, 10), until: end.toISOString().slice(0, 10) };
  }

  const year = base.getUTCFullYear();
  const month = base.getUTCMonth();
  const first = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(year, month + 1, 0));
  // Pad to full weeks so the month grid is complete.
  const padStart = (first.getUTCDay() + 6) % 7;
  const padEnd = 6 - ((last.getUTCDay() + 6) % 7);
  return {
    from: new Date(first.getTime() - padStart * 86_400_000).toISOString().slice(0, 10),
    until: new Date(last.getTime() + padEnd * 86_400_000).toISOString().slice(0, 10),
  };
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireOrg();
  const raw = await searchParams;
  const tz = await orgTimezone(ctx);

  const view: View = raw.view === 'day' || raw.view === 'month' ? raw.view : 'week';
  const dateParam = typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : null;
  const anchor = dateParam ?? zonedDateIso(new Date(), tz);
  const groupId = typeof raw.groupId === 'string' && raw.groupId ? raw.groupId : undefined;

  const range = rangeFor(view, anchor);

  const [lessons, groups] = await Promise.all([
    listLessons(ctx, { ...range, groupId }, tz),
    prisma.group.findMany({
      where: { organizationId: ctx.orgId, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, name: true, color: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const locale = await getLocale();

  return (
    <CalendarView
      view={view}
      anchor={anchor}
      range={range}
      timeZone={tz}
      locale={locale}
      groups={groups}
      selectedGroupId={groupId ?? ''}
      openNew={raw.new === '1'}
      lessons={lessons.map((lesson) => ({
        id: lesson.id,
        startsAt: lesson.startsAt.toISOString(),
        endsAt: lesson.endsAt.toISOString(),
        status: lesson.status,
        room: lesson.room,
        topic: lesson.topic,
        attendanceCount: lesson._count.attendance,
        group: lesson.group,
      }))}
    />
  );
}
