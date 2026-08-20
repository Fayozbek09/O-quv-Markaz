'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { apiFetch } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { TextAreaField } from '@/components/ui/Field';
import { FormError } from '@/components/forms/AuthCard';

export function PaymentRowActions({ paymentId }: { paymentId: string }) {
  const t = useT();
  const router = useRouter();
  const csrf = useCsrfToken();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reverse(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/payments/${paymentId}/reverse`, {
        method: 'POST',
        csrfToken: csrf,
        body: { reason },
      });
      toast.push(t('payments.reversed'), 'ok');
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
        className="rounded-[6px] px-2 py-1 text-[12px] font-medium text-ink-faint hover:bg-danger-50 hover:text-danger-600"
      >
        {t('payments.reverse')}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={t('payments.reverse')}>
        <form onSubmit={reverse} className="flex flex-col gap-3.5" noValidate>
          <FormError message={error} />
          <p className="text-[13px] text-ink-soft">{t('payments.reverseHint')}</p>
          <TextAreaField
            label={t('payments.reverseReason')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            minLength={3}
            maxLength={300}
            rows={3}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="danger" disabled={busy || reason.trim().length < 3}>
              {busy ? t('common.loading') : t('payments.reverse')}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
