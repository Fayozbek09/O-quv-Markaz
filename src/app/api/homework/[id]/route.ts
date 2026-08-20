import { json, noContent, orgMutation, orgRoute, readJson } from '@/lib/api';
import { homeworkInputSchema } from '@/lib/validation/schemas';
import { deleteHomework, getHomework, updateHomework } from '@/lib/domain/homework';

type Params = { id: string };

export const GET = orgRoute<Params>(
  async (ctx, _request, { id }) => json(await getHomework(ctx, id)),
  'homework.read',
);

export const PUT = orgMutation<Params>(async (ctx, request, { id }) => {
  const body = await readJson(request, homeworkInputSchema);
  return json(await updateHomework(ctx, id, body));
}, 'homework.write');

export const DELETE = orgMutation<Params>(async (ctx, _request, { id }) => {
  await deleteHomework(ctx, id);
  return noContent();
}, 'homework.write');
