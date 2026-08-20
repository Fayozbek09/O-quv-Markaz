'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { apiFetch } from '@/lib/client/api';
import { fieldErrorsFor, messageFor } from '@/lib/client/errors';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { TextField, SelectField } from '@/components/ui/Field';
import { FormError } from '@/components/forms/AuthCard';
import { WeekdayPicker } from '@/components/forms/WeekdayPicker';
import { MoneyField } from '@/components/forms/MoneyField';

type Initial = {
  name: string;
  subject: string | null;
  weekdays: number[];
  startTime: string | null;
  endTime: string | null;
  room: string | null;
  color: string;
  monthlyFee: string;
  currency: string;
  status: 'ACTIVE' | 'ARCHIVED';
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const inDaysIso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

export function GroupDetailActions({
  groupId,
  availableStudents,
  initial,
}: {
  groupId: string;
  availableStudents: Array<{ id: string; name: string }>;
  initial: Initial;
}) {
  const t = useT();
  const router = useRouter();
  const csrf = useCsrfToken();
  const toast = useToast();

  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [form, setForm] = useState<Initial>(initial);
  const [studentId, setStudentId] = useState(availableStudents[0]?.id ?? '');
  const [feeOverride, setFeeOverride] = useState('');
  const [from, setFrom] = useState(todayIso());
  const [until, setUntil] = useState(inDaysIso(30));
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof Initial>(key: K, value: Initial[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function run(action: () => Promise<void>, successKey: Parameters<typeof t>[0]) {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await action();
      toast.push(t(successKey), 'ok');
      router.refresh();
    } catch (err) {
      setError(messageFor(t, err));
      setFields(fieldErrorsFor(t, err));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      await run(async () => {
        await apiFetch(`/api/groups/${groupId}`, {
          method: 'PUT',
          csrfToken: csrf,
          body: {
            name: form.name,
            subject: form.subject || undefined,
            weekdays: form.weekdays,
            startTime: form.startTime || undefined,
            endTime: form.endTime || undefined,
            room: form.room || undefined,
            color: form.color,
            monthlyFee: form.monthlyFee.replace(/\s/g, ''),
            currency: form.currency,
            status: form.status,
          },
        });
        setEditOpen(false);
      }, 'groups.updated');
    } catch {
      /* message already shown */
    }
  }

  async function addMember(event: FormEvent) {
    event.preventDefault();
    try {
      await run(async () => {
        await apiFetch(`/api/groups/${groupId}/members`, {
          method: 'POST',
          csrfToken: csrf,
          body: { studentId, feeOverride: feeOverride.replace(/\s/g, '') || undefined },
        });
        setAddOpen(false);
        setFeeOverride('');
      }, 'common.saved');
    } catch {
      /* message already shown */
    }
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    try {
      let created = 0;
      await run(async () => {
        const result = await apiFetch<{ created: number }>(`/api/groups/${groupId}`, {
          method: 'POST',
          csrfToken: csrf,
          body: { from, until },
        });
        created = result.created;
        setGenOpen(false);
      }, 'common.saved');
      toast.push(t('groups.generated', { count: created }), 'ok');
    } catch {
      /* message already shown */
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => setGenOpen(true)}>
        {t('groups.generateLessons')}
      </Button>
      <Button variant="secondary" onClick={() => setAddOpen(true)} disabled={availableStudents.length === 0}>
        + {t('groups.addMember')}
      </Button>
      <Button onClick={() => setEditOpen(true)}>{t('common.edit')}</Button>

      {/* edit */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={t('groups.edit')} wide>
        <form onSubmit={save} className="flex flex-col gap-3.5" noValidate>
          <FormError message={error} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={t('groups.name')} value={form.name} onChange={(e) => set('name', e.target.value)} error={fields.name} required maxLength={120} />
            <TextField label={t('groups.subject')} value={form.subject ?? ''} onChange={(e) => set('subject', e.target.value)} maxLength={120} />
          </div>

          <WeekdayPicker value={form.weekdays} onChange={(v) => set('weekdays', v)} label={t('groups.weekdays')} />

          <div className="grid gap-3 sm:grid-cols-3">
            <TextField label={t('groups.startTime')} type="time" value={form.startTime ?? ''} onChange={(e) => set('startTime', e.target.value)} error={fields.startTime} />
            <TextField label={t('groups.endTime')} type="time" value={form.endTime ?? ''} onChange={(e) => set('endTime', e.target.value)} error={fields.endTime} />
            <TextField label={t('groups.room')} value={form.room ?? ''} onChange={(e) => set('room', e.target.value)} maxLength={80} />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <MoneyField label={t('groups.monthlyFee')} value={form.monthlyFee} onChange={(v) => set('monthlyFee', v)} currency={form.currency} error={fields.monthlyFee} />
            <TextField label={t('groups.color')} type="color" value={form.color} onChange={(e) => set('color', e.target.value)} className="[&_input]:h-9 [&_input]:p-1" />
            <SelectField label={t('common.status')} value={form.status} onChange={(e) => set('status', e.target.value as Initial['status'])}>
              <option value="ACTIVE">{t('groups.statusActive')}</option>
              <option value="ARCHIVED">{t('groups.statusArchived')}</option>
            </SelectField>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* add member */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title={t('groups.addMember')}>
        <form onSubmit={addMember} className="flex flex-col gap-3.5" noValidate>
          <FormError message={error} />
          <SelectField label={t('students.one')} value={studentId} onChange={(e) => setStudentId(e.target.value)} required>
            {availableStudents.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </SelectField>
          <MoneyField
            label={t('groups.feeOverride')}
            value={feeOverride}
            onChange={setFeeOverride}
            currency={form.currency}
            hint={t('groups.feeOverrideHint')}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setAddOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy || !studentId}>
              {t('common.add')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* generate lessons */}
      <Modal open={genOpen} onClose={() => setGenOpen(false)} title={t('groups.generateLessons')}>
        <form onSubmit={generate} className="flex flex-col gap-3.5" noValidate>
          <FormError message={error} />
          <p className="text-[13px] text-ink-soft">{t('groups.generateHint')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={t('common.from')} type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
            <TextField label={t('common.to')} type="date" value={until} onChange={(e) => setUntil(e.target.value)} required />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setGenOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? t('common.saving') : t('common.create')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
