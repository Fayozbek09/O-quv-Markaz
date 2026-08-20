import Link from 'next/link';
import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requireOrg, scope } from '@/lib/tenant';
import { requirePagePermission } from '@/lib/page';
import { listHomework } from '@/lib/domain/homework';
import { orgTimezone } from '@/lib/domain/org';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { formatDate } from '@/lib/i18n';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, TableWrap, Th, Td } from '@/components/ui/Table';
import { PageHeader } from '@/components/layout/PageHeader';
import { HomeworkDialog } from './HomeworkDialog';
import type { TKey } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('homework.title'), robots: { index: false } };
}

type Search = { groupId?: string; page?: string };

export default async function HomeworkPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireOrg();
  requirePagePermission(ctx, 'homework.read');

  const params = await searchParams;
  const t = await getTranslator();
  const locale = await getLocale();
  const tz = await orgTimezone(ctx);
  const canWrite = ctx.permissions.has('homework.write');

  const [data, groups] = await Promise.all([
    listHomework(ctx, {
      page: Number(params.page) || 1,
      perPage: 25,
      status: 'ALL',
      groupId: params.groupId,
    }),
    prisma.group.findMany({
      where: {
        ...scope.orgLive(ctx),
        status: 'ACTIVE',
        ...(ctx.role === 'TEACHER' && ctx.memberId ? { teacherId: ctx.memberId } : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const now = new Date();

  return (
    <>
      <PageHeader
        title={t('homework.title')}
        subtitle={`${data.total}`}
        actions={canWrite && groups.length > 0 ? <HomeworkDialog groups={groups} /> : null}
      />

      <Card>
        {data.rows.length === 0 ? (
          <EmptyState title={t('homework.empty')} />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>{t('homework.homeworkTitle')}</Th>
                <Th>{t('homework.group')}</Th>
                <Th>{t('homework.due')}</Th>
                <Th>{t('common.status')}</Th>
                <Th className="text-right">{t('homework.submissions')}</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id}>
                  <Td>
                    <Link
                      href={`/homework/${row.id}`}
                      className="text-sm font-medium hover:text-brand-600 hover:underline"
                    >
                      {row.title}
                    </Link>
                  </Td>
                  <Td className="text-[13px] text-ink-soft">{row.group.name}</Td>
                  <Td className="tnum whitespace-nowrap text-[13px]">
                    {formatDate(row.dueAt, locale, 'dayMonthTime', tz)}
                    {row.dueAt < now && row.status === 'PUBLISHED' && (
                      <Badge tone="warn" className="ml-2">
                        {t('homework.overdue')}
                      </Badge>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={row.status === 'PUBLISHED' ? 'ok' : 'neutral'}>
                      {t(`homework.${row.status}` as TKey)}
                    </Badge>
                  </Td>
                  <Td className="tnum text-right text-[13px]">{row._count.submissions}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
