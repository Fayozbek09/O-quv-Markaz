import { z } from 'zod';
import { json, noContent, orgMutation, readJson } from '@/lib/api';
import { groupMemberSchema } from '@/lib/validation/schemas';
import { addMember, removeMember } from '@/lib/domain/groups';
import { uuidSchema } from '@/lib/validation/common';

type Params = { id: string };

export const POST = orgMutation<Params>(async (ctx, request, { id }) => {
  const body = await readJson(request, groupMemberSchema);
  await addMember(ctx, id, body.studentId, body.feeOverride ?? null);
  return json({ ok: true }, { status: 201 });
});

export const DELETE = orgMutation<Params>(async (ctx, request, { id }) => {
  const body = await readJson(request, z.object({ studentId: uuidSchema }).strict());
  await removeMember(ctx, id, body.studentId);
  return noContent();
});
