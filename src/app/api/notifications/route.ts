import { prisma } from '@/lib/db';
import { json, toErrorResponse, userMutation } from '@/lib/api';
import { requireUser } from '@/lib/tenant';

export async function GET() {
  try {
    const user = await requireUser();
    const notifications = await prisma.notification.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return json({
      notifications,
      unread: notifications.filter((n) => !n.readAt).length,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Marks every notification of the calling user as read. */
export const POST = userMutation(async (user) => {
  await prisma.notification.updateMany({
    where: { userId: user.userId, readAt: null },
    data: { readAt: new Date() },
  });
  return json({ ok: true });
});
