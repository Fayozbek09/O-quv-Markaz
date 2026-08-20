'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { apiFetch } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { TextField, SelectField } from '@/components/ui/Field';
import { FormError } from '@/components/forms/AuthCard';
import type { TKey } from '@/lib/i18n';

/** The built-in catalogue; a centre can always type its own name instead. */
const CATALOG = [
  'english', 'ielts', 'russian', 'korean', 'turkish', 'arabic', 'chinese',
  'math', 'physics', 'chemistry', 'biology', 'history',
  'programming', 'robotics', 'design', 'sat', 'preschool', 'music', 'art',
] as const;

export function CourseDialog() {
  const t = useT();
  const csrf = useCsrfToken();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalogKey, setCatalogKey] = useState('');
  const [form, setForm] = useState({ name: '', description: '', defaultFee: '0', durationMonths: '' });

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  function pickCatalog(key: string) {
    setCatalogKey(key);
    if (key) setForm((prev) => ({ ...prev, name: t(`courses.${key}` as TKey) }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/courses', {
        method: 'POST',
        csrfToken: csrf,
        body: {
          name: form.name,
          catalogKey: catalogKey || undefined,
          description: form.description || undefined,
          defaultFee: form.defaultFee || '0',
          durationMonths: form.durationMonths ? Number(form.durationMonths) : undefined,
        },
      });
      setOpen(false);
      setForm({ name: '', description: '', defaultFee: '0', durationMonths: '' });
      setCatalogKey('');
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
        {t('courses.add')}
      </Button>

      <Modal open={open} title={t('courses.add')} onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <FormError message={error} />

          <SelectField
            label={t('courses.catalog')}
            value={catalogKey}
            onChange={(e) => pickCatalog(e.target.value)}
          >
            <option value="">{t('courses.custom')}</option>
            {CATALOG.map((key) => (
              <option key={key} value={key}>
                {t(`courses.${key}` as TKey)}
              </option>
            ))}
          </SelectField>

          <TextField label={t('courses.name')} value={form.name} onChange={set('name')} required />
          <TextField label={t('courses.description')} value={form.description} onChange={set('description')} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={t('courses.fee')} value={form.defaultFee} onChange={set('defaultFee')} inputMode="numeric" />
            <TextField label={t('courses.duration')} value={form.durationMonths} onChange={set('durationMonths')} inputMode="numeric" />
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
