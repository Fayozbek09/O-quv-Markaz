import { prisma } from '../db';
import { PLANS } from '../payments/provider';
import { PlanLimit } from '../errors';
import type { OrgContext } from '../tenant';

export async function getSubscription(orgId: string) {
  const existing = await prisma.subscription.findUnique({ where: { organizationId: orgId } });
  if (existing) return existing;
  return prisma.subscription.create({ data: { organizationId: orgId, plan: 'FREE' } });
}

export async function planUsage(orgId: string) {
  const [sub, activeStudents] = await Promise.all([
    getSubscription(orgId),
    prisma.student.count({ where: { organizationId: orgId, status: 'ACTIVE', deletedAt: null } }),
  ]);
  const limit = PLANS[sub.plan].studentLimit;
  const expired = sub.currentPeriodEnd ? sub.currentPeriodEnd < new Date() : false;
  // An expired paid plan falls back to the free limit rather than locking data away.
  const effectiveLimit = expired ? PLANS.FREE.studentLimit : limit;
  return { subscription: sub, activeStudents, limit: effectiveLimit, expired };
}

/** Called before creating or re-activating a student. */
export async function assertCanAddStudent(ctx: OrgContext) {
  const { activeStudents, limit } = await planUsage(ctx.orgId);
  if (limit !== null && activeStudents >= limit) {
    throw PlanLimit('students.limitReached', { limit });
  }
}
