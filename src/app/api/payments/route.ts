import { json, orgMutation, orgRoute, readJson, readQuery } from '@/lib/api';
import { paymentInputSchema, paymentListQuerySchema } from '@/lib/validation/schemas';
import { listPayments, recordPayment } from '@/lib/domain/payments';

export const GET = orgRoute(async (ctx, request) => {
  const query = readQuery(request, paymentListQuerySchema);
  return json(await listPayments(ctx, query));
});

export const POST = orgMutation(async (ctx, request) => {
  const body = await readJson(request, paymentInputSchema);
  return json(await recordPayment(ctx, body), { status: 201 });
});
