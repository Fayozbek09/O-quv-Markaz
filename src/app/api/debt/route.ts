import { json, orgRoute, readQuery } from '@/lib/api';
import { debtQuerySchema } from '@/lib/validation/schemas';
import { listDebtors, orgBalance } from '@/lib/domain/billing';

export const GET = orgRoute(async (ctx, request) => {
  const query = readQuery(request, debtQuerySchema);
  const [debtors, totals] = await Promise.all([
    listDebtors(ctx, {
      overdueOnly: query.overdueOnly,
      q: query.q,
      limit: query.perPage,
      offset: (query.page - 1) * query.perPage,
    }),
    orgBalance(ctx),
  ]);
  return json({ ...debtors, totals });
});
