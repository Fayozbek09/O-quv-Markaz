import Link from 'next/link';
import type { Metadata } from 'next';
import { requireOrg } from '@/lib/tenant';
import { prisma } from '@/lib/db';
import { getGroup } from '@/lib/domain/groups';
import { currentOrg } from '@/lib/domain/org';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/i18n';
import { INTL_LOCALE } from '@/lib/i18n/config';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge, Dot } from '@/components/ui/Badge';
import { TableWrap, Th, Td, EmptyState } from '@/components/ui/Table';
import { GroupDetailActions } from './GroupDetailActions';
import type { TKey } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('groups.one'), robots: { index: false } };
}

export default async function GroupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg();
  const t = await getTranslator();
  const locale = await getLocale();

  const [group, org] = await Promise.all([getGroup(ctx, id), currentOrg(ctx)]);

  const [lessons, availableStudents] = await Promise.all([
    prisma.lesson.findMany({
      where: { organizationId: ctx.orgId, groupId: id, deletedAt: null },
      orderBy: { startsAt: 'desc' },
      take: 15,
      include: { _count: { select: { attendance: true } } },
    }),
    prisma.student.findMany({
      where: {
        organizationId: ctx.orgId,
        deletedAt: null,
        status: 'ACTIVE',
        NOT: { memberships: { some: { groupId: id, leftAt: null } } },
      },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: 'asc' }],
      take: 300,
    }),
  ]);

  const money = (v: bigint) => formatMoney(v, group.currency || org.defaultCurrency, INTL_LOCALE[locale]);

  return (
    <>
      <nav className="mb-3 text-[13px] text-ink-faint">
        <Link href="/groups" className="hover:text-ink hover:underline">
          {t('groups.title')}
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink-soft">{group.name}</span>
      </nav>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2.5 text-lg font-semibold">
            <Dot color={group.color} />
            {group.name}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-soft">
            {group.subject && <span>{group.subject}</span>}
            <span className="flex gap-1">
              {group.weekdays.map((day) => (
                <span key={day} className="rounded-[5px] bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium">
                  {t(`weekdays.short${day}` as TKey)}
                </span>
              ))}
            </span>
            {group.startTime && (
              <span className="tnum">
                {group.startTime}–{group.endTime}
              </span>
            )}
            {group.room && <span>{group.room}</span>}
            <span className="tnum font-semibold text-ink">{money(group.monthlyFeeMinor)}</span>
          </div>
        </div>

        <GroupDetailActions
          groupId={group.id}
          availableStudents={availableStudents.map((s) => ({
            id: s.id,
            name: [s.firstName, s.lastName].filter(Boolean).join(' '),
          }))}
          initial={{
            name: group.name,
            subject: group.subject,
            weekdays: group.weekdays,
            startTime: group.startTime,
            endTime: group.endTime,
            room: group.room,
            color: group.color,
            monthlyFee: group.monthlyFeeMinor.toString(),
            currency: group.currency,
            status: group.status,
          }}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={t('groups.members')}
            subtitle={t('groups.memberCount', { count: group.members.length })}
          />
          {group.members.length === 0 ? (
            <EmptyState title={t('students.empty')} />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>{t('common.name')}</Th>
                  <Th>{t('students.phone')}</Th>
                  <Th className="text-right">{t('groups.feeOverride')}</Th>
                </tr>
              </thead>
              <tbody>
                {group.members.map((member) => (
                  <tr key={member.id}>
                    <Td>
                      <Link href={`/students/${member.student.id}`} className="font-medium hover:text-brand-600 hover:underline">
                        {[member.student.firstName, member.student.lastName].filter(Boolean).join(' ')}
                      </Link>
                    </Td>
                    <Td className="tnum text-ink-soft">{member.student.phone ?? '—'}</Td>
                    <Td className="tnum text-right text-ink-soft">
                      {member.feeOverrideMinor === null ? '—' : money(member.feeOverrideMinor)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>

        <Card>
          <CardHeader title={t('lessons.title')} />
          {lessons.length === 0 ? (
            <EmptyState title={t('lessons.empty')} hint={t('groups.generateHint')} />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>{t('common.date')}</Th>
                  <Th>{t('common.status')}</Th>
                  <Th className="text-right">{t('attendance.title')}</Th>
                </tr>
              </thead>
              <tbody>
                {lessons.map((lesson) => (
                  <tr key={lesson.id}>
                    <Td className="tnum whitespace-nowrap">
                      {formatDate(lesson.startsAt, locale, 'dateTime', org.timezone)}
                    </Td>
                    <Td>
                      <Badge tone={lesson.status === 'COMPLETED' ? 'ok' : lesson.status === 'CANCELLED' ? 'danger' : 'neutral'}>
                        {lesson.status === 'COMPLETED'
                          ? t('lessons.statusCompleted')
                          : lesson.status === 'CANCELLED'
                            ? t('lessons.statusCancelled')
                            : t('lessons.statusScheduled')}
                      </Badge>
                    </Td>
                    <Td className="text-right">
                      {lesson._count.attendance > 0 ? (
                        <span className="tnum text-[13px] text-ink-soft">{lesson._count.attendance}</span>
                      ) : (
                        <Link href={`/attendance?lessonId=${lesson.id}`} className="text-[13px] text-brand-600 hover:underline">
                          {t('attendance.mark')}
                        </Link>
                      )}
                    </Td>
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
