import type { Metadata } from 'next';
import { requireUser } from '@/lib/tenant';
import {
  requireStudent, myGroups, myLessons, myAttendance, myGrades, myHomework,
  myPayments, myNotifications,
} from '@/lib/domain/portal';
import { prisma } from '@/lib/db';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { formatMoney } from '@/lib/money';
import { formatDate, formatPercent } from '@/lib/i18n';
import { INTL_LOCALE } from '@/lib/i18n/config';
import { AvatarUploader } from '@/components/forms/AvatarUploader';
import { AttachmentList } from '@/components/ui/AttachmentList';
import { signFileUrl } from '@/lib/files/storage';
import { Stat, StatGrid } from '@/components/ui/Stat';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Badge, Dot } from '@/components/ui/Badge';
import { EmptyState, TableWrap, Th, Td } from '@/components/ui/Table';
import { SubmitHomework } from './SubmitHomework';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('student.title'), robots: { index: false } };
}

const DAY = 86_400_000;

export default async function StudentPage() {
  const user = await requireUser();
  const sc = await requireStudent(user);
  const t = await getTranslator();
  const locale = await getLocale();

  const now = new Date();
  const [groups, lessons, attendance, grades, homework, payments, notifications, org] =
    await Promise.all([
      myGroups(sc),
      myLessons(sc, new Date(now.getTime() - DAY), new Date(now.getTime() + 14 * DAY)),
      myAttendance(sc, 20),
      myGrades(sc, 20),
      myHomework(sc, 20),
      myPayments(sc),
      myNotifications(user, 8),
      prisma.organization.findUnique({
        where: { id: sc.organizationId },
        select: { name: true, defaultCurrency: true, timezone: true },
      }),
    ]);

  const tz = org?.timezone ?? 'Asia/Tashkent';
  const currency = org?.defaultCurrency ?? 'UZS';
  const money = (v: bigint) => formatMoney(v, currency, INTL_LOCALE[locale]);

  const todayIso = formatDate(now, 'en', 'dateNumeric', tz);
  const todaysLessons = lessons.filter(
    (l) => formatDate(l.startsAt, 'en', 'dateNumeric', tz) === todayIso,
  );
  const upcoming = lessons.filter((l) => l.startsAt > now).slice(0, 6);
  const primaryGroup = groups[0]?.group;
  const teacherProfile = primaryGroup?.teacher?.user.profile;

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <AvatarUploader
          name={[sc.firstName, sc.lastName].filter(Boolean).join(' ')}
          currentUrl={sc.avatarFileId ? signFileUrl(sc.avatarFileId, 30 * 60_000) : null}
        />
        <div>
          <h2 className="text-lg font-semibold text-ink">
            {[sc.firstName, sc.lastName].filter(Boolean).join(' ')}
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-soft">
            {org?.name}
            {sc.studentNo ? ` · ${t('student.studentId')} ${sc.studentNo}` : ''}
          </p>
        </div>
      </div>

      <StatGrid className="mb-6">
        <Stat
          label={t('student.myDebt')}
          value={money(payments.debtMinor > 0n ? payments.debtMinor : 0n)}
          tone={payments.debtMinor > 0n ? 'warn' : 'ok'}
          sub={`${t('payments.paid')}: ${money(payments.paidMinor)}`}
        />
        <Stat
          label={t('student.myAttendance')}
          value={
            attendance.stats.attendanceRate === null
              ? '—'
              : formatPercent(attendance.stats.attendanceRate, locale)
          }
          sub={`${t('attendance.absent')}: ${attendance.stats.absent} · ${t('attendance.late')}: ${attendance.stats.late}`}
        />
        <Stat
          label={t('student.average')}
          value={grades.average === null ? '—' : `${grades.average.toFixed(1)}%`}
          sub={`${grades.rows.length} ${t('grades.title').toLowerCase()}`}
        />
        <Stat
          label={t('student.myHomework')}
          value={homework.filter((h) => h.status === 'ASSIGNED').length}
          sub={t('homework.ASSIGNED')}
        />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={t('student.myLesson')}
            subtitle={
              teacherProfile
                ? `${t('student.myTeacher')}: ${[teacherProfile.firstName, teacherProfile.lastName].filter(Boolean).join(' ')}`
                : undefined
            }
          />
          {todaysLessons.length === 0 ? (
            <EmptyState title={t('teacher.noLessonsToday')} />
          ) : (
            <ul className="divide-y divide-line">
              {todaysLessons.map((lesson) => (
                <li key={lesson.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                  <span className="tnum w-11 shrink-0 text-[13px] font-medium text-ink-soft">
                    {formatDate(lesson.startsAt, locale, 'time', tz)}
                  </span>
                  <Dot color={lesson.group.color} />
                  <span className="min-w-0 flex-1 truncate text-sm">{lesson.group.name}</span>
                  {lesson.room && <span className="text-[12px] text-ink-faint">{lesson.room}</span>}
                  {lesson.status === 'CANCELLED' && (
                    <Badge tone="danger">{t('lessons.statusCancelled')}</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
          {upcoming.length > 0 && (
            <CardBody className="border-t border-line">
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
                {t('student.nextLesson')}
              </p>
              <div className="flex flex-wrap gap-2">
                {upcoming.map((lesson) => (
                  <span
                    key={lesson.id}
                    className="flex items-center gap-2 rounded-[var(--radius-field)] border border-line px-3 py-1.5 text-[13px]"
                  >
                    <Dot color={lesson.group.color} />
                    <span className="font-medium">{lesson.group.name}</span>
                    <span className="tnum text-ink-faint">
                      {formatDate(lesson.startsAt, locale, 'dayMonthTime', tz)}
                    </span>
                    {lesson.status === 'CANCELLED' && (
                      <Badge tone="danger">{t('lessons.statusCancelled')}</Badge>
                    )}
                  </span>
                ))}
              </div>
            </CardBody>
          )}
        </Card>

        <Card>
          <CardHeader title={t('student.myGroup')} />
          {groups.length === 0 ? (
            <EmptyState title={t('groups.empty')} />
          ) : (
            <ul className="divide-y divide-line">
              {groups.map((membership) => {
                const profile = membership.group.teacher?.user.profile;
                return (
                  <li key={membership.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                    <Dot color={membership.group.color} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        {membership.group.name}
                      </span>
                      <span className="block truncate text-[12px] text-ink-faint">
                        {[
                          membership.group.course?.name ?? membership.group.subject,
                          membership.group.room,
                          profile ? [profile.firstName, profile.lastName].filter(Boolean).join(' ') : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <span className="tnum shrink-0 text-[13px] text-ink-soft">
                      {money(membership.feeOverrideMinor ?? membership.group.monthlyFeeMinor)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title={t('student.myHomework')} />
          {homework.length === 0 ? (
            <EmptyState title={t('homework.empty')} />
          ) : (
            <ul className="divide-y divide-line">
              {homework.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">
                      {row.homework.title}
                    </span>
                    <span className="block truncate text-[12px] text-ink-faint">
                      {row.homework.group.name} · {t('homework.due')}{' '}
                      {formatDate(row.homework.dueAt, locale, 'dayMonthTime', tz)}
                    </span>
                    {row.homework.attachments.length > 0 && (
                      <span className="mt-1.5 block">
                        <AttachmentList
                          items={row.homework.attachments}
                          label={t('homework.attachments')}
                        />
                      </span>
                    )}
                  </span>
                  {row.score !== null && (
                    <Badge tone="brand">
                      {row.score}
                      {row.homework.maxScore ? `/${row.homework.maxScore}` : ''}
                    </Badge>
                  )}
                  <Badge
                    tone={
                      row.status === 'SUBMITTED' || row.status === 'GRADED'
                        ? 'ok'
                        : row.status === 'MISSING'
                          ? 'danger'
                          : row.status === 'LATE'
                            ? 'warn'
                            : 'neutral'
                    }
                  >
                    {t(`homework.${row.status}`)}
                  </Badge>
                  {(row.status === 'ASSIGNED' || row.status === 'MISSING') && (
                    <SubmitHomework homeworkId={row.homework.id} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title={t('student.myGrades')} />
          {grades.rows.length === 0 ? (
            <EmptyState title={t('grades.empty')} />
          ) : (
            <TableWrap className="px-1 pb-1">
              <thead>
                <tr>
                  <Th>{t('common.date')}</Th>
                  <Th>{t('grades.gradeTitle')}</Th>
                  <Th className="text-right">{t('grades.value')}</Th>
                </tr>
              </thead>
              <tbody>
                {grades.rows.map((g) => (
                  <tr key={g.id}>
                    <Td className="tnum whitespace-nowrap text-[13px] text-ink-soft">
                      {formatDate(g.gradedAt, locale, 'dayMonth', tz)}
                    </Td>
                    <Td className="text-[13px]">
                      {g.title ?? g.group?.name ?? '—'}
                    </Td>
                    <Td className="tnum text-right text-sm font-semibold">
                      {g.scheme === 'LETTER'
                        ? (g.valueLetter ?? '—')
                        : `${g.valueNumeric ?? '—'}${g.maxValue ? `/${g.maxValue}` : ''}`}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>

        <Card>
          <CardHeader title={t('student.myPayments')} />
          {payments.payments.length === 0 ? (
            <EmptyState title={t('payments.empty')} />
          ) : (
            <TableWrap className="px-1 pb-1">
              <thead>
                <tr>
                  <Th>{t('common.date')}</Th>
                  <Th>{t('payments.method')}</Th>
                  <Th className="text-right">{t('billing.amount')}</Th>
                </tr>
              </thead>
              <tbody>
                {payments.payments.map((p) => (
                  <tr key={p.id}>
                    <Td className="tnum whitespace-nowrap text-[13px] text-ink-soft">
                      {formatDate(p.paidAt, locale, 'dayMonth', tz)}
                    </Td>
                    <Td className="text-[13px]">{t(`payments.methods.${p.method}` as never)}</Td>
                    <Td className="tnum text-right text-sm font-semibold text-ok-600">
                      {money(p.amountMinor)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title={t('student.announcements')} />
          {notifications.length === 0 ? (
            <EmptyState title={t('notifications.empty')} />
          ) : (
            <ul className="divide-y divide-line">
              {notifications.map((n) => (
                <li key={n.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px] sm:px-5">
                  <span className="min-w-0 flex-1 truncate">{t(n.titleKey as never)}</span>
                  <span className="tnum shrink-0 text-[12px] text-ink-faint">
                    {formatDate(n.createdAt, locale, 'dayMonthTime', tz)}
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
