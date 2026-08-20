'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { apiFetch } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Dot } from '@/components/ui/Badge';
import { FormError } from '@/components/forms/AuthCard';

type Status = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';
type Row = { id: string; name: string; status: Status | null; minutesLate: number | null };

const ORDER: Status[] = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];

export function AttendanceSheet({
  lessonId,
  groupName,
  groupColor,
  when,
  students,
}: {
  lessonId: string;
  groupName: string;
  groupColor: string;
  when: string;
  students: Row[];
}) {
  const t = useT();
  const csrf = useCsrfToken();
  const router = useRouter();
  const toast = useToast();

  const [rows, setRows] = useState<Row[]>(students);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const labels: Record<Status, string> = {
    PRESENT: t('attendance.present'),
    ABSENT: t('attendance.absent'),
    LATE: t('attendance.late'),
    EXCUSED: t('attendance.excused'),
  };
  const styles: Record<Status, string> = {
    PRESENT: 'bg-ok-600 text-white border-ok-600',
    ABSENT: 'bg-danger-600 text-white border-danger-600',
    LATE: 'bg-warn-600 text-white border-warn-600',
    EXCUSED: 'bg-ink-soft text-white border-ink-soft',
  };

  const setStatus = (id: string, status: Status) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));

  const markAllPresent = () => setRows((prev) => prev.map((r) => ({ ...r, status: 'PRESENT' })));

  const counts = ORDER.reduce<Record<Status, number>>(
    (acc, status) => ({ ...acc, [status]: rows.filter((r) => r.status === status).length }),
    { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 },
  );

  async function save() {
    const entries = rows
      .filter((r) => r.status !== null)
      .map((r) => ({
        studentId: r.id,
        status: r.status as Status,
        minutesLate: r.status === 'LATE' ? (r.minutesLate ?? undefined) : undefined,
      }));

    if (entries.length === 0) return;

    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/attendance', {
        method: 'POST',
        csrfToken: csrf,
        body: { lessonId, entries },
      });
      toast.push(t('attendance.saved'), 'ok');
      router.refresh();
    } catch (err) {
      setError(messageFor(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Dot color={groupColor} />
            {groupName}
          </span>
        }
        subtitle={when}
        action={
          <Button variant="secondary" onClick={markAllPresent}>
            {t('attendance.markAllPresent')}
          </Button>
        }
      />

      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-ink-soft">{t('students.empty')}</p>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 sm:px-5">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.name}</span>

                <div role="group" aria-label={row.name} className="flex flex-wrap gap-1">
                  {ORDER.map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setStatus(row.id, status)}
                      aria-pressed={row.status === status}
                      className={
                        row.status === status
                          ? `rounded-[var(--radius-field)] border px-2.5 py-1 text-[12px] font-medium ${styles[status]}`
                          : 'rounded-[var(--radius-field)] border border-line-strong px-2.5 py-1 text-[12px] font-medium text-ink-soft hover:bg-surface-muted'
                      }
                    >
                      {labels[status]}
                    </button>
                  ))}
                </div>

                {row.status === 'LATE' && (
                  <label className="flex items-center gap-1.5 text-[12px] text-ink-soft">
                    <span className="sr-only sm:not-sr-only">{t('attendance.minutesLate')}</span>
                    <input
                      type="number"
                      min={0}
                      max={600}
                      value={row.minutesLate ?? ''}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((r) =>
                            r.id === row.id
                              ? { ...r, minutesLate: e.target.value ? Number(e.target.value) : null }
                              : r,
                          ),
                        )
                      }
                      className="field h-8 w-16 py-0 text-center tabular-nums"
                    />
                  </label>
                )}
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5">
            <p className="text-[13px] text-ink-soft">
              {t('attendance.summary', {
                present: counts.PRESENT,
                absent: counts.ABSENT,
                late: counts.LATE,
                excused: counts.EXCUSED,
              })}
            </p>
            <div className="flex items-center gap-3">
              <FormError message={error} />
              <Button onClick={() => void save()} disabled={busy || rows.every((r) => r.status === null)}>
                {busy ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
