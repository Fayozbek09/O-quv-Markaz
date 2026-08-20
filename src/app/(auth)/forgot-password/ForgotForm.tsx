'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useT } from '@/lib/i18n/provider';
import { apiFetch } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';
import { AuthCard, FormError, FormNotice } from '@/components/forms/AuthCard';
import { TextField } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { OtpInput } from '@/components/forms/OtpInput';
import { PasswordField } from '@/components/forms/PasswordField';

type Step = 'request' | 'reset' | 'done';

export function ForgotForm() {
  const t = useT();
  const router = useRouter();
  const [step, setStep] = useState<Step>('request');
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const channel = identifier.includes('@') ? ('EMAIL' as const) : ('SMS' as const);

  async function request(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/auth/forgot-password', { method: 'POST', body: { identifier } });
      // The response is identical whether or not the account exists.
      setStep('reset');
    } catch (err) {
      setError(messageFor(t, err));
    } finally {
      setBusy(false);
    }
  }

  async function reset(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        body: { identifier, channel, code, password },
      });
      setStep('done');
    } catch (err) {
      setError(messageFor(t, err));
    } finally {
      setBusy(false);
    }
  }

  if (step === 'done') {
    return (
      <AuthCard title={t('auth.resetTitle')}>
        <FormNotice message={t('auth.resetDone')} />
        <Button className="mt-4" size="lg" fullWidth onClick={() => router.push('/login')}>
          {t('auth.login')}
        </Button>
      </AuthCard>
    );
  }

  if (step === 'reset') {
    return (
      <AuthCard title={t('auth.resetTitle')} subtitle={t('auth.verifySubtitleEmail', { target: identifier })}>
        <form onSubmit={reset} className="flex flex-col gap-4" noValidate>
          <FormError message={error} />
          <OtpInput value={code} onChange={setCode} label={t('auth.code')} />
          <PasswordField
            label={t('auth.newPassword')}
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
          />
          <Button type="submit" size="lg" fullWidth disabled={busy || code.length !== 6}>
            {busy ? t('common.loading') : t('common.save')}
          </Button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t('auth.forgotTitle')}
      subtitle={t('auth.forgotSubtitle')}
      footer={
        <Link href="/login" className="font-medium text-brand-600 hover:underline">
          {t('auth.login')}
        </Link>
      }
    >
      <form onSubmit={request} className="flex flex-col gap-4" noValidate>
        <FormError message={error} />
        <TextField
          label={`${t('auth.phone')} / ${t('auth.email')}`}
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          autoComplete="username"
          required
          autoFocus
        />
        <Button type="submit" size="lg" fullWidth disabled={busy}>
          {busy ? t('common.loading') : t('auth.sendCode')}
        </Button>
      </form>
    </AuthCard>
  );
}
