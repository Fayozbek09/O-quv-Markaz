import { prisma } from '../db';
import { currentSubscription, startTrial, type SubscriptionView } from './subscription';
import { PlanLimit } from '../errors';
import type { OrgContext } from '../tenant';
import type { Permission } from '../rbac';

export async function getSubscription(orgId: string) {
  const existing = await prisma.subscription.findUnique({ where: { organizationId: orgId } });
  if (existing) return existing;
  return startTrial(orgId);
}

/**
 * What the centre is using. There is no student ceiling on any plan — the
 * price is flat for the whole centre — so this is reporting, not enforcement.
 */
export async function planUsage(orgId: string) {
  const [subscription, activeStudents, teachers, groups] = await Promise.all([
    currentSubscription(orgId),
    prisma.student.count({ where: { organizationId: orgId, status: 'ACTIVE', deletedAt: null } }),
    prisma.organizationMember.count({
      where: { organizationId: orgId, role: 'TEACHER', removedAt: null },
    }),
    prisma.group.count({ where: { organizationId: orgId, deletedAt: null } }),
  ]);
  return {
    subscription,
    activeStudents,
    teachers,
    groups,
    /** Kept for callers that still ask; always null — no per-student limits. */
    limit: null as number | null,
    expired: !subscription.usable,
  };
}

/**
 * Permissions that stay available on a suspended centre, so an owner can
 * always pay, read their own data and take it with them. Everything else is
 * held — but nothing is deleted.
 */
const ALLOWED_WHILE_SUSPENDED: ReadonlySet<Permission> = new Set<Permission>([
  'center.billing',
  'center.settings',
  'reports.export',
]);

/**
 * Gate for state-changing requests. A suspended centre keeps every row it ever
 * had; it simply cannot record new work until the subscription is settled.
 */
export async function assertSubscriptionWritable(
  ctx: OrgContext,
  permission: Permission,
): Promise<SubscriptionView | null> {
  if (ALLOWED_WHILE_SUSPENDED.has(permission)) return null;
  // A platform admin working inside a centre for support is not blocked.
  if (ctx.isOverride) return null;

  const subscription = await currentSubscription(ctx.orgId);
  if (!subscription.usable) {
    throw PlanLimit('billing.subscriptionSuspended', {
      status: subscription.status,
      amountMinor: subscription.amountMinor.toString(),
      currency: subscription.currency,
    });
  }
  return subscription;
}

/**
 * Called before creating or re-activating a student.
 *
 * Deliberately imposes no numeric limit: 10 students and 1000 students cost a
 * centre the same. It only checks that the centre is not suspended.
 */
export async function assertCanAddStudent(ctx: OrgContext) {
  await assertSubscriptionWritable(ctx, 'students.create');
}
