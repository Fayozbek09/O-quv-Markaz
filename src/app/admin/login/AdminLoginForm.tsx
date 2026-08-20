'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useT } from '@/lib/i18n/provider';
import { apiFetch } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';
import { AuthCard, FormError } from '@/components/forms/AuthCard';
import { TextField } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

/**
 * Platform-administrator sign-in.
 *
 * Posts to its own endpoint, which reads a different table and sets a different
 * cookie from the centre login. A centre account entered here fails exactly the
 * same way a wrong password does — no hint that the username exists elsewhere.
 */
export function AdminLoginForm() {
  const t = useT();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ redirectTo: string }>('/api/admin/login', {
        method: 'POST',
        body: { username, password },
      });
      router.push(result.redirectTo || '/admin');
      router.refresh();
    } catch (err) {
      setError(messageFor(t, err));
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t('admin.signIn')} subtitle={t('admin.title')}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <FormError message={error} />
        <TextField
          label={t('staff.username')}
          name="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
          autoFocus
        />
        <TextField
          label={t('auth.password')}
          name="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        <Button type="submit" size="lg" fullWidth disabled={busy}>
          {busy ? t('common.loading') : t('auth.login')}
        </Button>
      </form>
    </AuthCard>
  );
}
