import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { env } from '../../env';
import { minorToHundredths, hundredthsToMinor } from '../../money';
import { prisma } from '../../db';
import { PAYME_ERROR, PAYME_STATE } from '../payme-merchant';
import type { PaymentProvider, WebhookOutcomeKind, WebhookReply } from '../provider';

/**
 * Payme (paycom.uz) adapter.
 *
 * Payme is not a notify-once gateway: it drives a JSON-RPC state machine
 * against our merchant endpoint. That protocol lives in `../payme-merchant.ts`,
 * which `/api/billing/webhook` dispatches to; what remains here is the checkout
 * link, the credential check the generic pipeline and its tests use, the reply
 * envelope, and reconciliation against our own transaction table.
 *
 * Amounts: Payme quotes **tiyin**, always. The ledger counts so'm for UZS
 * (`CURRENCIES.UZS.minorUnits === 0`), so every amount crossing this boundary
 * is converted. Passing the figure through unchanged would undercharge by a
 * factor of 100 on the way out and fail the webhook's amount check on the way
 * back, so no payment would ever settle.
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

  async createCheckout({ amountMinor, currency, idempotencyKey, returnUrl }) {
    if (!configured) return { redirectUrl: null, providerRef: null, unavailable: true };
    // Payme's hosted checkout takes a base64 parameter string.
    const params = [
      `m=${env.PAYME_MERCHANT_ID}`,
      `ac.order_id=${idempotencyKey}`,
      `a=${minorToHundredths(amountMinor, currency).toString()}`,
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
      amountMinor: hundredthsToMinor(BigInt(body.params?.amount ?? 0), 'UZS'),
      currency: 'UZS',
    };
  },

  /**
   * The state machine is ours to keep — Payme expects the merchant to be the
   * record — so reconciling a pending intent is a read of what their calls
   * already told us, not a request back to them.
   */
  async fetchStatus(providerRef: string) {
    const intent = await prisma.billingIntent.findUnique({
      where: { idempotencyKey: providerRef },
      select: { id: true },
    });
    if (!intent) return 'pending';

    const row = await prisma.paymeTransaction.findFirst({
      where: { intentId: intent.id },
      orderBy: { createTime: 'desc' },
      select: { state: true },
    });
    if (!row) return 'pending';

    if (row.state === PAYME_STATE.PERFORMED) return 'succeeded';
    if (row.state === PAYME_STATE.CREATED) return 'pending';
    return 'canceled';
  },

  /**
   * Payme reads JSON-RPC and nothing else, and it treats any non-200 as a
   * transport fault worth retrying — so a business refusal has to travel inside
   * the envelope with a 200 around it.
   */
  renderReply(result: WebhookOutcomeKind): WebhookReply {
    const error = (code: number) => ({
      status: 200,
      body: { jsonrpc: '2.0', id: null, error: { code, message: 'request refused' } },
    });

    switch (result.kind) {
      case 'rejected':
        return error(PAYME_ERROR.UNAUTHORIZED);
      case 'unknown_intent':
        return error(PAYME_ERROR.ORDER_NOT_FOUND);
      case 'amount_mismatch':
        return error(PAYME_ERROR.WRONG_AMOUNT);
      case 'not_settled':
        return error(PAYME_ERROR.CANNOT_PERFORM);
      default:
        return { status: 200, body: { jsonrpc: '2.0', id: null, result: { ok: true } } };
    }
  },
};

/** Exported for tests. */
export const signPaymeBody = (body: string) =>
  createHmac('sha256', env.PAYME_SECRET_KEY || 'unset').update(body).digest('hex');
