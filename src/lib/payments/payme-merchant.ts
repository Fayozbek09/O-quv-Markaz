import { createHash, timingSafeEqual } from 'node:crypto';
import { prisma } from '../db';
import { env } from '../env';
import { minorToHundredths, hundredthsToMinor } from '../money';
import { applySuccessfulPayment } from '../domain/subscription';
import { audit } from '../security/audit';

/**
 * The Payme (paycom.uz) Merchant API.
 *
 * Payme does not post a "paid" notification. It drives a state machine over
 * JSON-RPC and expects the merchant to hold the state and to answer a repeated
 * call *identically* — the same transaction, the same timestamps, the same
 * state — because their gateway retries until it gets a well-formed answer.
 * That is why this is a protocol implementation rather than a signature check:
 * getting the security right but the shapes wrong means the gateway retries
 * forever and the merchant fails Payme's certification.
 *
 * Two rules run through all of it:
 *
 *   - **Every reply is HTTP 200**, errors included. A non-200 is read as a
 *     transport fault and retried, so a business refusal has to travel inside
 *     the JSON-RPC envelope.
 *   - **Money is never taken from the request.** The amount Payme quotes is
 *     compared against the intent the centre actually created, and a mismatch
 *     is -31001. A crafted call cannot buy a year for the price of a month.
 *
 * Amounts arrive in **tiyin**. The ledger counts so'm for UZS, so everything
 * crossing this boundary is converted.
 */

/** Payme's error codes. The negative ranges are theirs, not ours. */
export const PAYME_ERROR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  UNAUTHORIZED: -32504,
  WRONG_AMOUNT: -31001,
  TRANSACTION_NOT_FOUND: -31003,
  CANNOT_PERFORM: -31008,
  /** The -31050…-31099 band is reserved for "something is wrong with the account". */
  ORDER_NOT_FOUND: -31050,
  ORDER_ALREADY_PAID: -31051,
  ORDER_IN_PROGRESS: -31052,
} as const;

/** State values Payme understands. */
export const PAYME_STATE = {
  CREATED: 1,
  PERFORMED: 2,
  CANCELLED_BEFORE_PERFORM: -1,
  CANCELLED_AFTER_PERFORM: -2,
} as const;

/**
 * A transaction left unfinished for this long is dead. Payme's own rule: a
 * PerformTransaction arriving after it must cancel with reason 4 rather than
 * settle a charge the payer has long since abandoned.
 */
const TRANSACTION_TIMEOUT_MS = 12 * 60 * 60 * 1000;
const TIMEOUT_REASON = 4;

type Localized = { ru: string; uz: string; en: string };

const MESSAGES: Record<number, Localized> = {
  [PAYME_ERROR.PARSE]: { ru: 'Ошибка разбора JSON', uz: 'JSON tahlil xatosi', en: 'JSON parse error' },
  [PAYME_ERROR.INVALID_REQUEST]: { ru: 'Неверный запрос', uz: "Noto'g'ri so'rov", en: 'Invalid request' },
  [PAYME_ERROR.METHOD_NOT_FOUND]: { ru: 'Метод не найден', uz: 'Metod topilmadi', en: 'Method not found' },
  [PAYME_ERROR.UNAUTHORIZED]: { ru: 'Недостаточно привилегий', uz: 'Huquqlar yetarli emas', en: 'Insufficient privileges' },
  [PAYME_ERROR.WRONG_AMOUNT]: { ru: 'Неверная сумма', uz: "Noto'g'ri summa", en: 'Incorrect amount' },
  [PAYME_ERROR.TRANSACTION_NOT_FOUND]: { ru: 'Транзакция не найдена', uz: 'Tranzaksiya topilmadi', en: 'Transaction not found' },
  [PAYME_ERROR.CANNOT_PERFORM]: { ru: 'Невозможно выполнить операцию', uz: 'Amalni bajarib bo‘lmaydi', en: 'Unable to perform operation' },
  [PAYME_ERROR.ORDER_NOT_FOUND]: { ru: 'Заказ не найден', uz: 'Buyurtma topilmadi', en: 'Order not found' },
  [PAYME_ERROR.ORDER_ALREADY_PAID]: { ru: 'Заказ уже оплачен', uz: "Buyurtma allaqachon to'langan", en: 'Order is already paid' },
  [PAYME_ERROR.ORDER_IN_PROGRESS]: { ru: 'Заказ обрабатывается', uz: 'Buyurtma bajarilmoqda', en: 'Order is being processed' },
};

export type JsonRpcReply = {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: Localized; data?: string };
};

