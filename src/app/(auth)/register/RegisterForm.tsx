'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { useT } from '@/lib/i18n/provider';
import { apiFetch } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';
import { AuthCard, FormError, FormNotice } from '@/components/forms/AuthCard';
import { TextField } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { OtpInput } from '@/components/forms/OtpInput';
import { PasswordField } from '@/components/forms/PasswordField';
import { GoogleButton } from '@/components/forms/GoogleButton';

type Method = 'phone' | 'email';
type Step = 'identify' | 'verify';

export function RegisterForm({
  googleEnabled,
  showDevCode,
  priceLabel,
}: {
  googleEnabled: boolean;
  showDevCode: boolean;
  /** Formatted monthly price, resolved server-side from platform settings. */
  priceLabel: string;
}) {
  const t = useT();
  const router = useRouter();
  const [method, setMethod] = useState<Method>('phone');
  const [step, setStep] = useState<Step>('identify');
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [firstName, setFirstName] = useState('');
  const [password, setPassword] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ devCode?: string }>('/api/auth/register', {
        method: 'POST',
        body: method === 'phone' ? { phone: identifier } : { email: identifier },
      });
      setDevCode(result.devCode ?? null);
      setStep('verify');
      setCooldown(60);
    } catch (err) {
      setError(messageFor(t, err));
    } finally {
      setBusy(false);
    }
  }

  async function complete(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/auth/register', {
        method: 'PUT',
        body: {
          identifier,
          channel: method === 'phone' ? 'SMS' : 'EMAIL',
          code,
          password,
          firstName,
          locale: t.locale,
        },
      });
      router.push('/onboarding');
      router.refresh();
    } catch (err) {
      setError(messageFor(t, err));
      setBusy(false);
    }
  }

  if (step === 'verify') {
    return (
      <AuthCard
        title={t('auth.verifyTitle')}
        subtitle={
          method === 'phone'
            ? t('auth.verifySubtitlePhone', { target: identifier })
            : t('auth.verifySubtitleEmail', { target: identifier })
        }
      >
        <form onSubmit={complete} className="flex flex-col gap-4" noValidate>
          <FormError message={error} />
          {showDevCode && devCode && (
            <FormNotice message={`${t('auth.devCodeHint')} — ${devCode}`} />
          )}

          <OtpInput value={code} onChange={setCode} label={t('auth.code')} disabled={busy} />

          <button
            type="button"
            onClick={() => void sendCode()}
            disabled={cooldown > 0 || busy}
            className="self-start text-[12px] text-brand-600 hover:underline disabled:text-ink-faint disabled:no-underline"
          >
            {cooldown > 0 ? t('auth.resendIn', { seconds: cooldown }) : t('auth.resendCode')}
          </button>

          <hr className="border-line" />

          <TextField
            label={t('students.firstName')}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="given-name"
            required
            maxLength={80}
          />

          <PasswordField label={t('auth.password')} value={password} onChange={setPassword} />

          <Button type="submit" size="lg" fullWidth disabled={busy || code.length !== 6}>
            {busy ? t('common.loading') : t('auth.register')}
          </Button>

          <button
            type="button"
            onClick={() => { setStep('identify'); setCode(''); setError(null); }}
            className="text-[12px] text-ink-soft hover:underline"
          >
            {t('common.back')}
          </button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t('auth.registerTitle')}
      subtitle={t('auth.registerSubtitle', { price: priceLabel })}
      footer={
        <span className="text-ink-soft">
          {t('auth.haveAccount')}{' '}
          <Link href="/login" className="font-medium text-brand-600 hover:underline">
            {t('auth.login')}
          </Link>
        </span>
      }
    >
      <form onSubmit={sendCode} className="flex flex-col gap-4" noValidate>
        <FormError message={error} />

        <div role="tablist" aria-label={t('auth.register')} className="flex rounded-[var(--radius-field)] border border-line-strong p-0.5">
          {(['phone', 'email'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={method === m}
              onClick={() => { setMethod(m); setIdentifier(''); }}
              className={
                method === m
                  ? 'flex-1 rounded-[6px] bg-brand-500 px-3 py-1.5 text-[13px] font-medium text-white'
                  : 'flex-1 rounded-[6px] px-3 py-1.5 text-[13px] font-medium text-ink-soft hover:bg-surface-muted'
              }
            >
              {m === 'phone' ? t('auth.withPhone') : t('auth.withEmail')}
            </button>
          ))}
        </div>

        <TextField
          key={method}
          label={method === 'phone' ? t('auth.phone') : t('auth.email')}
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          type={method === 'phone' ? 'tel' : 'email'}
          inputMode={method === 'phone' ? 'tel' : 'email'}
          autoComplete={method === 'phone' ? 'tel' : 'email'}
          placeholder={method === 'phone' ? '+998 90 123 45 67' : 'ustoz@example.com'}
          required
          autoFocus
        />

        <Button type="submit" size="lg" fullWidth disabled={busy || identifier.length < 5}>
          {busy ? t('common.loading') : t('auth.sendCode')}
        </Button>

        {googleEnabled && (
          <>
            <div className="flex items-center gap-3 text-[12px] text-ink-faint">
              <span className="h-px flex-1 bg-line" />
              {t('auth.or')}
              <span className="h-px flex-1 bg-line" />
            </div>
            <GoogleButton label={t('auth.withGoogle')} />
          </>
        )}

        <p className="text-center text-[12px] leading-relaxed text-ink-faint">
          {t('auth.acceptTerms', { terms: '', privacy: '' }).replace(/\s+\.$/, '')}{' '}
          <Link href="/terms" className="text-brand-600 hover:underline">
            {t('auth.termsLink')}
          </Link>
          {' · '}
          <Link href="/privacy" className="text-brand-600 hover:underline">
            {t('auth.privacyLink')}
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
