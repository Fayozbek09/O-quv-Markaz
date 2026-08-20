'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';

/**
 * Platform-admin override banner.
 *
 * Impersonation is never silent: while an admin session is pointed at a centre,
 * every page in that centre carries this bar, and leaving is one click away.
 */
export function ImpersonationBanner({ centerName }: { centerName: string }) {
  const t = useT();
  const router = useRouter();
  const csrf = useCsrfToken();
  const [leaving, setLeaving] = useState(false);

  async function leave() {
    setLeaving(true);
    await fetch('/api/admin/impersonate', {
      method: 'DELETE',
      headers: { 'x-csrf-token': csrf },
      credentials: 'same-origin',
    });
    router.push('/admin');
    router.refresh();
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 bg-danger-600 px-4 py-2 text-[13px] font-semibold text-white"
    >
      <span>{t('admin.impersonating', { center: centerName })}</span>
      <button
        type="button"
        onClick={() => void leave()}
        disabled={leaving}
        className="rounded-[6px] bg-white/15 px-2.5 py-1 font-medium hover:bg-white/25 disabled:opacity-60"
      >
        {t('admin.stopImpersonating')}
      </button>
    </div>
  );
}

export type BillingBannerProps = {
  status: string;
  trialDaysLeft: number | null;
  daysLeft: number | null;
  price: string;
  canPay: boolean;
};

/**
 * Trial countdown and payment warnings. Shown from seven days out so nobody is
 * surprised, and never blocking — a lapsed centre keeps every row it has.
 */
export function BillingBanner({
  status,
  trialDaysLeft,
  daysLeft,
  price,
  canPay,
}: BillingBannerProps) {
  const t = useT();

  let tone = 'border-brand-100 bg-brand-50 text-brand-700';
  let message: string;

  if (status === 'TRIAL' || status === 'TRIALING') {
    if (trialDaysLeft === null) return null;
    if (trialDaysLeft > 7) return null;
    message = trialDaysLeft <= 0 ? t('billing.trialLastDay') : t('billing.trialLeft', { days: trialDaysLeft });
    tone = trialDaysLeft <= 3 ? 'border-warn-50 bg-warn-50 text-warn-600' : tone;
  } else if (status === 'PAYMENT_DUE' || status === 'PAST_DUE' || status === 'GRACE_PERIOD') {
    message = t('billing.gracePeriodWarning', { days: daysLeft ?? 0 });
    tone = 'border-warn-50 bg-warn-50 text-warn-600';
  } else if (status === 'SUSPENDED') {
    message = t('billing.trialEnded', { price });
    tone = 'border-danger-50 bg-danger-50 text-danger-600';
  } else {
    return null;
  }

  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-[13px] ${tone}`}>
      <span className="font-medium">
        {message}
        {status === 'SUSPENDED' && <span className="ml-2 font-normal">{t('billing.dataSafe')}</span>}
      </span>
      {canPay && (
        <Link href="/billing" className="shrink-0 font-semibold underline">
          {t('billing.payNow')}
        </Link>
      )}
    </div>
  );
}
