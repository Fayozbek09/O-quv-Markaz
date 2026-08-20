'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { apiFetch } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { TextField, SelectField, TextAreaField } from '@/components/ui/Field';
import { FormError } from '@/components/forms/AuthCard';
import { AttachmentPicker, type PickedFile } from '@/components/forms/AttachmentPicker';

/** Sets homework for one group; every student in it gets a submission row. */
export function HomeworkDialog({ groups }: { groups: Array<{ id: string; name: string }> }) {
  const t = useT();
  const csrf = useCsrfToken();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [form, setForm] = useState({
    groupId: groups[0]?.id ?? '',
    title: '',
    description: '',
    dueAt: '',
    maxScore: '',
  });

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/homework', {
        method: 'POST',
        csrfToken: csrf,
        body: {
          groupId: form.groupId,
          title: form.title,
          description: form.description || undefined,
          dueAt: new Date(form.dueAt).toISOString(),
          status: 'PUBLISHED',
          maxScore: form.maxScore ? Number(form.maxScore) : undefined,
          fileIds: files.map((f) => f.fileId),
        },
      });
      setOpen(false);
      setForm({ ...form, title: '', description: '', dueAt: '', maxScore: '' });
      setFiles([]);
      router.refresh();
    } catch (err) {
      setError(messageFor(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {t('homework.add')}
      </Button>

      <Modal open={open} title={t('homework.add')} onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <FormError message={error} />
          <SelectField label={t('homework.group')} value={form.groupId} onChange={set('groupId')} required>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </SelectField>
          <TextField label={t('homework.homeworkTitle')} value={form.title} onChange={set('title')} required autoFocus />
          <TextAreaField label={t('homework.description')} value={form.description} onChange={set('description')} rows={4} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={t('homework.due')} value={form.dueAt} onChange={set('dueAt')} type="datetime-local" required />
            <TextField label={t('homework.maxScore')} value={form.maxScore} onChange={set('maxScore')} inputMode="numeric" />
          </div>
          <AttachmentPicker value={files} onChange={setFiles} />
          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? t('common.saving') : t('common.create')}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
