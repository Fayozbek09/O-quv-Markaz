'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { apiFetch } from '@/lib/client/api';
import { useToast } from '@/components/providers/ToastProvider';
import { messageFor } from '@/lib/client/errors';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { TextAreaField } from '@/components/ui/Field';
import { AttachmentPicker, type PickedFile } from '@/components/forms/AttachmentPicker';

/**
 * Hands in one assignment, optionally with a note and one file.
 *
 * The server re-checks that the assignment belongs to this student and that the
 * file belongs to their centre, so neither field is trusted as sent.
 */
export function SubmitHomework({ homeworkId }: { homeworkId: string }) {
  const t = useT();
  const csrf = useCsrfToken();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<PickedFile[]>([]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await apiFetch(`/api/portal/homework/${homeworkId}`, {
        method: 'PUT',
        csrfToken: csrf,
        body: { note: note.trim() || null, fileId: files[0]?.fileId ?? null },
      });
      toast.push(t('student.submitted'), 'ok');
      setOpen(false);
      setNote('');
      setFiles([]);
      router.refresh();
    } catch (err) {
      toast.push(messageFor(t, err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-[6px] border border-line-strong px-2.5 py-1 text-[12px] font-medium text-ink-soft hover:bg-surface-muted disabled:opacity-60"
      >
        {t('student.submit')}
      </button>

      <Modal open={open} title={t('student.submit')} onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <TextAreaField
            label={t('homework.note')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={2000}
          />
          <AttachmentPicker value={files} onChange={setFiles} max={1} />
          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? t('common.saving') : t('student.submit')}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
