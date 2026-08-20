'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { apiFetch } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { PasswordField } from '@/components/forms/PasswordField';
import { FormError } from '@/components/forms/AuthCard';
import { Modal } from '@/components/ui/Modal';

export function SecurityForms({
  hasPassword,
  hasGoogle,
  otherSessionCount,
}: {
  hasPassword: boolean;
  hasGoogle: boolean;
  otherSessionCount: number;
}) {
  const t = useT();
  const router = useRouter();
  const csrf = useCsrfToken();
  const toast = useToast();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmWord, setConfirmWord] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setPwBusy(true);
    setPwError(null);
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        csrfToken: csrf,
        body: { currentPassword: current, newPassword: next },
      });
      toast.push(t('settings.passwordChanged'), 'ok');
      setCurrent('');
      setNext('');
      router.refresh();
    } catch (err) {
      setPwError(messageFor(t, err));
    } finally {
      setPwBusy(false);
    }
  }

  async function revokeOthers() {
    try {
      await apiFetch('/api/auth/sessions', { method: 'DELETE', csrfToken: csrf });
      toast.push(t('common.saved'), 'ok');
      router.refresh();
    } catch (err) {
      toast.push(messageFor(t, err), 'error');
    }
  }

  async function deleteAccount(event: FormEvent) {
    event.preventDefault();
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await apiFetch('/api/account/delete', {
        method: 'DELETE',
        csrfToken: csrf,
        body: { confirm: 'DELETE', password: hasPassword ? deletePassword : undefined },
      });
      router.push('/');
      router.refresh();
    } catch (err) {
      setDeleteError(messageFor(t, err));
      setDeleteBusy(false);
    }
  }

  return (
    <>
      {hasPassword && (
        <Card>
          <CardHeader title={t('settings.changePassword')} subtitle={t('settings.securitySubtitle')} />
          <CardBody>
            <form onSubmit={changePassword} className="flex max-w-sm flex-col gap-3.5" noValidate>
              <FormError message={pwError} />
              <PasswordField
                label={t('auth.currentPassword')}
                value={current}
                onChange={setCurrent}
                autoComplete="current-password"
                showMeter={false}
              />
              <PasswordField label={t('auth.newPassword')} value={next} onChange={setNext} />
              <div>
                <Button type="submit" disabled={pwBusy || !current || next.length < 10}>
                  {pwBusy ? t('common.saving') : t('common.save')}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {!hasPassword && hasGoogle && (
        <Card>
          <CardHeader title={t('settings.securityTitle')} />
          <CardBody>
            <p className="text-[13px] text-ink-soft">Google</p>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title={t('auth.sessions')} />
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-ink-soft">
            {otherSessionCount} {t('auth.sessions').toLowerCase()}
          </p>
          <Button variant="secondary" onClick={() => void revokeOthers()} disabled={otherSessionCount === 0}>
            {t('auth.revokeOthers')}
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('settings.exportData')} />
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-md text-[13px] text-ink-soft">{t('settings.exportDataHint')}</p>
          <a
            href="/api/account/export"
            className="inline-flex h-9 items-center rounded-[var(--radius-field)] border border-line-strong bg-surface px-4 text-sm font-medium hover:bg-surface-muted"
          >
            {t('common.download')}
          </a>
        </CardBody>
      </Card>

      <Card className="border-danger-50">
        <CardHeader title={t('settings.deleteAccount')} />
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-md text-[13px] text-ink-soft">{t('settings.deleteAccountHint')}</p>
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>
            {t('settings.deleteAccount')}
          </Button>
        </CardBody>
      </Card>

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title={t('settings.deleteAccount')}>
        <form onSubmit={deleteAccount} className="flex flex-col gap-3.5" noValidate>
          <FormError message={deleteError} />
          <p className="text-[13px] text-ink-soft">{t('settings.deleteAccountHint')}</p>

          <TextField
            label={t('settings.deleteConfirmLabel', { word: t('settings.deleteConfirmWord') })}
            value={confirmWord}
            onChange={(e) => setConfirmWord(e.target.value)}
            autoComplete="off"
            required
          />

          {hasPassword && (
            <PasswordField
              label={t('auth.password')}
              value={deletePassword}
              onChange={setDeletePassword}
              autoComplete="current-password"
              showMeter={false}
            />
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDeleteOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              variant="danger"
              disabled={deleteBusy || confirmWord !== t('settings.deleteConfirmWord')}
            >
              {deleteBusy ? t('common.loading') : t('settings.deleteAccount')}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
