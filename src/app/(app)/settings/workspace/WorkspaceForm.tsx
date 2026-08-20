'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { apiFetch } from '@/lib/client/api';
import { fieldErrorsFor, messageFor } from '@/lib/client/errors';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { TextField, SelectField } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/forms/AuthCard';
import { LogoUploader } from '@/components/forms/LogoUploader';
import { TelegramPanel } from './TelegramPanel';
import { LOCALES, LOCALE_LABEL, type AppLocale } from '@/lib/i18n/config';

const TIMEZONES = ['Asia/Tashkent', 'Asia/Samarkand', 'Asia/Almaty', 'Europe/Moscow', 'UTC'];
const CURRENCIES = ['UZS', 'USD', 'RUB', 'EUR'] as const;

type Initial = {
  name: string;
  address: string | null;
  phone: string | null;
  telegramHandle: string | null;
  defaultCurrency: (typeof CURRENCIES)[number];
  timezone: string;
  locale: AppLocale;
};

export function WorkspaceForm({
  initial,
  logoUrl,
  canEdit,
}: {
  initial: Initial;
  logoUrl: string | null;
  canEdit: boolean;
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
      await apiFetch('/api/settings/workspace', {
        method: 'PUT',
        csrfToken: csrf,
        body: {
          name: form.name,
          address: form.address || undefined,
          phone: form.phone || undefined,
          telegramHandle: form.telegramHandle || undefined,
          defaultCurrency: form.defaultCurrency,
          timezone: form.timezone,
          locale: form.locale,
        },
      });
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
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title={t('settings.workspaceTitle')} subtitle={t('settings.workspaceSubtitle')} />
        <CardBody>
          <form onSubmit={submit} className="flex max-w-xl flex-col gap-3.5" noValidate>
            <FormError message={error} />

            <div>
              <p className="mb-1.5 text-[13px] font-medium text-ink-soft">{t('settings.logo')}</p>
              <LogoUploader currentUrl={logoUrl} />
            </div>

            <TextField label={t('settings.centerName')} value={form.name} onChange={(e) => set('name', e.target.value)} error={fields.name} required disabled={!canEdit} maxLength={160} />

            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label={t('settings.address')} value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} disabled={!canEdit} maxLength={300} />
              <TextField label={t('auth.phone')} value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} error={fields.phone} type="tel" disabled={!canEdit} />
            </div>

            <TextField label={t('settings.telegramHandle')} value={form.telegramHandle ?? ''} onChange={(e) => set('telegramHandle', e.target.value)} disabled={!canEdit} maxLength={64} placeholder="@ustozly" />

            <div className="grid gap-3 sm:grid-cols-3">
              <SelectField label={t('settings.currency')} value={form.defaultCurrency} onChange={(e) => set('defaultCurrency', e.target.value as Initial['defaultCurrency'])} disabled={!canEdit}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </SelectField>
              <SelectField label={t('settings.timezone')} value={form.timezone} onChange={(e) => set('timezone', e.target.value)} disabled={!canEdit}>
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </SelectField>
              <SelectField label={t('settings.language')} value={form.locale} onChange={(e) => set('locale', e.target.value as AppLocale)} disabled={!canEdit}>
                {LOCALES.map((code) => (
                  <option key={code} value={code}>{LOCALE_LABEL[code]}</option>
                ))}
              </SelectField>
            </div>

            {canEdit && (
              <div>
                <Button type="submit" disabled={busy}>
                  {busy ? t('common.saving') : t('common.save')}
                </Button>
              </div>
            )}
          </form>
        </CardBody>
      </Card>

      <TelegramPanel />
    </div>
  );
}
