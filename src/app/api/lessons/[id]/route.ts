import { json, noContent, orgMutation, orgRoute, readJson } from '@/lib/api';
import { lessonInputSchema, lessonStatusSchema } from '@/lib/validation/schemas';
import { deleteLesson, getLesson, setLessonStatus, updateLesson } from '@/lib/domain/lessons';
import { orgTimezone } from '@/lib/domain/org';

type Params = { id: string };

export const GET = orgRoute<Params>(async (ctx, _request, { id }) => json(await getLesson(ctx, id)), 'lessons.read');

export const PUT = orgMutation<Params>(async (ctx, request, { id }) => {
  const body = await readJson(request, lessonInputSchema);
  const tz = await orgTimezone(ctx);
  return json(await updateLesson(ctx, id, body, tz));
}, 'lessons.write');

export const PATCH = orgMutation<Params>(async (ctx, request, { id }) => {
  const body = await readJson(request, lessonStatusSchema);
  await setLessonStatus(ctx, id, body);
  return json({ ok: true });
}, 'lessons.write');

export const DELETE = orgMutation<Params>(async (ctx, _request, { id }) => {
  await deleteLesson(ctx, id);
  return noContent();
}, 'lessons.write');
