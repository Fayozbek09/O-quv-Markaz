'use client';

import { useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/Button';

export type IssuedCredentials = {
  username: string;
  password: string;
  expiresAt?: string | null;
  usernameWasTaken?: boolean;
  requestedUsername?: string | null;
};

/**
 * Shows a generated username and password exactly once.
 *
 * The password is never persisted in readable form and there is no endpoint
 * that returns it again — if this panel is dismissed, the only way forward is
 * to issue a new one. That is deliberate.
 */
export function CredentialsPanel({
  credentials,
  onDone,
}: {
  credentials: IssuedCredentials;
  onDone: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(
      `${credentials.username}\n${credentials.password}`,
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-[var(--radius-field)] border border-warn-50 bg-warn-50 px-3 py-2 text-[13px] font-medium text-warn-600">
        {t('staff.credentialsHint')}
      </p>

      {credentials.usernameWasTaken && credentials.requestedUsername && (
        <p className="text-[13px] text-ink-soft">
          {t('staff.usernameTaken')}{' '}
          <span className="font-semibold text-ink">{credentials.username}</span>
        </p>
      )}

      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 rounded-[var(--radius-field)] border border-line bg-surface-muted/60 px-3 py-3">
        <dt className="text-[12px] uppercase tracking-wide text-ink-faint">{t('staff.username')}</dt>
        <dd className="select-all font-mono text-sm font-semibold text-ink">{credentials.username}</dd>
        <dt className="text-[12px] uppercase tracking-wide text-ink-faint">{t('staff.password')}</dt>
        <dd className="select-all font-mono text-sm font-semibold text-ink">{credentials.password}</dd>
      </dl>

      <p className="text-[12px] text-ink-soft">{t('staff.mustChange')}</p>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => void copy()}>
          {copied ? t('common.copied') : t('common.copy')}
        </Button>
        <Button type="button" onClick={onDone}>
          {t('common.close')}
        </Button>
      </div>
    </div>
  );
}
