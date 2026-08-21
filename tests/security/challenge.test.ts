import { describe, it, expect, vi, afterEach } from 'vitest';
import { verifyChallenge, challengeEnabled } from '@/lib/security/challenge';

/**
 * The human-verification challenge.
 *
 * The rule that matters is the failure direction: a provider that is slow,
 * broken or unreachable must produce a refusal, never an approval. Getting that
 * backwards turns an outage at Cloudflare into an open door here.
 */
afterEach(() => vi.unstubAllGlobals());

describe('when no provider is configured', () => {
  it('passes everything through, because that is the documented way to run', async () => {
    // The test environment sets CAPTCHA_PROVIDER=none.
    expect(challengeEnabled).toBe(false);
    expect(await verifyChallenge(undefined)).toEqual({ ok: true });
    expect(await verifyChallenge('anything')).toEqual({ ok: true });
  });

  it('never calls out to a provider', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await verifyChallenge('token');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/**
 * With a provider configured the module reads its settings at import time, so
 * these exercise the verification helper directly against a stubbed provider
 * rather than re-importing the module under a different environment.
 */
describe('the verification helper, against a stubbed provider', () => {
  const withProvider = async (
    response: { status?: number; body?: unknown } | Error,
  ) => {
    vi.resetModules();
    vi.stubEnv('CAPTCHA_PROVIDER', 'turnstile');
    vi.stubEnv('CAPTCHA_SITE_KEY', 'site-key');
    vi.stubEnv('CAPTCHA_SECRET_KEY', 'secret-key');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (response instanceof Error) throw response;
        return {
          ok: (response.status ?? 200) < 400,
          status: response.status ?? 200,
          json: async () => response.body,
        } as Response;
      }),
    );

    const mod = await import('@/lib/security/challenge');
    return mod;
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('accepts a token the provider says is good', async () => {
    const mod = await withProvider({ body: { success: true } });
    expect(await mod.verifyChallenge('good-token')).toEqual({ ok: true });
  });

  it('refuses a token the provider rejects, and records why', async () => {
    const mod = await withProvider({ body: { success: false, 'error-codes': ['invalid-input-response'] } });
    const verdict = await mod.verifyChallenge('bad-token');
    expect(verdict).toEqual({ ok: false, reason: 'invalid-input-response' });
  });

  it('refuses a missing token without calling the provider', async () => {
    const mod = await withProvider({ body: { success: true } });
    expect(await mod.verifyChallenge(undefined)).toEqual({ ok: false, reason: 'missing_token' });
  });

  it('refuses when the provider is unreachable — an outage is not an approval', async () => {
    const mod = await withProvider(new Error('ECONNREFUSED'));
    const verdict = await mod.verifyChallenge('token');
    expect(verdict).toEqual({ ok: false, reason: 'provider_unreachable' });
  });

  it('refuses when the provider answers with an error status', async () => {
    const mod = await withProvider({ status: 502, body: {} });
    const verdict = await mod.verifyChallenge('token');
    expect(verdict.ok).toBe(false);
  });

  it('sends the secret to the provider and never returns it', async () => {
    const mod = await withProvider({ body: { success: false, 'error-codes': ['x'] } });
    const verdict = await mod.verifyChallenge('token', '203.0.113.9');
    expect(JSON.stringify(verdict)).not.toContain('secret-key');
  });
});
