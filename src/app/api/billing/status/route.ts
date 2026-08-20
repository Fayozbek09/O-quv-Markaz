import { json, orgRoute } from '@/lib/api';
import { currentSubscription } from '@/lib/domain/subscription';
import { getPricing } from '@/lib/domain/settings';
import { prisma } from '@/lib/db';
import { scope } from '@/lib/tenant';

/** The centre's own subscription state and payment history. */
export const GET = orgRoute(async (ctx) => {
  const [subscription, pricing, payments] = await Promise.all([
    currentSubscription(ctx.orgId),
    getPricing(),
    prisma.subscriptionPayment.findMany({
      where: { ...scope.org(ctx) },
      orderBy: { createdAt: 'desc' },
      take: 24,
      select: {
        id: true, amountMinor: true, currency: true, provider: true, status: true,
        periodStart: true, periodEnd: true, paidAt: true, createdAt: true,
      },
    }),
  ]);
  return json({ subscription, pricing, payments });
}, 'center.billing');
