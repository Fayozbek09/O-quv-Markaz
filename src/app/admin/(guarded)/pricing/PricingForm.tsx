'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { apiFetch } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { FormError, FormNotice } from '@/components/forms/AuthCard';

type Pricing = {
  monthlyPriceMinor: number;
  currency: string;
  trialDays: number;
  gracePeriodDays: number;
};

export function PricingForm({ initial }: { initial: Pricing }) {
  const t = useT();
  const csrf = useCsrfToken();
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await apiFetch('/api/admin/settings', { method: 'PUT', csrfToken: csrf, body: form });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(messageFor(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardBody>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <FormError message={error} />
          <FormNotice message={saved ? t('admin.pricingSaved') : null} />

          <TextField
            label={t('admin.monthlyPrice')}
            value={String(form.monthlyPriceMinor)}
            onChange={(e) => setForm({ ...form, monthlyPriceMinor: Number(e.target.value) || 0 })}
            inputMode="numeric"
            hint={form.currency}
            required
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t('admin.trialDays')}
              value={String(form.trialDays)}
              onChange={(e) => setForm({ ...form, trialDays: Number(e.target.value) || 0 })}
              inputMode="numeric"
              required
            />
            <TextField
              label={t('admin.graceDays')}
              value={String(form.gracePeriodDays)}
              onChange={(e) => setForm({ ...form, gracePeriodDays: Number(e.target.value) || 0 })}
              inputMode="numeric"
              required
            />
          </div>

          <p className="text-[12px] text-ink-soft">{t('admin.pricingHint')}</p>

          <Button type="submit" disabled={busy}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
