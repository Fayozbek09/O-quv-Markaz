import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/tenant';
import { getTranslator } from '@/lib/i18n/server';
import { NotificationsForm } from './NotificationsForm';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('settings.notificationsTitle'), robots: { index: false } };
}

const TYPES = ['LESSON_UPCOMING', 'ATTENDANCE_MISSED', 'PAYMENT_OVERDUE', 'MONTHLY_SUMMARY'] as const;

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
