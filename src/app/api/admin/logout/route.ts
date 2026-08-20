import { noContent, publicRoute } from '@/lib/api';
import { getAdminSession, destroyAdminSession } from '@/lib/auth/admin-session';
import { audit } from '@/lib/security/audit';

/**
 * Logout is deliberately not CSRF-gated: forcing a session to end can only ever
 * reduce an attacker's reach, and refusing the request would leave a live
 * session behind.
 */
export const POST = publicRoute(async () => {
  const admin = await getAdminSession();
  await destroyAdminSession();
  if (admin) await audit({ actorAdminId: admin.adminId, action: 'admin.logout' });
  return noContent();
});
