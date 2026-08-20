import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { googleConfigured, isProd } from '@/lib/env';
import { authorizeUrl, createPkce, GOOGLE_STATE_COOKIE, GOOGLE_VERIFIER_COOKIE } from '@/lib/auth/google';
import { toErrorResponse } from '@/lib/api';

/** Kicks off the OAuth flow. State + PKCE verifier are held in short-lived cookies. */
export async function GET() {
  try {
    if (!googleConfigured) {
      return NextResponse.json(
        { error: 'not_configured', messageKey: 'auth.googleUnavailable' },
        { status: 501 },
      );
    }

    const { verifier, challenge, state } = createPkce();
    const store = await cookies();
    const options = {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: 600,
    };
    store.set(GOOGLE_STATE_COOKIE, state, options);
    store.set(GOOGLE_VERIFIER_COOKIE, verifier, options);

    return NextResponse.redirect(authorizeUrl(challenge, state));
  } catch (err) {
    return toErrorResponse(err);
  }
}
