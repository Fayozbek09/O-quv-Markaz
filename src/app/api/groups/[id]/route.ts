import { json, orgMutation, orgRoute, readJson } from '@/lib/api';
import { groupInputSchema, generateLessonsSchema } from '@/lib/validation/schemas';
import { generateLessons, getGroup, updateGroup } from '@/lib/domain/groups';
import { orgTimezone } from '@/lib/domain/org';

type Params = { id: string };

export const GET = orgRoute<Params>(async (ctx, _request, { id }) => json(await getGroup(ctx, id)), 'groups.read');

export const PUT = orgMutation<Params>(async (ctx, request, { id }) => {
  const body = await readJson(request, groupInputSchema);
  return json(await updateGroup(ctx, id, body));
}, 'groups.update');

/** Materializes the recurring schedule into lessons for a date range. */
export const POST = orgMutation<Params>(async (ctx, request, { id }) => {
  const body = await readJson(request, generateLessonsSchema);
  const tz = await orgTimezone(ctx);
  return json(await generateLessons(ctx, id, body, tz));
}, 'lessons.write');
