import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { env } from '../../env';
import type { PaymentProvider } from '../provider';

/**
 * Payme (paycom.uz) adapter skeleton.
 *
 * The merchant protocol is JSON-RPC over HTTPS with Basic auth on the merchant
 * endpoint. Filling in `createCheckout`/`fetchStatus` requires PAYME_MERCHANT_ID
 * and PAYME_SECRET_KEY plus a merchant cabinet - see DEPLOYMENT.md.
 *
 * The parts that matter for security are implemented and testable now:
 * constant-time credential comparison and per-event idempotency.
 */
const configured = Boolean(env.PAYME_MERCHANT_ID && env.PAYME_SECRET_KEY);

function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export const paymeProvider: PaymentProvider = {
  name: 'payme',
  configured,

  async createCheckout({ amountMinor, idempotencyKey, returnUrl }) {
    if (!configured) return { redirectUrl: null, providerRef: null, unavailable: true };
    // Payme's hosted checkout takes a base64 parameter string.
    const params = [
      `m=${env.PAYME_MERCHANT_ID}`,
      `ac.order_id=${idempotencyKey}`,
      `a=${amountMinor.toString()}`,
      `c=${returnUrl}`,
    ].join(';');
    return {
      redirectUrl: `https://checkout.paycom.uz/${Buffer.from(params).toString('base64')}`,
      providerRef: idempotencyKey,
    };
  },

  async verifyWebhook({ rawBody, headers }) {
    if (!configured) return { ok: false, reason: 'provider_not_configured' };

    const auth = headers['authorization'] ?? '';
    if (!auth.startsWith('Basic ')) return { ok: false, reason: 'missing_auth' };

    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    const expected = `Paycom:${env.PAYME_SECRET_KEY}`;
    if (!constantTimeEqual(decoded, expected)) return { ok: false, reason: 'bad_credentials' };

    let body: {
      id?: number | string;
      method?: string;
      params?: { account?: { order_id?: string }; amount?: number };
    };
    try {
      body = JSON.parse(rawBody) as typeof body;
    } catch {
      return { ok: false, reason: 'bad_json' };
    }

    const orderId = body.params?.account?.order_id;
    if (!orderId || body.id === undefined) return { ok: false, reason: 'missing_fields' };

    const outcome =
      body.method === 'PerformTransaction'
        ? ('succeeded' as const)
        : body.method === 'CancelTransaction'
          ? ('canceled' as const)
          : ('failed' as const);

    return {
      ok: true,
      externalId: String(body.id),
      idempotencyKey: orderId,
      outcome,
      amountMinor: BigInt(body.params?.amount ?? 0),
      currency: 'UZS',
    };
  },

  async fetchStatus() {
    return 'pending';
  },
};

/** Exported for tests. */
export const signPaymeBody = (body: string) =>
  createHmac('sha256', env.PAYME_SECRET_KEY || 'unset').update(body).digest('hex');
