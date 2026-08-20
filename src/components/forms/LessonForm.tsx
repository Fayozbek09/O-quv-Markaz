'use client';

import { useState, type FormEvent } from 'react';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { apiFetch } from '@/lib/client/api';
import { fieldErrorsFor, messageFor } from '@/lib/client/errors';
import { TextField, SelectField } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/forms/AuthCard';

export function LessonForm({
  groups,
  defaultDate,
  onDone,
  onCancel,
}: {
  groups: Array<{ id: string; name: string }>;
  defaultDate: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const csrf = useCsrfToken();
  const toast = useToast();

  const [groupId, setGroupId] = useState(groups[0]?.id ?? '');
  const [date, setDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('19:30');
  const [room, setRoom] = useState('');
  const [topic, setTopic] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await apiFetch('/api/lessons', {
        method: 'POST',
        csrfToken: csrf,
        body: {
          groupId,
          date,
          startTime,
          endTime,
          room: room || undefined,
          topic: topic || undefined,
        },
      });
      toast.push(t('lessons.created'), 'ok');
      onDone();
    } catch (err) {
      setError(messageFor(t, err));
      setFields(fieldErrorsFor(t, err));
    } finally {
      setBusy(false);
    }
  }

  if (groups.length === 0) {
    return <p className="text-[13px] text-ink-soft">{t('groups.emptyHint')}</p>;
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5" noValidate>
      <FormError message={error} />

      <SelectField label={t('lessons.group')} value={groupId} onChange={(e) => setGroupId(e.target.value)} required>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>{g.name}</option>
        ))}
      </SelectField>

      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label={t('lessons.date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} error={fields.date} required />
        <TextField label={t('lessons.startTime')} type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} error={fields.startTime} required />
        <TextField label={t('lessons.endTime')} type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} error={fields.endTime} required />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t('lessons.room')} value={room} onChange={(e) => setRoom(e.target.value)} maxLength={80} />
        <TextField label={t('lessons.topic')} value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={200} />
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
