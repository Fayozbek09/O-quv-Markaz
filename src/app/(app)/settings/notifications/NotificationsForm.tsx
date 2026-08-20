'use client';

import { useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { apiFetch } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/forms/AuthCard';
import type { TKey } from '@/lib/i18n';

type Type = 'LESSON_UPCOMING' | 'ATTENDANCE_MISSED' | 'PAYMENT_OVERDUE' | 'MONTHLY_SUMMARY';
type Pref = { type: Type; inApp: boolean; telegram: boolean; email: boolean };

const LABEL: Record<Type, TKey> = {
  LESSON_UPCOMING: 'notifications.lessonUpcoming',
  ATTENDANCE_MISSED: 'notifications.attendanceMissed',
  PAYMENT_OVERDUE: 'notifications.paymentOverdue',
  MONTHLY_SUMMARY: 'notifications.monthlySummary',
};

const CHANNELS: Array<{ key: 'inApp' | 'telegram' | 'email'; label: TKey }> = [
  { key: 'inApp', label: 'notifications.channelInApp' },
  { key: 'telegram', label: 'notifications.channelTelegram' },
  { key: 'email', label: 'notifications.channelEmail' },
];

export function NotificationsForm({ initial }: { initial: Pref[] }) {
  const t = useT();
  const csrf = useCsrfToken();
  const toast = useToast();
  const [prefs, setPrefs] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(type: Type, channel: 'inApp' | 'telegram' | 'email') {
    setPrefs((prev) =>
      prev.map((p) => (p.type === type ? { ...p, [channel]: !p[channel] } : p)),
    );
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/settings/notifications', {
        method: 'PUT',
        csrfToken: csrf,
        body: { prefs },
      });
      toast.push(t('common.saved'), 'ok');
    } catch (err) {
      setError(messageFor(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title={t('settings.notificationsTitle')} subtitle={t('settings.notificationsSubtitle')} />
      <CardBody className="flex flex-col gap-4">
        <FormError message={error} />

        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr>
                <th className="border-b border-line px-2 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
                  {t('notifications.title')}
                </th>
                {CHANNELS.map((channel) => (
                  <th key={channel.key} className="border-b border-line px-2 py-2 text-center text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
                    {t(channel.label)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {prefs.map((pref) => (
                <tr key={pref.type}>
                  <td className="border-b border-line px-2 py-2.5">{t(LABEL[pref.type])}</td>
                  {CHANNELS.map((channel) => (
                    <td key={channel.key} className="border-b border-line px-2 py-2.5 text-center">
                      <input
                        type="checkbox"
                        checked={pref[channel.key]}
                        onChange={() => toggle(pref.type, channel.key)}
                        aria-label={`${t(LABEL[pref.type])} — ${t(channel.label)}`}
                        className="size-4 accent-[var(--color-brand-500)]"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
