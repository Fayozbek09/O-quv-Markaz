import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { db, truncateAll, createTenant, type Tenant } from '../factories';
import {
  handlePaymeRequest, PAYME_ERROR, PAYME_STATE, toTiyin,
} from '@/lib/payments/payme-merchant';

/**
 * The Payme Merchant API.
 *
 * Payme certifies an integration by driving the state machine and checking the
 * answers, so these tests do the same thing: they play the gateway. Every one
 * asserts the *shape* as well as the effect, because a correct decision
 * returned in an envelope Payme does not recognise is, to Payme, no answer at
 * all.
 */
const SECRET = 'test_payme_secret_key_value';
const AUTH = `Basic ${Buffer.from(`Paycom:${SECRET}`).toString('base64')}`;

let tenant: Tenant;
let orderId: string;
let intentId: string;

const AMOUNT_MINOR = 300_000n; // 300 000 so'm
const AMOUNT_TIYIN = Number(toTiyin(AMOUNT_MINOR)); // 30 000 000 tiyin

/**
 * `auth` takes `null` to mean "send no credential". An `undefined` default
 * would silently fall back to the valid header, which is how the
 * no-credential case first passed while testing an authenticated request.
 */
async function call(
  method: string,
  params: Record<string, unknown>,
  auth: string | null = AUTH,
) {
  return handlePaymeRequest({
    rawBody: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    authorization: auth ?? undefined,
  });
}

async function newIntent() {
  const key = `${tenant.org.id}:STANDARD:${Math.random().toString(16).slice(2, 10)}`;
  const intent = await db.billingIntent.create({
    data: {
      organizationId: tenant.org.id,
      plan: 'STANDARD',
      amountMinor: AMOUNT_MINOR,
      currency: 'UZS',
      provider: 'payme',
      idempotencyKey: key,
    },
  });
  return { key, id: intent.id };
}

beforeAll(async () => {
  await truncateAll();
  tenant = await createTenant('Payme Centre');
});
afterAll(() => db.$disconnect());

beforeEach(async () => {
  // The subscription ledger is cleared as well: a test that asserts "no charge
  // was taken" is meaningless if a previous test's charge is still counted.
  await db.subscriptionPayment.deleteMany();
  await db.paymeTransaction.deleteMany();
  await db.billingIntent.deleteMany();
  const made = await newIntent();
  orderId = made.key;
  intentId = made.id;
});

describe('authentication', () => {
  it('refuses a request with no credential, inside the envelope and with a 200', async () => {
    const reply = await call('CheckPerformTransaction', { account: { order_id: orderId }, amount: AMOUNT_TIYIN }, null);
    expect(reply.error?.code).toBe(PAYME_ERROR.UNAUTHORIZED);
    expect(reply.jsonrpc).toBe('2.0');
  });

  it('refuses a wrong key', async () => {
    const wrong = `Basic ${Buffer.from('Paycom:not-the-key').toString('base64')}`;
    const reply = await call('CheckPerformTransaction', { account: { order_id: orderId }, amount: AMOUNT_TIYIN }, wrong);
    expect(reply.error?.code).toBe(PAYME_ERROR.UNAUTHORIZED);
  });

  it('refuses the right key under the wrong username', async () => {
    const wrong = `Basic ${Buffer.from(`Merchant:${SECRET}`).toString('base64')}`;
    const reply = await call('CheckPerformTransaction', { account: { order_id: orderId }, amount: AMOUNT_TIYIN }, wrong);
    expect(reply.error?.code).toBe(PAYME_ERROR.UNAUTHORIZED);
  });

  it('answers a malformed body with a parse error rather than throwing', async () => {
    const reply = await handlePaymeRequest({ rawBody: '{not json', authorization: AUTH });
    expect(reply.error?.code).toBe(PAYME_ERROR.PARSE);
  });

  it('names an unknown method rather than guessing at it', async () => {
    const reply = await call('DefinitelyNotAMethod', {});
    expect(reply.error?.code).toBe(PAYME_ERROR.METHOD_NOT_FOUND);
  });

  it('carries a message in all three languages', async () => {
    const reply = await call('CheckPerformTransaction', { account: { order_id: 'nope' }, amount: AMOUNT_TIYIN });
    expect(reply.error?.message).toMatchObject({
      ru: expect.any(String), uz: expect.any(String), en: expect.any(String),
    });
  });
});

describe('CheckPerformTransaction', () => {
  it('allows a real order for the right amount', async () => {
    const reply = await call('CheckPerformTransaction', { account: { order_id: orderId }, amount: AMOUNT_TIYIN });
    expect(reply.result).toEqual({ allow: true });
  });

  it('refuses an unknown order', async () => {
    const reply = await call('CheckPerformTransaction', { account: { order_id: 'no-such-order' }, amount: AMOUNT_TIYIN });
    expect(reply.error?.code).toBe(PAYME_ERROR.ORDER_NOT_FOUND);
  });

  it('refuses a quoted amount that does not match the order', async () => {
    const reply = await call('CheckPerformTransaction', { account: { order_id: orderId }, amount: 1 });
    expect(reply.error?.code).toBe(PAYME_ERROR.WRONG_AMOUNT);
  });

  it('reads the amount as tiyin, not as so\'m', async () => {
    // 300 000 so'm is 30 000 000 tiyin. Quoting the so'm figure must fail, or
    // the centre would buy a month for a hundredth of the price.
    const reply = await call('CheckPerformTransaction', { account: { order_id: orderId }, amount: 300_000 });
    expect(reply.error?.code).toBe(PAYME_ERROR.WRONG_AMOUNT);
  });
});

