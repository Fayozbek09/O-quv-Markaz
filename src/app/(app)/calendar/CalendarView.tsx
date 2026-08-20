'use client';

import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { formatDate } from '@/lib/i18n';
import type { AppLocale } from '@/lib/i18n/config';
import { Card } from '@/components/ui/Card';
import { Badge, Dot } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/layout/PageHeader';
import { LessonForm } from '@/components/forms/LessonForm';
import type { TKey } from '@/lib/i18n';

type Lesson = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  room: string | null;
  topic: string | null;
  attendanceCount: number;
  group: { id: string; name: string; color: string; subject: string | null };
};

type Group = { id: string; name: string; color: string };

export function CalendarView({
  view,
  anchor,
  range,
  timeZone,
  locale,
  groups,
  selectedGroupId,
  lessons,
  openNew,
}: {
  view: 'day' | 'week' | 'month';
  anchor: string;
  range: { from: string; until: string };
  timeZone: string;
  locale: AppLocale;
  groups: Group[];
  selectedGroupId: string;
  lessons: Lesson[];
  openNew: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [newOpen, setNewOpen] = useState(openNew);

  function navigate(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    next.delete('new');
    router.replace(`${pathname}?${next.toString()}`);
  }

  const shiftDays = view === 'day' ? 1 : view === 'week' ? 7 : 30;
  const shift = (direction: -1 | 1) =>
    navigate({
      date: new Date(Date.parse(`${anchor}T00:00:00Z`) + direction * shiftDays * 86_400_000)
        .toISOString()
        .slice(0, 10),
    });

  // Group lessons by their local calendar day.
  const byDay = new Map<string, Lesson[]>();
  for (const lesson of lessons) {
    const key = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(lesson.startsAt));
    const list = byDay.get(key) ?? [];
    list.push(lesson);
    byDay.set(key, list);
  }

  const days: string[] = [];
  for (
    let cursor = Date.parse(`${range.from}T00:00:00Z`);
    cursor <= Date.parse(`${range.until}T00:00:00Z`);
    cursor += 86_400_000
  ) {
    days.push(new Date(cursor).toISOString().slice(0, 10));
  }

  const todayIso = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const time = (iso: string) =>
    formatDate(iso, locale, 'time', timeZone);

  const headingLabel =
    view === 'day'
      ? formatDate(`${anchor}T12:00:00Z`, locale, 'dateFull', 'UTC')
      : view === 'month'
        ? formatDate(`${anchor}T12:00:00Z`, locale, 'monthYear', 'UTC')
        : `${formatDate(`${range.from}T12:00:00Z`, locale, 'dayMonth', 'UTC')} – ${formatDate(`${range.until}T12:00:00Z`, locale, 'date', 'UTC')}`;

  return (
    <>
      <PageHeader
        title={t('calendar.title')}
        actions={<Button onClick={() => setNewOpen(true)}>+ {t('lessons.add')}</Button>}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => shift(-1)} aria-label={t('common.previous')}
            className="rounded-[var(--radius-field)] border border-line-strong bg-surface px-2 py-1.5 hover:bg-surface-muted">
            <svg viewBox="0 0 20 20" className="size-4" fill="none" aria-hidden="true">
              <path d="M12 4 6 10l6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button type="button" onClick={() => navigate({ date: todayIso })}
            className="rounded-[var(--radius-field)] border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium hover:bg-surface-muted">
            {t('calendar.today')}
          </button>
          <button type="button" onClick={() => shift(1)} aria-label={t('common.next')}
            className="rounded-[var(--radius-field)] border border-line-strong bg-surface px-2 py-1.5 hover:bg-surface-muted">
            <svg viewBox="0 0 20 20" className="size-4" fill="none" aria-hidden="true">
              <path d="m8 4 6 6-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <p className="text-sm font-medium">{headingLabel}</p>

        <div className="flex-1" />

        <label className="sr-only" htmlFor="calendar-group">{t('calendar.allGroups')}</label>
        <select
          id="calendar-group"
          value={selectedGroupId}
          onChange={(e) => navigate({ groupId: e.target.value || null })}
          className="field h-8 w-auto py-0 text-[13px]"
        >
          <option value="">{t('calendar.allGroups')}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>

        <div className="flex rounded-[var(--radius-field)] border border-line-strong bg-surface p-0.5">
          {(['day', 'week', 'month'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => navigate({ view: v })}
              aria-pressed={view === v}
              className={
                view === v
                  ? 'rounded-[6px] bg-brand-500 px-2.5 py-1 text-[12px] font-medium text-white'
                  : 'rounded-[6px] px-2.5 py-1 text-[12px] font-medium text-ink-soft hover:bg-surface-muted'
              }
            >
              {t(`calendar.${v}` as TKey)}
            </button>
          ))}
        </div>
      </div>

      {view === 'month' ? (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-7 border-b border-line bg-surface-muted/60">
            {[1, 2, 3, 4, 5, 6, 7].map((day) => (
              <div key={day} className="px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                {t(`weekdays.short${day}` as TKey)}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const dayLessons = byDay.get(day) ?? [];
              const isToday = day === todayIso;
              return (
                <div key={day} className="min-h-24 border-b border-r border-line p-1.5 last:border-r-0">
                  <button
                    type="button"
                    onClick={() => navigate({ view: 'day', date: day })}
                    className={
                      isToday
                        ? 'tnum mb-1 flex size-5 items-center justify-center rounded-full bg-brand-500 text-[11px] font-semibold text-white'
                        : 'tnum mb-1 text-[11px] font-medium text-ink-faint hover:text-ink'
                    }
                  >
                    {Number(day.slice(8, 10))}
                  </button>
                  <div className="space-y-0.5">
                    {dayLessons.slice(0, 3).map((lesson) => (
                      <Link
                        key={lesson.id}
                        href={`/attendance?lessonId=${lesson.id}`}
                        className="flex items-center gap-1 truncate rounded-[4px] px-1 py-0.5 text-[11px] hover:bg-surface-muted"
                      >
                        <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: lesson.group.color }} />
                        <span className="tnum shrink-0 text-ink-faint">{time(lesson.startsAt)}</span>
                        <span className="truncate">{lesson.group.name}</span>
                      </Link>
                    ))}
                    {dayLessons.length > 3 && (
                      <p className="px-1 text-[10px] text-ink-faint">+{dayLessons.length - 3}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : (
        <div className={view === 'week' ? 'grid gap-3 md:grid-cols-2 xl:grid-cols-4' : ''}>
          {days.map((day) => {
            const dayLessons = byDay.get(day) ?? [];
            return (
              <Card key={day} className={day === todayIso ? 'ring-1 ring-brand-500' : ''}>
                <div className="flex items-baseline justify-between border-b border-line px-3.5 py-2">
                  <p className="text-[13px] font-semibold">
                    {formatDate(`${day}T12:00:00Z`, locale, 'weekdayDayMonth', 'UTC')}
                  </p>
                  {dayLessons.length > 0 && (
                    <span className="tnum text-[12px] text-ink-faint">{dayLessons.length}</span>
                  )}
                </div>
                {dayLessons.length === 0 ? (
                  <p className="px-3.5 py-4 text-center text-[12px] text-ink-faint">{t('calendar.noLessons')}</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {dayLessons.map((lesson) => (
                      <li key={lesson.id}>
                        <Link
                          href={`/attendance?lessonId=${lesson.id}`}
                          className="flex items-center gap-2 px-3.5 py-2 hover:bg-surface-muted"
                        >
                          <Dot color={lesson.group.color} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-medium">{lesson.group.name}</p>
                            <p className="tnum text-[11px] text-ink-faint">
                              {time(lesson.startsAt)}–{time(lesson.endsAt)}
                              {lesson.room ? ` · ${lesson.room}` : ''}
                            </p>
                          </div>
                          {lesson.status === 'CANCELLED' ? (
                            <Badge tone="danger">{t('lessons.statusCancelled')}</Badge>
                          ) : lesson.attendanceCount > 0 ? (
                            <Badge tone="ok">✓</Badge>
                          ) : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title={t('lessons.add')}>
        <LessonForm
          groups={groups}
          defaultDate={anchor}
          onDone={() => { setNewOpen(false); router.refresh(); }}
          onCancel={() => setNewOpen(false)}
        />
      </Modal>
    </>
  );
}
