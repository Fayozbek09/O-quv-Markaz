import { prisma } from '../db';
import { scope, findOwned, type OrgContext } from '../tenant';
import { audit } from '../security/audit';
import { parseAmountToMinor } from '../money';
import { Conflict } from '../errors';
import type { z } from 'zod';
import type { courseInputSchema } from '../validation/schemas';

export async function listCourses(ctx: OrgContext, includeInactive = true) {
  return prisma.course.findMany({
    where: { ...scope.orgLive(ctx), ...(includeInactive ? {} : { isActive: true }) },
    orderBy: { name: 'asc' },
    include: { _count: { select: { groups: true } } },
  });
}

export async function createCourse(ctx: OrgContext, input: z.infer<typeof courseInputSchema>) {
  const clash = await prisma.course.findFirst({
    where: { ...scope.org(ctx), name: input.name, deletedAt: null },
  });
  if (clash) throw Conflict('courses.nameTaken');

  const course = await prisma.course.create({
    data: {
      organizationId: ctx.orgId,
      name: input.name,
      catalogKey: input.catalogKey,
      description: input.description,
      defaultFeeMinor: parseAmountToMinor(input.defaultFee || '0', input.currency),
      currency: input.currency,
      durationMonths: input.durationMonths,
      color: input.color,
      isActive: input.isActive,
    },
  });

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    actorAdminId: ctx.admin?.adminId ?? null,
    isOverride: ctx.isOverride,
    action: 'course.create',
    entityType: 'course',
    entityId: course.id,
  });
  return course;
}

export async function updateCourse(
  ctx: OrgContext,
  id: string,
  input: z.infer<typeof courseInputSchema>,
) {
  const existing = await findOwned<{ id: string }>(ctx, 'course', id, { deletedAt: null });
  const clash = await prisma.course.findFirst({
    where: { ...scope.org(ctx), name: input.name, deletedAt: null, NOT: { id: existing.id } },
  });
  if (clash) throw Conflict('courses.nameTaken');

  const course = await prisma.course.update({
    where: { id: existing.id },
    data: {
      name: input.name,
      catalogKey: input.catalogKey,
      description: input.description,
      defaultFeeMinor: parseAmountToMinor(input.defaultFee || '0', input.currency),
      currency: input.currency,
      durationMonths: input.durationMonths,
      color: input.color,
      isActive: input.isActive,
    },
  });

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    actorAdminId: ctx.admin?.adminId ?? null,
    isOverride: ctx.isOverride,
    action: 'course.update',
    entityType: 'course',
    entityId: course.id,
  });
  return course;
}

/** Soft delete; groups keep pointing at the course row for their history. */
export async function deleteCourse(ctx: OrgContext, id: string) {
  const existing = await findOwned<{ id: string }>(ctx, 'course', id, { deletedAt: null });
  await prisma.course.update({
    where: { id: existing.id },
    data: { deletedAt: new Date(), isActive: false },
  });
  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    actorAdminId: ctx.admin?.adminId ?? null,
    isOverride: ctx.isOverride,
    action: 'course.delete',
    entityType: 'course',
    entityId: existing.id,
  });
}
