import { json, orgMutation, orgRoute, readJson } from '@/lib/api';
import { announcementInputSchema } from '@/lib/validation/schemas';
import { createAnnouncement, listAnnouncements } from '@/lib/domain/announcements';

export const GET = orgRoute(
  async (ctx) => json({ rows: await listAnnouncements(ctx) }),
  'notifications.send',
);

export const POST = orgMutation(async (ctx, request) => {
  const body = await readJson(request, announcementInputSchema);
  return json(await createAnnouncement(ctx, body), { status: 201 });
}, 'notifications.send');
