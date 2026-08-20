import { prisma } from '../db';
import { scope, findOwned, assertAllOwned, type OrgContext } from '../tenant';
import { audit } from '../security/audit';
import { notify } from '../notifications/notify';
import { BadRequest, Forbidden, NotFound } from '../errors';
import type { z } from 'zod';
import type { GradeScheme } from '@/generated/prisma/enums';
import type { gradeBulkSchema, gradeInputSchema, gradeListQuerySchema } from '../validation/schemas';

/**
 * Grading schemes are data, not code paths: a mark is stored as a number plus
 * the scheme it was recorded under, so adding a fourth scheme later needs no
 * migration of existing rows.
 */
export const SCHEME_MAX: Record<GradeScheme, number | null> = {
  POINTS_100: 100,
  POINTS_5: 5,
  LETTER: null,
};

const LETTERS = new Set(['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'E', 'F']);

/** Normalizes any scheme onto 0..1 so averages can mix schemes. */
export function gradeRatio(grade: {
  scheme: GradeScheme;
  valueNumeric: number | null;
  valueLetter: string | null;
  maxValue: number | null;
}): number | null {
  if (grade.scheme === 'LETTER') {
    const table: Record<string, number> = {
      'A+': 1, A: 0.95, 'A-': 0.9, 'B+': 0.87, B: 0.83, 'B-': 0.8,
      'C+': 0.77, C: 0.73, 'C-': 0.7, D: 0.6, E: 0.5, F: 0,
    };
    return grade.valueLetter ? (table[grade.valueLetter] ?? null) : null;
  }
  if (grade.valueNumeric === null) return null;
  const max = grade.maxValue ?? SCHEME_MAX[grade.scheme] ?? 100;
  if (max <= 0) return null;
  return Math.min(1, grade.valueNumeric / max);
}

function validateValue(input: {
  scheme: GradeScheme;
  valueNumeric?: number | null;
  valueLetter?: string | null;
  maxValue?: number | null;
}) {
  if (input.scheme === 'LETTER') {
    if (!input.valueLetter || !LETTERS.has(input.valueLetter.toUpperCase())) {
      throw BadRequest('grades.invalidValue');
    }
    return;
  }
  if (input.valueNumeric === null || input.valueNumeric === undefined) {
    throw BadRequest('grades.invalidValue');
  }
  const max = input.maxValue ?? SCHEME_MAX[input.scheme] ?? 100;
  if (input.valueNumeric < 0 || input.valueNumeric > max) throw BadRequest('grades.invalidValue');
}

async function assertGroupAccess(ctx: OrgContext, groupId: string) {
  const group = await prisma.group.findFirst({
    where: { ...scope.byId(ctx, groupId), deletedAt: null },
    select: { id: true, teacherId: true, name: true },
  });
  if (!group) throw NotFound();
  if (ctx.role === 'TEACHER' && group.teacherId !== ctx.memberId) throw Forbidden();
  return group;
}

export async function listGrades(ctx: OrgContext, query: z.infer<typeof gradeListQuerySchema>) {
  const where = {
    ...scope.orgLive(ctx),
    ...(query.studentId ? { studentId: query.studentId } : {}),
    ...(query.groupId ? { groupId: query.groupId } : {}),
    ...(ctx.role === 'TEACHER' && ctx.memberId ? { group: { teacherId: ctx.memberId } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.grade.findMany({
      where,
      orderBy: { gradedAt: 'desc' },
      skip: (query.page - 1) * query.perPage,
      take: query.perPage,
      include: {
        student: { select: { id: true, firstName: true, lastName: true } },
        group: { select: { id: true, name: true } },
      },
    }),
    prisma.grade.count({ where }),
  ]);
  return { rows, total, page: query.page, perPage: query.perPage };
}

export async function createGrade(ctx: OrgContext, input: z.infer<typeof gradeInputSchema>) {
  await assertAllOwned(ctx, 'student', [input.studentId]);
  if (input.groupId) await assertGroupAccess(ctx, input.groupId);
  if (input.lessonId) await findOwned(ctx, 'lesson', input.lessonId);
  if (input.homeworkId) await findOwned(ctx, 'homework', input.homeworkId);
  // A teacher with no group named on the mark still has to own the student's group.
  if (!input.groupId && ctx.role === 'TEACHER') throw BadRequest('grades.groupRequired');
  validateValue(input);

  const grade = await prisma.grade.create({
    data: {
      organizationId: ctx.orgId,
      studentId: input.studentId,
      groupId: input.groupId ?? null,
      lessonId: input.lessonId ?? null,
      homeworkId: input.homeworkId ?? null,
      teacherId: ctx.memberId,
      scheme: input.scheme,
      valueNumeric: input.scheme === 'LETTER' ? null : (input.valueNumeric ?? null),
      valueLetter: input.scheme === 'LETTER' ? (input.valueLetter?.toUpperCase() ?? null) : null,
      maxValue: input.maxValue ?? SCHEME_MAX[input.scheme],
      title: input.title,
      comment: input.comment,
      gradedAt: input.gradedAt ? new Date(`${input.gradedAt}T00:00:00Z`) : new Date(),
    },
  });

  const student = await prisma.student.findFirst({
    where: { id: input.studentId, organizationId: ctx.orgId },
    select: { userId: true },
  });
  if (student?.userId) {
    await notify({
      organizationId: ctx.orgId,
      userIds: [student.userId],
      type: 'GRADE_POSTED',
      titleKey: 'notifications.gradePosted',
      payload: { gradeId: grade.id },
    });
  }

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    actorAdminId: ctx.admin?.adminId ?? null,
    isOverride: ctx.isOverride,
    action: 'grade.create',
    entityType: 'grade',
    entityId: grade.id,
  });
  return grade;
}

/** One mark per student for a whole group — the common classroom case. */
export async function createGradesBulk(ctx: OrgContext, input: z.infer<typeof gradeBulkSchema>) {
  const group = await assertGroupAccess(ctx, input.groupId);
  const studentIds = input.entries.map((e) => e.studentId);
  await assertAllOwned(ctx, 'student', studentIds);

  const members = await prisma.groupMember.findMany({
    where: { organizationId: ctx.orgId, groupId: group.id, studentId: { in: studentIds } },
    select: { studentId: true },
  });
  const allowed = new Set(members.map((m) => m.studentId));
  if (studentIds.some((id) => !allowed.has(id))) throw NotFound();

  const gradedAt = input.gradedAt ? new Date(`${input.gradedAt}T00:00:00Z`) : new Date();
  for (const entry of input.entries) {
    validateValue({ scheme: input.scheme, ...entry });
  }

  const created = await prisma.grade.createMany({
    data: input.entries.map((entry) => ({
      organizationId: ctx.orgId,
      studentId: entry.studentId,
      groupId: group.id,
      teacherId: ctx.memberId,
      scheme: input.scheme,
      valueNumeric: input.scheme === 'LETTER' ? null : (entry.valueNumeric ?? null),
      valueLetter: input.scheme === 'LETTER' ? (entry.valueLetter?.toUpperCase() ?? null) : null,
      maxValue: SCHEME_MAX[input.scheme],
      title: input.title,
      comment: entry.comment,
      gradedAt,
    })),
  });

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    actorAdminId: ctx.admin?.adminId ?? null,
    isOverride: ctx.isOverride,
    action: 'grade.bulk',
    entityType: 'group',
    entityId: group.id,
    meta: { count: created.count },
  });
  return created;
}

