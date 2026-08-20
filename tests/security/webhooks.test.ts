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
      expect(result.amountMinor).toBe(25000n);
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

  it('accepts a correctly signed settlement and converts the amount', async () => {
    const result = await clickProvider.verifyWebhook(form(callback()));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome).toBe('succeeded');
      // 300 000 so'm is 30 000 000 tiyin.
      expect(result.amountMinor).toBe(30_000_000n);
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
