import { z } from 'zod';
import { json, orgRoute, readQuery } from '@/lib/api';
import { uuidSchema, localeSchema } from '@/lib/validation/common';
import { buildReminder } from '@/lib/domain/reminders';

const schema = z
  .object({ studentId: uuidSchema, template: z.enum(['DEBT', 'LESSON']), locale: localeSchema })
  .strict();

/** Renders exactly the text that would be sent, so the teacher can read it first. */
export const GET = orgRoute(async (ctx, request) => {
  const query = readQuery(request, schema);
  return json(await buildReminder(ctx, query));
}, 'notifications.send');
