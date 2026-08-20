'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { apiFetch } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';
import { ConfirmDialog } from '@/components/ui/Modal';

export function StudentRowActions({
  studentId,
  name,
  archived,
}: {
  studentId: string;
  name: string;
  archived: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const csrf = useCsrfToken();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function archive() {
    setBusy(true);
    try {
      await apiFetch(`/api/students/${studentId}`, { method: 'DELETE', csrfToken: csrf });
      toast.push(t('students.archived'), 'ok');
      setConfirming(false);
      router.refresh();
    } catch (err) {
      toast.push(messageFor(t, err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Link
        href={`/students/${studentId}`}
        className="rounded-[6px] px-2 py-1 text-[12px] font-medium text-ink-soft hover:bg-surface-muted hover:text-ink"
      >
        {t('common.more')}
      </Link>
      {!archived && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-[6px] px-2 py-1 text-[12px] font-medium text-ink-faint hover:bg-danger-50 hover:text-danger-600"
        >
          {t('common.archive')}
        </button>
      )}

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => void archive()}
        title={t('common.archive')}
        message={t('students.archiveConfirm', { name })}
        confirmLabel={t('common.archive')}
        cancelLabel={t('common.cancel')}
        busy={busy}
      />
    </div>
  );
}
