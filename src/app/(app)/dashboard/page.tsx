import { redirect } from 'next/navigation';
import { requireOrgPage } from '@/lib/page';
import { ROLE_HOME } from '@/lib/rbac';

/**
 * Legacy entry point. The landing area depends on the role, and the role is
 * resolved from the session — never from the URL — so this simply forwards.
 */
export default async function DashboardPage() {
  const ctx = await requireOrgPage();
  redirect(ROLE_HOME[ctx.role]);
}
