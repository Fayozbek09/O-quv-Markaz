import { z } from 'zod';
import { json, orgMutation, orgRoute, readJson, readQuery } from '@/lib/api';
import { generateInvoicesSchema } from '@/lib/validation/schemas';
import { generateInvoices, listInvoices } from '@/lib/domain/payments';

const querySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

export const GET = orgRoute(async (ctx, request) => {
  const { year, month } = readQuery(request, querySchema);
  return json({ invoices: await listInvoices(ctx, year, month) });
}, 'invoices.read');

export const POST = orgMutation(async (ctx, request) => {
  const body = await readJson(request, generateInvoicesSchema);
  return json(await generateInvoices(ctx, body), { status: 201 });
}, 'invoices.write');
