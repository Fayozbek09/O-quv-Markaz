import { json, readJson, sessionMutation } from '@/lib/api';
import { studentSubmitSchema } from '@/lib/validation/schemas';
import { requireStudent, submitHomework } from '@/lib/domain/portal';
import { audit } from '@/lib/security/audit';
import { isUuid } from '@/lib/tenant';
import { NotFound } from '@/lib/errors';

/**
 * A student hands in their own work. The homework id is validated against the
 * student's own submission rows, so a stranger's id resolves to 404.
 */
export const PUT = sessionMutation(async (user, request) => {
  const id = new URL(request.url).pathname.split('/').pop() ?? '';
  if (!isUuid(id)) throw NotFound();

  const sc = await requireStudent(user);
  const body = await readJson(request, studentSubmitSchema);
  const submission = await submitHomework(sc, id, {
    note: body.note,
    fileId: body.fileId ?? null,
  });

  await audit({
    organizationId: sc.organizationId,
    actorUserId: user.userId,
    action: 'homework.submit',
    entityType: 'homework_submission',
    entityId: submission.id,
  });

  return json({ ok: true, status: submission.status });
});