const ok = (id: number | string | null, result: unknown): JsonRpcReply => ({
  jsonrpc: '2.0',
  id,
  result,
});

const fail = (id: number | string | null, code: number, data?: string): JsonRpcReply => ({
  jsonrpc: '2.0',
  id,
  error: {
    code,
    message: MESSAGES[code] ?? MESSAGES[PAYME_ERROR.CANNOT_PERFORM]!,
    ...(data ? { data } : {}),
  },
});

/**
 * Constant-time comparison of the Basic credential. Payme authenticates with
 * `Basic base64("Paycom:<key>")`; a length-independent compare keeps the key
 * from being recovered a byte at a time.
 */
function constantTimeEqual(a: string, b: string): boolean {
  // Digest both sides first so the compare is over equal-length buffers and
  // the key's length is not itself a signal.
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest(),
  );
}

function authorized(headerValue: string | undefined): boolean {
  if (!env.PAYME_SECRET_KEY) return false;
  if (!headerValue?.startsWith('Basic ')) return false;

  let decoded: string;
  try {
    decoded = Buffer.from(headerValue.slice(6), 'base64').toString('utf8');
  } catch {
    return false;
  }
  return constantTimeEqual(decoded, `Paycom:${env.PAYME_SECRET_KEY}`);
}

type Params = {
  id?: string;
  time?: number;
  amount?: number;
  reason?: number;
  from?: number;
  to?: number;
  account?: { order_id?: string };
};

/**
 * Resolves the order named by `account.order_id` and checks that the amount
 * Payme quotes matches what the centre was actually asked for.
 */
type ResolvedOrder =
  | { ok: false; error: number; data: string }
  | { ok: true; intent: Awaited<ReturnType<typeof prisma.billingIntent.findUniqueOrThrow>> };

async function resolveOrder(params: Params): Promise<ResolvedOrder> {
  const orderId = params.account?.order_id;
  if (!orderId || typeof orderId !== 'string') {
    return { ok: false, error: PAYME_ERROR.ORDER_NOT_FOUND, data: 'order_id' };
  }

  const intent = await prisma.billingIntent.findUnique({ where: { idempotencyKey: orderId } });
  if (!intent) return { ok: false, error: PAYME_ERROR.ORDER_NOT_FOUND, data: 'order_id' };
  if (intent.status === 'SUCCEEDED') {
    return { ok: false, error: PAYME_ERROR.ORDER_ALREADY_PAID, data: 'order_id' };
  }
  if (intent.status !== 'PENDING') {
    return { ok: false, error: PAYME_ERROR.ORDER_NOT_FOUND, data: 'order_id' };
  }

  const quoted = BigInt(params.amount ?? 0);
  const expected = minorToHundredths(intent.amountMinor, intent.currency);
  if (quoted !== expected) return { ok: false, error: PAYME_ERROR.WRONG_AMOUNT, data: 'amount' };

  return { ok: true, intent };
}

async function checkPerformTransaction(id: JsonRpcReply['id'], params: Params) {
  const resolved = await resolveOrder(params);
  if (!resolved.ok) return fail(id, resolved.error, resolved.data);

  // An order already being paid by another transaction must not be offered a
  // second one; Payme would then hold two reservations against one charge.
  const active = await prisma.paymeTransaction.count({
    where: { intentId: resolved.intent.id, state: PAYME_STATE.CREATED },
  });
  if (active > 0) return fail(id, PAYME_ERROR.ORDER_IN_PROGRESS, 'order_id');

  return ok(id, { allow: true });
}

