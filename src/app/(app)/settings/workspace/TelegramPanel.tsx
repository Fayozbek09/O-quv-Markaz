'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { apiFetch } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { FormError } from '@/components/forms/AuthCard';

type Account = {
  id: string;
  targetType: string;
  username: string | null;
  displayName: string | null;
  consentAt: string;
};

export function TelegramPanel() {
  const t = useT();
  const csrf = useCsrfToken();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<{ configured: boolean; accounts: Account[] }>('/api/telegram/link')
      .then((result) => {
        setConfigured(result.configured);
        setAccounts(result.accounts);
      })
      .catch((err) => setError(messageFor(t, err)));
  }, [t]);

  async function createLink() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ token: string }>('/api/telegram/link', {
        method: 'POST',
        csrfToken: csrf,
        body: { targetType: 'TEACHER' },
      });
      setLinkToken(result.token);
    } catch (err) {
      setError(messageFor(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={t('telegram.title')}
        action={
          configured === false ? (
            <Badge tone="neutral">{t('telegram.botNotConfigured')}</Badge>
          ) : accounts.length > 0 ? (
            <Badge tone="ok">{t('telegram.connected')}</Badge>
          ) : (
            <Badge tone="neutral">{t('telegram.notConnected')}</Badge>
          )
        }
      />
      <CardBody className="flex flex-col gap-3">
        <FormError message={error} />

        <p className="text-[13px] text-ink-soft">{t('telegram.connectHint')}</p>

        {accounts.length > 0 && (
          <ul className="divide-y divide-line rounded-[var(--radius-field)] border border-line">
            {accounts.map((account) => (
              <li key={account.id} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                <span className="flex-1 truncate">
                  {account.displayName ?? account.username ?? account.targetType}
                </span>
                <Badge tone="ok">{account.targetType}</Badge>
              </li>
            ))}
          </ul>
        )}

        {linkToken && (
          <div className="rounded-[var(--radius-field)] border border-brand-100 bg-brand-50 px-3 py-2.5">
            <p className="text-[12px] font-medium text-brand-700">{t('telegram.linkCode')}</p>
            <code className="mt-1 block break-all font-mono text-[13px] text-ink">
              /start {linkToken}
            </code>
            <p className="mt-1 text-[11px] text-brand-700">{t('telegram.linkExpires', { minutes: 15 })}</p>
          </div>
        )}

        <div>
          <Button variant="secondary" onClick={() => void createLink()} disabled={busy}>
            {t('telegram.connect')}
          </Button>
        </div>

        <p className="text-[12px] text-ink-faint">{t('telegram.consentNote')}</p>
      </CardBody>
    </Card>
  );
}
