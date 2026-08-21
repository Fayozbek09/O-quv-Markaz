import Link from 'next/link';
import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requireAdminPage } from '@/lib/page';

import { getLocale, getTranslator } from '@/lib/i18n/server';
import { formatDate } from '@/lib/i18n';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, TableWrap, Th, Td } from '@/components/ui/Table';
import { PageHeader } from '@/components/layout/PageHeader';
import { CreateCenterDialog } from './CreateCenterDialog';
import type { TKey } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('admin.centers') };
}

type Search = { q?: string; status?: string };

export default async function AdminCentersPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  await requireAdminPage();
  const params = await searchParams;
  const t = await getTranslator();
  const locale = await getLocale();

  const q = (params.q ?? '').slice(0, 120);
  const status = params.status === 'ACTIVE' || params.status === 'SUSPENDED' ? params.status : null;

  const rows = await prisma.organization.findMany({
    where: {
      deletedAt: null,
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' as const } },
              { city: { contains: q, mode: 'insensitive' as const } },
              { phone: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true, name: true, city: true, phone: true, status: true, createdAt: true,
      subscription: { select: { status: true, trialEndsAt: true, subscriptionEndsAt: true } },
      _count: { select: { students: true, groups: true, members: true } },
    },
  });

  return (
    <>
      <PageHeader title={t('admin.centers')} actions={<CreateCenterDialog />} />

      <form method="get" className="mb-4 flex flex-wrap gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder={t('common.search')}
          aria-label={t('common.search')}
          className="field h-10 w-full max-w-xs"
        />
        <select name="status" defaultValue={status ?? ''} className="field h-10 w-40" aria-label={t('common.status')}>
          <option value="">{t('common.all')}</option>
          <option value="ACTIVE">{t('admin.activeCenters')}</option>
          <option value="SUSPENDED">{t('admin.suspendedCenters')}</option>
        </select>
        <button type="submit" className="btn btn-primary h-10 px-4 text-[13px]">
          {t('common.apply')}
        </button>
      </form>

      <Card>
        {rows.length === 0 ? (
          <EmptyState title={t('common.empty')} />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>{t('center.name')}</Th>
                <Th>{t('center.city')}</Th>
                <Th className="text-right">{t('nav.students')}</Th>
                <Th className="text-right">{t('nav.groups')}</Th>
                <Th>{t('billing.status')}</Th>
                <Th>{t('common.date')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <Td>
                    <Link
                      href={`/admin/centers/${row.id}`}
                      className="font-medium hover:text-brand-600 hover:underline"
                    >
                      {row.name}
                    </Link>
                    {row.status === 'SUSPENDED' && (
                      <Badge tone="danger" className="ml-2">
                        {t('admin.suspendedCenters')}
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-[13px] text-ink-soft">{row.city ?? '—'}</Td>
                  <Td className="tnum text-right text-[13px]">{row._count.students}</Td>
                  <Td className="tnum text-right text-[13px]">{row._count.groups}</Td>
                  <Td>
                    {row.subscription ? (
                      <Badge
                        tone={
                          row.subscription.status === 'ACTIVE'
                            ? 'ok'
                            : row.subscription.status === 'TRIAL' || row.subscription.status === 'TRIALING'
                              ? 'brand'
                              : row.subscription.status === 'SUSPENDED'
                                ? 'danger'
                                : 'warn'
                        }
                      >
                        {t(`billing.${row.subscription.status}` as TKey)}
                      </Badge>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td className="tnum whitespace-nowrap text-[13px] text-ink-faint">
                    {formatDate(row.createdAt, locale, 'dateNumeric')}
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
