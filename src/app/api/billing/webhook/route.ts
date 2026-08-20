import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { paymentProvider } from '@/lib/payments';
import { applySuccessfulPayment } from '@/lib/domain/subscription';
import { sha256 } from '@/lib/crypto';
import { audit } from '@/lib/security/audit';

/**
 * Payment webhook.
 *
 * Rules, in order:
 *   1. the raw body must carry a valid provider signature/credential;
 *   2. the event id must not have been processed before (idempotency);
 *   3. the amount must match the intent the event claims to settle;
 *   4. only then is the subscription activated.
 * A browser callback never reaches this path, and never activates a plan.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 128 * 1024) return NextResponse.json({ ok: false }, { status: 413 });

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const verification = await paymentProvider.verifyWebhook({ rawBody: raw, headers });

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
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
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
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const intent = await prisma.billingIntent.findUnique({
    where: { idempotencyKey: verification.idempotencyKey },
  });
  if (!intent) {
    await audit({ action: 'billing.webhook.unknown_intent', outcome: 'failure' });
    return NextResponse.json({ ok: true });
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
    return NextResponse.json({ error: 'amount_mismatch' }, { status: 400 });
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
    return NextResponse.json({ ok: true });
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

  return NextResponse.json({ ok: true });
}
