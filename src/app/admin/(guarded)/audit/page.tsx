import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/admin';
import { isUuid } from '@/lib/tenant';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { formatDate } from '@/lib/i18n';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, TableWrap, Th, Td } from '@/components/ui/Table';
import { PageHeader } from '@/components/layout/PageHeader';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('admin.audit') };
}

type Search = { organizationId?: string; action?: string; overridesOnly?: string };

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const params = await searchParams;
  const t = await getTranslator();
  const locale = await getLocale();

  const organizationId = isUuid(params.organizationId) ? params.organizationId : undefined;
  const action = (params.action ?? '').slice(0, 80) || undefined;
  const overridesOnly = params.overridesOnly === '1';

  const rows = await prisma.auditLog.findMany({
    where: {
      ...(organizationId ? { organizationId } : {}),
      ...(action ? { action: { contains: action } } : {}),
      ...(overridesOnly ? { isOverride: true } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true, action: true, entityType: true, entityId: true, outcome: true,
      createdAt: true, isOverride: true, meta: true,
      organization: { select: { id: true, name: true } },
      actorAdmin: { select: { fullName: true, username: true } },
      actor: { select: { username: true, profile: { select: { firstName: true, lastName: true } } } },
    },
  });

  return (
    <>
      <PageHeader title={t('admin.audit')} />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        {organizationId && <input type="hidden" name="organizationId" value={organizationId} />}
        <input
          type="search"
          name="action"
          defaultValue={action ?? ''}
          placeholder={t('admin.auditAction')}
          aria-label={t('admin.auditAction')}
          className="field h-10 w-full max-w-xs"
        />
        <label className="flex h-10 items-center gap-2 text-[13px] text-ink-soft">
          <input type="checkbox" name="overridesOnly" value="1" defaultChecked={overridesOnly} />
          {t('admin.overridesOnly')}
        </label>
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
                <Th>{t('admin.auditWhen')}</Th>
                <Th>{t('admin.auditActor')}</Th>
                <Th>{t('admin.auditAction')}</Th>
                <Th>{t('admin.center')}</Th>
                <Th>{t('admin.auditTarget')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <Td className="tnum whitespace-nowrap text-[12px] text-ink-soft">
                    {formatDate(row.createdAt, locale, 'dateTimeShort')}
                  </Td>
                  <Td className="text-[13px]">
                    {row.actorAdmin ? (
                      <span className="flex items-center gap-1.5">
                        <Badge tone="danger">{t('nav.admin')}</Badge>
                        {row.actorAdmin.fullName}
                      </span>
                    ) : (
                      ([row.actor?.profile?.firstName, row.actor?.profile?.lastName]
                        .filter(Boolean)
                        .join(' ') ||
                        row.actor?.username ||
                        '—')
                    )}
                  </Td>
                  <Td className="text-[13px]">
                    <span className="font-medium">{row.action}</span>
                    {row.outcome !== 'success' && (
                      <Badge tone={row.outcome === 'denied' ? 'warn' : 'danger'} className="ml-2">
                        {row.outcome}
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-[13px] text-ink-soft">{row.organization?.name ?? '—'}</Td>
                  <Td className="font-mono text-[11px] text-ink-faint">
                    {row.entityType ? `${row.entityType}:${(row.entityId ?? '').slice(0, 8)}` : '—'}
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
