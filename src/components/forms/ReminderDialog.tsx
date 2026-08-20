'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { apiFetch } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/Field';
import { FormError } from '@/components/forms/AuthCard';
import { LOCALES, LOCALE_LABEL, type AppLocale } from '@/lib/i18n/config';

/**
 * The teacher always reads the exact message before it goes out. Nothing is
 * sent automatically, and the send button is disabled until a parent has linked
 * their own Telegram account.
 */
export function ReminderDialog({
  open,
  onClose,
  studentId,
  studentName,
  parentLinked,
}: {
  open: boolean;
  onClose: () => void;
  studentId: string;
  studentName: string;
  parentLinked: boolean;
}) {
  const t = useT();
  const csrf = useCsrfToken();
  const toast = useToast();

  const [template, setTemplate] = useState<'DEBT' | 'LESSON'>('DEBT');
  const [locale, setLocale] = useState<AppLocale>(t.locale);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setBody('');

    apiFetch<{ body: string }>(
      `/api/telegram/send-reminder/preview?studentId=${studentId}&template=${template}&locale=${locale}`,
    )
      .then((result) => {
        if (!cancelled) setBody(result.body);
      })
      .catch((err) => {
        if (!cancelled) setError(messageFor(t, err));
      });

    return () => {
      cancelled = true;
    };
  }, [open, studentId, template, locale, t]);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ status: string; configured: boolean }>(
        '/api/telegram/send-reminder',
        {
          method: 'POST',
          csrfToken: csrf,
          body: { studentId, template, locale, confirm: true },
        },
      );
      toast.push(
        result.status === 'SENT' ? t('telegram.reminderSent') : t('telegram.reminderQueued'),
        result.status === 'SENT' ? 'ok' : 'info',
      );
      onClose();
    } catch (err) {
      setError(messageFor(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('telegram.sendReminder')}>
      <div className="flex flex-col gap-4">
        <FormError message={error} />

        <p className="text-[13px] text-ink-soft">{studentName}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label={t('common.name')}
            value={template}
            onChange={(e) => setTemplate(e.target.value as 'DEBT' | 'LESSON')}
          >
            <option value="DEBT">{t('telegram.templateDebt')}</option>
            <option value="LESSON">{t('telegram.templateLesson')}</option>
          </SelectField>
          <SelectField
            label={t('common.language')}
            value={locale}
            onChange={(e) => setLocale(e.target.value as AppLocale)}
          >
            {LOCALES.map((code) => (
              <option key={code} value={code}>
                {LOCALE_LABEL[code]}
              </option>
            ))}
          </SelectField>
        </div>

        <div>
          <p className="mb-1.5 text-[13px] font-medium text-ink-soft">{t('telegram.reminderPreview')}</p>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-[var(--radius-field)] border border-line bg-surface-muted px-3 py-2.5 font-sans text-[13px] leading-relaxed text-ink">
            {body || t('common.loading')}
          </pre>
        </div>

        {!parentLinked && (
          <p className="rounded-[var(--radius-field)] border border-warn-50 bg-warn-50 px-3 py-2 text-[13px] text-warn-600">
            {t('telegram.noRecipient')}
          </p>
        )}

        <p className="text-[12px] text-ink-faint">{t('telegram.consentNote')}</p>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void send()} disabled={busy || !body || !parentLinked}>
            {busy ? t('common.loading') : t('telegram.reminderSend')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
