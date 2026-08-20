import { noContent, orgMutation } from '@/lib/api';
import { deleteGrade } from '@/lib/domain/grades';

type Params = { id: string };

export const DELETE = orgMutation<Params>(async (ctx, _request, { id }) => {
  await deleteGrade(ctx, id);
  return noContent();
}, 'grades.write');
