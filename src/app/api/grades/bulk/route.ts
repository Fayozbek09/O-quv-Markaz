import { json, orgMutation, readJson } from '@/lib/api';
import { gradeBulkSchema } from '@/lib/validation/schemas';
import { createGradesBulk } from '@/lib/domain/grades';

export const POST = orgMutation(async (ctx, request) => {
  const body = await readJson(request, gradeBulkSchema);
  return json(await createGradesBulk(ctx, body), { status: 201 });
}, 'grades.write');
