import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, truncateAll, createTenant, type Tenant } from '../factories';
import { paymeProvider } from '@/lib/payments/providers/payme';
import { manualProvider } from '@/lib/payments/providers/manual';
import { clickProvider, clickSignature } from '@/lib/payments/providers/click';
import { createLinkToken, redeemLinkToken } from '@/lib/integrations/telegram/link';
import { safeEqual } from '@/lib/crypto';

let tenant: Tenant;

beforeAll(async () => {
  await truncateAll();
  tenant = await createTenant();
});
afterAll(() => db.$disconnect());

const basic = (user: string, pass: string) =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

const body = (method: string, orderId: string, amount: number) =>
  JSON.stringify({ id: 42, method, params: { account: { order_id: orderId }, amount } });

describe('17/18. payment webhook signature verification', () => {
  it('accepts a correctly authenticated event', async () => {
    const result = await paymeProvider.verifyWebhook({
      rawBody: body('PerformTransaction', 'order-1', 25000),
      headers: { authorization: basic('Paycom', process.env.PAYME_SECRET_KEY as string) },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome).toBe('succeeded');
      // Payme quotes tiyin; the ledger counts so'm. 25 000 tiyin = 250 so'm.
      expect(result.amountMinor).toBe(250n);
      expect(result.idempotencyKey).toBe('order-1');
    }
  });

  it('rejects a wrong secret', async () => {
    const result = await paymeProvider.verifyWebhook({
      rawBody: body('PerformTransaction', 'order-1', 25000),
      headers: { authorization: basic('Paycom', 'wrong-secret') },
    });
    expect(result).toMatchObject({ ok: false, reason: 'bad_credentials' });
  });

  it('rejects a wrong username even with the right secret', async () => {
    const result = await paymeProvider.verifyWebhook({
      rawBody: body('PerformTransaction', 'order-1', 25000),
      headers: { authorization: basic('Attacker', process.env.PAYME_SECRET_KEY as string) },
    });
    expect(result).toMatchObject({ ok: false });
  });

  it('rejects a missing Authorization header', async () => {
    const result = await paymeProvider.verifyWebhook({
      rawBody: body('PerformTransaction', 'order-1', 25000),
      headers: {},
    });
    expect(result).toMatchObject({ ok: false, reason: 'missing_auth' });
  });

  it('rejects a malformed body without throwing', async () => {
    const result = await paymeProvider.verifyWebhook({
      rawBody: 'not json at all',
      headers: { authorization: basic('Paycom', process.env.PAYME_SECRET_KEY as string) },
    });
    expect(result).toMatchObject({ ok: false, reason: 'bad_json' });
  });

  it('rejects an authenticated event that omits the order reference', async () => {
    const result = await paymeProvider.verifyWebhook({
      rawBody: JSON.stringify({ id: 1, method: 'PerformTransaction', params: {} }),
      headers: { authorization: basic('Paycom', process.env.PAYME_SECRET_KEY as string) },
    });
    expect(result).toMatchObject({ ok: false, reason: 'missing_fields' });
  });

  it('maps a cancellation to a non-succeeding outcome', async () => {
    const result = await paymeProvider.verifyWebhook({
      rawBody: body('CancelTransaction', 'order-1', 25000),
      headers: { authorization: basic('Paycom', process.env.PAYME_SECRET_KEY as string) },
    });
    expect(result.ok && result.outcome).toBe('canceled');
  });
});

describe('the default provider never fakes a success', () => {
  it('reports itself as unconfigured and refuses every webhook', async () => {
    expect(manualProvider.configured).toBe(false);

    const checkout = await manualProvider.createCheckout({
      organizationId: tenant.org.id, plan: 'PRO', amountMinor: 25000n,
      currency: 'UZS', idempotencyKey: 'x', returnUrl: 'http://localhost',
    });
    expect(checkout.unavailable).toBe(true);
    expect(checkout.redirectUrl).toBeNull();

    expect(await manualProvider.verifyWebhook({ rawBody: '{}', headers: {} })).toMatchObject({ ok: false });
    expect(await manualProvider.fetchStatus('x')).toBe('pending');
  });
});

