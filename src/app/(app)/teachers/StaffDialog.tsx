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
import { CredentialsPanel, type IssuedCredentials } from '@/components/forms/CredentialsPanel';

/**
 * Creates a teacher or receptionist.
 *
 * The account's username and first password are generated on the server; this
 * form can suggest a username but cannot set a password, and the one it gets
 * back is displayed once and never stored anywhere the app can read again.
 */
export function StaffDialog({ canCreateAdmin }: { canCreateAdmin: boolean }) {
  const t = useT();
  const csrf = useCsrfToken();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedCredentials | null>(null);
  const [form, setForm] = useState({
    firstName: '', lastName: '', role: 'TEACHER', phone: '', email: '',
    username: '', subject: '', specialization: '', hireDate: '',
    salaryModel: 'FIXED', salaryAmount: '0', salaryPercent: '0',
  });

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ credentials: IssuedCredentials }>('/api/staff', {
        method: 'POST',
        csrfToken: csrf,
        body: {
          firstName: form.firstName,
          lastName: form.lastName || undefined,
          role: form.role,
          phone: form.phone || undefined,
          email: form.email || undefined,
          username: form.username || undefined,
          subject: form.subject || undefined,
          specialization: form.specialization || undefined,
          hireDate: form.hireDate || undefined,
          salaryModel: form.salaryModel,
          salaryAmount: form.salaryAmount || '0',
          salaryPercent: Number(form.salaryPercent) || 0,
        },
      });
      setIssued(result.credentials);
      router.refresh();
    } catch (err) {
      setError(messageFor(t, err));
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setIssued(null);
    setError(null);
  }

  const isTeacher = form.role === 'TEACHER';

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {t('staff.addStaff')}
      </Button>

      <Modal
        open={open}
        wide
        title={issued ? t('staff.credentialsTitle') : t('staff.addStaff')}
        onClose={close}
      >
        {issued ? (
          <CredentialsPanel credentials={issued} onDone={close} />
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <FormError message={error} />

            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label={t('staff.firstName')} value={form.firstName} onChange={set('firstName')} required autoFocus />
              <TextField label={t('staff.lastName')} value={form.lastName} onChange={set('lastName')} />
            </div>

            <SelectField label={t('staff.role')} value={form.role} onChange={set('role')}>
              <option value="TEACHER">{t('roles.TEACHER')}</option>
              <option value="RECEPTIONIST">{t('roles.RECEPTIONIST')}</option>
              {canCreateAdmin && <option value="ADMIN">{t('roles.ADMIN')}</option>}
            </SelectField>

            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label={t('center.phone')} value={form.phone} onChange={set('phone')} />
              <TextField label={t('center.email')} value={form.email} onChange={set('email')} type="email" />
            </div>

            <TextField
              label={t('staff.username')}
              value={form.username}
              onChange={set('username')}
              hint={t('common.optional')}
            />

            {isTeacher && (
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label={t('staff.subject')} value={form.subject} onChange={set('subject')} />
                <TextField label={t('staff.specialization')} value={form.specialization} onChange={set('specialization')} />
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <TextField label={t('staff.hireDate')} value={form.hireDate} onChange={set('hireDate')} type="date" />
              <SelectField label={t('salary.model')} value={form.salaryModel} onChange={set('salaryModel')}>
                <option value="FIXED">{t('salary.FIXED')}</option>
                <option value="PER_LESSON">{t('salary.PER_LESSON')}</option>
                <option value="PERCENTAGE">{t('salary.PERCENTAGE')}</option>
                <option value="MIXED">{t('salary.MIXED')}</option>
              </SelectField>
              {form.salaryModel === 'PERCENTAGE' ? (
                <TextField label={t('salary.percent')} value={form.salaryPercent} onChange={set('salaryPercent')} inputMode="numeric" />
              ) : (
                <TextField label={t('salary.amount')} value={form.salaryAmount} onChange={set('salaryAmount')} inputMode="numeric" />
              )}
            </div>

            <div className="mt-1 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={close}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? t('common.saving') : t('common.create')}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
