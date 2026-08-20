import { prisma } from '../db';
import { scope, findOwned, type OrgContext } from '../tenant';
import { audit } from '../security/audit';
import { assertCanAddStudent } from './plan';
import { NotFound } from '../errors';
import type { z } from 'zod';
import type { studentInputSchema, studentListQuerySchema } from '../validation/schemas';

type StudentInput = z.infer<typeof studentInputSchema>;
type ListQuery = z.infer<typeof studentListQuerySchema>;

export async function listStudents(ctx: OrgContext, query: ListQuery) {
  const where = {
    ...scope.orgLive(ctx),
    ...(query.status !== 'ALL' ? { status: query.status } : {}),
    ...(query.groupId
      ? { memberships: { some: { groupId: query.groupId, leftAt: null } } }
      : {}),
    ...(query.q
      ? {
          OR: [
            // Prisma parameterizes these; the value is never concatenated into SQL.
            { firstName: { contains: query.q, mode: 'insensitive' as const } },
            { lastName: { contains: query.q, mode: 'insensitive' as const } },
            { phone: { contains: query.q } },
          ],
        }
      : {}),
  };

  const orderBy =
    query.sort === 'created'
      ? [{ createdAt: query.dir }]
      : [{ firstName: query.dir }, { lastName: query.dir }];

  const [rows, total] = await Promise.all([
    prisma.student.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.perPage,
      take: query.perPage,
      include: {
        parents: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], take: 1 },
        memberships: {
          where: { leftAt: null },
          include: { group: { select: { id: true, name: true, color: true } } },
        },
      },
    }),
    prisma.student.count({ where }),
  ]);

  return { rows, total, page: query.page, perPage: query.perPage };
}

export async function getStudent(ctx: OrgContext, id: string) {
  const student = await prisma.student.findFirst({
    where: scope.byId(ctx, id),
    include: {
      parents: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
      memberships: {
        where: { leftAt: null },
        include: { group: { select: { id: true, name: true, color: true, monthlyFeeMinor: true, currency: true } } },
      },
    },
  });
  if (!student || student.deletedAt) throw NotFound();
  return student;
}

export async function createStudent(ctx: OrgContext, input: StudentInput) {
  if (input.status === 'ACTIVE') await assertCanAddStudent(ctx);

  const student = await prisma.$transaction(async (tx) => {
    const created = await tx.student.create({
      data: {
        // organizationId comes from the session context, never from the payload.
        organizationId: ctx.orgId,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        email: input.email,
        birthDate: input.birthDate ? new Date(`${input.birthDate}T00:00:00Z`) : null,
        notes: input.notes,
        status: input.status,
      },
    });

    if (input.parentName || input.parentPhone) {
      await tx.studentParent.create({
        data: {
          organizationId: ctx.orgId,
          studentId: created.id,
          fullName: input.parentName ?? '-',
          phone: input.parentPhone,
          relation: input.parentRelation,
          isPrimary: true,
        },
      });
    }
    return created;
  });

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    action: 'student.create',
    entityType: 'student',
    entityId: student.id,
  });
  return student;
}

export async function updateStudent(ctx: OrgContext, id: string, input: StudentInput) {
  const existing = await findOwned<{ id: string; status: string }>(ctx, 'student', id, {
    deletedAt: null,
  });
  if (existing.status !== 'ACTIVE' && input.status === 'ACTIVE') await assertCanAddStudent(ctx);

  const updated = await prisma.$transaction(async (tx) => {
    // updateMany with the tenant filter: a mismatched org updates zero rows.
    const res = await tx.student.updateMany({
      where: scope.byId(ctx, id),
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        email: input.email,
        birthDate: input.birthDate ? new Date(`${input.birthDate}T00:00:00Z`) : null,
        notes: input.notes,
        status: input.status,
        archivedAt: input.status === 'ARCHIVED' ? new Date() : null,
      },
    });
    if (res.count === 0) throw NotFound();

    if (input.parentName || input.parentPhone) {
      const primary = await tx.studentParent.findFirst({
        where: { studentId: id, organizationId: ctx.orgId },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      });
      if (primary) {
        await tx.studentParent.update({
          where: { id: primary.id },
          data: {
            fullName: input.parentName ?? primary.fullName,
            phone: input.parentPhone,
            relation: input.parentRelation,
          },
        });
      } else {
        await tx.studentParent.create({
          data: {
            organizationId: ctx.orgId,
            studentId: id,
            fullName: input.parentName ?? '-',
            phone: input.parentPhone,
            relation: input.parentRelation,
          },
        });
      }
    }
    return tx.student.findFirst({ where: scope.byId(ctx, id) });
  });

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    action: 'student.update',
    entityType: 'student',
    entityId: id,
  });
  return updated;
}

/** Archive, not delete: attendance and payment history must survive. */
export async function archiveStudent(ctx: OrgContext, id: string) {
  const res = await prisma.student.updateMany({
    where: scope.byId(ctx, id),
    data: { status: 'ARCHIVED', archivedAt: new Date() },
  });
  if (res.count === 0) throw NotFound();

  await prisma.groupMember.updateMany({
    where: { studentId: id, organizationId: ctx.orgId, leftAt: null },
    data: { leftAt: new Date() },
  });

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    action: 'student.archive',
    entityType: 'student',
    entityId: id,
  });
}

export async function restoreStudent(ctx: OrgContext, id: string) {
  await assertCanAddStudent(ctx);
  const res = await prisma.student.updateMany({
    where: { ...scope.byId(ctx, id), status: 'ARCHIVED' },
    data: { status: 'ACTIVE', archivedAt: null },
  });
  if (res.count === 0) throw NotFound();
  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    action: 'student.restore',
    entityType: 'student',
    entityId: id,
  });
}

export async function studentAttendanceStats(ctx: OrgContext, studentId: string) {
  const grouped = await prisma.attendance.groupBy({
    by: ['status'],
    where: { ...scope.org(ctx), studentId },
    _count: { _all: true },
  });
  const counts = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 };
  for (const g of grouped) counts[g.status] = g._count._all;
  const total = counts.PRESENT + counts.ABSENT + counts.LATE + counts.EXCUSED;
  // Late still counts as attended; excused is neutral and left out of the base.
  const base = counts.PRESENT + counts.ABSENT + counts.LATE;
  return {
    ...counts,
    total,
    rate: base === 0 ? null : (counts.PRESENT + counts.LATE) / base,
  };
}
