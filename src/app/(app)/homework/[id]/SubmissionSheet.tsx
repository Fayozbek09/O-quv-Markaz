'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { apiFetch } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';
import { useToast } from '@/components/providers/ToastProvider';
import { Button } from '@/components/ui/Button';
import { TableWrap, Th, Td } from '@/components/ui/Table';
import type { TKey } from '@/lib/i18n';

type Row = {
  studentId: string;
  name: string;
  status: string;
  score: number | null;
  feedback: string | null;
};

const STATUSES = ['ASSIGNED', 'SUBMITTED', 'LATE', 'MISSING', 'GRADED'] as const;

/** Marks a whole group's submissions in one request. */
export function SubmissionSheet({
  homeworkId,
  maxScore,
  canGrade,
  rows: initial,
}: {
  homeworkId: string;
  maxScore: number | null;
  canGrade: boolean;
  rows: Row[];
}) {
  const t = useT();
  const csrf = useCsrfToken();
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState(false);

  function update(studentId: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.studentId === studentId ? { ...r, ...patch } : r)));
  }

  async function save() {
    setBusy(true);
    try {
      await apiFetch(`/api/homework/${homeworkId}/submissions`, {
        method: 'PUT',
        csrfToken: csrf,
        body: {
          entries: rows.map((r) => ({
            studentId: r.studentId,
            status: r.status,
            score: r.score ?? undefined,
            feedback: r.feedback || undefined,
          })),
        },
      });
      toast.push(t('common.saved'), 'ok');
      router.refresh();
    } catch (err) {
      toast.push(messageFor(t, err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TableWrap>
        <thead>
          <tr>
            <Th>{t('common.name')}</Th>
            <Th>{t('common.status')}</Th>
            <Th className="text-right">{t('homework.score')}</Th>
            <Th>{t('homework.feedback')}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.studentId}>
              <Td className="text-sm font-medium">{row.name}</Td>
              <Td>
                <select
                  value={row.status}
                  disabled={!canGrade}
                  onChange={(e) => update(row.studentId, { status: e.target.value })}
                  aria-label={`${row.name} — ${t('common.status')}`}
                  className="field h-9 w-36 text-[13px]"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`homework.${s}` as TKey)}
                    </option>
                  ))}
                </select>
              </Td>
              <Td className="text-right">
                <input
                  type="number"
                  min={0}
                  max={maxScore ?? 1000}
                  value={row.score ?? ''}
                  disabled={!canGrade}
                  onChange={(e) =>
                    update(row.studentId, { score: e.target.value === '' ? null : Number(e.target.value) })
                  }
                  aria-label={`${row.name} — ${t('homework.score')}`}
                  className="field tnum h-9 w-20 text-right text-[13px]"
                />
              </Td>
              <Td>
                <input
                  type="text"
                  value={row.feedback ?? ''}
                  disabled={!canGrade}
                  onChange={(e) => update(row.studentId, { feedback: e.target.value })}
                  aria-label={`${row.name} — ${t('homework.feedback')}`}
                  className="field h-9 w-full text-[13px]"
                />
              </Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {canGrade && (
        <div className="flex justify-end border-t border-line px-4 py-3 sm:px-5">
          <Button type="button" onClick={() => void save()} disabled={busy}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      )}
    </>
  );
}
