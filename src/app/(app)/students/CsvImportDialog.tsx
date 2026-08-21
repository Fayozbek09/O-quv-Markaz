'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { apiFetch } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/forms/AuthCard';
import { CSV_TEMPLATE } from '@/lib/domain/csv';
import type { TKey } from '@/lib/i18n';

type PreviewRow = {
  line: number;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  parentName: string | null;
  errors: string[];
  duplicate: boolean;
};

type Preview = {
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
  rows: PreviewRow[];
};

const MAX_FILE_BYTES = 512 * 1024;

export function CsvImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const csrf = useCsrfToken();
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setCsv('');
    setPreview(null);
    setError(null);
    onClose();
  }

  async function loadFile(file: File) {
    setError(null);
    if (file.size > MAX_FILE_BYTES) {
      setError(t('errors.fileTooLarge', { max: '512 KB' }));
      return;
    }
    const text = await file.text();
    setCsv(text);
    await runPreview(text);
  }

  async function runPreview(text: string) {
    setBusy(true);
    setError(null);
    try {
      setPreview(
        await apiFetch<Preview>('/api/students/import', {
          method: 'POST',
          csrfToken: csrf,
          body: { csv: text, commit: false },
        }),
      );
    } catch (err) {
      setError(messageFor(t, err));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ created: number }>('/api/students/import', {
        method: 'POST',
        csrfToken: csrf,
        body: { csv, commit: true },
      });
      toast.push(t('students.importDone', { count: result.created }), 'ok');
      reset();
      router.refresh();
    } catch (err) {
      setError(messageFor(t, err));
    } finally {
      setBusy(false);
    }
  }

  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(CSV_TEMPLATE)}`;

  return (
    <Modal open={open} onClose={reset} title={t('students.importTitle')} wide>
      <div className="flex flex-col gap-4">
        <FormError message={error} />

        <p className="text-[13px] text-ink-soft">{t('students.importHint')}</p>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void loadFile(file);
              e.target.value = '';
            }}
          />
          <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={busy}>
            {t('common.upload')} CSV
          </Button>
          <a
            href={templateHref}
            download="oquv-markaz-students-template.csv"
            className="text-[13px] text-brand-600 hover:underline"
          >
            {t('students.downloadTemplate')}
          </a>
        </div>

        {preview && (
          <>
            <div className="flex flex-wrap gap-2 text-[13px]">
              <span className="rounded-full border border-ok-50 bg-ok-50 px-2.5 py-1 font-medium text-ok-600">
                {t('students.importValid', { count: preview.valid })}
              </span>
              {preview.invalid > 0 && (
                <span className="rounded-full border border-danger-50 bg-danger-50 px-2.5 py-1 font-medium text-danger-600">
                  {t('students.importInvalid', { count: preview.invalid })}
                </span>
              )}
              {preview.duplicates > 0 && (
                <span className="rounded-full border border-warn-50 bg-warn-50 px-2.5 py-1 font-medium text-warn-600">
                  {t('students.importDuplicates', { count: preview.duplicates })}
                </span>
              )}
            </div>

            <div className="max-h-64 overflow-auto rounded-[var(--radius-field)] border border-line">
              <table className="w-full min-w-[520px] text-[13px]">
                <thead className="sticky top-0 bg-surface-muted">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium text-ink-faint">#</th>
                    <th className="px-2 py-1.5 text-left font-medium text-ink-faint">{t('common.name')}</th>
                    <th className="px-2 py-1.5 text-left font-medium text-ink-faint">{t('students.phone')}</th>
                    <th className="px-2 py-1.5 text-left font-medium text-ink-faint">{t('students.parentName')}</th>
                    <th className="px-2 py-1.5 text-left font-medium text-ink-faint">{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.line} className="border-t border-line">
                      <td className="tnum px-2 py-1.5 text-ink-faint">{row.line}</td>
                      <td className="px-2 py-1.5">{[row.firstName, row.lastName].filter(Boolean).join(' ')}</td>
                      <td className="tnum px-2 py-1.5 text-ink-soft">{row.phone ?? '—'}</td>
                      <td className="px-2 py-1.5 text-ink-soft">{row.parentName ?? '—'}</td>
                      <td className="px-2 py-1.5">
                        {row.errors.length > 0 ? (
                          <span className="text-danger-600">{t(row.errors[0] as TKey)}</span>
                        ) : row.duplicate ? (
                          <span className="text-warn-600">{t('students.importDuplicates', { count: 1 })}</span>
                        ) : (
                          <span className="text-ok-600">OK</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={reset}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => void commit()} disabled={busy || preview.valid === 0}>
                {t('students.importConfirm', { count: preview.valid })}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
