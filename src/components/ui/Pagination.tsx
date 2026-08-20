'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useT } from '@/lib/i18n/provider';

export function Pagination({
  page,
  perPage,
  total,
}: {
  page: number;
  perPage: number;
  total: number;
}) {
  const t = useT();
  const pathname = usePathname();
  const params = useSearchParams();
  const lastPage = Math.max(1, Math.ceil(total / perPage));
  if (total === 0) return null;

  const hrefFor = (target: number) => {
    const next = new URLSearchParams(params.toString());
    next.set('page', String(target));
    return `${pathname}?${next.toString()}`;
  };

  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  return (
    <nav
      aria-label={t('common.page')}
      className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-[13px] sm:px-5"
    >
      <p className="tnum text-ink-soft">
        {t('common.showing')} {from}–{to} {t('common.of')} {total}
      </p>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className="rounded-[6px] border border-line-strong px-2.5 py-1 hover:bg-surface-muted">
            {t('common.previous')}
          </Link>
        ) : (
          <span className="rounded-[6px] border border-line px-2.5 py-1 text-ink-faint">
            {t('common.previous')}
          </span>
        )}
        <span className="tnum px-2 text-ink-soft">
          {page} / {lastPage}
        </span>
        {page < lastPage ? (
          <Link href={hrefFor(page + 1)} className="rounded-[6px] border border-line-strong px-2.5 py-1 hover:bg-surface-muted">
            {t('common.next')}
          </Link>
        ) : (
          <span className="rounded-[6px] border border-line px-2.5 py-1 text-ink-faint">
            {t('common.next')}
          </span>
        )}
      </div>
    </nav>
  );
}
