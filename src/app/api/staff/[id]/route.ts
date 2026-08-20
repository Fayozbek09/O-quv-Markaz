import { json, noContent, orgMutation, orgRoute, readJson } from '@/lib/api';
import { updateStaffSchema } from '@/lib/validation/schemas';
import { getStaff, removeStaff, updateStaff } from '@/lib/domain/staff';

type Params = { id: string };

export const GET = orgRoute<Params>(
  async (ctx, _request, { id }) => json(await getStaff(ctx, id)),
  'staff.read',
);

export const PUT = orgMutation<Params>(async (ctx, request, { id }) => {
  const body = await readJson(request, updateStaffSchema);
  await updateStaff(ctx, id, body);
  return json({ ok: true });
}, 'staff.read');

export const DELETE = orgMutation<Params>(async (ctx, _request, { id }) => {
  await removeStaff(ctx, id);
  return noContent();
}, 'staff.read');
