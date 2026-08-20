import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, truncateAll, createTenant, type Tenant } from '../factories';
import { paymeProvider } from '@/lib/payments/providers/payme';
import { manualProvider } from '@/lib/payments/providers/manual';
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
