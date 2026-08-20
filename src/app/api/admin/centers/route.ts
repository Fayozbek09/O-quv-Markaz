import { prisma } from '@/lib/db';
import { adminMutation, adminRoute, json, readJson, readQuery } from '@/lib/api';
import { adminCenterCreateSchema, adminCenterQuerySchema } from '@/lib/validation/schemas';
import { buildTempCredentials } from '@/lib/auth/credentials';
import { auditAdmin } from '@/lib/admin';
import { startTrial } from '@/lib/domain/subscription';
import { DEFAULT_NOTIFICATION_TYPES } from '@/lib/notifications/notify';
import { centerSlug } from '@/lib/domain/slug';

export const GET = adminRoute(async (_admin, request) => {
  const query = readQuery(request, adminCenterQuerySchema);
  const where = {
    deletedAt: null,
    ...(query.status === 'ALL' ? {} : { status: query.status }),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' as const } },
            { city: { contains: query.q, mode: 'insensitive' as const } },
            { phone: { contains: query.q } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.organization.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.perPage,
      take: query.perPage,
      select: {
        id: true, name: true, city: true, district: true, phone: true, email: true,
        status: true, createdAt: true, suspendedAt: true, suspendedReason: true,
        _count: { select: { students: true, groups: true, members: true } },
      },
    }),
    prisma.organization.count({ where }),
  ]);

  return json({ rows, total, page: query.page, perPage: query.perPage });
});

/**
 * Creates a centre and its owner account in one transaction. The owner gets a
 * generated username and a generated temporary password, returned exactly once
 * in this response — nothing recoverable is stored in plaintext.
 */
export const POST = adminMutation(async (admin, request) => {
  const body = await readJson(request, adminCenterCreateSchema);

  const credentials = await buildTempCredentials({
    firstName: body.ownerFirstName,
    lastName: body.ownerLastName,
    role: 'OWNER',
    preferred: body.ownerUsername,
  });

  const org = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        username: credentials.username,
        passwordHash: credentials.passwordHash,
        mustChangePassword: true,
        credentialsExpireAt: credentials.credentialsExpireAt,
        profile: {
          create: {
            firstName: body.ownerFirstName,
            lastName: body.ownerLastName,
            timezone: body.timezone,
          },
        },
      },
    });

    const created = await tx.organization.create({
      data: {
        name: body.centerName,
        slug: centerSlug(body.centerName),
        city: body.city,
        district: body.district,
        phone: body.phone,
        email: body.email,
        address: body.address,
        timezone: body.timezone,
        defaultCurrency: body.currency,
        members: { create: { userId: user.id, role: 'OWNER' } },
        courses: {
          create: body.courses.map((name) => ({
            name,
            currency: body.currency,
          })),
        },
      },
    });

    await tx.notificationPreference.createMany({
      data: DEFAULT_NOTIFICATION_TYPES.map((type) => ({
        userId: user.id,
        type,
        inApp: true,
        telegram: false,
        email: false,
      })),
      skipDuplicates: true,
    });

    return created;
  });

  await startTrial(org.id);

  await auditAdmin({
    adminId: admin.adminId,
    organizationId: org.id,
    action: 'admin.center.create',
    entityType: 'organization',
    entityId: org.id,
    after: { name: org.name, city: org.city },
  });

  return json(
    {
      organizationId: org.id,
      credentials: {
        username: credentials.username,
        // Shown once, in this response only.
        password: credentials.password,
        expiresAt: credentials.credentialsExpireAt,
        usernameWasTaken: credentials.wasTaken,
        requestedUsername: credentials.requested,
      },
    },
    { status: 201 },
  );
});
