'use client';

import { useState, type FormEvent } from 'react';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { apiFetch } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';
import { TextField, SelectField } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/forms/AuthCard';
import type { TKey } from '@/lib/i18n';

export function GenerateInvoicesForm({
  groups,
  onDone,
  onCancel,
}: {
  groups: Array<{ id: string; name: string }>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const csrf = useCsrfToken();
  const toast = useToast();
  const now = new Date();

  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [groupId, setGroupId] = useState('');
  const [dueDay, setDueDay] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ created: number }>('/api/invoices', {
        method: 'POST',
        csrfToken: csrf,
        body: { year, month, groupId: groupId || undefined, dueDay },
      });
      toast.push(t('payments.invoicesGenerated', { count: result.created }), 'ok');
      onDone();
    } catch (err) {
      setError(messageFor(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5" noValidate>
      <FormError message={error} />
      <p className="text-[13px] text-ink-soft">{t('payments.generateInvoicesHint')}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label={t('common.month')} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {t(`months.m${m}` as TKey)}
            </option>
          ))}
        </SelectField>
        <TextField
          label={t('reports.period')}
          type="number"
          value={year}
          min={2020}
          max={2100}
          onChange={(e) => setYear(Number(e.target.value))}
          required
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label={t('payments.group')} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">{t('common.all')}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </SelectField>
        <TextField
          label={t('payments.dueDate')}
          type="number"
          min={1}
          max={28}
          value={dueDay}
          onChange={(e) => setDueDay(Number(e.target.value))}
          required
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? t('common.saving') : t('common.create')}
        </Button>
      </div>
    </form>
  );
}