async function createTransaction(id: JsonRpcReply['id'], params: Params) {
  if (!params.id) return fail(id, PAYME_ERROR.INVALID_REQUEST, 'id');

  const existing = await prisma.paymeTransaction.findUnique({ where: { paymeId: params.id } });
  if (existing) {
    // A repeated create is normal: answer with what we already hold rather
    // than making a second reservation.
    if (existing.state !== PAYME_STATE.CREATED) {
      return fail(id, PAYME_ERROR.CANNOT_PERFORM, 'id');
    }
    if (Date.now() - Number(existing.createTime) > TRANSACTION_TIMEOUT_MS) {
      await prisma.paymeTransaction.update({
        where: { id: existing.id },
        data: {
          state: PAYME_STATE.CANCELLED_BEFORE_PERFORM,
          reason: TIMEOUT_REASON,
          cancelTime: BigInt(Date.now()),
        },
      });
      return fail(id, PAYME_ERROR.CANNOT_PERFORM, 'id');
    }
    return ok(id, {
      create_time: Number(existing.createTime),
      transaction: existing.id,
      state: existing.state,
    });
  }

  const resolved = await resolveOrder(params);
  if (!resolved.ok) return fail(id, resolved.error, resolved.data);

  const active = await prisma.paymeTransaction.count({
    where: { intentId: resolved.intent.id, state: PAYME_STATE.CREATED },
  });
  if (active > 0) return fail(id, PAYME_ERROR.ORDER_IN_PROGRESS, 'order_id');

  const now = Date.now();
  const created = await prisma.paymeTransaction.create({
    data: {
      paymeId: params.id,
      intentId: resolved.intent.id,
      organizationId: resolved.intent.organizationId,
      amountMinor: resolved.intent.amountMinor,
      state: PAYME_STATE.CREATED,
      paymeTime: BigInt(params.time ?? now),
      createTime: BigInt(now),
    },
  });

  await audit({
    organizationId: resolved.intent.organizationId,
    action: 'billing.payme.create',
    entityType: 'billing_intent',
    entityId: resolved.intent.id,
    meta: { paymeId: params.id },
  });

  return ok(id, {
    create_time: Number(created.createTime),
    transaction: created.id,
    state: created.state,
  });
}

async function performTransaction(id: JsonRpcReply['id'], params: Params) {
  if (!params.id) return fail(id, PAYME_ERROR.INVALID_REQUEST, 'id');

  const row = await prisma.paymeTransaction.findUnique({
    where: { paymeId: params.id },
    include: { intent: true },
  });
  if (!row) return fail(id, PAYME_ERROR.TRANSACTION_NOT_FOUND, 'id');

  // Already settled: repeat the same answer. Payme retries, and a second
  // settlement would extend the term twice.
  if (row.state === PAYME_STATE.PERFORMED) {
    return ok(id, {
      transaction: row.id,
      perform_time: Number(row.performTime),
      state: row.state,
    });
  }

  if (row.state !== PAYME_STATE.CREATED) return fail(id, PAYME_ERROR.CANNOT_PERFORM, 'id');

  if (Date.now() - Number(row.createTime) > TRANSACTION_TIMEOUT_MS) {
    await prisma.paymeTransaction.update({
      where: { id: row.id },
      data: {
        state: PAYME_STATE.CANCELLED_BEFORE_PERFORM,
        reason: TIMEOUT_REASON,
        cancelTime: BigInt(Date.now()),
      },
    });
    return fail(id, PAYME_ERROR.CANNOT_PERFORM, 'id');
  }

  const now = Date.now();
  await prisma.$transaction([
    prisma.paymeTransaction.update({
      where: { id: row.id },
      data: { state: PAYME_STATE.PERFORMED, performTime: BigInt(now) },
    }),
    prisma.billingIntent.update({
      where: { id: row.intentId },
      data: { status: 'SUCCEEDED', verifiedAt: new Date(now) },
    }),
  ]);

  // The term is extended here and nowhere else on this path. Replaying the
  // same Payme transaction id is a no-op inside applySuccessfulPayment.
  await applySuccessfulPayment({
    organizationId: row.organizationId,
    amountMinor: row.amountMinor,
    currency: row.intent.currency,
    provider: 'payme',
    providerTransactionId: row.paymeId,
    paidAt: new Date(now),
  });

  await audit({
    organizationId: row.organizationId,
    action: 'billing.payme.perform',
    entityType: 'billing_intent',
    entityId: row.intentId,
    meta: { paymeId: row.paymeId, amountMinor: row.amountMinor.toString() },
  });

  return ok(id, { transaction: row.id, perform_time: now, state: PAYME_STATE.PERFORMED });
}

