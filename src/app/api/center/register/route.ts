import { headers } from 'next/headers';
import { prisma } from '@/lib/db';
import { json, publicRoute, readJson } from '@/lib/api';
import { centerRegistrationSchema } from '@/lib/validation/schemas';
import { requireUser } from '@/lib/tenant';
import { assertCsrf } from '@/lib/security/csrf';
import { switchOrganization, clientIp } from '@/lib/auth/session';
import { audit } from '@/lib/security/audit';
import { enforce } from '@/lib/security/rate-limit';
import { DEFAULT_NOTIFICATION_TYPES } from '@/lib/notifications/notify';
import { startTrial } from '@/lib/domain/subscription';
import { centerSlug } from '@/lib/domain/slug';
import { Conflict } from '@/lib/errors';

/**
 * Self-service centre registration.
 *
 * Runs after the account itself exists (phone/e-mail verified through the OTP
 * flow), so this endpoint only ever creates the centre and makes the caller its
 * owner. One account may own one centre; a second attempt is a conflict.
 */
export const POST = publicRoute(async (request: Request) => {
  const user = await requireUser();
  await assertCsrf(user.csrfSecret);

  const hdrs = await headers();
  await enforce('auth:register:ip', clientIp(hdrs) ?? 'unknown');

  const body = await readJson(request, centerRegistrationSchema);

  const existing = await prisma.organizationMember.findFirst({
    where: { userId: user.userId, removedAt: null },
  });
  if (existing) throw Conflict();

  const org = await prisma.$transaction(async (tx) => {
    const created = await tx.organization.create({
      data: {
        name: body.centerName,
        legalName: body.legalName,
        slug: centerSlug(body.centerName),
        phone: body.phone,
        email: body.email,
        address: body.address,
        city: body.city,
        district: body.district,
        description: body.description,
        telegramHandle: body.telegramHandle,
        instagram: body.instagram,
        website: body.website,
        workingHours: body.workingHours,
        timezone: body.timezone,
        defaultCurrency: body.currency,
        members: { create: { userId: user.userId, role: 'OWNER' } },
        courses: {
          create: [...new Set(body.courses)].map((name) => ({ name, currency: body.currency })),
        },
      },
    });

    await tx.profile.update({
      where: { userId: user.userId },
      data: { firstName: body.firstName, lastName: body.lastName, timezone: body.timezone },
    });

    await tx.notificationPreference.createMany({
      data: DEFAULT_NOTIFICATION_TYPES.map((type) => ({
        userId: user.userId, type, inApp: true, telegram: false, email: false,
      })),
      skipDuplicates: true,
    });

    return created;
  });

  // 30 free days, no student ceiling, nothing to pay yet.
  await startTrial(org.id);

  await switchOrganization(user.sessionId, user.userId, org.id);
  await audit({
    organizationId: org.id,
    actorUserId: user.userId,
    action: 'center.register',
    entityType: 'organization',
    entityId: org.id,
    meta: { city: body.city, courses: body.courses.length },
  });

  return json({ organizationId: org.id, redirectTo: '/center' }, { status: 201 });
});
