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
import { TextField, TextAreaField, SelectField } from '@/components/ui/Field';
import { FormError } from '@/components/forms/AuthCard';
import { ReminderDialog } from '@/components/forms/ReminderDialog';

type Initial = {
  firstName: string;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  birthDate: string | null;
  notes: string | null;
  status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
  parentName: string | null;
  parentPhone: string | null;
};

export function StudentDetailActions({
  studentId,
  studentName,
  hasDebt,
  parentLinked,
  initial,
}: {
  studentId: string;
  studentName: string;
  hasDebt: boolean;
  parentLinked: boolean;
  initial: Initial;
}) {
  const t = useT();
  const router = useRouter();
  const csrf = useCsrfToken();
  const toast = useToast();

  const [editOpen, setEditOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof Initial>(key: K, value: Initial[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await apiFetch(`/api/students/${studentId}`, {
        method: 'PUT',
        csrfToken: csrf,
        body: {
          firstName: form.firstName,
          lastName: form.lastName || undefined,
          phone: form.phone || undefined,
          email: form.email || undefined,
          birthDate: form.birthDate || undefined,
          notes: form.notes || undefined,
          status: form.status,
          parentName: form.parentName || undefined,
          parentPhone: form.parentPhone || undefined,
        },
      });
      toast.push(t('students.updated'), 'ok');
      setEditOpen(false);
      router.refresh();
    } catch (err) {
      setError(messageFor(t, err));
      setFields(fieldErrorsFor(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {hasDebt && (
        <Button variant="secondary" onClick={() => setReminderOpen(true)}>
          {t('debt.sendReminder')}
        </Button>
      )}
      <Button onClick={() => setEditOpen(true)}>{t('common.edit')}</Button>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={t('students.edit')} wide>
        <form onSubmit={save} className="flex flex-col gap-3.5" noValidate>
          <FormError message={error} />

          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={t('students.firstName')} value={form.firstName} onChange={(e) => set('firstName', e.target.value)} error={fields.firstName} required maxLength={80} />
            <TextField label={t('students.lastName')} value={form.lastName ?? ''} onChange={(e) => set('lastName', e.target.value)} error={fields.lastName} maxLength={80} />
            <TextField label={t('students.phone')} value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} error={fields.phone} type="tel" />
            <TextField label={t('students.email')} value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} error={fields.email} type="email" />
            <TextField label={t('students.birthDate')} value={form.birthDate ?? ''} onChange={(e) => set('birthDate', e.target.value)} error={fields.birthDate} type="date" />
            <SelectField label={t('students.status')} value={form.status} onChange={(e) => set('status', e.target.value as Initial['status'])}>
              <option value="ACTIVE">{t('students.statusActive')}</option>
              <option value="PAUSED">{t('students.statusPaused')}</option>
              <option value="ARCHIVED">{t('students.statusArchived')}</option>
            </SelectField>
            <TextField label={t('students.parentName')} value={form.parentName ?? ''} onChange={(e) => set('parentName', e.target.value)} error={fields.parentName} maxLength={160} />
            <TextField label={t('students.parentPhone')} value={form.parentPhone ?? ''} onChange={(e) => set('parentPhone', e.target.value)} error={fields.parentPhone} type="tel" />
          </div>

          <TextAreaField label={t('students.notes')} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} error={fields.notes} maxLength={2000} rows={3} />

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

      <ReminderDialog
        open={reminderOpen}
        onClose={() => setReminderOpen(false)}
        studentId={studentId}
        studentName={studentName}
        parentLinked={parentLinked}
      />
    </div>
  );
}
