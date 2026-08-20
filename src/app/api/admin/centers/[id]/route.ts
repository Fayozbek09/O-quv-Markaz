import { prisma } from '@/lib/db';
import { adminMutation, adminRoute, json, readJson } from '@/lib/api';
import {
  adminCenterUpdateSchema,
  adminDeleteCenterSchema,
  adminSuspendSchema,
} from '@/lib/validation/schemas';
import { auditAdmin } from '@/lib/admin';
import { isUuid } from '@/lib/tenant';
import { NotFound } from '@/lib/errors';

type Params = { id: string };

async function loadCenter(id: string) {
  if (!isUuid(id)) throw NotFound();
  const org = await prisma.organization.findFirst({ where: { id, deletedAt: null } });
  if (!org) throw NotFound();
  return org;
}

export const GET = adminRoute<Params>(async (_admin, _request, params) => {
  const org = await loadCenter(params.id);
  const [students, groups, members, lessons, revenue, outstanding] = await Promise.all([
    prisma.student.count({ where: { organizationId: org.id, deletedAt: null } }),
    prisma.group.count({ where: { organizationId: org.id, deletedAt: null } }),
    prisma.organizationMember.findMany({
      where: { organizationId: org.id, removedAt: null },
      select: {
        id: true, role: true, status: true, hireDate: true,
        user: { select: { username: true, email: true, phone: true, profile: { select: { firstName: true, lastName: true } } } },
      },
      orderBy: { joinedAt: 'asc' },
    }),
    prisma.lesson.count({ where: { organizationId: org.id, deletedAt: null } }),
    prisma.payment.aggregate({
      _sum: { amountMinor: true },
      where: { organizationId: org.id, status: 'COMPLETED' },
    }),
    prisma.invoice.aggregate({
      _sum: { amountMinor: true },
      where: { organizationId: org.id, status: 'OPEN' },
    }),
  ]);

  return json({
    center: org,
    stats: {
      students,
      groups,
      lessons,
      revenueMinor: revenue._sum.amountMinor ?? 0n,
      invoicedOpenMinor: outstanding._sum.amountMinor ?? 0n,
    },
    members,
  });
});

export const PUT = adminMutation<Params>(async (admin, request, params) => {
  const before = await loadCenter(params.id);
  const body = await readJson(request, adminCenterUpdateSchema);

  const after = await prisma.organization.update({
    where: { id: before.id },
    data: {
      name: body.name,
      legalName: body.legalName,
      phone: body.phone,
      email: body.email,
      address: body.address,
      city: body.city,
      district: body.district,
      description: body.description,
    },
  });

  await auditAdmin({
    adminId: admin.adminId,
    organizationId: before.id,
    action: 'admin.center.update',
    entityType: 'organization',
    entityId: before.id,
    before: { name: before.name, city: before.city, phone: before.phone },
    after: { name: after.name, city: after.city, phone: after.phone },
  });

  return json({ ok: true });
});

/**
 * Suspend / reactivate. Suspension is reversible and does not touch data: every
 * member simply loses their tenant context until it is lifted (see
 * lib/auth/session.ts).
 */
export const PATCH = adminMutation<Params>(async (admin, request, params) => {
  const org = await loadCenter(params.id);
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (action === 'suspend') {
    const body = await readJson(request, adminSuspendSchema);
    await prisma.$transaction([
      prisma.organization.update({
        where: { id: org.id },
        data: { status: 'SUSPENDED', suspendedAt: new Date(), suspendedReason: body.reason },
      }),
      // Kill live sessions so the suspension takes effect immediately.
      prisma.session.updateMany({
        where: { activeOrgId: org.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await auditAdmin({
      adminId: admin.adminId,
      organizationId: org.id,
      action: 'admin.center.suspend',
      entityType: 'organization',
      entityId: org.id,
      meta: { reason: body.reason },
    });
    return json({ ok: true, status: 'SUSPENDED' });
  }

  if (action === 'reactivate') {
    await prisma.organization.update({
      where: { id: org.id },
      data: { status: 'ACTIVE', suspendedAt: null, suspendedReason: null },
    });
    await auditAdmin({
      adminId: admin.adminId,
      organizationId: org.id,
      action: 'admin.center.reactivate',
      entityType: 'organization',
      entityId: org.id,
    });
    return json({ ok: true, status: 'ACTIVE' });
  }

  throw NotFound();
});

/**
 * Soft delete. Financial and attendance records are retained — see
 * "Account deletion" in SECURITY.md — so this marks the centre deleted and
 * revokes access rather than dropping rows.
 */
export const DELETE = adminMutation<Params>(async (admin, request, params) => {
  const org = await loadCenter(params.id);
  const body = await readJson(request, adminDeleteCenterSchema);

  await prisma.$transaction([
    prisma.organization.update({
      where: { id: org.id },
      data: { deletedAt: new Date(), status: 'SUSPENDED', suspendedReason: body.reason },
    }),
    prisma.session.updateMany({
      where: { activeOrgId: org.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  await auditAdmin({
    adminId: admin.adminId,
    organizationId: org.id,
    action: 'admin.center.delete',
    entityType: 'organization',
    entityId: org.id,
    meta: { reason: body.reason, retention: 'soft_delete_records_retained' },
  });

  return json({ ok: true });
});
