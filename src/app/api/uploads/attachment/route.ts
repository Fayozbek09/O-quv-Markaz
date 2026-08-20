import { prisma } from '@/lib/db';
import { json, toErrorResponse } from '@/lib/api';
import { requireUser, requireOrg } from '@/lib/tenant';
import { requireStudent } from '@/lib/domain/portal';
import { assertSubscriptionWritable } from '@/lib/domain/plan';
import { assertCsrf } from '@/lib/security/csrf';
import { enforce } from '@/lib/security/rate-limit';
import { processDocumentUpload, MAX_DOCUMENT_BYTES } from '@/lib/files/document';
import { newStorageKey, putObject, signFileUrl } from '@/lib/files/storage';
import { audit } from '@/lib/security/audit';
import { BadRequest, PayloadTooLarge } from '@/lib/errors';

const MAX_MULTIPART_BYTES = MAX_DOCUMENT_BYTES + 1024 * 1024;

/**
 * Files that hang off homework: the material a teacher attaches to an
 * assignment, and the work a student hands back.
 *
 * The upload only ever *creates* a file owned by the caller's centre and
 * returns its id. Linking that id to an assignment or a submission is a
 * separate, access-checked call — `createHomework` re-checks that every id
 * belongs to the centre, and `submitHomework` does the same — so obtaining a
 * file id here grants nothing on its own.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    await assertCsrf(user.csrfSecret);
    await enforce('upload:user', user.userId);

    const declared = request.headers.get('content-length');
    if (declared && Number(declared) > MAX_MULTIPART_BYTES) throw PayloadTooLarge();

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw BadRequest('errors.fileType');

    // A student uploads through the portal context, which is scoped to their
    // own enrolment; staff need the permission that lets them set homework.
    const isStudent = user.role === 'STUDENT';
    let organizationId: string;
    if (isStudent) {
      const sc = await requireStudent(user);
      organizationId = sc.organizationId;
    } else {
      const ctx = await requireOrg('homework.write');
      // This route is hand-rolled rather than wrapped in `orgMutation`, so the
      // gate that holds writes on a lapsed subscription is applied explicitly.
      await assertSubscriptionWritable(ctx, 'homework.write');
      organizationId = ctx.orgId;
    }

    const doc = await processDocumentUpload(file);
    const storageKey = newStorageKey(
      `org/${organizationId}/homework`,
      doc.extension,
    );
    await putObject(storageKey, doc.buffer);

    const created = await prisma.file.create({
      data: {
        organizationId,
        ownerUserId: user.userId,
        kind: isStudent ? 'HOMEWORK_SUBMISSION' : 'HOMEWORK_ATTACHMENT',
        storageKey,
        mimeType: doc.mimeType,
        sizeBytes: doc.sizeBytes,
        sha256: doc.sha256,
        width: doc.width,
        height: doc.height,
      },
    });

    await audit({
      organizationId,
      actorUserId: user.userId,
      action: 'file.upload',
      entityType: 'file',
      entityId: created.id,
      meta: { kind: created.kind, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes },
    });

    return json(
      {
        fileId: created.id,
        url: signFileUrl(created.id),
        mimeType: created.mimeType,
        sizeBytes: created.sizeBytes,
      },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
