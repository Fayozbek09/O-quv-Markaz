'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { apiFetch } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';
import { useToast } from '@/components/providers/ToastProvider';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { TextField, SelectField } from '@/components/ui/Field';
import { FormError } from '@/components/forms/AuthCard';
import { CredentialsPanel, type IssuedCredentials } from '@/components/forms/CredentialsPanel';

export function StaffRowActions({
  memberId,
  role,
  canManage,
  canWriteSalary,
  salaryModel,
  salaryAmount,
  salaryPercent,
}: {
  memberId: string;
  role: string;
  canManage: boolean;
  canWriteSalary: boolean;
  salaryModel: string | null;
  salaryAmount: string | null;
  salaryPercent: number | null;
}) {
  const t = useT();
  const csrf = useCsrfToken();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<IssuedCredentials | null>(null);
  const [salaryOpen, setSalaryOpen] = useState(false);
  const [salaryError, setSalaryError] = useState<string | null>(null);
  const [salary, setSalary] = useState({
    salaryModel: salaryModel ?? 'FIXED',
    salaryAmount: salaryAmount ?? '0',
    salaryPercent: String(salaryPercent ?? 0),
  });

  if (!canManage && !canWriteSalary) return null;
  if (role === 'OWNER') return null;

  async function reissue() {
    if (!window.confirm(t('staff.reissueConfirm'))) return;
    setBusy(true);
    try {
      const result = await apiFetch<IssuedCredentials>(`/api/staff/${memberId}/credentials`, {
        method: 'POST',
        csrfToken: csrf,
        body: {},
      });
      setIssued(result);
    } catch (err) {
      toast.push(messageFor(t, err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(t('staff.remove'))) return;
    setBusy(true);
    try {
      await apiFetch(`/api/staff/${memberId}`, { method: 'DELETE', csrfToken: csrf });
      toast.push(t('staff.removed'), 'ok');
      router.refresh();
    } catch (err) {
      toast.push(messageFor(t, err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveSalary(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSalaryError(null);
    try {
      await apiFetch(`/api/staff/${memberId}/salary`, {
        method: 'PUT',
        csrfToken: csrf,
        body: {
          salaryModel: salary.salaryModel,
          salaryAmount: salary.salaryAmount || '0',
          salaryPercent: Number(salary.salaryPercent) || 0,
        },
      });
      setSalaryOpen(false);
      toast.push(t('common.saved'), 'ok');
      router.refresh();
    } catch (err) {
      setSalaryError(messageFor(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex justify-end gap-1">
        {canWriteSalary && (
          <button
            type="button"
            onClick={() => setSalaryOpen(true)}
            className="rounded-[6px] border border-line-strong px-2 py-1 text-[12px] text-ink-soft hover:bg-surface-muted"
          >
            {t('salary.editSalary')}
          </button>
        )}
        {canManage && (
          <>
            <button
              type="button"
              onClick={() => void reissue()}
              disabled={busy}
              className="rounded-[6px] border border-line-strong px-2 py-1 text-[12px] text-ink-soft hover:bg-surface-muted disabled:opacity-60"
            >
              {t('staff.reissue')}
            </button>
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className="rounded-[6px] border border-danger-50 px-2 py-1 text-[12px] text-danger-600 hover:bg-danger-50 disabled:opacity-60"
            >
              {t('common.remove')}
            </button>
          </>
        )}
      </div>

      <Modal
        open={Boolean(issued)}
        title={t('staff.credentials')}
        onClose={() => {
          setIssued(null);
          router.refresh();
        }}
      >
        {issued && (
          <CredentialsPanel
            credentials={issued}
            onDone={() => {
              setIssued(null);
              router.refresh();
            }}
          />
        )}
      </Modal>

      <Modal open={salaryOpen} title={t('salary.editSalary')} onClose={() => setSalaryOpen(false)}>
        <form onSubmit={saveSalary} className="flex flex-col gap-3">
          <FormError message={salaryError} />
          <SelectField
            label={t('salary.model')}
            value={salary.salaryModel}
            onChange={(e) => setSalary({ ...salary, salaryModel: e.target.value })}
          >
            <option value="FIXED">{t('salary.FIXED')}</option>
            <option value="PER_LESSON">{t('salary.PER_LESSON')}</option>
            <option value="PERCENTAGE">{t('salary.PERCENTAGE')}</option>
            <option value="MIXED">{t('salary.MIXED')}</option>
          </SelectField>
          {salary.salaryModel !== 'PERCENTAGE' && (
            <TextField
              label={t('salary.amount')}
              value={salary.salaryAmount}
              onChange={(e) => setSalary({ ...salary, salaryAmount: e.target.value })}
              inputMode="numeric"
            />
          )}
          {(salary.salaryModel === 'PERCENTAGE' || salary.salaryModel === 'MIXED') && (
            <TextField
              label={t('salary.percent')}
              value={salary.salaryPercent}
              onChange={(e) => setSalary({ ...salary, salaryPercent: e.target.value })}
              inputMode="numeric"
            />
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setSalaryOpen(false)}>
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
