import { prisma } from '@/lib/db';
import { json, readJson, userMutation } from '@/lib/api';
import { updateProfileSchema } from '@/lib/validation/schemas';
import { DB_LOCALE } from '@/lib/i18n/config';
import { audit } from '@/lib/security/audit';

export const PUT = userMutation(async (user, request) => {
  const body = await readJson(request, updateProfileSchema);

  await prisma.profile.update({
    where: { userId: user.userId },
    data: {
      firstName: body.firstName,
      lastName: body.lastName,
      bio: body.bio,
      teachingSubject: body.teachingSubject,
      locale: DB_LOCALE[body.locale],
      timezone: body.timezone,
    },
  });

  await audit({ actorUserId: user.userId, action: 'profile.update' });
  return json({ ok: true });
});
