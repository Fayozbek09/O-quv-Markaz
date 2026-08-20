import { json, orgMutation, orgRoute, readJson, readQuery } from '@/lib/api';
import { calendarQuerySchema, lessonInputSchema } from '@/lib/validation/schemas';
import { createLesson, listLessons } from '@/lib/domain/lessons';
import { orgTimezone } from '@/lib/domain/org';

export const GET = orgRoute(async (ctx, request) => {
  const query = readQuery(request, calendarQuerySchema);
  const tz = await orgTimezone(ctx);
  return json({ lessons: await listLessons(ctx, query, tz), timezone: tz });
});

export const POST = orgMutation(async (ctx, request) => {
  const body = await readJson(request, lessonInputSchema);
  const tz = await orgTimezone(ctx);
  return json(await createLesson(ctx, body, tz), { status: 201 });
});