export async function deleteGrade(ctx: OrgContext, id: string) {
  const grade = await prisma.grade.findFirst({
    where: { ...scope.byId(ctx, id), deletedAt: null },
    include: { group: { select: { teacherId: true } } },
  });
  if (!grade) throw NotFound();
  if (ctx.role === 'TEACHER' && grade.group?.teacherId !== ctx.memberId) throw NotFound();

  await prisma.grade.update({ where: { id: grade.id }, data: { deletedAt: new Date() } });
  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    actorAdminId: ctx.admin?.adminId ?? null,
    isOverride: ctx.isOverride,
    action: 'grade.delete',
    entityType: 'grade',
    entityId: grade.id,
    meta: {
      scheme: grade.scheme,
      value: grade.valueNumeric ?? grade.valueLetter,
    },
  });
}

/** Average across schemes, expressed as a percentage. */
export async function studentGradeAverage(
  organizationId: string,
  studentId: string,
): Promise<{ average: number | null; count: number }> {
  const rows = await prisma.grade.findMany({
    where: { organizationId, studentId, deletedAt: null },
    select: { scheme: true, valueNumeric: true, valueLetter: true, maxValue: true, weightBp: true },
  });
  let weighted = 0;
  let weight = 0;
  for (const row of rows) {
    const ratio = gradeRatio(row);
    if (ratio === null) continue;
    const w = row.weightBp / 10000;
    weighted += ratio * w;
    weight += w;
  }
  return { average: weight > 0 ? (weighted / weight) * 100 : null, count: rows.length };
}
