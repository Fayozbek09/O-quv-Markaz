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

type Dialog = 'impersonate' | 'suspend' | 'delete' | 'payment' | null;

/**
 * The privileged actions on one centre.
 *
 * Each one asks for a reason or a reference before it runs, and the server
 * writes that into the audit log alongside the admin's id — an override is
 * never anonymous and never silent.
 */
export function CenterActions({
  centerId,
  centerName,
  status,
  currency,
}: {
  centerId: string;
  centerName: string;
  status: string;
  currency: string;
}) {
  const t = useT();
  const csrf = useCsrfToken();
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [confirmWord, setConfirmWord] = useState('');
  const [amount, setAmount] = useState('300000');
  const [reference, setReference] = useState('');

  function close() {
    setDialog(null);
    setError(null);
    setReason('');
    setConfirmWord('');
    setReference('');
  }

  async function run(fn: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      close();
      if (after) after();
      else router.refresh();
    } catch (err) {
      setError(messageFor(t, err));
    } finally {
      setBusy(false);
    }
  }

  const impersonate = () =>
    run(
      () =>
        apiFetch('/api/admin/impersonate', {
          method: 'POST',
          csrfToken: csrf,
          body: { organizationId: centerId, reason },
        }),
      () => {
        // The banner in the centre shell makes the override obvious from here on.
        window.location.href = '/center';
      },
    );

  const suspend = () =>
    run(() =>
      apiFetch(`/api/admin/centers/${centerId}?action=suspend`, {
        method: 'PATCH',
        csrfToken: csrf,
        body: { reason },
      }),
    );

  const reactivate = () =>
    run(() =>
      apiFetch(`/api/admin/centers/${centerId}?action=reactivate`, {
        method: 'PATCH',
        csrfToken: csrf,
        body: {},
      }),
    );

  const remove = () =>
    run(
      () =>
        apiFetch(`/api/admin/centers/${centerId}`, {
          method: 'DELETE',
          csrfToken: csrf,
          body: { confirm: confirmWord, reason },
        }),
      () => router.push('/admin/centers'),
    );

  const recordPayment = () =>
    run(() =>
      apiFetch(`/api/admin/centers/${centerId}/subscription`, {
        method: 'POST',
        csrfToken: csrf,
        body: {
          amount,
          currency,
          months: 1,
          reference,
          paidAt: new Date().toISOString().slice(0, 10),
        },
      }),
    );

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => setDialog('payment')}>
          {t('admin.manualPayment')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setDialog('impersonate')}>
          {t('admin.impersonate')}
        </Button>
        {status === 'ACTIVE' ? (
          <Button size="sm" variant="secondary" onClick={() => setDialog('suspend')}>
            {t('admin.suspend')}
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => void reactivate()} disabled={busy}>
            {t('admin.reactivate')}
          </Button>
        )}
        <Button size="sm" variant="danger" onClick={() => setDialog('delete')}>
          {t('admin.deleteCenter')}
        </Button>
      </div>

      <Modal
        open={dialog === 'impersonate'}
        title={t('admin.impersonate')}
        onClose={close}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void impersonate();
          }}
          className="flex flex-col gap-3"
        >
          <FormError message={error} />
          <p className="text-[13px] text-ink-soft">{centerName}</p>
          <TextField
            label={t('admin.impersonateReason')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy || reason.trim().length < 3}>
              {t('admin.viewCenter')}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={dialog === 'suspend'} title={t('admin.suspend')} onClose={close}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void suspend();
          }}
          className="flex flex-col gap-3"
        >
          <FormError message={error} />
          <TextField
            label={t('admin.suspendReason')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="danger" disabled={busy || reason.trim().length < 3}>
              {t('admin.suspend')}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={dialog === 'delete'} title={t('admin.deleteCenter')} onClose={close}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void remove();
          }}
          className="flex flex-col gap-3"
        >
          <FormError message={error} />
          <p className="rounded-[var(--radius-field)] border border-warn-50 bg-warn-50 px-3 py-2 text-[13px] text-warn-600">
            {t('admin.deleteWarning')}
          </p>
          <TextField
            label={t('admin.deleteReason')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
          />
          <TextField
            label="DELETE"
            value={confirmWord}
            onChange={(e) => setConfirmWord(e.target.value)}
            hint={t('common.confirm')}
            required
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              variant="danger"
              disabled={busy || confirmWord !== 'DELETE' || reason.trim().length < 3}
            >
              {t('common.delete')}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={dialog === 'payment'} title={t('admin.manualPayment')} onClose={close}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void recordPayment();
          }}
          className="flex flex-col gap-3"
        >
          <FormError message={error} />
          <p className="text-[13px] text-ink-soft">{t('admin.manualPaymentHint')}</p>
          <TextField
            label={t('billing.amount')}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="numeric"
            required
          />
          <TextField
            label={t('billing.reference')}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            required
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy || reference.trim().length < 3}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
