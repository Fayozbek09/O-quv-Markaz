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

const CATEGORIES = ['RENT', 'UTILITIES', 'SALARY', 'MARKETING', 'EQUIPMENT', 'TAX', 'OTHER'] as const;

export function ExpenseDialog() {
  const t = useT();
  const csrf = useCsrfToken();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    category: 'OTHER',
    title: '',
    amount: '',
    spentAt: new Date().toISOString().slice(0, 10),
    note: '',
  });

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/expenses', {
        method: 'POST',
        csrfToken: csrf,
        body: {
          category: form.category,
          title: form.title,
          amount: form.amount,
          spentAt: form.spentAt,
          note: form.note || undefined,
        },
      });
      setOpen(false);
      setForm({ ...form, title: '', amount: '', note: '' });
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
        {t('expenses.add')}
      </Button>

      <Modal open={open} title={t('expenses.add')} onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <FormError message={error} />
          <SelectField label={t('expenses.category')} value={form.category} onChange={set('category')}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`expenses.${c}` as TKey)}
              </option>
            ))}
          </SelectField>
          <TextField label={t('expenses.expenseTitle')} value={form.title} onChange={set('title')} required autoFocus />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={t('billing.amount')} value={form.amount} onChange={set('amount')} inputMode="numeric" required />
            <TextField label={t('expenses.spentAt')} value={form.spentAt} onChange={set('spentAt')} type="date" required />
          </div>
          <TextField label={t('common.notes')} value={form.note} onChange={set('note')} />
          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
