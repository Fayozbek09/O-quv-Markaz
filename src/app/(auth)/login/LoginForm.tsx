'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useT } from '@/lib/i18n/provider';
import { apiFetch } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';
import { AuthCard, FormError } from '@/components/forms/AuthCard';
import { TextField } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { GoogleButton } from '@/components/forms/GoogleButton';

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(
    params.get('error') === 'google' ? t('errors.badRequest') : null,
  );
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // The destination is decided server-side from the membership row. The
      // client never states a role, and a `?role=` in the URL is ignored.
      const result = await apiFetch<{ hasWorkspace: boolean; redirectTo: string }>(
        '/api/auth/login',
        { method: 'POST', body: { identifier, password } },
      );
      router.push(result.redirectTo || (result.hasWorkspace ? '/dashboard' : '/onboarding'));
      router.refresh();
    } catch (err) {
      setError(messageFor(t, err));
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title={t('auth.loginTitle')}
      subtitle={t('auth.loginSubtitle')}
      footer={
        <span className="text-ink-soft">
          {t('auth.noAccount')}{' '}
          <Link href="/register" className="font-medium text-brand-600 hover:underline">
            {t('auth.register')}
          </Link>
        </span>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <FormError message={error} />

        {/* Labelled simply "Login", though the field still accepts a username,
            a phone number or an e-mail — the server works out which it is. */}
        <TextField
          label={t('staff.username')}
          name="identifier"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          autoComplete="username"
          required
          autoFocus
        />

        <div>
          <TextField
            label={t('auth.password')}
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
          <div className="mt-1.5 text-right">
            <Link href="/forgot-password" className="text-[12px] text-brand-600 hover:underline">
              {t('auth.forgot')}
            </Link>
          </div>
        </div>

        <Button type="submit" size="lg" fullWidth disabled={busy}>
          {busy ? t('common.loading') : t('auth.login')}
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
      </form>
    </AuthCard>
  );
}
