'use client';

import { useState, type FormEvent } from 'react';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { apiFetch } from '@/lib/client/api';
import { fieldErrorsFor, messageFor } from '@/lib/client/errors';
import { TextField, SelectField, TextAreaField } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/forms/AuthCard';
import { MoneyField } from '@/components/forms/MoneyField';

const METHODS = ['CASH', 'CARD', 'BANK_TRANSFER', 'CLICK', 'PAYME', 'UZUM', 'OTHER'] as const;

export function PaymentForm({
  students,
  groups,
  currency,
  defaultStudentId,
  onDone,
  onCancel,
}: {
  students: Array<{ id: string; name: string }>;
  groups: Array<{ id: string; name: string }>;
  currency: string;
  defaultStudentId?: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const csrf = useCsrfToken();
  const toast = useToast();

  const [studentId, setStudentId] = useState(defaultStudentId ?? students[0]?.id ?? '');
  const [groupId, setGroupId] = useState('');
  const [amount, setAmount] = useState('');
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<(typeof METHODS)[number]>('CASH');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const methodLabels: Record<(typeof METHODS)[number], string> = {
    CASH: t('payments.methodCash'),
    CARD: t('payments.methodCard'),
    BANK_TRANSFER: t('payments.methodTransfer'),
    CLICK: t('payments.methodClick'),
    PAYME: t('payments.methodPayme'),
    UZUM: t('payments.methodUzum'),
    OTHER: t('payments.methodOther'),
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await apiFetch('/api/payments', {
        method: 'POST',
        csrfToken: csrf,
        body: {
          studentId,
          groupId: groupId || undefined,
          amount: amount.replace(/[\s ]/g, ''),
          currency,
          paidAt,
          method,
          note: note || undefined,
        },
      });
      toast.push(t('payments.created'), 'ok');
      onDone();
    } catch (err) {
      setError(messageFor(t, err));
      setFields(fieldErrorsFor(t, err));
    } finally {
      setBusy(false);
    }
  }

  if (students.length === 0) {
    return <p className="text-[13px] text-ink-soft">{t('students.emptyHint')}</p>;
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5" noValidate>
      <FormError message={error} />

      <SelectField label={t('payments.student')} value={studentId} onChange={(e) => setStudentId(e.target.value)} required>
        {students.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </SelectField>

      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label={t('payments.group')} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">{t('common.none')}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </SelectField>
        <SelectField label={t('payments.method')} value={method} onChange={(e) => setMethod(e.target.value as (typeof METHODS)[number])}>
          {METHODS.map((m) => (
            <option key={m} value={m}>{methodLabels[m]}</option>
          ))}
        </SelectField>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <MoneyField label={t('payments.amount')} value={amount} onChange={setAmount} currency={currency} error={fields.amount} required />
        <TextField label={t('payments.paidAt')} type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} error={fields.paidAt} required />
      </div>

      <TextAreaField label={t('payments.note')} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={busy || !amount}>
          {busy ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </form>
  );
}
