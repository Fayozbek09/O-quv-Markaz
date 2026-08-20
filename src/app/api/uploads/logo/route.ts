import { prisma } from '@/lib/db';
import { json, toErrorResponse } from '@/lib/api';
import { requireOrg } from '@/lib/tenant';
import { assertCsrf } from '@/lib/security/csrf';
import { enforce } from '@/lib/security/rate-limit';
import { processImageUpload } from '@/lib/files/image';
import { deleteObject, newStorageKey, putObject, signFileUrl } from '@/lib/files/storage';
import { audit } from '@/lib/security/audit';
import { BadRequest, PayloadTooLarge } from '@/lib/errors';

const MAX_MULTIPART_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const ctx = await requireOrg('ADMIN');
    await assertCsrf(ctx.user.csrfSecret);
    await enforce('upload:org', ctx.orgId);

    const declared = request.headers.get('content-length');
    if (declared && Number(declared) > MAX_MULTIPART_BYTES) throw PayloadTooLarge();

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw BadRequest('errors.fileType');

    const image = await processImageUpload(file, { maxBytes: 2 * 1024 * 1024, maxDimension: 512 });
    const storageKey = newStorageKey(`org/${ctx.orgId}/logo`, image.extension);
    await putObject(storageKey, image.buffer);

    const record = await prisma.$transaction(async (tx) => {
      const created = await tx.file.create({
        data: {
          organizationId: ctx.orgId,
          ownerUserId: ctx.user.userId,
          kind: 'ORG_LOGO',
          storageKey,
          mimeType: image.mimeType,
          sizeBytes: image.sizeBytes,
          sha256: image.sha256,
          width: image.width,
          height: image.height,
        },
      });

      const previous = await tx.organization.findUnique({
        where: { id: ctx.orgId },
        select: { logoFileId: true },
      });

      await tx.organization.update({ where: { id: ctx.orgId }, data: { logoFileId: created.id } });

      if (previous?.logoFileId) {
        await tx.file.update({
          where: { id: previous.logoFileId },
          data: { deletedAt: new Date() },
        });
      }
      return { created, previousId: previous?.logoFileId ?? null };
    });

    if (record.previousId) {
      const old = await prisma.file.findUnique({ where: { id: record.previousId } });
      if (old) await deleteObject(old.storageKey);
    }

    await audit({
      organizationId: ctx.orgId,
      actorUserId: ctx.user.userId,
      action: 'file.upload',
      entityType: 'file',
      entityId: record.created.id,
      meta: { kind: 'ORG_LOGO', sizeBytes: image.sizeBytes },
    });

    return json({ fileId: record.created.id, url: signFileUrl(record.created.id) }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
