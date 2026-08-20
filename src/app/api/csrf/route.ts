import { json, toErrorResponse } from '@/lib/api';
import { getSessionUser } from '@/lib/auth/session';
import { getAdminSession } from '@/lib/auth/admin-session';
import { csrfTokenFor } from '@/lib/security/csrf';
import { Unauthorized } from '@/lib/errors';

/**
 * Returns the caller's own CSRF token. Reading it needs a valid session cookie
 * and a same-origin request, so a cross-site page cannot obtain one; the
 * response is `no-store` and is scoped to the session that asked for it.
 *
 * Both session kinds are served, each from its own secret: a centre token is
 * derived from the centre session and an admin token from the admin session, so
 * one can never be replayed against the other.
 */
export async function GET() {
  try {
    const user = await getSessionUser();
    if (user) return json({ csrfToken: csrfTokenFor(user.csrfSecret) });

    const admin = await getAdminSession();
    if (admin) return json({ csrfToken: csrfTokenFor(admin.csrfSecret) });

    throw Unauthorized();
  } catch (err) {
    return toErrorResponse(err);
  }
}
