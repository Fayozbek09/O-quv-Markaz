import { json, orgMutation, readJson } from '@/lib/api';
import { submissionMarkSchema } from '@/lib/validation/schemas';
import { markSubmissions } from '@/lib/domain/homework';

type Params = { id: string };

export const PUT = orgMutation<Params>(async (ctx, request, { id }) => {
  const body = await readJson(request, submissionMarkSchema);
  await markSubmissions(ctx, id, body);
  return json({ ok: true });
}, 'homework.grade');
