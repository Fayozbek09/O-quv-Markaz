'use client';

import { useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { apiFetch } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';
import { Button } from '@/components/ui/Button';
import { FormError, FormNotice } from '@/components/forms/AuthCard';

/**
 * Starts a checkout. Nothing here can activate a subscription — the button only
 * asks the server for a provider redirect, and the term moves only when a
 * signed webhook lands.
 */
export function PayButton({
  price,
  configured,
  notConfiguredMessage,
}: {
  price: string;
  configured: boolean;
  notConfiguredMessage: string;
}) {
  const t = useT();
  const csrf = useCsrfToken();
  const [months, setMonths] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(configured ? null : notConfiguredMessage);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ redirectUrl: string | null; unavailable: boolean }>(
        '/api/billing/checkout',
        { method: 'POST', csrfToken: csrf, body: { months } },
      );
      if (result.redirectUrl) {
        window.location.href = result.redirectUrl;
        return;
      }
      setNotice(notConfiguredMessage);
    } catch (err) {
      setError(messageFor(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <FormError message={error} />
      <FormNotice message={notice} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[13px]">
          <span className="font-medium text-ink-soft">{t('billing.months')}</span>
          <select
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
            className="field h-10 w-24"
          >
            {[1, 3, 6, 12].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <Button type="button" onClick={() => void pay()} disabled={busy} size="lg">
          {busy ? t('common.loading') : `${t('billing.payNow')} · ${price}`}
        </Button>
      </div>
    </div>
  );
}
