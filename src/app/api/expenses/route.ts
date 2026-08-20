import { json, orgMutation, orgRoute, readJson, readQuery } from '@/lib/api';
import { expenseInputSchema, financeQuerySchema } from '@/lib/validation/schemas';
import { createExpense, listExpenses } from '@/lib/domain/finance';
import { orgTimezone } from '@/lib/domain/org';

export const GET = orgRoute(async (ctx, request) => {
  const query = readQuery(request, financeQuerySchema);
  const tz = await orgTimezone(ctx);
  return json({ rows: await listExpenses(ctx, query.year, query.month, tz) });
}, 'expenses.read');

export const POST = orgMutation(async (ctx, request) => {
  const body = await readJson(request, expenseInputSchema);
  return json(await createExpense(ctx, body), { status: 201 });
}, 'expenses.write');
