import { prisma } from '@/lib/db';
import { json, readJson, toErrorResponse, userMutation } from '@/lib/api';
import { notificationPrefSchema } from '@/lib/validation/schemas';
import { requireUser } from '@/lib/tenant';

export async function GET() {
  try {
    const user = await requireUser();
    const prefs = await prisma.notificationPreference.findMany({ where: { userId: user.userId } });
    return json({ prefs });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export const PUT = userMutation(async (user, request) => {
  const body = await readJson(request, notificationPrefSchema);

  await prisma.$transaction(
    body.prefs.map((p) =>
      prisma.notificationPreference.upsert({
        // userId comes from the session, so one user cannot write another's prefs.
        where: { userId_type: { userId: user.userId, type: p.type } },
        create: { userId: user.userId, type: p.type, inApp: p.inApp, telegram: p.telegram, email: p.email },
        update: { inApp: p.inApp, telegram: p.telegram, email: p.email },
      }),
    ),
  );

  return json({ ok: true });
});
