import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requireAdminPage } from '@/lib/page';
import { getTranslator } from '@/lib/i18n/server';
import { PageHeader } from '@/components/layout/PageHeader';
import { TwoFactorPanel } from './TwoFactorPanel';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('admin.security') };
}

/** Where the platform administrator manages their own second factor. */
export default async function AdminSecurityPage() {
  const admin = await requireAdminPage();
  const t = await getTranslator();

  const row = await prisma.platformAdmin.findUniqueOrThrow({
    where: { id: admin.adminId },
    select: { totpEnabledAt: true, totpRecoveryHashes: true },
  });

  const recoveryLeft = Array.isArray(row.totpRecoveryHashes)
    ? row.totpRecoveryHashes.length
    : 0;

  return (
    <>
      <PageHeader title={t('admin.security')} />
      <TwoFactorPanel enabled={Boolean(row.totpEnabledAt)} recoveryLeft={recoveryLeft} />
    </>
  );
}
