'use client';

import { useState, type FormEvent } from 'react';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { apiFetch } from '@/lib/client/api';
import { fieldErrorsFor, messageFor } from '@/lib/client/errors';
import { TextField } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/forms/AuthCard';

/** Minimal student form used in onboarding and in the "+ Student" quick action. */
export function StudentQuickForm({
  onCreated,
  onSkip,
  onCancel,
}: {
  onCreated: (id: string) => void;
  onSkip?: () => void;
  onCancel?: () => void;
}) {
  const t = useT();
  const csrf = useCsrfToken();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [parentName, setParentName] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const created = await apiFetch<{ id: string }>('/api/students', {
        method: 'POST',
        csrfToken: csrf,
        body: {
          firstName,
          lastName: lastName || undefined,
          phone: phone || undefined,
          parentName: parentName || undefined,
          parentPhone: parentPhone || undefined,
          status: 'ACTIVE',
        },
      });
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
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t('students.firstName')} value={firstName} onChange={(e) => setFirstName(e.target.value)} error={fields.firstName} required autoFocus maxLength={80} />
        <TextField label={t('students.lastName')} value={lastName} onChange={(e) => setLastName(e.target.value)} error={fields.lastName} maxLength={80} />
      </div>
      <TextField label={t('students.phone')} value={phone} onChange={(e) => setPhone(e.target.value)} error={fields.phone} type="tel" placeholder="+998 90 123 45 67" />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t('students.parentName')} value={parentName} onChange={(e) => setParentName(e.target.value)} error={fields.parentName} maxLength={160} />
        <TextField label={t('students.parentPhone')} value={parentPhone} onChange={(e) => setParentPhone(e.target.value)} error={fields.parentPhone} type="tel" />
      </div>

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
        <Button type="submit" size="lg" fullWidth disabled={busy || firstName.trim().length < 1}>
          {busy ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </form>
  );
}
