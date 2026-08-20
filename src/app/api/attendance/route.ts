import { json, orgMutation, readJson } from '@/lib/api';
import { attendanceMarkSchema } from '@/lib/validation/schemas';
import { markAttendance } from '@/lib/domain/attendance';

export const POST = orgMutation(async (ctx, request) => {
  const body = await readJson(request, attendanceMarkSchema);
  await markAttendance(ctx, body);
  return json({ ok: true });
}, 'attendance.write');
