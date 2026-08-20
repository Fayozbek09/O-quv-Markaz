'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { apiFetch } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';

/** Withdraws a notice. The row is kept and marked, never deleted. */
export function WithdrawButton({ id }: { id: string }) {
  const t = useT();
  const csrf = useCsrfToken();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function withdraw() {
    if (!window.confirm(t('announcements.confirmDelete'))) return;
    setBusy(true);
    try {
      await apiFetch(`/api/announcements/${id}`, { method: 'DELETE', csrfToken: csrf });
      toast.push(t('announcements.deleted'), 'ok');
      router.refresh();
    } catch (err) {
      toast.push(messageFor(t, err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void withdraw()}
      disabled={busy}
      className="text-[12px] font-medium text-danger-600 hover:underline disabled:opacity-60"
    >
      {t('announcements.withdraw')}
    </button>
  );
}
