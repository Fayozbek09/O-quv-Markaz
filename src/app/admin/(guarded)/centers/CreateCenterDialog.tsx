'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { apiFetch } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { FormError } from '@/components/forms/AuthCard';
import { CredentialsPanel, type IssuedCredentials } from '@/components/forms/CredentialsPanel';

/** Creates a centre and its owner account, then shows the credentials once. */
export function CreateCenterDialog() {
  const t = useT();
  const csrf = useCsrfToken();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedCredentials | null>(null);
  const [form, setForm] = useState({
    centerName: '', city: '', district: '', phone: '', email: '',
    ownerFirstName: '', ownerLastName: '', ownerUsername: '',
  });

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ credentials: IssuedCredentials }>('/api/admin/centers', {
        method: 'POST',
        csrfToken: csrf,
        body: {
          centerName: form.centerName,
          city: form.city,
          district: form.district || undefined,
          phone: form.phone,
          email: form.email || undefined,
          ownerFirstName: form.ownerFirstName,
          ownerLastName: form.ownerLastName || undefined,
          ownerUsername: form.ownerUsername || undefined,
          courses: [],
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
    setForm({
      centerName: '', city: '', district: '', phone: '', email: '',
      ownerFirstName: '', ownerLastName: '', ownerUsername: '',
    });
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} size="sm">
        {t('admin.addCenter')}
      </Button>

      <Modal
        open={open}
        title={issued ? t('admin.ownerCredentials') : t('admin.addCenter')}
        onClose={close}
      >
          {issued ? (
            <CredentialsPanel credentials={issued} onDone={close} />
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-3">
              <FormError message={error} />
              <TextField label={t('center.name')} value={form.centerName} onChange={set('centerName')} required autoFocus />
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label={t('center.city')} value={form.city} onChange={set('city')} required />
                <TextField label={t('center.district')} value={form.district} onChange={set('district')} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label={t('center.phone')} value={form.phone} onChange={set('phone')} required placeholder="+998 90 123 45 67" />
                <TextField label={t('center.email')} value={form.email} onChange={set('email')} type="email" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label={t('staff.firstName')} value={form.ownerFirstName} onChange={set('ownerFirstName')} required />
                <TextField label={t('staff.lastName')} value={form.ownerLastName} onChange={set('ownerLastName')} />
              </div>
              <TextField
                label={t('staff.username')}
                value={form.ownerUsername}
                onChange={set('ownerUsername')}
                hint={t('common.optional')}
              />
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
