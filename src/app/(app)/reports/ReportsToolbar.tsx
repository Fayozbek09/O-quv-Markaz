'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useT } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/layout/PageHeader';
import type { TKey } from '@/lib/i18n';

export function ReportsToolbar({
  year,
  month,
  groupId,
  groups,
}: {
  year: number;
  month: number;
  groupId: string;
  groups: Array<{ id: string; name: string }>;
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function navigate(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    router.replace(`${pathname}?${next.toString()}`);
  }

  const csvHref = `/api/reports?year=${year}&month=${month}${groupId ? `&groupId=${groupId}` : ''}&format=csv`;
  // Month names come from the dictionary, not from Intl: Chromium's ICU data
  // for uz-UZ is incomplete and renders "M08" instead of "Avgust".
  const monthName = (m: number) => t(`months.m${m}` as TKey);

  return (
    <>
      <PageHeader
        title={t('reports.title')}
        actions={
          <>
            {/* Server-rendered CSV: no client-side blob, so it works with a strict CSP. */}
            <a
              href={csvHref}
              className="inline-flex h-9 items-center rounded-[var(--radius-field)] border border-line-strong bg-surface px-4 text-sm font-medium hover:bg-surface-muted"
            >
              {t('reports.exportCsv')}
            </a>
            <PrintButton label={t('reports.print')} />
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2 no-print">
        <label className="sr-only" htmlFor="report-month">{t('common.month')}</label>
        <select
          id="report-month"
          value={month}
          onChange={(e) => navigate({ month: e.target.value })}
          className="field h-9 w-auto"
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>{monthName(m)}</option>
          ))}
        </select>

        <label className="sr-only" htmlFor="report-year">{t('reports.period')}</label>
        <select
          id="report-year"
          value={year}
          onChange={(e) => navigate({ year: e.target.value })}
          className="field h-9 w-auto"
        >
          {Array.from({ length: 6 }, (_, i) => new Date().getUTCFullYear() - 3 + i).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>

        <label className="sr-only" htmlFor="report-group">{t('groups.title')}</label>
        <select
          id="report-group"
          value={groupId}
          onChange={(e) => navigate({ groupId: e.target.value || null })}
          className="field h-9 w-auto"
        >
          <option value="">{t('calendar.allGroups')}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </div>
    </>
  );
}

function PrintButton({ label }: { label: string }) {
  return (
    <Button variant="secondary" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
