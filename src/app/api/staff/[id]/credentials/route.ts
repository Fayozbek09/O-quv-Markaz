import { json, orgMutation, readJson } from '@/lib/api';
import { issueCredentialsSchema } from '@/lib/validation/schemas';
import { reissueStaffCredentials } from '@/lib/domain/staff';

type Params = { id: string };

export const POST = orgMutation<Params>(async (ctx, request, { id }) => {
  const body = await readJson(request, issueCredentialsSchema);
  return json(await reissueStaffCredentials(ctx, id, body));
}, 'staff.read');
