import type { Metadata } from 'next';
import { requireOrgPage } from '@/lib/page';
import { currentOrg } from '@/lib/domain/org';
import { signFileUrl } from '@/lib/files/storage';
import { getTranslator } from '@/lib/i18n/server';
import { FROM_DB_LOCALE } from '@/lib/i18n/config';
import { WorkspaceForm } from './WorkspaceForm';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('settings.workspaceTitle'), robots: { index: false } };
}

export default async function WorkspaceSettingsPage() {
  const ctx = await requireOrgPage();
  const org = await currentOrg(ctx);

  return (
    <WorkspaceForm
      canEdit={ctx.role === 'OWNER' || ctx.role === 'ADMIN'}
      logoUrl={org.logoFileId ? signFileUrl(org.logoFileId, 30 * 60_000) : null}
      initial={{
        name: org.name,
        address: org.address,
        phone: org.phone,
        telegramHandle: org.telegramHandle,
        defaultCurrency: org.defaultCurrency as 'UZS' | 'USD' | 'RUB' | 'EUR',
        timezone: org.timezone,
        locale: FROM_DB_LOCALE[org.locale],
      }}
    />
  );
}
