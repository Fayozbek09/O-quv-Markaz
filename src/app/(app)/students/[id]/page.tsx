import Link from 'next/link';
import type { Metadata } from 'next';
import { requireOrg } from '@/lib/tenant';
import { loadPage, requirePagePermission } from '@/lib/page';
import { prisma } from '@/lib/db';
import { getStudent, studentAttendanceStats } from '@/lib/domain/students';
import { studentBalance } from '@/lib/domain/billing';
import { currentOrg } from '@/lib/domain/org';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { formatMoney } from '@/lib/money';
import { formatDate, formatPercent } from '@/lib/i18n';
import { INTL_LOCALE } from '@/lib/i18n/config';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Stat, StatGrid } from '@/components/ui/Stat';
import { Badge, Dot } from '@/components/ui/Badge';
import { TableWrap, Th, Td, EmptyState } from '@/components/ui/Table';
import { AvatarUploader } from '@/components/forms/AvatarUploader';
import { signFileUrl } from '@/lib/files/storage';
import { StudentDetailActions } from './StudentDetailActions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('students.one'), robots: { index: false } };
}

export default async function StudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg();
  requirePagePermission(ctx, 'students.read');
  const t = await getTranslator();
  const locale = await getLocale();

  // A foreign or malformed id must render 404, not 500 — see lib/page.ts.
  const [student, balance, attendance, org] = await loadPage(() =>
    Promise.all([
      getStudent(ctx, id),
      studentBalance(ctx, id),
      studentAttendanceStats(ctx, id),
      currentOrg(ctx),
    ]),
  );

  const [payments, recentAttendance] = await Promise.all([
    prisma.payment.findMany({
      where: { organizationId: ctx.orgId, studentId: id },
      orderBy: { paidAt: 'desc' },
      take: 20,
      include: { group: { select: { name: true } } },
    }),
    prisma.attendance.findMany({
      where: { organizationId: ctx.orgId, studentId: id },
      orderBy: { markedAt: 'desc' },
      take: 20,
      include: { lesson: { include: { group: { select: { name: true, color: true } } } } },
    }),
  ]);

  const money = (v: bigint) => formatMoney(v, org.defaultCurrency, INTL_LOCALE[locale]);
  const parent = student.parents[0];
  const fullName = [student.firstName, student.lastName].filter(Boolean).join(' ');

  const attendanceTone = {
    PRESENT: 'ok', LATE: 'warn', ABSENT: 'danger', EXCUSED: 'neutral',
  } as const;
  const attendanceLabel = {
    PRESENT: t('attendance.present'),
    LATE: t('attendance.late'),
    ABSENT: t('attendance.absent'),
    EXCUSED: t('attendance.excused'),
  } as const;

  return (
    <>
      <nav className="mb-3 text-[13px] text-ink-faint">
        <Link href="/students" className="hover:text-ink hover:underline">
          {t('students.title')}
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink-soft">{fullName}</span>
      </nav>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {ctx.permissions.has('students.update') && (
            <AvatarUploader
              studentId={student.id}
              name={fullName}
              currentUrl={
                student.avatarFileId ? signFileUrl(student.avatarFileId, 30 * 60_000) : null
              }
            />
          )}
          <div>
          <h2 className="text-lg font-semibold">{fullName}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-soft">
            {student.phone && <span className="tnum">{student.phone}</span>}
            {student.birthDate && (
              <span>{formatDate(student.birthDate, locale, 'date', 'UTC')}</span>
            )}
            <Badge tone={student.status === 'ACTIVE' ? 'ok' : student.status === 'PAUSED' ? 'warn' : 'neutral'}>
              {student.status === 'ACTIVE'
                ? t('students.statusActive')
                : student.status === 'PAUSED'
                  ? t('students.statusPaused')
                  : t('students.statusArchived')}
            </Badge>
          </div>
          </div>
        </div>

        <StudentDetailActions
          studentId={student.id}
          studentName={fullName}
          hasDebt={balance.debtMinor > 0n}
          parentLinked={Boolean(parent?.telegramChatId)}
          initial={{
            firstName: student.firstName,
            lastName: student.lastName,
            phone: student.phone,
            email: student.email,
            birthDate: student.birthDate ? student.birthDate.toISOString().slice(0, 10) : null,
            notes: student.notes,
            status: student.status,
            parentName: parent?.fullName ?? null,
            parentPhone: parent?.phone ?? null,
          }}
        />
      </div>

      <StatGrid className="mb-4">
        <Stat label={t('payments.expected')} value={money(balance.expectedMinor)} />
        <Stat label={t('payments.paid')} value={money(balance.paidMinor + balance.adjustedMinor)} tone="ok" />
        <Stat
          label={t('payments.remaining')}
          value={money(balance.debtMinor > 0n ? balance.debtMinor : 0n)}
          tone={balance.debtMinor > 0n ? 'warn' : 'neutral'}
        />
        <Stat
          label={t('students.attendanceRate')}
          value={attendance.rate === null ? '—' : formatPercent(attendance.rate, locale)}
          sub={`${t('students.missedLessons')}: ${attendance.ABSENT} · ${t('students.lateCount')}: ${attendance.LATE}`}
        />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title={t('students.groups')} />
          {student.memberships.length === 0 ? (
            <EmptyState title={t('students.noGroups')} />
          ) : (
            <ul className="divide-y divide-line">
              {student.memberships.map((m) => (
                <li key={m.id} className="flex items-center gap-2.5 px-4 py-2.5 sm:px-5">
                  <Dot color={m.group.color} />
                  <Link href={`/groups/${m.group.id}`} className="flex-1 truncate text-sm hover:text-brand-600 hover:underline">
                    {m.group.name}
                  </Link>
                  <span className="tnum text-[13px] text-ink-soft">
                    {money(m.feeOverrideMinor ?? m.group.monthlyFeeMinor)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {parent && (
            <CardBody className="border-t border-line">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
                {t('students.parentName')}
              </p>
              <p className="mt-1 text-sm">{parent.fullName}</p>
              {parent.phone && <p className="tnum text-[13px] text-ink-soft">{parent.phone}</p>}
              <p className="mt-1.5">
                <Badge tone={parent.telegramChatId ? 'ok' : 'neutral'}>
                  Telegram: {parent.telegramChatId ? t('telegram.connected') : t('telegram.notConnected')}
                </Badge>
              </p>
            </CardBody>
          )}

          {student.notes && (
            <CardBody className="border-t border-line">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
                {t('students.notes')}
              </p>
              {/* Rendered as text - React escapes it, so markup in a note is inert. */}
              <p className="mt-1 whitespace-pre-wrap text-[13px] text-ink-soft">{student.notes}</p>
            </CardBody>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title={t('students.paymentsTab')} />
          {payments.length === 0 ? (
            <EmptyState title={t('payments.empty')} />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>{t('common.date')}</Th>
                  <Th>{t('payments.group')}</Th>
                  <Th>{t('payments.method')}</Th>
                  <Th className="text-right">{t('payments.amount')}</Th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <Td className="tnum whitespace-nowrap text-ink-soft">
                      {formatDate(p.paidAt, locale, 'date', org.timezone)}
                    </Td>
                    <Td className="text-ink-soft">{p.group?.name ?? '—'}</Td>
                    <Td>
                      {p.status === 'REVERSED' ? (
                        <Badge tone="danger">{t('payments.statusReversed')}</Badge>
                      ) : (
                        <span className="text-[13px] text-ink-soft">{p.method}</span>
                      )}
                    </Td>
                    <Td className={`tnum text-right font-medium ${p.status === 'REVERSED' ? 'text-ink-faint line-through' : ''}`}>
                      {money(p.amountMinor)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title={t('attendance.history')} />
          {recentAttendance.length === 0 ? (
            <EmptyState title={t('common.empty')} />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>{t('common.date')}</Th>
                  <Th>{t('lessons.group')}</Th>
                  <Th>{t('common.status')}</Th>
                  <Th>{t('common.notes')}</Th>
                </tr>
              </thead>
              <tbody>
                {recentAttendance.map((a) => (
                  <tr key={a.id}>
                    <Td className="tnum whitespace-nowrap text-ink-soft">
                      {formatDate(a.lesson.startsAt, locale, 'dateTime', org.timezone)}
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-2">
                        <Dot color={a.lesson.group.color} />
                        {a.lesson.group.name}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={attendanceTone[a.status]}>
                        {attendanceLabel[a.status]}
                        {a.status === 'LATE' && a.minutesLate ? ` (${a.minutesLate}′)` : ''}
                      </Badge>
                    </Td>
                    <Td className="text-[13px] text-ink-soft">{a.note ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      </div>
    </>
  );
}
