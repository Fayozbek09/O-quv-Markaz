'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/layout/PageHeader';
import { PaymentForm } from '@/components/forms/PaymentForm';
import { GenerateInvoicesForm } from '@/components/forms/GenerateInvoicesForm';

export function PaymentsToolbar({
  tab,
  overdueOnly,
  openNew,
  students,
  groups,
  currency,
}: {
  tab: 'payments' | 'debt';
  overdueOnly: boolean;
  openNew: boolean;
  students: Array<{ id: string; name: string }>;
  groups: Array<{ id: string; name: string }>;
  currency: string;
  canReverse: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [newOpen, setNewOpen] = useState(openNew);
  const [invoiceOpen, setInvoiceOpen] = useState(false);

  function navigate(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    next.delete('page');
    next.delete('new');
    router.replace(`${pathname}?${next.toString()}`);
  }

  return (
    <>
      <PageHeader
        title={t('payments.title')}
        actions={
          <>
            <Button variant="secondary" onClick={() => setInvoiceOpen(true)}>
              {t('payments.generateInvoices')}
            </Button>
            <Button onClick={() => setNewOpen(true)}>+ {t('payments.add')}</Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-[var(--radius-field)] border border-line-strong bg-surface p-0.5">
          <button
            type="button"
            onClick={() => navigate({ tab: null, overdue: null })}
            aria-pressed={tab === 'payments'}
            className={tab === 'payments'
              ? 'rounded-[6px] bg-brand-500 px-3 py-1 text-[12px] font-medium text-white'
              : 'rounded-[6px] px-3 py-1 text-[12px] font-medium text-ink-soft hover:bg-surface-muted'}
          >
            {t('payments.history')}
          </button>
          <button
            type="button"
            onClick={() => navigate({ tab: 'debt' })}
            aria-pressed={tab === 'debt'}
            className={tab === 'debt'
              ? 'rounded-[6px] bg-brand-500 px-3 py-1 text-[12px] font-medium text-white'
              : 'rounded-[6px] px-3 py-1 text-[12px] font-medium text-ink-soft hover:bg-surface-muted'}
          >
            {t('debt.whoOwes')}
          </button>
        </div>

        {tab === 'debt' && (
          <button
            type="button"
            onClick={() => navigate({ overdue: overdueOnly ? null : '1' })}
            aria-pressed={overdueOnly}
            className={overdueOnly
              ? 'rounded-[var(--radius-field)] border border-warn-600 bg-warn-50 px-3 py-1.5 text-[12px] font-medium text-warn-600'
              : 'rounded-[var(--radius-field)] border border-line-strong bg-surface px-3 py-1.5 text-[12px] font-medium text-ink-soft hover:bg-surface-muted'}
          >
            {t('debt.overdueOnly')}
          </button>
        )}
      </div>

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title={t('payments.add')}>
        <PaymentForm
          students={students}
          groups={groups}
          currency={currency}
          onDone={() => { setNewOpen(false); router.refresh(); }}
          onCancel={() => setNewOpen(false)}
        />
      </Modal>

      <Modal open={invoiceOpen} onClose={() => setInvoiceOpen(false)} title={t('payments.generateInvoices')}>
        <GenerateInvoicesForm
          groups={groups}
          onDone={() => { setInvoiceOpen(false); router.refresh(); }}
          onCancel={() => setInvoiceOpen(false)}
        />
      </Modal>
    </>
  );
}
