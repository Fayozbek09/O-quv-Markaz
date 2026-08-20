import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { toErrorResponse } from '@/lib/api';
import { exchangeCode, GOOGLE_STATE_COOKIE, GOOGLE_VERIFIER_COOKIE } from '@/lib/auth/google';
import { createSession } from '@/lib/auth/session';
import { safeEqual } from '@/lib/crypto';
import { audit } from '@/lib/security/audit';
import { BadRequest } from '@/lib/errors';

/** Only ever redirects to a path on this origin - no open redirect. */
const localRedirect = (path: string) => NextResponse.redirect(new URL(path, env.APP_URL));

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    const store = await cookies();
    const expectedState = store.get(GOOGLE_STATE_COOKIE)?.value;
    const verifier = store.get(GOOGLE_VERIFIER_COOKIE)?.value;
    store.delete(GOOGLE_STATE_COOKIE);
    store.delete(GOOGLE_VERIFIER_COOKIE);

    if (error) return localRedirect('/login?error=google');
    if (!code || !state || !expectedState || !verifier) throw BadRequest();
    if (!safeEqual(state, expectedState)) throw BadRequest();

    const identity = await exchangeCode(code, verifier);

    // Match on the OIDC subject first; the email is secondary because it can be
    // reassigned inside a Workspace domain.
    let user = await prisma.user.findFirst({
      where: { OR: [{ googleSub: identity.sub }, { email: identity.email }], deletedAt: null },
      include: { memberships: { where: { removedAt: null }, orderBy: { joinedAt: 'asc' }, take: 1 } },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: identity.email,
          emailVerified: new Date(),
          googleSub: identity.sub,
          profile: {
            create: {
              firstName: identity.givenName ?? identity.email.split('@')[0] ?? 'User',
              lastName: identity.familyName,
              locale: identity.locale?.startsWith('ru') ? 'RU' : identity.locale?.startsWith('en') ? 'EN' : 'UZ',
            },
          },
        },
        include: { memberships: true },
      });
      await audit({ actorUserId: user.id, action: 'auth.google.register' });
    } else if (!user.googleSub) {
      await prisma.user.update({
        where: { id: user.id },
        data: { googleSub: identity.sub, emailVerified: user.emailVerified ?? new Date() },
      });
    }

    await createSession(user.id, user.memberships[0]?.organizationId ?? null);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await audit({ actorUserId: user.id, action: 'auth.google.login' });

    return localRedirect(user.memberships.length > 0 ? '/dashboard' : '/onboarding');
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) return localRedirect('/login?error=google');
    return toErrorResponse(err);
  }
}
