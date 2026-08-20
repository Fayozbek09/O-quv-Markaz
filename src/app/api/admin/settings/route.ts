import { adminMutation, adminRoute, json, readJson } from '@/lib/api';
import { platformPricingSchema } from '@/lib/validation/schemas';
import { getPricing, setPricing } from '@/lib/domain/settings';
import { auditAdmin } from '@/lib/admin';

export const GET = adminRoute(async () => json(await getPricing()));

/**
 * Changes the platform price, trial length or grace window. Existing
 * subscriptions keep the amount snapshotted on their own row, so this affects
 * new centres and renewals rather than silently re-pricing a live customer.
 */
export const PUT = adminMutation(async (admin, request) => {
  const body = await readJson(request, platformPricingSchema);
  const before = await getPricing();
  const after = await setPricing(body, admin.adminId);

  await auditAdmin({
    adminId: admin.adminId,
    action: 'admin.pricing.update',
    entityType: 'platform_setting',
    before: { ...before, monthlyPriceMinor: before.monthlyPriceMinor.toString() },
    after: { ...after, monthlyPriceMinor: after.monthlyPriceMinor.toString() },
  });

  return json(after);
});
