import type { Metadata } from 'next';
import { requireOrgPage, requirePagePermission } from '@/lib/page';
import { listAnnouncements } from '@/lib/domain/announcements';
import { listGroups } from '@/lib/domain/groups';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { formatDate } from '@/lib/i18n';
import { currentOrg } from '@/lib/domain/org';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/Table';
import { PageHeader } from '@/components/layout/PageHeader';
import { AnnouncementDialog } from './AnnouncementDialog';
import { WithdrawButton } from './WithdrawButton';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('announcements.title'), robots: { index: false } };
}

export default async function AnnouncementsPage() {
  const ctx = await requireOrgPage();
  requirePagePermission(ctx, 'notifications.send');

  const t = await getTranslator();
  const locale = await getLocale();
  const [rows, groups, org] = await Promise.all([
    listAnnouncements(ctx),
    listGroups(ctx),
    currentOrg(ctx),
  ]);
  const tz = org.timezone;

  return (
    <>
      <PageHeader
        title={t('announcements.title')}
        subtitle={`${rows.length}`}
        actions={<AnnouncementDialog groups={groups.map((g) => ({ id: g.id, name: g.name }))} />}
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState title={t('announcements.empty')} />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row) => {
            const author = row.author?.user.profile;
            const expired = row.expiresAt !== null && row.expiresAt <= new Date();
            return (
              <Card key={row.id}>
                <div className="flex flex-col gap-2 px-4 py-3.5 sm:px-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-ink">{row.title}</h3>
                    {row.pinned && <Badge tone="brand">{t('announcements.pin')}</Badge>}
                    <Badge tone="neutral">
                      {row.audience === 'GROUP'
                        ? (row.group?.name ?? t('announcements.GROUP'))
                        : t(`announcements.${row.audience}`)}
                    </Badge>
                    {expired && <Badge tone="warn">{t('announcements.expired')}</Badge>}
                    <span className="ml-auto">
                      <WithdrawButton id={row.id} />
                    </span>
                  </div>

                  {/* Free text written by staff, rendered as text and never as markup. */}
                  <p className="whitespace-pre-wrap text-[13px] text-ink-soft">{row.body}</p>

                  <p className="text-[12px] text-ink-faint">
                    {author ? [author.firstName, author.lastName].filter(Boolean).join(' ') : '—'}
                    {' · '}
                    {formatDate(row.createdAt, locale, 'dayMonthTime', tz)}
                  </p>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
