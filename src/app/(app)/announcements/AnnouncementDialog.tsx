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

const AUDIENCES = ['EVERYONE', 'STAFF', 'TEACHERS', 'STUDENTS', 'GROUP'] as const;

/**
 * Posts a notice. The audience decides who is notified and whose list it
 * appears in — both resolved on the server, from the audience stored on the
 * row rather than from anything a reader sends.
 */
export function AnnouncementDialog({ groups }: { groups: Array<{ id: string; name: string }> }) {
  const t = useT();
  const csrf = useCsrfToken();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '',
    body: '',
    audience: 'EVERYONE' as (typeof AUDIENCES)[number],
    groupId: groups[0]?.id ?? '',
    expiresAt: '',
    pinned: false,
  });

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/announcements', {
        method: 'POST',
        csrfToken: csrf,
        body: {
          title: form.title,
          body: form.body,
          audience: form.audience,
          groupId: form.audience === 'GROUP' ? form.groupId : undefined,
          expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined,
          pinned: form.pinned,
        },
      });
      setOpen(false);
      setForm({ ...form, title: '', body: '', expiresAt: '', pinned: false });
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
        {t('announcements.add')}
      </Button>

      <Modal open={open} title={t('announcements.add')} onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <FormError message={error} />

          <TextField
            label={t('announcements.announcementTitle')}
            value={form.title}
            onChange={set('title')}
            required
            autoFocus
            maxLength={160}
          />
          <TextAreaField
            label={t('announcements.body')}
            value={form.body}
            onChange={set('body')}
            rows={5}
            required
            maxLength={4000}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label={t('announcements.audience')}
              value={form.audience}
              onChange={set('audience')}
            >
              {AUDIENCES.map((a) => (
                <option key={a} value={a}>
                  {t(`announcements.${a}`)}
                </option>
              ))}
            </SelectField>

            {form.audience === 'GROUP' && (
              <SelectField
                label={t('announcements.group')}
                value={form.groupId}
                onChange={set('groupId')}
                required
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </SelectField>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label={t('announcements.expiresAt')}
              value={form.expiresAt}
              onChange={set('expiresAt')}
              type="datetime-local"
            />
            <label className="flex items-end gap-2 pb-2 text-[13px] text-ink-soft">
              <input
                type="checkbox"
                checked={form.pinned}
                onChange={(e) => setForm((prev) => ({ ...prev, pinned: e.target.checked }))}
                className="size-4 rounded border-line-strong"
              />
              {t('announcements.pinned')}
            </label>
          </div>

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
