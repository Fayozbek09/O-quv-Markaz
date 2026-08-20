import { prisma } from '@/lib/db';
import { adminRoute, json, readQuery } from '@/lib/api';
import { adminAuditQuerySchema } from '@/lib/validation/schemas';

export const GET = adminRoute(async (_admin, request) => {
  const query = readQuery(request, adminAuditQuerySchema);
  const where = {
    ...(query.organizationId ? { organizationId: query.organizationId } : {}),
    ...(query.action ? { action: { contains: query.action } } : {}),
    ...(query.overridesOnly ? { isOverride: true } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.perPage,
      take: query.perPage,
      include: {
        organization: { select: { name: true } },
        actor: { select: { username: true, profile: { select: { firstName: true, lastName: true } } } },
        actorAdmin: { select: { username: true, fullName: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return json({ rows, total, page: query.page, perPage: query.perPage });
});
