'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { apiFetch } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { FormError } from '@/components/forms/AuthCard';

/**
 * Records a payout. The amount is suggested from the server-side calculation
 * but stored as its own immutable row — paying does not rewrite the sheet.
 */
export function PaySalaryButton({
  memberId,
  year,
  month,
  suggested,
  currency,
}: {
  memberId: string;
  year: number;
  month: number;
  suggested: string;
  currency: string;
}) {
  const t = useT();
  const csrf = useCsrfToken();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(suggested);
  const [note, setNote] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/salaries', {
        method: 'POST',
        csrfToken: csrf,
        body: {
          memberId,
          year,
          month,
          amount,
          currency,
          paidAt: new Date().toISOString().slice(0, 10),
          note: note || undefined,
        },
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(messageFor(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-[6px] border border-line-strong px-2 py-1 text-[12px] font-medium text-ink-soft hover:bg-surface-muted"
      >
        {t('salary.pay')}
      </button>

      <Modal open={open} title={t('salary.pay')} onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <FormError message={error} />
          <TextField
            label={t('billing.amount')}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="numeric"
            required
            autoFocus
          />
          <TextField label={t('common.notes')} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? t('common.saving') : t('salary.pay')}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