describe('webhook idempotency', () => {
  it('the unique (provider, externalId) index rejects a replayed event', async () => {
    await db.webhookEvent.create({
      data: { provider: 'payme', externalId: 'evt-1', signatureOk: true, payloadHash: 'h' },
    });
    await expect(
      db.webhookEvent.create({
        data: { provider: 'payme', externalId: 'evt-1', signatureOk: true, payloadHash: 'h' },
      }),
    ).rejects.toThrow();
  });
});

describe('17. Telegram webhook secret comparison', () => {
  it('matches only the exact secret', () => {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET as string;
    expect(safeEqual(secret, secret)).toBe(true);
    expect(safeEqual(`${secret}x`, secret)).toBe(false);
    expect(safeEqual('', secret)).toBe(false);
    expect(safeEqual(secret.toUpperCase(), secret)).toBe(false);
  });
});

describe('Telegram link tokens', () => {
  it('stores only a hash of the token', async () => {
    const { token } = await createLinkToken({
      organizationId: tenant.org.id,
      targetType: 'TEACHER',
      createdByUserId: tenant.user.id,
    });
    const row = await db.telegramLinkToken.findFirstOrThrow({
      where: { organizationId: tenant.org.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toHaveLength(64);
  });

  it('is single-use', async () => {
    const { token } = await createLinkToken({
      organizationId: tenant.org.id, targetType: 'TEACHER', createdByUserId: tenant.user.id,
    });
    expect((await redeemLinkToken(token)).ok).toBe(true);
    expect(await redeemLinkToken(token)).toMatchObject({ ok: false, reason: 'used' });
  });

  it('only one of two concurrent redemptions wins', async () => {
    const { token } = await createLinkToken({
      organizationId: tenant.org.id, targetType: 'TEACHER', createdByUserId: tenant.user.id,
    });
    const results = await Promise.all([redeemLinkToken(token), redeemLinkToken(token)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it('rejects an expired token', async () => {
    const { token } = await createLinkToken({
      organizationId: tenant.org.id, targetType: 'TEACHER', createdByUserId: tenant.user.id,
    });
    await db.telegramLinkToken.updateMany({
      where: { consumedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await redeemLinkToken(token)).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('rejects a guessed token', async () => {
    expect(await redeemLinkToken('totally-made-up')).toMatchObject({ ok: false, reason: 'invalid' });
  });
});

/**
 * Click's callback is signed with an MD5 digest over concatenated fields, and
 * arrives twice for one payment. Both facts are load-bearing: a forged digest
 * must be refused, and the first call must not buy anything.
 */
describe('click webhook verification', () => {
  const SERVICE_ID = process.env.CLICK_MERCHANT_ID as string;
  const SECRET = process.env.CLICK_SECRET_KEY as string;

  const form = (fields: Record<string, string>) => ({
    rawBody: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });

  const callback = (over: Record<string, string> = {}) => {
    const base = {
      click_trans_id: '900001',
      service_id: SERVICE_ID,
      merchant_trans_id: 'intent-abc',
      merchant_prepare_id: '55',
      amount: '300000.00',
      action: '1',
      sign_time: '2026-08-20 12:00:00',
      error: '0',
      ...over,
    };
    const signed = {
      ...base,
      sign_string: clickSignature({
        clickTransId: base.click_trans_id,
        serviceId: base.service_id,
        merchantTransId: base.merchant_trans_id,
        merchantPrepareId: base.merchant_prepare_id,
        amount: base.amount,
        action: base.action,
        signTime: base.sign_time,
        secret: SECRET,
      }),
    };
    return { ...signed, ...(over.sign_string ? { sign_string: over.sign_string } : {}) };
  };

  it('accepts a correctly signed settlement and reads the amount in ledger units', async () => {
    const result = await clickProvider.verifyWebhook(form(callback()));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome).toBe('succeeded');
      // Click quotes so'm, and the UZS ledger counts so'm, so the figure is
      // carried across unchanged - it must NOT be divided or multiplied by 100.
      expect(result.amountMinor).toBe(300_000n);
      expect(result.idempotencyKey).toBe('intent-abc');
    }
  });

  it('treats the reservation call as pending, never as a purchase', async () => {
    const result = await clickProvider.verifyWebhook(form(callback({ action: '0' })));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.outcome).toBe('pending');
  });

  it('gives the two phases different event ids so neither masks the other', async () => {
    const prepare = await clickProvider.verifyWebhook(form(callback({ action: '0' })));
    const complete = await clickProvider.verifyWebhook(form(callback()));
    expect(prepare.ok && complete.ok).toBe(true);
    if (prepare.ok && complete.ok) {
      expect(prepare.externalId).not.toBe(complete.externalId);
    }
  });

  it('rejects a forged signature', async () => {
    const result = await clickProvider.verifyWebhook(
      form(callback({ sign_string: 'f'.repeat(32) })),
    );
    expect(result).toMatchObject({ ok: false, reason: 'bad_signature' });
  });

  it('rejects an amount changed after signing', async () => {
    const signed = callback();
    const result = await clickProvider.verifyWebhook(form({ ...signed, amount: '1.00' }));
    expect(result).toMatchObject({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a callback addressed to a different shop', async () => {
    const result = await clickProvider.verifyWebhook(
      form(callback({ service_id: 'someone_else' })),
    );
    expect(result).toMatchObject({ ok: false, reason: 'wrong_service' });
  });

  it('rejects an unknown action rather than guessing', async () => {
    const result = await clickProvider.verifyWebhook(form(callback({ action: '7' })));
    expect(result).toMatchObject({ ok: false, reason: 'unknown_action' });
  });

  it('rejects a body with fields missing', async () => {
    const result = await clickProvider.verifyWebhook(form({ click_trans_id: '1' }));
    expect(result).toMatchObject({ ok: false, reason: 'missing_fields' });
  });

  it('reports a negative error code as a failure, not a success', async () => {
    const result = await clickProvider.verifyWebhook(form(callback({ error: '-5' })));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.outcome).toBe('failed');
  });

  it('reports the cancellation code as cancelled', async () => {
    const result = await clickProvider.verifyWebhook(form(callback({ error: '-9' })));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.outcome).toBe('canceled');
  });

  it('signs the two phases differently, so a prepare digest cannot settle', async () => {
    const prepareDigest = clickSignature({
      clickTransId: '900001', serviceId: SERVICE_ID, merchantTransId: 'intent-abc',
      merchantPrepareId: '55', amount: '300000.00', action: '0',
      signTime: '2026-08-20 12:00:00', secret: SECRET,
    });
    const result = await clickProvider.verifyWebhook(
      form(callback({ action: '1', sign_string: prepareDigest })),
    );
    expect(result).toMatchObject({ ok: false, reason: 'bad_signature' });
  });
});

/**
 * The amount has to survive the whole round trip.
 *
 * A centre owes 300 000 so'm. The intent stores 300000 minor units, because the
 * UZS minor unit *is* the so'm. Each gateway quotes a different unit, and the
 * webhook route settles a payment only when the figure it verifies equals the
 * figure on the intent — so a 100x slip in either adapter means either an
 * undercharge at the checkout or a payment that can never settle.
 */
describe('the reply each gateway can actually read', () => {
  /**
   * A correct decision returned in an envelope the gateway does not recognise
   * is not an acknowledgement. Click looks for `error` and, on Prepare, keeps
   * `merchant_prepare_id` to send back on Complete — where it also forms part
   * of the next signature. Answering `{ ok: true }` leaves the payment
   * unconfirmed on Click's side while our ledger says it settled.
   */
  const verification = {
    ok: true as const,
    externalId: '900001:1',
    idempotencyKey: 'intent-abc',
    outcome: 'succeeded' as const,
    amountMinor: 300_000n,
    currency: 'UZS',
  };

  it('answers Click with its own envelope, and always with a 200', () => {
    const reply = clickProvider.renderReply(
      { kind: 'settled' },
      { verification, intentId: 'intent-uuid' },
    );
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      click_trans_id: 900001,
      merchant_trans_id: 'intent-abc',
      error: 0,
      error_note: 'Success',
      merchant_confirm_id: 'intent-uuid',
    });
  });

  it('returns a prepare id on the reservation, and no confirm id', () => {
    const reply = clickProvider.renderReply(
      { kind: 'reserved' },
      { verification, intentId: 'intent-uuid' },
    );
    const body = reply.body as Record<string, unknown>;
    expect(body.error).toBe(0);
    expect(body.merchant_prepare_id).toBe('intent-uuid');
    expect(body).not.toHaveProperty('merchant_confirm_id');
  });

  it("reports a bad signature as Click's own -1, not as an HTTP 401", () => {
    const reply = clickProvider.renderReply({ kind: 'rejected', reason: 'bad_signature' }, {});
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ error: -1, error_note: 'SIGN CHECK FAILED' });
  });

  it('reports an amount mismatch as -2 rather than accepting it', () => {
    const reply = clickProvider.renderReply({ kind: 'amount_mismatch' }, { verification });
    expect(reply.body).toMatchObject({ error: -2 });
  });

  it('reports an unknown order as -5', () => {
    const reply = clickProvider.renderReply({ kind: 'unknown_intent' }, { verification });
    expect(reply.body).toMatchObject({ error: -5 });
  });

  it('never echoes an id the signature did not cover', () => {
    // With no verified body there is nothing to echo, and the reply says so
    // rather than inventing a transaction id.
    const reply = clickProvider.renderReply({ kind: 'rejected', reason: 'bad_body' }, {});
    expect(reply.body).toMatchObject({ click_trans_id: null, merchant_trans_id: null });
  });

  it('answers a duplicate as a success, so Click stops retrying a settled charge', () => {
    const reply = clickProvider.renderReply(
      { kind: 'duplicate' },
      { verification, intentId: 'intent-uuid' },
    );
    expect(reply.body).toMatchObject({ error: 0, merchant_confirm_id: 'intent-uuid' });
  });

  it('the manual provider still refuses outright', () => {
    const reply = manualProvider.renderReply({ kind: 'rejected', reason: 'provider_not_configured' }, {});
    expect(reply.status).toBe(401);
  });
});

describe('amounts survive the round trip to each gateway', () => {
  const ONE_MONTH_MINOR = 300_000n; // 300 000 so'm

  it('quotes Payme in tiyin and reads tiyin back as so\'m', async () => {
    const checkout = await paymeProvider.createCheckout({
      organizationId: 'org-1',
      plan: 'STANDARD',
      amountMinor: ONE_MONTH_MINOR,
      currency: 'UZS',
      idempotencyKey: 'intent-payme',
      returnUrl: 'https://example.test/billing',
    });

    const decoded = Buffer.from(
      (checkout.redirectUrl as string).split('/').pop() as string,
      'base64',
    ).toString('utf8');
    // 300 000 so'm is 30 000 000 tiyin — what Payme expects to be told.
    expect(decoded).toContain('a=30000000');

    const back = await paymeProvider.verifyWebhook({
      rawBody: body('PerformTransaction', 'intent-payme', 30_000_000),
      headers: { authorization: basic('Paycom', process.env.PAYME_SECRET_KEY as string) },
    });
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.amountMinor).toBe(ONE_MONTH_MINOR);
  });

  it("quotes Click in so'm and reads so'm back unchanged", async () => {
    const checkout = await clickProvider.createCheckout({
      organizationId: 'org-1',
      plan: 'STANDARD',
      amountMinor: ONE_MONTH_MINOR,
      currency: 'UZS',
      idempotencyKey: 'intent-click',
      returnUrl: 'https://example.test/billing',
    });

    const amount = new URL(checkout.redirectUrl as string).searchParams.get('amount');
    // Not 3000, which is what dividing by 100 would have charged.
    expect(amount).toBe('300000');

    const fields = {
      click_trans_id: '900002',
      service_id: process.env.CLICK_MERCHANT_ID as string,
      merchant_trans_id: 'intent-click',
      merchant_prepare_id: '77',
      amount: '300000.00',
      action: '1',
      sign_time: '2026-08-21 09:00:00',
      error: '0',
    };
    const back = await clickProvider.verifyWebhook({
      rawBody: new URLSearchParams({
        ...fields,
        sign_string: clickSignature({
          clickTransId: fields.click_trans_id,
          serviceId: fields.service_id,
          merchantTransId: fields.merchant_trans_id,
          merchantPrepareId: fields.merchant_prepare_id,
          amount: fields.amount,
          action: fields.action,
          signTime: fields.sign_time,
          secret: process.env.CLICK_SECRET_KEY as string,
        }),
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(back.ok).toBe(true);
    if (back.ok) {
      // The equality the webhook route performs before extending the term.
      expect(back.amountMinor).toBe(ONE_MONTH_MINOR);
    }
  });
});
