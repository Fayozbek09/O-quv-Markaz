import { json, orgMutation, orgRoute, readJson, readQuery } from '@/lib/api';
import { salaryPaymentSchema, salaryQuerySchema } from '@/lib/validation/schemas';
import { listSalaryPayments, ownSalary, recordSalaryPayment, salarySheet } from '@/lib/domain/salary';
import { orgTimezone } from '@/lib/domain/org';

/**
 * A teacher reading this endpoint gets their own line and nothing else; the
 * scoping happens here, not in the UI.
 */
export const GET = orgRoute(async (ctx, request) => {
  const query = readQuery(request, salaryQuerySchema);
  const tz = await orgTimezone(ctx);

  if (ctx.role === 'TEACHER') {
    return json(await ownSalary(ctx, query.year, query.month, tz));
  }
  const [sheet, payments] = await Promise.all([
    salarySheet(ctx, query, tz),
    listSalaryPayments(ctx, query.year, query.month),
  ]);
  return json({ sheet, payments });
}, 'salary.read');

export const POST = orgMutation(async (ctx, request) => {
  const body = await readJson(request, salaryPaymentSchema);
  return json(await recordSalaryPayment(ctx, body), { status: 201 });
}, 'salary.write');
