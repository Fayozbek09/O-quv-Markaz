'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { apiFetch } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';
import { AuthCard, FormError } from '@/components/forms/AuthCard';
import { TextField } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

/**
 * Takes a six-digit code from an authenticator app, or one recovery code.
 *
 * `inputMode="numeric"` and `autoComplete="one-time-code"` matter here: on a
 * phone they bring up the number pad and let the OS offer the code, which is
 * the difference between this screen being routine and being a nuisance.
 */
export function AdminTwoFactorForm() {
  const t = useT();
  const csrf = useCsrfToken();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ redirectTo: string; usedRecoveryCode?: boolean; recoveryCodesLeft?: number }>(
        '/api/admin/2fa/verify',
        { method: 'POST', csrfToken: csrf, body: { code } },
      );
      router.push(result.redirectTo || '/admin');
      router.refresh();
    } catch (err) {
      setError(messageFor(t, err));
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t('admin.twoFactor')} subtitle={t('admin.twoFactorPrompt')}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <FormError message={error} />
        <TextField
          label={t('admin.twoFactorCode')}
          name="code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={20}
          required
          autoFocus
        />
        <p className="text-[12px] text-ink-faint">{t('admin.twoFactorRecoveryHint')}</p>
        <Button type="submit" size="lg" fullWidth disabled={busy}>
          {busy ? t('common.loading') : t('common.confirm')}
        </Button>
      </form>
    </AuthCard>
  );
}
