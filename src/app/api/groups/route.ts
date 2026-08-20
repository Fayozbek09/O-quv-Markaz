import { json, orgMutation, orgRoute, readJson } from '@/lib/api';
import { groupInputSchema } from '@/lib/validation/schemas';
import { createGroup, listGroups } from '@/lib/domain/groups';

export const GET = orgRoute(async (ctx, request) => {
  const includeArchived = new URL(request.url).searchParams.get('archived') === '1';
  return json({ groups: await listGroups(ctx, includeArchived) });
}, 'groups.read');

export const POST = orgMutation(async (ctx, request) => {
  const body = await readJson(request, groupInputSchema);
  return json(await createGroup(ctx, body), { status: 201 });
}, 'groups.create');