async function cancelTransaction(id: JsonRpcReply['id'], params: Params) {
  if (!params.id) return fail(id, PAYME_ERROR.INVALID_REQUEST, 'id');

  const row = await prisma.paymeTransaction.findUnique({ where: { paymeId: params.id } });
  if (!row) return fail(id, PAYME_ERROR.TRANSACTION_NOT_FOUND, 'id');

  // Already cancelled: same answer again.
  if (row.state < 0) {
    return ok(id, { transaction: row.id, cancel_time: Number(row.cancelTime), state: row.state });
  }

  const now = Date.now();
  const nextState =
    row.state === PAYME_STATE.PERFORMED
      ? PAYME_STATE.CANCELLED_AFTER_PERFORM
      : PAYME_STATE.CANCELLED_BEFORE_PERFORM;

  await prisma.paymeTransaction.update({
    where: { id: row.id },
    data: { state: nextState, reason: params.reason ?? null, cancelTime: BigInt(now) },
  });

  await prisma.billingIntent.update({
    where: { id: row.intentId },
    data: { status: 'CANCELED' },
  });

  /*
   * A cancellation after settlement is a refund. The charge is marked
   * refunded so the ledger tells the truth, and the term is deliberately NOT
   * clawed back here: the subscription lapses on its own date, and taking a
   * centre's access away from inside a payment callback is the kind of action
   * that should be a decision, not a side effect. The audit row makes it
   * visible to the platform admin either way.
   */
  await prisma.subscriptionPayment.updateMany({
    where: { provider: 'payme', providerTransactionId: row.paymeId },
    data: { status: 'REFUNDED', failureReason: `payme_cancel_reason_${params.reason ?? 'none'}` },
  });

  await audit({
    organizationId: row.organizationId,
    action: 'billing.payme.cancel',
    outcome: 'denied',
    entityType: 'billing_intent',
    entityId: row.intentId,
    meta: { paymeId: row.paymeId, reason: params.reason ?? null, afterPerform: nextState === -2 },
  });

  return ok(id, { transaction: row.id, cancel_time: now, state: nextState });
}

async function checkTransaction(id: JsonRpcReply['id'], params: Params) {
  if (!params.id) return fail(id, PAYME_ERROR.INVALID_REQUEST, 'id');

  const row = await prisma.paymeTransaction.findUnique({ where: { paymeId: params.id } });
  if (!row) return fail(id, PAYME_ERROR.TRANSACTION_NOT_FOUND, 'id');

  return ok(id, {
    create_time: Number(row.createTime),
    perform_time: Number(row.performTime),
    cancel_time: Number(row.cancelTime),
    transaction: row.id,
    state: row.state,
    reason: row.reason ?? null,
  });
}

async function getStatement(id: JsonRpcReply['id'], params: Params) {
  const from = BigInt(params.from ?? 0);
  const to = BigInt(params.to ?? Date.now());

  const rows = await prisma.paymeTransaction.findMany({
    where: { createTime: { gte: from, lte: to } },
    include: { intent: { select: { idempotencyKey: true } } },
    orderBy: { createTime: 'asc' },
    take: 5000,
  });

  return ok(id, {
    transactions: rows.map((row) => ({
      id: row.paymeId,
      time: Number(row.paymeTime),
      amount: Number(minorToHundredths(row.amountMinor, 'UZS')),
      account: { order_id: row.intent.idempotencyKey },
      create_time: Number(row.createTime),
      perform_time: Number(row.performTime),
      cancel_time: Number(row.cancelTime),
      transaction: row.id,
      state: row.state,
      reason: row.reason ?? null,
    })),
  });
}

/**
 * Entry point. Always resolves — a thrown error would become a 500, which Payme
 * retries indefinitely.
 */
export async function handlePaymeRequest(input: {
  rawBody: string;
  authorization: string | undefined;
}): Promise<JsonRpcReply> {
  let payload: { id?: number | string; method?: string; params?: Params };
  try {
    payload = JSON.parse(input.rawBody) as typeof payload;
  } catch {
    return fail(null, PAYME_ERROR.PARSE);
  }

  const id = payload.id ?? null;

  if (!authorized(input.authorization)) {
    await audit({
      action: 'billing.payme.unauthorized',
      outcome: 'denied',
      meta: { method: payload.method ?? null },
    });
    return fail(id, PAYME_ERROR.UNAUTHORIZED);
  }

  const params = payload.params ?? {};

  try {
    switch (payload.method) {
      case 'CheckPerformTransaction':
        return await checkPerformTransaction(id, params);
      case 'CreateTransaction':
        return await createTransaction(id, params);
      case 'PerformTransaction':
        return await performTransaction(id, params);
      case 'CancelTransaction':
        return await cancelTransaction(id, params);
      case 'CheckTransaction':
        return await checkTransaction(id, params);
      case 'GetStatement':
        return await getStatement(id, params);
      default:
        return fail(id, PAYME_ERROR.METHOD_NOT_FOUND, payload.method ?? '');
    }
  } catch (error) {
    // Never leak the detail; the server log keeps it.
    console.error('[payme]', error instanceof Error ? error.stack : error);
    return fail(id, PAYME_ERROR.CANNOT_PERFORM);
  }
}

/** Exported for tests: what a given so'm amount looks like in tiyin. */
export const toTiyin = (amountMinor: bigint, currency = 'UZS') =>
  minorToHundredths(amountMinor, currency);
export const fromTiyin = (tiyin: bigint, currency = 'UZS') => hundredthsToMinor(tiyin, currency);
