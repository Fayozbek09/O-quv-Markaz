'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { apiFetch } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { TextField, SelectField } from '@/components/ui/Field';
import { FormError } from '@/components/forms/AuthCard';
import type { TKey } from '@/lib/i18n';

type Group = { id: string; name: string; students: Array<{ id: string; name: string }> };

const SCHEMES = ['POINTS_100', 'POINTS_5', 'LETTER'] as const;
const LETTERS = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'E', 'F'];

/**
 * Grades a whole group in one pass. The scheme travels with the marks, so a
 * centre can switch to a different scale later without touching old rows.
 */
export function GradeDialog({ groups }: { groups: Group[] }) {
  const t = useT();
  const csrf = useCsrfToken();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '');
  const [scheme, setScheme] = useState<(typeof SCHEMES)[number]>('POINTS_100');
  const [title, setTitle] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});

  const group = groups.find((g) => g.id === groupId);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const entries = (group?.students ?? [])
      .filter((s) => (values[s.id] ?? '') !== '')
      .map((s) =>
        scheme === 'LETTER'
          ? { studentId: s.id, valueLetter: values[s.id] }
          : { studentId: s.id, valueNumeric: Number(values[s.id]) },
      );
    if (entries.length === 0) return;

    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/grades/bulk', {
        method: 'POST',
        csrfToken: csrf,
        body: {
          groupId,
          scheme,
          title: title || undefined,
          entries,
        },
      });
      setOpen(false);
      setValues({});
      setTitle('');
      router.refresh();
    } catch (err) {
      setError(messageFor(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {t('grades.bulk')}
      </Button>

      <Modal open={open} wide title={t('grades.bulk')} onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <FormError message={error} />

          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField label={t('nav.groups')} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              label={t('grades.scheme')}
              value={scheme}
              onChange={(e) => setScheme(e.target.value as (typeof SCHEMES)[number])}
            >
              {SCHEMES.map((s) => (
                <option key={s} value={s}>
                  {t(`grades.${s}` as TKey)}
                </option>
              ))}
            </SelectField>
            <TextField label={t('grades.gradeTitle')} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="max-h-[45vh] overflow-y-auto rounded-[var(--radius-field)] border border-line">
            <ul className="divide-y divide-line">
              {(group?.students ?? []).map((student) => (
                <li key={student.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-[13px]">{student.name}</span>
                  {scheme === 'LETTER' ? (
                    <select
                      value={values[student.id] ?? ''}
                      onChange={(e) => setValues({ ...values, [student.id]: e.target.value })}
                      aria-label={`${student.name} — ${t('grades.value')}`}
                      className="field h-9 w-24 text-[13px]"
                    >
                      <option value="">—</option>
                      {LETTERS.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      max={scheme === 'POINTS_5' ? 5 : 100}
                      value={values[student.id] ?? ''}
                      onChange={(e) => setValues({ ...values, [student.id]: e.target.value })}
                      aria-label={`${student.name} — ${t('grades.value')}`}
                      className="field tnum h-9 w-20 text-right text-[13px]"
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
