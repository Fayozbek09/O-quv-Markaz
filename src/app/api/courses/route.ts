import { json, orgMutation, orgRoute, readJson } from '@/lib/api';
import { courseInputSchema } from '@/lib/validation/schemas';
import { createCourse, listCourses } from '@/lib/domain/courses';

export const GET = orgRoute(async (ctx) => json({ rows: await listCourses(ctx) }), 'courses.read');

export const POST = orgMutation(async (ctx, request) => {
  const body = await readJson(request, courseInputSchema);
  return json(await createCourse(ctx, body), { status: 201 });
}, 'courses.write');
