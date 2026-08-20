import Link from 'next/link';
import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requireOrg, assertPermission, scope } from '@/lib/tenant';
import { listGrades } from '@/lib/domain/grades';
import { orgTimezone } from '@/lib/domain/org';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { formatDate } from '@/lib/i18n';
import { Card } from '@/components/ui/Card';
import { EmptyState, TableWrap, Th, Td } from '@/components/ui/Table';
import { PageHeader } from '@/components/layout/PageHeader';
import { GradeDialog } from './GradeDialog';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('grades.title'), robots: { index: false } };
}

type Search = { groupId?: string; studentId?: string; page?: string };

export default async function GradesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireOrg();
  assertPermission(ctx, 'grades.read');

  const params = await searchParams;
  const t = await getTranslator();
  const locale = await getLocale();
  const tz = await orgTimezone(ctx);

  const [data, groups] = await Promise.all([
    listGrades(ctx, {
      page: Number(params.page) || 1,
      perPage: 50,
      groupId: params.groupId,
      studentId: params.studentId,
    }),
    prisma.group.findMany({
      where: {
        ...scope.orgLive(ctx),
        status: 'ACTIVE',
        ...(ctx.role === 'TEACHER' && ctx.memberId ? { teacherId: ctx.memberId } : {}),
      },
      select: {
        id: true,
        name: true,
        members: {
          where: { leftAt: null },
          select: { student: { select: { id: true, firstName: true, lastName: true } } },
        },
      },
      orderBy: { name: 'asc' },
    }),
  ]);

  const canWrite = ctx.permissions.has('grades.write');

  return (
    <>
      <PageHeader
        title={t('grades.title')}
        subtitle={`${data.total}`}
        actions={
          canWrite && groups.length > 0 ? (
            <GradeDialog
              groups={groups.map((g) => ({
                id: g.id,
                name: g.name,
                students: g.members.map((m) => ({
                  id: m.student.id,
                  name: [m.student.firstName, m.student.lastName].filter(Boolean).join(' '),
                })),
              }))}
            />
          ) : null
        }
      />

      <Card>
        {data.rows.length === 0 ? (
          <EmptyState title={t('grades.empty')} />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>{t('grades.gradedAt')}</Th>
                <Th>{t('nav.students')}</Th>
                <Th>{t('nav.groups')}</Th>
                <Th>{t('grades.gradeTitle')}</Th>
                <Th className="text-right">{t('grades.value')}</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((grade) => (
                <tr key={grade.id}>
                  <Td className="tnum whitespace-nowrap text-[13px] text-ink-soft">
                    {formatDate(grade.gradedAt, locale, 'dateNumeric', tz)}
                  </Td>
                  <Td className="text-sm">
                    <Link
                      href={`/students/${grade.student.id}`}
                      className="hover:text-brand-600 hover:underline"
                    >
                      {[grade.student.firstName, grade.student.lastName].filter(Boolean).join(' ')}
                    </Link>
                  </Td>
                  <Td className="text-[13px] text-ink-soft">{grade.group?.name ?? '—'}</Td>
                  <Td className="text-[13px]">{grade.title ?? '—'}</Td>
                  <Td className="tnum text-right text-sm font-semibold">
                    {grade.scheme === 'LETTER'
                      ? (grade.valueLetter ?? '—')
                      : `${grade.valueNumeric ?? '—'}${grade.maxValue ? `/${grade.maxValue}` : ''}`}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
