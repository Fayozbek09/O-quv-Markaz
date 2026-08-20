import { prisma } from '@/lib/db';
import { json, readJson, userMutation } from '@/lib/api';
import { onboardingSchema } from '@/lib/validation/schemas';
import { switchOrganization } from '@/lib/auth/session';
import { audit } from '@/lib/security/audit';
import { startTrial } from '@/lib/domain/subscription';
import { Conflict } from '@/lib/errors';
import { randomBytes } from 'node:crypto';

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'workspace'}-${randomBytes(3).toString('hex')}`;
}

/** Creates the user's first workspace and makes them its OWNER. */
export const POST = userMutation(async (user, request) => {
  const body = await readJson(request, onboardingSchema);

  const existing = await prisma.organizationMember.findFirst({
    where: { userId: user.userId, removedAt: null },
  });
  if (existing) throw Conflict();

  const org = await prisma.$transaction(async (tx) => {
    const created = await tx.organization.create({
      data: {
        name: body.workspaceName,
        slug: slugify(body.workspaceName),
        defaultCurrency: body.currency,
        timezone: body.timezone,
        members: { create: { userId: user.userId, role: 'OWNER' } },
      },
    });

    await tx.profile.update({
      where: { userId: user.userId },
      data: {
        firstName: body.firstName,
        lastName: body.lastName,
        teachingSubject: body.teachingSubject,
        timezone: body.timezone,
      },
    });

    // Sensible notification defaults; the user can turn each one off.
    await tx.notificationPreference.createMany({
      data: (['LESSON_UPCOMING', 'ATTENDANCE_MISSED', 'PAYMENT_OVERDUE', 'MONTHLY_SUMMARY'] as const).map(
        (type) => ({ userId: user.userId, type, inApp: true, telegram: false, email: false }),
      ),
      skipDuplicates: true,
    });

    return created;
  });

  await startTrial(org.id);
  await switchOrganization(user.sessionId, user.userId, org.id);
  await audit({
    organizationId: org.id,
    actorUserId: user.userId,
    action: 'organization.create',
    entityType: 'organization',
    entityId: org.id,
  });

  return json({ organizationId: org.id }, { status: 201 });
});
