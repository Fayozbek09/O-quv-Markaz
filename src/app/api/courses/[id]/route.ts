import { json, noContent, orgMutation, readJson } from '@/lib/api';
import { courseInputSchema } from '@/lib/validation/schemas';
import { deleteCourse, updateCourse } from '@/lib/domain/courses';

type Params = { id: string };

export const PUT = orgMutation<Params>(async (ctx, request, { id }) => {
  const body = await readJson(request, courseInputSchema);
  return json(await updateCourse(ctx, id, body));
}, 'courses.write');

export const DELETE = orgMutation<Params>(async (ctx, _request, { id }) => {
  await deleteCourse(ctx, id);
  return noContent();
}, 'courses.write');
