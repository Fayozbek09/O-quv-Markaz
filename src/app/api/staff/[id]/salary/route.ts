import { json, orgMutation, readJson } from '@/lib/api';
import { updateSalarySchema } from '@/lib/validation/schemas';
import { updateSalary } from '@/lib/domain/staff';

type Params = { id: string };

/** Separately permissioned: editing a person is not editing their pay. */
export const PUT = orgMutation<Params>(async (ctx, request, { id }) => {
  const body = await readJson(request, updateSalarySchema);
  await updateSalary(ctx, id, body);
  return json({ ok: true });
}, 'salary.write');
