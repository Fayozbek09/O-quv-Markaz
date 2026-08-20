'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { apiFetch } from '@/lib/client/api';
import { fieldErrorsFor, messageFor } from '@/lib/client/errors';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { TextField, TextAreaField, SelectField } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/forms/AuthCard';
import { LOCALES, LOCALE_LABEL, type AppLocale } from '@/lib/i18n/config';

const TIMEZONES = ['Asia/Tashkent', 'Asia/Samarkand', 'Asia/Almaty', 'Europe/Moscow', 'Europe/London', 'UTC'];

type Initial = {
  firstName: string;
  lastName: string | null;
  bio: string | null;
  teachingSubject: string | null;
  locale: AppLocale;
  timezone: string;
};

export function ProfileForm({
  initial,
  contact,
}: {
  initial: Initial;
  contact: { email: string | null; phone: string | null };
}) {
  const t = useT();
  const router = useRouter();
  const csrf = useCsrfToken();
  const toast = useToast();

  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof Initial>(key: K, value: Initial[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await apiFetch('/api/settings/profile', {
        method: 'PUT',
        csrfToken: csrf,
        body: {
          firstName: form.firstName,
          lastName: form.lastName || undefined,
          bio: form.bio || undefined,
          teachingSubject: form.teachingSubject || undefined,
          locale: form.locale,
          timezone: form.timezone,
        },
      });

      // The interface language lives in a cookie so server rendering matches.
      if (form.locale !== initial.locale) {
        await fetch('/api/locale', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ locale: form.locale }),
        });
      }

      toast.push(t('common.saved'), 'ok');
      router.refresh();
    } catch (err) {
      setError(messageFor(t, err));
      setFields(fieldErrorsFor(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title={t('settings.profileTitle')} subtitle={t('settings.profileSubtitle')} />
      <CardBody>
        <form onSubmit={submit} className="flex max-w-xl flex-col gap-3.5" noValidate>
          <FormError message={error} />

          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={t('settings.firstName')} value={form.firstName} onChange={(e) => set('firstName', e.target.value)} error={fields.firstName} required maxLength={80} />
            <TextField label={t('settings.lastName')} value={form.lastName ?? ''} onChange={(e) => set('lastName', e.target.value)} error={fields.lastName} maxLength={80} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={t('auth.phone')} value={contact.phone ?? '—'} disabled readOnly />
            <TextField label={t('auth.email')} value={contact.email ?? '—'} disabled readOnly />
          </div>

          <TextField label={t('settings.subject')} value={form.teachingSubject ?? ''} onChange={(e) => set('teachingSubject', e.target.value)} maxLength={120} />

          <TextAreaField label={t('settings.bio')} value={form.bio ?? ''} onChange={(e) => set('bio', e.target.value)} maxLength={1000} rows={3} />

          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label={t('settings.language')} value={form.locale} onChange={(e) => set('locale', e.target.value as AppLocale)}>
              {LOCALES.map((code) => (
                <option key={code} value={code}>{LOCALE_LABEL[code]}</option>
              ))}
            </SelectField>
            <SelectField label={t('settings.timezone')} value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </SelectField>
          </div>

          <div>
            <Button type="submit" disabled={busy}>
              {busy ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
