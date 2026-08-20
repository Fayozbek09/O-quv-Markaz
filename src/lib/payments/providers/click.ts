import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '../../env';
import { minorToMajorString, parseAmountToMinor } from '../../money';
import type { PaymentProvider } from '../provider';

/**
 * Click (click.uz) adapter.
 *
 * Click's SHOP API calls the merchant twice for one payment: `action=0`
 * (Prepare) reserves the order, and `action=1` (Complete) settles it. Only the
 * second one is allowed to extend a subscription, which is why this adapter
 * reports the first as `pending` rather than as a success.
 *
 * The signature is an MD5 digest over concatenated fields. MD5 is Click's
 * protocol, not a choice made here — it is a shared-secret construction rather
 * than a collision-resistance one, and the comparison below is still done in
 * constant time so the digest cannot be guessed byte by byte.
 *
 * Completing a live purchase additionally requires the merchant cabinet to be
 * pointed at `/api/billing/webhook` and CLICK_SERVICE_ID / CLICK_SECRET_KEY to
 * be set; see DEPLOYMENT.md. With those absent the adapter reports itself
 * unconfigured and never verifies anything.
 */
const configured = Boolean(env.CLICK_MERCHANT_ID && env.CLICK_SECRET_KEY);

const PREPARE = '0';
const COMPLETE = '1';

function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Click posts `application/x-www-form-urlencoded`, but some integrations are
 * configured for JSON. Both are read; anything else fails to parse and is
 * refused.
 */
function parseBody(rawBody: string, contentType: string): Record<string, string> | null {
  if (contentType.includes('application/json')) {
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]),
      );
    } catch {
      return null;
    }
  }
  try {
    return Object.fromEntries(new URLSearchParams(rawBody).entries());
  } catch {
    return null;
  }
}

/**
 * `md5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id +
 * [merchant_prepare_id] + amount + action + sign_time)`.
 *
 * `merchant_prepare_id` is part of the digest on the Complete call only.
 */
export function clickSignature(fields: {
  clickTransId: string;
  serviceId: string;
  merchantTransId: string;
  merchantPrepareId?: string;
  amount: string;
  action: string;
  signTime: string;
  secret: string;
}): string {
  const parts = [
    fields.clickTransId,
    fields.serviceId,
    fields.secret,
    fields.merchantTransId,
    ...(fields.action === COMPLETE ? [fields.merchantPrepareId ?? ''] : []),
    fields.amount,
    fields.action,
    fields.signTime,
  ];
  return createHash('md5').update(parts.join('')).digest('hex');
}

/**
 * Click quotes the major unit — so'm, not tiyin. For UZS the ledger's minor
 * unit is already the so'm, so this is a parse rather than a division; going
 * through the shared helper keeps it that way if another currency is ever
 * added.
 */
function amountToMinor(amount: string, currency: string): bigint {
  try {
    return parseAmountToMinor(amount, currency);
  } catch {
    return -1n;
  }
}

export const clickProvider: PaymentProvider = {
  name: 'click',
  configured,

  async createCheckout({ amountMinor, currency, idempotencyKey, returnUrl }) {
    if (!configured) return { redirectUrl: null, providerRef: null, unavailable: true };

    const params = new URLSearchParams({
      service_id: env.CLICK_MERCHANT_ID,
      merchant_id: env.CLICK_MERCHANT_ID,
      // Click takes the amount in so'm, not in tiyin.
      amount: minorToMajorString(amountMinor, currency),
      transaction_param: idempotencyKey,
      return_url: returnUrl,
    });
    return {
      redirectUrl: `https://my.click.uz/services/pay?${params.toString()}`,
      providerRef: idempotencyKey,
    };
  },

  async verifyWebhook({ rawBody, headers }) {
    if (!configured) return { ok: false, reason: 'provider_not_configured' };

    const body = parseBody(rawBody, headers['content-type'] ?? '');
    if (!body) return { ok: false, reason: 'bad_body' };

    const {
      click_trans_id: clickTransId,
      service_id: serviceId,
      merchant_trans_id: merchantTransId,
      merchant_prepare_id: merchantPrepareId,
      amount,
      action,
      sign_time: signTime,
      sign_string: signString,
      error,
    } = body;

    if (!clickTransId || !serviceId || !merchantTransId || !amount || !signTime || !signString) {
      return { ok: false, reason: 'missing_fields' };
    }
    if (action !== PREPARE && action !== COMPLETE) {
      return { ok: false, reason: 'unknown_action' };
    }
    // A callback naming a different shop is not ours to settle.
    if (!constantTimeEqual(serviceId, env.CLICK_MERCHANT_ID)) {
      return { ok: false, reason: 'wrong_service' };
    }

    const expected = clickSignature({
      clickTransId,
      serviceId,
      merchantTransId,
      merchantPrepareId,
      amount,
      action,
      signTime,
      secret: env.CLICK_SECRET_KEY,
    });
    if (!constantTimeEqual(signString.toLowerCase(), expected)) {
      return { ok: false, reason: 'bad_signature' };
    }

    const amountMinor = amountToMinor(amount, 'UZS');
    if (amountMinor < 0n) return { ok: false, reason: 'bad_amount' };

    // Click reports failure as a negative error code on either call.
    const errorCode = Number(error ?? '0');
    const failed = Number.isFinite(errorCode) && errorCode < 0;

    const outcome = failed
      ? errorCode === -9
        ? ('canceled' as const)
        : ('failed' as const)
      : action === COMPLETE
        ? ('succeeded' as const)
        : ('pending' as const);

    return {
      ok: true,
      // The Click transaction id is stable across both calls, so the two phases
      // would collide on the idempotency index. The action keeps them distinct
      // while still making a replay of either one a no-op.
      externalId: `${clickTransId}:${action}`,
      idempotencyKey: merchantTransId,
      outcome,
      amountMinor,
      currency: 'UZS',
    };
  },

  async fetchStatus() {
    // Click's status endpoint needs a merchant API session, which is a
    // deployment step rather than something to guess at here. Reconciliation
    // therefore relies on the signed callback.
    return 'pending';
  },
};
