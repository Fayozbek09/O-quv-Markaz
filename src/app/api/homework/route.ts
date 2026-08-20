import { json, orgMutation, orgRoute, readJson, readQuery } from '@/lib/api';
import { homeworkInputSchema, homeworkListQuerySchema } from '@/lib/validation/schemas';
import { createHomework, listHomework } from '@/lib/domain/homework';

export const GET = orgRoute(async (ctx, request) => {
  const query = readQuery(request, homeworkListQuerySchema);
  return json(await listHomework(ctx, query));
}, 'homework.read');

export const POST = orgMutation(async (ctx, request) => {
  const body = await readJson(request, homeworkInputSchema);
  return json(await createHomework(ctx, body), { status: 201 });
}, 'homework.write');
