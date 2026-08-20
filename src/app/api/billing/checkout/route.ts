import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { json, orgMutation, readJson } from '@/lib/api';
import { startCheckoutSchema } from '@/lib/validation/schemas';
import { paymentProvider } from '@/lib/payments';
import { getPricing } from '@/lib/domain/settings';
import { currentSubscription } from '@/lib/domain/subscription';
import { enforce } from '@/lib/security/rate-limit';
import { env } from '@/lib/env';
import { audit } from '@/lib/security/audit';

/**
 * Creates a pending billing intent and hands back the provider's checkout URL.
 *
 * Nothing about the subscription changes here — activation happens only when a
 * signed webhook (or an explicit server-side status fetch) confirms payment.
 * The amount is computed here from platform settings, never taken from the
 * request, so a crafted body cannot buy a year for nothing.
 */
export const POST = orgMutation(async (ctx, request) => {
  const body = await readJson(request, startCheckoutSchema);
  await enforce('billing:intent:org', ctx.orgId);

  const [pricing, subscription] = await Promise.all([
    getPricing(),
    currentSubscription(ctx.orgId),
  ]);

  // Honour the price snapshotted on the subscription so an existing customer
  // is not silently re-priced mid-relationship.
  const unitMinor = subscription.amountMinor > 0n ? subscription.amountMinor : pricing.monthlyPriceMinor;
  const amountMinor = unitMinor * BigInt(body.months);
  const currency = subscription.currency || pricing.currency;
  const idempotencyKey = `${ctx.orgId}:STANDARD:${randomBytes(8).toString('hex')}`;

  const intent = await prisma.billingIntent.create({
    data: {
      organizationId: ctx.orgId,
      plan: 'STANDARD',
      amountMinor,
      currency,
      provider: paymentProvider.name,
      idempotencyKey,
      createdByUserId: ctx.actorUserId,
    },
  });

  const checkout = await paymentProvider.createCheckout({
    organizationId: ctx.orgId,
    plan: 'STANDARD',
    amountMinor,
    currency,
    idempotencyKey,
    returnUrl: `${env.APP_URL}/center/billing`,
  });

  if (checkout.providerRef) {
    await prisma.billingIntent.update({
      where: { id: intent.id },
      data: { providerRef: checkout.providerRef },
    });
  }

  await prisma.subscriptionPayment.create({
    data: {
      organizationId: ctx.orgId,
      subscriptionId: subscription.id,
      amountMinor,
      currency,
      provider: paymentProvider.name,
      providerTransactionId: checkout.providerRef ?? idempotencyKey,
      status: 'PENDING',
    },
  });

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    action: 'billing.checkout.create',
    entityType: 'billing_intent',
    entityId: intent.id,
    meta: { months: body.months, provider: paymentProvider.name, amountMinor: amountMinor.toString() },
  });

  return json(
    {
      intentId: intent.id,
      amountMinor: amountMinor.toString(),
      currency,
      redirectUrl: checkout.redirectUrl,
      unavailable: checkout.unavailable ?? false,
      messageKey: checkout.unavailable ? 'billing.providerNotConfigured' : undefined,
    },
    { status: 201 },
  );
}, 'center.billing');
