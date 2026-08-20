import { prisma } from '@/lib/db';
import { json, toErrorResponse, userMutation } from '@/lib/api';
import { requireUser, } from '@/lib/tenant';
import { revokeAllSessions } from '@/lib/auth/session';
import { audit } from '@/lib/security/audit';

export async function GET() {
  try {
    const user = await requireUser();
    const sessions = await prisma.session.findMany({
      where: { userId: user.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, userAgent: true, createdAt: true, lastSeenAt: true },
      take: 50,
    });
    return json({
      sessions: sessions.map((s) => ({ ...s, current: s.id === user.sessionId })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Revokes every session except the one making the request. */
export const DELETE = userMutation(async (user) => {
  await revokeAllSessions(user.userId, user.sessionId);
  await audit({ actorUserId: user.userId, action: 'auth.sessions.revoke_others' });
  return json({ ok: true });
});
