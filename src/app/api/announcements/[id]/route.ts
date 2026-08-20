import { json, noContent, orgMutation, readJson } from '@/lib/api';
import { announcementInputSchema } from '@/lib/validation/schemas';
import { deleteAnnouncement, updateAnnouncement } from '@/lib/domain/announcements';

type Params = { id: string };

export const PUT = orgMutation<Params>(async (ctx, request, { id }) => {
  const body = await readJson(request, announcementInputSchema);
  return json(await updateAnnouncement(ctx, id, body));
}, 'notifications.send');

export const DELETE = orgMutation<Params>(async (ctx, _request, { id }) => {
  await deleteAnnouncement(ctx, id);
  return noContent();
}, 'notifications.send');
