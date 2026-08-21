import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { paymentProvider } from '@/lib/payments';
import { handlePaymeRequest } from '@/lib/payments/payme-merchant';
import { env } from '@/lib/env';
import { applySuccessfulPayment } from '@/lib/domain/subscription';
import { sha256 } from '@/lib/crypto';
import { audit } from '@/lib/security/audit';

/**
 * Payment webhook. One URL, because a merchant cabinet is configured with one.
 *
 * Payme is dispatched away immediately: it is not a notify-once gateway but a
 * JSON-RPC state machine, and it is answered by `lib/payments/payme-merchant`.
 *
 * Everything else runs the generic pipeline, in order:
 *   1. the raw body must carry a valid provider signature/credential;
 *   2. the event id must not have been processed before (idempotency);
 *   3. the amount must match the intent the event claims to settle;
 *   4. only then is the subscription activated.
 *
 * A browser callback never reaches this path, and never activates a plan. The
 * reply is rendered by the adapter, because each gateway reads a different
 * envelope and a shape it does not recognise is not an acknowledgement.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 128 * 1024) return NextResponse.json({ ok: false }, { status: 413 });

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  if (env.PAYMENT_PROVIDER === 'payme') {
    const reply = await handlePaymeRequest({
      rawBody: raw,
      authorization: headers['authorization'],
    });
    // Always 200: Payme reads the envelope and retries anything else.
    return NextResponse.json(reply, { status: 200, headers: { 'cache-control': 'no-store' } });
  }

  const verification = await paymentProvider.verifyWebhook({ rawBody: raw, headers });

  const reply = (result: Parameters<typeof paymentProvider.renderReply>[0], intentId?: string) => {
    const rendered = paymentProvider.renderReply(result, { verification, intentId });
    return NextResponse.json(rendered.body, {
      status: rendered.status,
      headers: { 'cache-control': 'no-store' },
    });
  };

  if (!verification.ok) {
    await prisma.webhookEvent
      .create({
        data: {
          provider: paymentProvider.name,
          externalId: `rejected-${sha256(raw).slice(0, 32)}`,
          signatureOk: false,
          payloadHash: sha256(raw),
        },
      })
      .catch(() => undefined);
    await audit({ action: 'billing.webhook.rejected', outcome: 'denied', meta: { reason: verification.reason } });
    return reply({ kind: 'rejected', reason: verification.reason });
  }

  try {
    await prisma.webhookEvent.create({
      data: {
        provider: paymentProvider.name,
        externalId: verification.externalId,
        signatureOk: true,
        payloadHash: sha256(raw),
      },
    });
  } catch {
    // Already processed - acknowledge without repeating the side effects.
    const seen = await prisma.billingIntent.findUnique({
      where: { idempotencyKey: verification.idempotencyKey },
      select: { id: true },
    });
    return reply({ kind: 'duplicate' }, seen?.id);
  }

  const intent = await prisma.billingIntent.findUnique({
    where: { idempotencyKey: verification.idempotencyKey },
  });
  if (!intent) {
    await audit({ action: 'billing.webhook.unknown_intent', outcome: 'failure' });
    return reply({ kind: 'unknown_intent' });
  }

  // Trusting the provider's amount over our own record would let a tampered
  // event buy a year for the price of a month.
  if (verification.amountMinor !== intent.amountMinor) {
    await prisma.billingIntent.update({
      where: { id: intent.id },
      data: { status: 'FAILED' },
    });
    await audit({
      organizationId: intent.organizationId,
      action: 'billing.webhook.amount_mismatch',
      outcome: 'denied',
      entityType: 'billing_intent',
      entityId: intent.id,
    });
    return reply({ kind: 'amount_mismatch' }, intent.id);
  }

  // A multi-phase provider reserves before it settles. The reservation is
  // signed and recorded, but it buys nothing until the settling call arrives.
  if (verification.outcome === 'pending') {
    await prisma.webhookEvent.updateMany({
      where: { provider: paymentProvider.name, externalId: verification.externalId },
      data: { processedAt: new Date() },
    });
    return reply({ kind: 'reserved' }, intent.id);
  }

  if (verification.outcome !== 'succeeded') {
    await prisma.billingIntent.update({
      where: { id: intent.id },
      data: { status: verification.outcome === 'canceled' ? 'CANCELED' : 'FAILED' },
    });
    // The attempt is kept in the ledger; a failed charge never touches the term.
    await prisma.subscriptionPayment.updateMany({
      where: {
        organizationId: intent.organizationId,
        status: 'PENDING',
        providerTransactionId: intent.providerRef ?? intent.idempotencyKey,
      },
      data: { status: 'FAILED', failureReason: verification.outcome },
    });
    return reply({ kind: 'not_settled', outcome: verification.outcome }, intent.id);
  }

  const now = new Date();

  await prisma.$transaction([
    prisma.billingIntent.update({
      where: { id: intent.id },
      data: { status: 'SUCCEEDED', verifiedAt: now },
    }),
    prisma.webhookEvent.updateMany({
      where: { provider: paymentProvider.name, externalId: verification.externalId },
      data: { processedAt: now },
    }),
  ]);

  // The term is extended here, from a verified provider event only. Replaying
  // the same transaction id is a no-op (see applySuccessfulPayment).
  await applySuccessfulPayment({
    organizationId: intent.organizationId,
    amountMinor: intent.amountMinor,
    currency: intent.currency,
    provider: paymentProvider.name,
    providerTransactionId: verification.externalId,
    paidAt: now,
  });

  return reply({ kind: 'settled' }, intent.id);
}
