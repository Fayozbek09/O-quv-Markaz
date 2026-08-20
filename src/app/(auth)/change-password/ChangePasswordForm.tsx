'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useT } from '@/lib/i18n/provider';
import { apiFetch } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';
import { AuthCard, FormError } from '@/components/forms/AuthCard';
import { TextField } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

export function ChangePasswordForm({ csrfToken }: { csrfToken: string }) {
  const t = useT();
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (next !== confirm) {
      setError(t('changePassword.mismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ redirectTo: string }>('/api/auth/change-password', {
        method: 'POST',
        csrfToken,
        body: { currentPassword: current, newPassword: next },
      });
      router.push(result.redirectTo || '/dashboard');
      router.refresh();
    } catch (err) {
      setError(messageFor(t, err));
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t('changePassword.title')} subtitle={t('changePassword.subtitle')}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <FormError message={error} />
        <TextField
          label={t('changePassword.current')}
          name="currentPassword"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          required
          autoFocus
        />
        <TextField
          label={t('changePassword.next')}
          name="newPassword"
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          hint={t('auth.passwordHint')}
          required
        />
        <TextField
          label={t('changePassword.confirm')}
          name="confirmPassword"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
        <Button type="submit" size="lg" fullWidth disabled={busy}>
          {busy ? t('common.saving') : t('changePassword.submit')}
        </Button>
      </form>
    </AuthCard>
  );
}
