'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { StudentQuickForm } from '@/components/forms/StudentQuickForm';
import { CsvImportDialog } from './CsvImportDialog';
import { PageHeader } from '@/components/layout/PageHeader';

export function StudentsToolbar({
  query,
  usage,
  openNew,
}: {
  query: { q: string; status: string };
  usage: { used: number; limit: number | null };
  openNew: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [search, setSearch] = useState(query.q);
  const [newOpen, setNewOpen] = useState(openNew);
  const [importOpen, setImportOpen] = useState(false);

  // Debounced navigation so typing does not fire a request per keystroke.
  useEffect(() => {
    if (search === query.q) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (search) next.set('q', search);
      else next.delete('q');
      next.delete('page');
      next.delete('new');
      router.replace(`${pathname}?${next.toString()}`);
    }, 350);
    return () => clearTimeout(timer);
  }, [search, query.q, params, pathname, router]);

  function setStatus(status: string) {
    const next = new URLSearchParams(params.toString());
    next.set('status', status);
    next.delete('page');
    router.replace(`${pathname}?${next.toString()}`);
  }

  const statuses = [
    ['ACTIVE', t('students.statusActive')],
    ['PAUSED', t('students.statusPaused')],
    ['ARCHIVED', t('students.statusArchived')],
    ['ALL', t('common.all')],
  ] as const;

  return (
    <>
      <PageHeader
        title={t('students.title')}
        subtitle={
          usage.limit === null
            ? undefined
            : t('settings.studentUsage', { used: usage.used, limit: usage.limit })
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              {t('common.import')} CSV
            </Button>
            <Button onClick={() => setNewOpen(true)}>+ {t('students.add')}</Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <label htmlFor="student-search" className="sr-only">
            {t('common.search')}
          </label>
          <input
            id="student-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('students.searchPlaceholder')}
            className="field pl-9"
          />
          <svg viewBox="0 0 20 20" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" fill="none" aria-hidden="true">
            <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="m13.5 13.5 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </div>

        <div className="flex rounded-[var(--radius-field)] border border-line-strong bg-surface p-0.5">
          {statuses.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatus(value)}
              aria-pressed={query.status === value}
              className={
                query.status === value
                  ? 'rounded-[6px] bg-brand-500 px-2.5 py-1 text-[12px] font-medium text-white'
                  : 'rounded-[6px] px-2.5 py-1 text-[12px] font-medium text-ink-soft hover:bg-surface-muted'
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title={t('students.add')}>
        <StudentQuickForm
          onCreated={() => { setNewOpen(false); router.refresh(); }}
          onCancel={() => setNewOpen(false)}
        />
      </Modal>

      <CsvImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}
