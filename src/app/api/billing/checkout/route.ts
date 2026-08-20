import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { json, orgMutation, readJson } from '@/lib/api';
import { startCheckoutSchema } from '@/lib/validation/schemas';
import { paymentProvider, PLANS } from '@/lib/payments';
import { enforce } from '@/lib/security/rate-limit';
import { env } from '@/lib/env';
import { audit } from '@/lib/security/audit';

/**
 * Creates a pending billing intent and hands back the provider's checkout URL.
 * Nothing about the subscription changes here - activation happens only when a
 * signed webhook (or an explicit server-side status fetch) confirms payment.
 */
export const POST = orgMutation(async (ctx, request) => {
  const body = await readJson(request, startCheckoutSchema);
  await enforce('billing:intent:org', ctx.orgId);

  const plan = PLANS[body.plan];
  const idempotencyKey = `${ctx.orgId}:${body.plan}:${randomBytes(8).toString('hex')}`;

  const intent = await prisma.billingIntent.create({
    data: {
      organizationId: ctx.orgId,
      plan: body.plan,
      amountMinor: plan.priceMinor,
      currency: plan.currency,
      provider: paymentProvider.name,
      idempotencyKey,
      createdByUserId: ctx.user.userId,
    },
  });

  const checkout = await paymentProvider.createCheckout({
    organizationId: ctx.orgId,
    plan: body.plan,
    amountMinor: plan.priceMinor,
    currency: plan.currency,
    idempotencyKey,
    returnUrl: `${env.APP_URL}/settings/billing`,
  });

  if (checkout.providerRef) {
    await prisma.billingIntent.update({
      where: { id: intent.id },
      data: { providerRef: checkout.providerRef },
    });
  }

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.user.userId,
    action: 'billing.checkout.create',
    entityType: 'billing_intent',
    entityId: intent.id,
    meta: { plan: body.plan, provider: paymentProvider.name },
  });

  return json({
    intentId: intent.id,
    redirectUrl: checkout.redirectUrl,
    unavailable: checkout.unavailable ?? false,
    messageKey: checkout.unavailable ? 'settings.billingNotConfigured' : undefined,
  }, { status: 201 });
}, 'OWNER');
