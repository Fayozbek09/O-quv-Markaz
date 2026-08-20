import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/tenant';
import { getTranslator } from '@/lib/i18n/server';
import { FROM_DB_LOCALE } from '@/lib/i18n/config';
import { ProfileForm } from './ProfileForm';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('settings.profileTitle'), robots: { index: false } };
}

export default async function ProfileSettingsPage() {
  const user = await requireUser();
  const profile = await prisma.profile.findUniqueOrThrow({ where: { userId: user.userId } });

  return (
    <ProfileForm
      initial={{
        firstName: profile.firstName,
        lastName: profile.lastName,
        bio: profile.bio,
        teachingSubject: profile.teachingSubject,
        locale: FROM_DB_LOCALE[profile.locale],
        timezone: profile.timezone,
      }}
      contact={{ email: user.email, phone: user.phone }}
    />
  );
}
