import { headers } from 'next/headers';
import { env } from '../env';
import { hmac, safeEqual } from '../crypto';
import { Forbidden } from '../errors';

export const CSRF_HEADER = 'x-csrf-token';

/** Per-session CSRF token, derived from the session's stored secret. */
export const csrfTokenFor = (csrfSecret: string) => hmac(env.SESSION_SECRET, csrfSecret);

/**
 * Double defence for state-changing requests:
 *   1. Origin/Referer must match APP_URL (blocks cross-site form posts).
 *   2. A per-session CSRF token must be echoed in a custom header.
 * SameSite=Lax on the cookie is the third layer.
 */
export async function assertCsrf(csrfSecret: string): Promise<void> {
  const hdrs = await headers();

  const origin = hdrs.get('origin');
  const expected = new URL(env.APP_URL).origin;
  if (origin) {
    if (origin !== expected) throw Forbidden('errors.csrf');
  } else {
    const referer = hdrs.get('referer');
    if (!referer || new URL(referer).origin !== expected) throw Forbidden('errors.csrf');
  }

  const token = hdrs.get(CSRF_HEADER);
  if (!token || !safeEqual(token, csrfTokenFor(csrfSecret))) throw Forbidden('errors.csrf');
}
