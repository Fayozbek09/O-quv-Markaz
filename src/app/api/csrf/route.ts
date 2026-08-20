import { json, toErrorResponse } from '@/lib/api';
import { requireUser } from '@/lib/tenant';
import { csrfTokenFor } from '@/lib/security/csrf';

/**
 * Returns the caller's own CSRF token. Reading it needs a valid session cookie
 * and a same-origin request, so a cross-site page cannot obtain one; the
 * response is `no-store` and is scoped to the session that asked for it.
 */
export async function GET() {
  try {
    const user = await requireUser();
    return json({ csrfToken: csrfTokenFor(user.csrfSecret) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
