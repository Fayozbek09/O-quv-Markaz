import { json, orgMutation, orgRoute, readJson } from '@/lib/api';
import { createStaffSchema } from '@/lib/validation/schemas';
import { createStaff, listStaff } from '@/lib/domain/staff';
import type { OrgRole } from '@/generated/prisma/enums';

export const GET = orgRoute(async (ctx, request) => {
  const role = new URL(request.url).searchParams.get('role');
  const valid = ['OWNER', 'ADMIN', 'RECEPTIONIST', 'TEACHER', 'ASSISTANT'];
  return json({
    rows: await listStaff(ctx, { role: role && valid.includes(role) ? (role as OrgRole) : 'ALL' }),
  });
}, 'staff.read');

/**
 * Creates a teacher or receptionist. The response carries the one and only
 * copy of the generated password; it is never stored in plaintext and cannot
 * be retrieved again — only re-issued.
 */
export const POST = orgMutation(async (ctx, request) => {
  const body = await readJson(request, createStaffSchema);
  return json(await createStaff(ctx, body), { status: 201 });
}, 'staff.read');
