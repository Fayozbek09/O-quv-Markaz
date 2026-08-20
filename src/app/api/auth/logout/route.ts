import { json, toErrorResponse } from '@/lib/api';
import { assertCsrf, destroySession, getSessionUserOrNull } from '@/lib/auth/logout-helpers';
import { audit } from '@/lib/security/audit';

export async function POST() {
  try {
    const user = await getSessionUserOrNull();
    if (user) {
      await assertCsrf(user.csrfSecret);
      await audit({ actorUserId: user.userId, action: 'auth.logout' });
    }
    await destroySession();
    return json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
