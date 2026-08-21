import { env } from '../env';

/**
 * Human-verification challenge for the endpoints that cost real money to abuse.
 *
 * Registration and password reset both send an SMS, and an SMS has a price. Rate
 * limiting bounds one IP and one identifier; it does not bound a thousand of
 * each, which is the shape a bill-running attack actually takes.
 *
 * Deliberately optional. A deployment with no provider configured keeps exactly
 * the behaviour it had — rate limiting alone — rather than failing shut, because
 * a challenge that cannot be solved is an outage. `CAPTCHA_PROVIDER=none` is a
 * supported way to run.
 *
 * Turnstile is the default because it works without a Google account and
 * without asking users to identify traffic lights, which matters for a product
 * whose users are receptionists in a hurry.
 */
export type ChallengeVerdict = { ok: true } | { ok: false; reason: string };

const VERIFY_URLS: Record<string, string> = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  hcaptcha: 'https://hcaptcha.com/siteverify',
  recaptcha: 'https://www.google.com/recaptcha/api/siteverify',
};

export const challengeProvider = env.CAPTCHA_PROVIDER;

/** True when a challenge is configured and should be rendered by the client. */
export const challengeEnabled =
  env.CAPTCHA_PROVIDER !== 'none' && Boolean(env.CAPTCHA_SECRET_KEY && env.CAPTCHA_SITE_KEY);

/**
 * Verifies a client-supplied token with the provider.
 *
 * Every failure mode resolves rather than throws: a challenge provider having a
 * bad day must not take registration down with it. What it must never do is
 * pass a token it could not verify — a network error is a refusal, not an
 * approval.
 */
export async function verifyChallenge(
  token: string | undefined | null,
  remoteIp?: string | null,
): Promise<ChallengeVerdict> {
  if (!challengeEnabled) return { ok: true };
  if (!token) return { ok: false, reason: 'missing_token' };

  const url = VERIFY_URLS[env.CAPTCHA_PROVIDER];
  if (!url) return { ok: false, reason: 'unknown_provider' };

  const form = new URLSearchParams({ secret: env.CAPTCHA_SECRET_KEY, response: token });
  if (remoteIp) form.set('remoteip', remoteIp);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      // A challenge provider is not allowed to hold a request open.
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { ok: false, reason: `provider_http_${response.status}` };

    const body = (await response.json()) as { success?: boolean; 'error-codes'?: string[] };
    if (body.success === true) return { ok: true };

    // Provider error codes are safe to record — they describe the token, not
    // the user — but they never reach the client.
    return { ok: false, reason: (body['error-codes'] ?? ['rejected']).join(',') };
  } catch (error) {
    console.error('[challenge]', error instanceof Error ? error.message : 'unknown');
    return { ok: false, reason: 'provider_unreachable' };
  }
}
