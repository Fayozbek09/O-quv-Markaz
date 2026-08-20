'use client';

import { useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { apiFetch } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';
import { Button } from '@/components/ui/Button';

/**
 * Starting a checkout never changes the plan on its own - the server only
 * activates a subscription after a verified webhook.
 */
export function BillingActions({
  plan,
  canManage,
  providerConfigured,
}: {
  plan: 'PRO' | 'ANNUAL';
  canManage: boolean;
  providerConfigured: boolean;
}) {
  const t = useT();
  const csrf = useCsrfToken();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function upgrade() {
    setBusy(true);
    try {
      const result = await apiFetch<{ redirectUrl: string | null; unavailable: boolean }>(
        '/api/billing/checkout',
        { method: 'POST', csrfToken: csrf, body: { plan } },
      );

      if (result.unavailable || !result.redirectUrl) {
        toast.push(t('settings.billingNotConfigured'), 'info');
        return;
      }
      window.location.href = result.redirectUrl;
    } catch (err) {
      toast.push(messageFor(t, err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      size="sm"
      variant={providerConfigured ? 'primary' : 'secondary'}
      onClick={() => void upgrade()}
      disabled={busy || !canManage}
    >
      {t('settings.upgrade')}
    </Button>
  );
}
