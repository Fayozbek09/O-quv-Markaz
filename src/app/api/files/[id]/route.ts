import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { toErrorResponse } from '@/lib/api';
import { getObject, verifyFileSignature } from '@/lib/files/storage';
import { getSessionUser } from '@/lib/auth/session';
import { Forbidden, NotFound } from '@/lib/errors';
import { isUuid } from '@/lib/tenant';

/**
 * Private file delivery. Two independent gates, both required:
 *   1. a valid, unexpired HMAC signature for this exact file id;
 *   2. a session that belongs to the file's workspace (or owns it personally).
 * A leaked URL alone is not enough after it expires, and a valid session for a
 * different workspace is not enough either.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!isUuid(id)) throw NotFound();

    const url = new URL(request.url);
    if (!verifyFileSignature(id, url.searchParams.get('exp'), url.searchParams.get('sig'))) {
      throw Forbidden();
    }

    const file = await prisma.file.findFirst({ where: { id, deletedAt: null } });
    if (!file) throw NotFound();

    const user = await getSessionUser();
    if (!user) throw Forbidden();

    if (file.organizationId) {
      const member = await prisma.organizationMember.findFirst({
        where: { organizationId: file.organizationId, userId: user.userId, removedAt: null },
      });
      if (!member) throw NotFound();
    } else if (file.ownerUserId !== user.userId) {
      throw NotFound();
    }

    const bytes = await getObject(file.storageKey);

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        // Only image/webp is ever stored, but the header set assumes the worst.
        'content-type': file.mimeType,
        'content-length': String(bytes.byteLength),
        'content-disposition': 'inline',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        'cache-control': 'private, max-age=300, no-transform',
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
