import { json, orgMutation, orgRoute, readJson, readQuery } from '@/lib/api';
import { studentInputSchema, studentListQuerySchema } from '@/lib/validation/schemas';
import { createStudent, listStudents } from '@/lib/domain/students';

export const GET = orgRoute(async (ctx, request) => {
  const query = readQuery(request, studentListQuerySchema);
  return json(await listStudents(ctx, query));
}, 'students.read');

export const POST = orgMutation(async (ctx, request) => {
  const body = await readJson(request, studentInputSchema);
  return json(await createStudent(ctx, body), { status: 201 });
}, 'students.create');
