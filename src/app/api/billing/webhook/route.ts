import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { paymentProvider, PLANS } from '@/lib/payments';
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
    return NextResponse.json({ ok: true });
  }

  const periodDays = PLANS[intent.plan].periodDays ?? 30;
  const now = new Date();

  await prisma.$transaction([
    prisma.billingIntent.update({
      where: { id: intent.id },
      data: { status: 'SUCCEEDED', verifiedAt: now },
    }),
    prisma.subscription.upsert({
      where: { organizationId: intent.organizationId },
      create: {
        organizationId: intent.organizationId,
        plan: intent.plan,
        status: 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + periodDays * 86_400_000),
        provider: paymentProvider.name,
        providerRef: intent.providerRef,
      },
      update: {
        plan: intent.plan,
        status: 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + periodDays * 86_400_000),
        provider: paymentProvider.name,
        providerRef: intent.providerRef,
        cancelAtPeriodEnd: false,
      },
    }),
    prisma.webhookEvent.updateMany({
      where: { provider: paymentProvider.name, externalId: verification.externalId },
      data: { processedAt: now },
    }),
  ]);

  await audit({
    organizationId: intent.organizationId,
    action: 'billing.subscription.activate',
    entityType: 'subscription',
    entityId: intent.organizationId,
    meta: { plan: intent.plan },
  });

  return NextResponse.json({ ok: true });
}
