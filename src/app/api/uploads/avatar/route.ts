import { prisma } from '@/lib/db';
import { json, toErrorResponse } from '@/lib/api';
import { requireUser, requireOrg, isUuid } from '@/lib/tenant';
import { assertCsrf } from '@/lib/security/csrf';
import { enforce } from '@/lib/security/rate-limit';
import { processImageUpload } from '@/lib/files/image';
import { deleteObject, newStorageKey, putObject, signFileUrl } from '@/lib/files/storage';
import { assertSubscriptionWritable } from '@/lib/domain/plan';
import { audit } from '@/lib/security/audit';
import { BadRequest, NotFound, PayloadTooLarge } from '@/lib/errors';

const MAX_MULTIPART_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * Profile photos.
 *
 * Two subjects, one endpoint:
 *   - no `studentId`  → the caller's own photo. Every role may do this,
 *     students included, which is why it authenticates with `requireUser`
 *     rather than `requireOrg` (a student session is refused a tenant context
 *     by design).
 *   - with `studentId` → a student's photo, set by staff. That branch takes a
 *     full tenant context and the `students.update` permission, and the student
 *     is looked up inside the caller's centre, so an id from another centre is
 *     a 404 rather than a cross-tenant write.
 *
 * The bytes go through the same pipeline as the centre logo: decoded, checked,
 * stripped of metadata, re-encoded to WebP and stored under a random name.
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

    const rawStudentId = form.get('studentId');
    const studentId = typeof rawStudentId === 'string' && rawStudentId ? rawStudentId : null;
    if (studentId && !isUuid(studentId)) throw NotFound();

    // Resolve the target and the owning centre before spending time on pixels.
    let organizationId: string | null;
    let actorUserId: string | null;
    if (studentId) {
      const ctx = await requireOrg('students.update');
      // Setting someone else's photo is centre work, so a lapsed subscription
      // holds it. Changing your own photo below is not, and stays available.
      await assertSubscriptionWritable(ctx, 'students.update');
      const student = await prisma.student.findFirst({
        where: { id: studentId, organizationId: ctx.orgId, deletedAt: null },
        select: { id: true },
      });
      if (!student) throw NotFound();
      organizationId = ctx.orgId;
      actorUserId = ctx.actorUserId;
    } else {
      organizationId = user.activeOrgId ?? null;
      actorUserId = user.userId;
    }

    const image = await processImageUpload(file, {
      maxBytes: MAX_IMAGE_BYTES,
      maxDimension: 512,
    });
    const storageKey = newStorageKey(
      studentId ? `org/${organizationId}/student-avatar` : `user/${user.userId}/avatar`,
      image.extension,
    );
    await putObject(storageKey, image.buffer);

    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.file.create({
        data: {
          organizationId,
          ownerUserId: user.userId,
          kind: studentId ? 'STUDENT_AVATAR' : 'USER_AVATAR',
          storageKey,
          mimeType: image.mimeType,
          sizeBytes: image.sizeBytes,
          sha256: image.sha256,
          width: image.width,
          height: image.height,
        },
      });

      let previousId: string | null = null;
      if (studentId) {
        const before = await tx.student.findUnique({
          where: { id: studentId },
          select: { avatarFileId: true },
        });
        previousId = before?.avatarFileId ?? null;
        await tx.student.update({ where: { id: studentId }, data: { avatarFileId: created.id } });
      } else {
        const before = await tx.profile.findUnique({
          where: { userId: user.userId },
          select: { avatarFileId: true },
        });
        previousId = before?.avatarFileId ?? null;
        await tx.profile.update({
          where: { userId: user.userId },
          data: { avatarFileId: created.id },
        });

        // A student has both an account profile and a student record, and the
        // portal reads the student record. Point both at the same file so a
        // self-uploaded photo actually appears.
        await tx.student.updateMany({
          where: { userId: user.userId, deletedAt: null },
          data: { avatarFileId: created.id },
        });
      }

      // The replaced photo is soft-deleted so a signed URL minted a minute ago
      // stops resolving; the bytes go next.
      if (previousId) {
        await tx.file.update({ where: { id: previousId }, data: { deletedAt: new Date() } });
      }
      return { created, previousId };
    });

    if (result.previousId) {
      const old = await prisma.file.findUnique({ where: { id: result.previousId } });
      if (old) await deleteObject(old.storageKey);
    }

    await audit({
      organizationId,
      actorUserId,
      action: 'file.upload',
      entityType: 'file',
      entityId: result.created.id,
      meta: {
        kind: studentId ? 'STUDENT_AVATAR' : 'USER_AVATAR',
        studentId,
        sizeBytes: image.sizeBytes,
      },
    });

    return json({ fileId: result.created.id, url: signFileUrl(result.created.id) }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
