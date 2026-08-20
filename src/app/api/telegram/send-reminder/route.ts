import { json, orgMutation, readJson } from '@/lib/api';
import { telegramSendReminderSchema } from '@/lib/validation/schemas';
import { sendReminder } from '@/lib/domain/reminders';

/**
 * Always sends, and only when the payload carries `confirm: true` - the schema
 * rejects anything else. The read-only preview lives at
 * /api/telegram/send-reminder/preview.
 */
export const POST = orgMutation(async (ctx, request) => {
  const body = await readJson(request, telegramSendReminderSchema);
  const result = await sendReminder(ctx, body);
  return json(result);
});
