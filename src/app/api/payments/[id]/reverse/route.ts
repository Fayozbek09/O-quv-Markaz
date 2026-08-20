import { json, orgMutation, readJson } from '@/lib/api';
import { paymentReverseSchema } from '@/lib/validation/schemas';
import { reversePayment } from '@/lib/domain/payments';

type Params = { id: string };

/**
 * Payments are immutable. This records a reversal in the adjustment ledger
 * instead of editing or deleting the original row.
 */
export const POST = orgMutation<Params>(async (ctx, request, { id }) => {
  const body = await readJson(request, paymentReverseSchema);
  await reversePayment(ctx, id, body.reason);
  return json({ ok: true });
}, 'ADMIN');
