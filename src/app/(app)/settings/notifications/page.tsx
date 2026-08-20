import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/tenant';
import { getTranslator } from '@/lib/i18n/server';
import { NotificationsForm } from './NotificationsForm';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('settings.notificationsTitle'), robots: { index: false } };
}

/**
 * Every type a person can actually receive. The server honours these on write
 * (see lib/notifications/notify.ts), so anything it can send has to be listed
 * here or the preference would exist without a way to set it.
 */
const TYPES = [
  'LESSON_UPCOMING', 'LESSON_CANCELLED', 'LESSON_RESCHEDULED',
  'ATTENDANCE_MISSED', 'HOMEWORK_ASSIGNED', 'GRADE_POSTED',
  'PAYMENT_OVERDUE', 'ANNOUNCEMENT', 'MONTHLY_SUMMARY',
] as const;

export default async function NotificationSettingsPage() {
  const user = await requireUser();
  const stored = await prisma.notificationPreference.findMany({ where: { userId: user.userId } });
  const map = new Map(stored.map((p) => [p.type, p]));

  return (
    <NotificationsForm
      initial={TYPES.map((type) => ({
        type,
        inApp: map.get(type)?.inApp ?? true,
        telegram: map.get(type)?.telegram ?? false,
        email: map.get(type)?.email ?? false,
      }))}
    />
  );
}
