import { json, noContent, orgMutation, orgRoute, readJson } from '@/lib/api';
import { studentInputSchema } from '@/lib/validation/schemas';
import { archiveStudent, getStudent, studentAttendanceStats, updateStudent } from '@/lib/domain/students';
import { studentBalance } from '@/lib/domain/billing';

type Params = { id: string };

export const GET = orgRoute<Params>(async (ctx, _request, { id }) => {
  const [student, balance, attendance] = await Promise.all([
    getStudent(ctx, id),
    studentBalance(ctx, id),
    studentAttendanceStats(ctx, id),
  ]);
  return json({ student, balance, attendance });
});

export const PUT = orgMutation<Params>(async (ctx, request, { id }) => {
  const body = await readJson(request, studentInputSchema);
  return json(await updateStudent(ctx, id, body));
});

/** Archive rather than destroy - attendance and payment history must survive. */
export const DELETE = orgMutation<Params>(async (ctx, _request, { id }) => {
  await archiveStudent(ctx, id);
  return noContent();
});
