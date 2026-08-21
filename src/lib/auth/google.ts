import { createHash, randomBytes } from 'node:crypto';
import { env, googleConfigured } from '../env';
import { BadRequest } from '../errors';

/**
 * Google OAuth 2.0 / OpenID Connect, authorization-code flow with PKCE.
 * The ID token is validated against Google's tokeninfo endpoint rather than by
 * hand-rolled JWT verification - no invented cryptography.
 */
const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';

export const GOOGLE_STATE_COOKIE = 'omarkaz_oauth_state';
export const GOOGLE_VERIFIER_COOKIE = 'omarkaz_oauth_verifier';

export const redirectUri = () => `${env.APP_URL}/api/auth/google/callback`;

export function createPkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(24).toString('base64url');
  return { verifier, challenge, state };
}

export function authorizeUrl(challenge: string, state: string): string {
  if (!googleConfigured) throw BadRequest('auth.googleUnavailable');
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'online',
    prompt: 'select_account',
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export type GoogleIdentity = {
  sub: string;
  email: string;
  emailVerified: boolean;
  givenName: string | null;
  familyName: string | null;
  locale: string | null;
};

export async function exchangeCode(code: string, verifier: string): Promise<GoogleIdentity> {
  if (!googleConfigured) throw BadRequest('auth.googleUnavailable');

  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) throw BadRequest('errors.badRequest');

  const tokens = (await tokenRes.json()) as { id_token?: string };
  if (!tokens.id_token) throw BadRequest('errors.badRequest');

  const infoRes = await fetch(`${TOKENINFO_URL}?id_token=${encodeURIComponent(tokens.id_token)}`);
  if (!infoRes.ok) throw BadRequest('errors.badRequest');

  const info = (await infoRes.json()) as Record<string, string>;

  // The audience check is what stops a token minted for another app being
  // replayed here.
  if (info.aud !== env.GOOGLE_CLIENT_ID) throw BadRequest('errors.badRequest');
  if (info.iss !== 'https://accounts.google.com' && info.iss !== 'accounts.google.com') {
    throw BadRequest('errors.badRequest');
  }
  if (!info.sub || !info.email) throw BadRequest('errors.badRequest');

  // Trust the provider's own verification flag - never assume verified.
  const emailVerified = info.email_verified === 'true' || info.email_verified === '1';
  if (!emailVerified) throw BadRequest('errors.badRequest');

  return {
    sub: info.sub,
    email: info.email.toLowerCase(),
    emailVerified,
    givenName: info.given_name ?? null,
    familyName: info.family_name ?? null,
    locale: info.locale ?? null,
  };
}
