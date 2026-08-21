'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { apiFetch } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { FormError } from '@/components/forms/AuthCard';

/**
 * Enrolment, in the three steps it actually takes: fetch a secret, prove a code
 * from it works, then write down the recovery codes.
 *
 * The secret and the recovery codes exist only in this component's state. They
 * are never put in a URL, a log or an audit row, and a reload loses them —
 * which is why the recovery step says so plainly.
 */
export function TwoFactorPanel({
  enabled,
  recoveryLeft,
}: {
  enabled: boolean;
  recoveryLeft: number;
}) {
  const t = useT();
  const csrf = useCsrfToken();
  const router = useRouter();

  const [secret, setSecret] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(messageFor(t, err));
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      const result = await apiFetch<{ secret: string; uri: string }>('/api/admin/2fa', {
        method: 'POST',
        csrfToken: csrf,
      });
      setSecret(result.secret);
      setUri(result.uri);
    });

  const confirm = () =>
    run(async () => {
      const result = await apiFetch<{ recoveryCodes: string[] }>('/api/admin/2fa', {
        method: 'PUT',
        csrfToken: csrf,
        body: { code },
      });
      setCodes(result.recoveryCodes);
      setSecret(null);
      setUri(null);
      setCode('');
      router.refresh();
    });

  const disable = () =>
    run(async () => {
      await apiFetch('/api/admin/2fa', {
        method: 'DELETE',
        csrfToken: csrf,
        body: { code, password },
      });
      setCode('');
      setPassword('');
      router.push('/admin/login');
      router.refresh();
    });

  if (codes) {
    return (
      <Card>
        <CardHeader title={t('admin.twoFactorRecoveryTitle')} />
        <CardBody className="flex flex-col gap-3">
          <p className="text-[13px] text-ink-soft">{t('admin.twoFactorRecoverySaved')}</p>
          <ul className="grid gap-1.5 rounded-[var(--radius-field)] border border-line bg-surface-muted/50 p-4 font-mono text-sm sm:grid-cols-2">
            {codes.map((value) => (
              <li key={value}>{value}</li>
            ))}
          </ul>
          <div>
            <Button variant="secondary" onClick={() => setCodes(null)}>
              {t('common.close')}
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title={t('admin.twoFactor')}
        action={
          <Badge tone={enabled ? 'ok' : 'warn'}>
            {enabled ? t('admin.twoFactorOn') : t('admin.twoFactorOff')}
          </Badge>
        }
      />
      <CardBody className="flex flex-col gap-4">
        <FormError message={error} />

        {enabled ? (
          <>
            <p className="text-[13px] text-ink-soft">
              {t('admin.twoFactorRecoveryTitle')}: {recoveryLeft}
            </p>
            <div className="flex flex-col gap-3 sm:max-w-sm">
              <TextField
                label={t('admin.twoFactorCode')}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
              />
              <TextField
                label={t('auth.password')}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <div>
                <Button variant="danger" onClick={() => void disable()} disabled={busy}>
                  {t('admin.twoFactorDisable')}
                </Button>
              </div>
            </div>
          </>
        ) : secret && uri ? (
          <div className="flex flex-col gap-3 sm:max-w-sm">
            <p className="text-[13px] text-ink-soft">{t('admin.twoFactorScan')}</p>
            {/* Rendered as a link rather than a QR image: generating one would
                mean either a dependency or an external request, and an
                otpauth:// link is what an authenticator app accepts anyway. */}
            <a href={uri} className="break-all text-[13px] font-medium text-brand-600 hover:underline">
              {uri.slice(0, 64)}…
            </a>
            <label className="text-[12px] text-ink-faint">
              {t('admin.twoFactorSecret')}
              <code className="mt-1 block break-all rounded-[var(--radius-field)] border border-line bg-surface-muted/50 p-2 font-mono text-sm text-ink">
                {secret}
              </code>
            </label>
            <TextField
              label={t('admin.twoFactorCode')}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
            />
            <div>
              <Button onClick={() => void confirm()} disabled={busy || code.length < 6}>
                {t('common.confirm')}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button onClick={() => void start()} disabled={busy}>
              {t('admin.twoFactorEnable')}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
