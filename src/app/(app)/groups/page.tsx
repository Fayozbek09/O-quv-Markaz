import Link from 'next/link';
import type { Metadata } from 'next';
import { requireOrg } from '@/lib/tenant';
import { requirePagePermission } from '@/lib/page';
import { listGroups } from '@/lib/domain/groups';
import { currentOrg } from '@/lib/domain/org';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { formatMoney } from '@/lib/money';
import { INTL_LOCALE } from '@/lib/i18n/config';
import { Card } from '@/components/ui/Card';
import { Badge, Dot } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/Table';
import { GroupsToolbar } from './GroupsToolbar';
import type { TKey } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('groups.title'), robots: { index: false } };
}

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireOrg();
  requirePagePermission(ctx, 'groups.read');
  const t = await getTranslator();
  const locale = await getLocale();
  const raw = await searchParams;

  const showArchived = raw.archived === '1';
  const [groups, org] = await Promise.all([listGroups(ctx, showArchived), currentOrg(ctx)]);

  const money = (v: bigint, currency: string) => formatMoney(v, currency, INTL_LOCALE[locale]);

  return (
    <>
      <GroupsToolbar openNew={raw.new === '1'} showArchived={showArchived} />

      {groups.length === 0 ? (
        <Card>
          <EmptyState title={t('groups.empty')} hint={t('groups.emptyHint')} />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <Link
              key={group.id}
              href={`/groups/${group.id}`}
              className="card flex flex-col gap-2.5 p-4 transition-shadow hover:shadow-[var(--shadow-pop)]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Dot color={group.color} />
                  <h3 className="truncate text-[15px] font-semibold">{group.name}</h3>
                </div>
                {group.status === 'ARCHIVED' && (
                  <Badge tone="neutral">{t('groups.statusArchived')}</Badge>
                )}
              </div>

              {group.subject && <p className="text-[13px] text-ink-soft">{group.subject}</p>}

              <div className="flex flex-wrap gap-1.5">
                {group.weekdays.map((day) => (
                  <span key={day} className="rounded-[5px] bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-ink-soft">
                    {t(`weekdays.short${day}` as TKey)}
                  </span>
                ))}
                {group.startTime && (
                  <span className="tnum rounded-[5px] bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-ink-soft">
                    {group.startTime}–{group.endTime}
                  </span>
                )}
              </div>

              <div className="mt-auto flex items-end justify-between border-t border-line pt-2.5">
                <span className="text-[13px] text-ink-soft">
                  {t('groups.memberCount', { count: group._count.members })}
                </span>
                <span className="tnum text-[13px] font-semibold">
                  {money(group.monthlyFeeMinor, group.currency || org.defaultCurrency)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