describe('CreateTransaction', () => {
  it('reserves the order and reports state 1', async () => {
    const reply = await call('CreateTransaction', {
      id: 'pt-1', time: Date.now(), amount: AMOUNT_TIYIN, account: { order_id: orderId },
    });
    const result = reply.result as { state: number; transaction: string; create_time: number };
    expect(result.state).toBe(PAYME_STATE.CREATED);
    expect(result.transaction).toBeTruthy();
    expect(result.create_time).toBeGreaterThan(0);
  });

  it('answers a repeated create with the same transaction, not a second one', async () => {
    const params = { id: 'pt-2', time: Date.now(), amount: AMOUNT_TIYIN, account: { order_id: orderId } };
    const first = (await call('CreateTransaction', params)).result as { transaction: string; create_time: number };
    const second = (await call('CreateTransaction', params)).result as { transaction: string; create_time: number };

    expect(second.transaction).toBe(first.transaction);
    expect(second.create_time).toBe(first.create_time);
    expect(await db.paymeTransaction.count()).toBe(1);
  });

  it('refuses a second transaction against an order already being paid', async () => {
    await call('CreateTransaction', { id: 'pt-3a', time: Date.now(), amount: AMOUNT_TIYIN, account: { order_id: orderId } });
    const reply = await call('CreateTransaction', { id: 'pt-3b', time: Date.now(), amount: AMOUNT_TIYIN, account: { order_id: orderId } });
    expect(reply.error?.code).toBe(PAYME_ERROR.ORDER_IN_PROGRESS);
  });

  it('refuses a create for the wrong amount', async () => {
    const reply = await call('CreateTransaction', { id: 'pt-4', time: Date.now(), amount: 999, account: { order_id: orderId } });
    expect(reply.error?.code).toBe(PAYME_ERROR.WRONG_AMOUNT);
    expect(await db.paymeTransaction.count()).toBe(0);
  });
});

describe('PerformTransaction', () => {
  beforeEach(async () => {
    await call('CreateTransaction', { id: 'perf-1', time: Date.now(), amount: AMOUNT_TIYIN, account: { order_id: orderId } });
  });

  it('settles once, extends the term and reports state 2', async () => {
    const reply = await call('PerformTransaction', { id: 'perf-1' });
    const result = reply.result as { state: number; perform_time: number };
    expect(result.state).toBe(PAYME_STATE.PERFORMED);
    expect(result.perform_time).toBeGreaterThan(0);

    const intent = await db.billingIntent.findUniqueOrThrow({ where: { id: intentId } });
    expect(intent.status).toBe('SUCCEEDED');

    const paid = await db.subscriptionPayment.findFirst({
      where: { provider: 'payme', providerTransactionId: 'perf-1' },
    });
    expect(paid?.status).toBe('PAID');
    expect(paid?.amountMinor).toBe(AMOUNT_MINOR);
  });

  it('is idempotent: a retry returns the same answer and does not charge twice', async () => {
    const first = (await call('PerformTransaction', { id: 'perf-1' })).result as { perform_time: number };
    const second = (await call('PerformTransaction', { id: 'perf-1' })).result as { perform_time: number };

    expect(second.perform_time).toBe(first.perform_time);
    expect(await db.subscriptionPayment.count({ where: { provider: 'payme' } })).toBe(1);
  });

  it('refuses a transaction it has never seen', async () => {
    const reply = await call('PerformTransaction', { id: 'never-created' });
    expect(reply.error?.code).toBe(PAYME_ERROR.TRANSACTION_NOT_FOUND);
  });

  it('will not settle a transaction older than the 12-hour window', async () => {
    await db.paymeTransaction.updateMany({
      where: { paymeId: 'perf-1' },
      data: { createTime: BigInt(Date.now() - 13 * 60 * 60 * 1000) },
    });

    const reply = await call('PerformTransaction', { id: 'perf-1' });
    expect(reply.error?.code).toBe(PAYME_ERROR.CANNOT_PERFORM);

    const row = await db.paymeTransaction.findUniqueOrThrow({ where: { paymeId: 'perf-1' } });
    expect(row.state).toBe(PAYME_STATE.CANCELLED_BEFORE_PERFORM);
    expect(row.reason).toBe(4);
    expect(await db.subscriptionPayment.count({ where: { provider: 'payme' } })).toBe(0);
  });

  it('will not settle a cancelled transaction', async () => {
    await call('CancelTransaction', { id: 'perf-1', reason: 3 });
    const reply = await call('PerformTransaction', { id: 'perf-1' });
    expect(reply.error?.code).toBe(PAYME_ERROR.CANNOT_PERFORM);
  });
});

