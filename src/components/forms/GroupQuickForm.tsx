'use client';

import { useState, type FormEvent } from 'react';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { apiFetch } from '@/lib/client/api';
import { fieldErrorsFor, messageFor } from '@/lib/client/errors';
import { TextField } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/forms/AuthCard';
import { WeekdayPicker } from '@/components/forms/WeekdayPicker';
import { MoneyField } from '@/components/forms/MoneyField';

export function GroupQuickForm({
  studentIdToAdd,
  onCreated,
  onSkip,
  onCancel,
}: {
  studentIdToAdd?: string | null;
  onCreated: (id: string) => void;
  onSkip?: () => void;
  onCancel?: () => void;
}) {
  const t = useT();
  const csrf = useCsrfToken();
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([1, 3, 5]);
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('19:30');
  const [fee, setFee] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const created = await apiFetch<{ id: string }>('/api/groups', {
        method: 'POST',
        csrfToken: csrf,
        body: {
          name,
          subject: subject || undefined,
          weekdays,
          startTime,
          endTime,
          monthlyFee: fee.replace(/\s/g, '') || '0',
          status: 'ACTIVE',
        },
      });

      if (studentIdToAdd) {
        await apiFetch(`/api/groups/${created.id}/members`, {
          method: 'POST',
          csrfToken: csrf,
          body: { studentId: studentIdToAdd },
        });
      }
      onCreated(created.id);
    } catch (err) {
      setError(messageFor(t, err));
      setFields(fieldErrorsFor(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5" noValidate>
      <FormError message={error} />

      <TextField label={t('groups.name')} value={name} onChange={(e) => setName(e.target.value)} error={fields.name} placeholder={t('groups.namePlaceholder')} required autoFocus maxLength={120} />
      <TextField label={t('groups.subject')} value={subject} onChange={(e) => setSubject(e.target.value)} error={fields.subject} maxLength={120} />

      <WeekdayPicker value={weekdays} onChange={setWeekdays} label={t('groups.weekdays')} />

      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t('groups.startTime')} type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} error={fields.startTime} required />
        <TextField label={t('groups.endTime')} type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} error={fields.endTime} required />
      </div>

      <MoneyField label={t('groups.monthlyFee')} value={fee} onChange={setFee} error={fields.monthlyFee} />

      <div className="flex gap-2">
        {onSkip && (
          <Button type="button" variant="secondary" size="lg" onClick={onSkip}>
            {t('common.skip')}
          </Button>
        )}
        {onCancel && (
          <Button type="button" variant="secondary" size="lg" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        )}
        <Button type="submit" size="lg" fullWidth disabled={busy || name.trim().length < 1}>
          {busy ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </form>
  );
}
