'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { apiFetch } from '@/lib/client/api';
import { useToast } from '@/components/providers/ToastProvider';
import { messageFor } from '@/lib/client/errors';

/** Hands in one assignment. The server re-checks that it belongs to this student. */
export function SubmitHomework({ homeworkId }: { homeworkId: string }) {
  const t = useT();
  const csrf = useCsrfToken();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await apiFetch(`/api/portal/homework/${homeworkId}`, {
        method: 'PUT',
        csrfToken: csrf,
        body: { note: null, fileId: null },
      });
      toast.push(t('student.submitted'), 'ok');
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
      onClick={() => void submit()}
      disabled={busy}
      className="rounded-[6px] border border-line-strong px-2.5 py-1 text-[12px] font-medium text-ink-soft hover:bg-surface-muted disabled:opacity-60"
    >
      {t('student.submit')}
    </button>
  );
}