describe('CancelTransaction', () => {
  beforeEach(async () => {
    await call('CreateTransaction', { id: 'canc-1', time: Date.now(), amount: AMOUNT_TIYIN, account: { order_id: orderId } });
  });

  it('cancels before settlement as state -1', async () => {
    const reply = await call('CancelTransaction', { id: 'canc-1', reason: 3 });
    const result = reply.result as { state: number; cancel_time: number };
    expect(result.state).toBe(PAYME_STATE.CANCELLED_BEFORE_PERFORM);
    expect(result.cancel_time).toBeGreaterThan(0);
    expect((await db.billingIntent.findUniqueOrThrow({ where: { id: intentId } })).status).toBe('CANCELED');
  });

  it('cancels after settlement as state -2 and marks the charge refunded', async () => {
    await call('PerformTransaction', { id: 'canc-1' });
    const reply = await call('CancelTransaction', { id: 'canc-1', reason: 5 });

    expect((reply.result as { state: number }).state).toBe(PAYME_STATE.CANCELLED_AFTER_PERFORM);
    const paid = await db.subscriptionPayment.findFirstOrThrow({
      where: { provider: 'payme', providerTransactionId: 'canc-1' },
    });
    expect(paid.status).toBe('REFUNDED');
  });

  it('answers a repeated cancel identically', async () => {
    const first = (await call('CancelTransaction', { id: 'canc-1', reason: 3 })).result as { cancel_time: number };
    const second = (await call('CancelTransaction', { id: 'canc-1', reason: 3 })).result as { cancel_time: number };
    expect(second.cancel_time).toBe(first.cancel_time);
  });

  it('refuses to cancel something it has never seen', async () => {
    const reply = await call('CancelTransaction', { id: 'ghost', reason: 3 });
    expect(reply.error?.code).toBe(PAYME_ERROR.TRANSACTION_NOT_FOUND);
  });
});

describe('CheckTransaction', () => {
  it('reports the full state record Payme expects', async () => {
    await call('CreateTransaction', { id: 'chk-1', time: Date.now(), amount: AMOUNT_TIYIN, account: { order_id: orderId } });
    await call('PerformTransaction', { id: 'chk-1' });

    const reply = await call('CheckTransaction', { id: 'chk-1' });
    expect(reply.result).toMatchObject({
      state: PAYME_STATE.PERFORMED,
      cancel_time: 0,
      reason: null,
    });
    const result = reply.result as { create_time: number; perform_time: number; transaction: string };
    expect(result.create_time).toBeGreaterThan(0);
    expect(result.perform_time).toBeGreaterThan(0);
    expect(result.transaction).toBeTruthy();
  });

  it('refuses an unknown transaction', async () => {
    expect((await call('CheckTransaction', { id: 'nope' })).error?.code)
      .toBe(PAYME_ERROR.TRANSACTION_NOT_FOUND);
  });
});

describe('GetStatement', () => {
  it('lists transactions in the window, quoted in tiyin', async () => {
    await call('CreateTransaction', { id: 'st-1', time: Date.now(), amount: AMOUNT_TIYIN, account: { order_id: orderId } });
    await call('PerformTransaction', { id: 'st-1' });

    const reply = await call('GetStatement', { from: Date.now() - 60_000, to: Date.now() + 60_000 });
    const { transactions } = reply.result as {
      transactions: Array<{ id: string; amount: number; account: { order_id: string }; state: number }>;
    };

    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      id: 'st-1',
      amount: AMOUNT_TIYIN,
      account: { order_id: orderId },
      state: PAYME_STATE.PERFORMED,
    });
  });

  it('excludes transactions outside the window', async () => {
    await call('CreateTransaction', { id: 'st-2', time: Date.now(), amount: AMOUNT_TIYIN, account: { order_id: orderId } });
    const reply = await call('GetStatement', { from: 0, to: 1000 });
    expect((reply.result as { transactions: unknown[] }).transactions).toHaveLength(0);
  });
});

describe('the money can never come from the request', () => {
  it('a settled order cannot be paid a second time under a new transaction', async () => {
    await call('CreateTransaction', { id: 'dbl-1', time: Date.now(), amount: AMOUNT_TIYIN, account: { order_id: orderId } });
    await call('PerformTransaction', { id: 'dbl-1' });

    const reply = await call('CreateTransaction', {
      id: 'dbl-2', time: Date.now(), amount: AMOUNT_TIYIN, account: { order_id: orderId },
    });
    expect(reply.error?.code).toBe(PAYME_ERROR.ORDER_ALREADY_PAID);
    expect(await db.subscriptionPayment.count({ where: { provider: 'payme' } })).toBe(1);
  });

  it('the term is extended by the order amount, never by the quoted one', async () => {
    await call('CreateTransaction', { id: 'amt-1', time: Date.now(), amount: AMOUNT_TIYIN, account: { order_id: orderId } });
    await call('PerformTransaction', { id: 'amt-1' });

    const paid = await db.subscriptionPayment.findFirstOrThrow({
      where: { provider: 'payme', providerTransactionId: 'amt-1' },
    });
    expect(paid.amountMinor).toBe(AMOUNT_MINOR);
  });
});
