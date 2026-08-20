import { prisma } from '@/lib/db';
import { adminMutation, adminRoute, json, readJson } from '@/lib/api';
import { adminManualPaymentSchema } from '@/lib/validation/schemas';
import { applySuccessfulPayment, currentSubscription } from '@/lib/domain/subscription';
import { parseAmountToMinor } from '@/lib/money';
import { auditAdmin } from '@/lib/admin';
import { isUuid } from '@/lib/tenant';
import { BadRequest, NotFound } from '@/lib/errors';

type Params = { id: string };

async function loadCenter(id: string) {
  if (!isUuid(id)) throw NotFound();
  const org = await prisma.organization.findFirst({ where: { id, deletedAt: null } });
  if (!org) throw NotFound();
  return org;
}

export const GET = adminRoute<Params>(async (_admin, _request, params) => {
  const org = await loadCenter(params.id);
  const [subscription, payments] = await Promise.all([
    currentSubscription(org.id),
    prisma.subscriptionPayment.findMany({
      where: { organizationId: org.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);
  return json({ subscription, payments });
});

/**
 * Records a payment that arrived outside a provider — a bank transfer, or cash
 * at the office. This is the only way a subscription can be extended without a
 * signed webhook, it is available to platform staff only, and every use is
 * audited with the reference the operator supplied.
 */
export const POST = adminMutation<Params>(async (admin, request, params) => {
  const org = await loadCenter(params.id);
  const body = await readJson(request, adminManualPaymentSchema);

  const amountMinor = parseAmountToMinor(body.amount, body.currency);
  if (amountMinor <= 0n) throw BadRequest('errors.invalidAmount');

  const until = await applySuccessfulPayment({
    organizationId: org.id,
    amountMinor,
    currency: body.currency,
    provider: 'offline',
    providerTransactionId: `offline:${org.id}:${body.reference}`,
    paidAt: new Date(`${body.paidAt}T12:00:00Z`),
  });

  await auditAdmin({
    adminId: admin.adminId,
    organizationId: org.id,
    action: 'admin.subscription.manual_payment',
    entityType: 'subscription',
    entityId: org.id,
    meta: {
      amountMinor: amountMinor.toString(),
      currency: body.currency,
      reference: body.reference,
      months: body.months,
      until: until.toISOString(),
    },
  });

  return json({ ok: true, until }, { status: 201 });
});
