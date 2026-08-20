import { json, orgMutation, orgRoute, readJson, readQuery } from '@/lib/api';
import { gradeInputSchema, gradeListQuerySchema } from '@/lib/validation/schemas';
import { createGrade, listGrades } from '@/lib/domain/grades';

export const GET = orgRoute(async (ctx, request) => {
  const query = readQuery(request, gradeListQuerySchema);
  return json(await listGrades(ctx, query));
}, 'grades.read');

export const POST = orgMutation(async (ctx, request) => {
  const body = await readJson(request, gradeInputSchema);
  return json(await createGrade(ctx, body), { status: 201 });
}, 'grades.write');
