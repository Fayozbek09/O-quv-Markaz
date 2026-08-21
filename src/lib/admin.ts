import { prisma } from './db';
import { monthBounds } from './domain/time';
import { Forbidden, Unauthorized } from './errors';
import { getAdminSession, type AdminSessionUser } from './auth/admin-session';
import { getSessionUser } from './auth/session';
import { audit } from './security/audit';

/**
 * Platform-administration context.
 *
 * There is no path from a centre role to this context: it is produced only from
 * an `admin_sessions` row, which in turn is produced only by /api/admin/login.
 * A centre user hitting an admin route is refused with 403 whether or not they
 * are signed in, and the refusal is recorded.
 */
export type AdminContext = {
  adminId: string;
  sessionId: string;
  username: string;
  fullName: string;
  csrfSecret: string;
  impersonatingOrgId: string | null;
};

export async function requireAdmin(): Promise<AdminContext> {
  const admin = await getAdminSession();
  if (!admin) {
    // Distinguish "not an admin" from "not signed in" only in the audit log,
    // never in the response: both get the same shape.
    const user = await getSessionUser();
    if (user) {
      await audit({
        actorUserId: user.userId,
        action: 'admin.access.denied',
        outcome: 'denied',
        meta: { reason: 'centre_session_at_admin_route' },
      });
      throw Forbidden();
    }
    throw Unauthorized();
  }

  // A session that has passed the password but not the code reaches the
  // challenge screen and nothing else. Enforcing it here rather than only in
  // the layout means the API is closed too — a redirect governs a browser, not
  // a script holding the cookie.
  if (admin.awaitingSecondFactor) {
    await audit({
      actorAdminId: admin.adminId,
      action: 'admin.access.denied',
      outcome: 'denied',
      meta: { reason: 'second_factor_required' },
    });
    throw Forbidden('admin.twoFactorRequired');
  }

  return {
    adminId: admin.adminId,
    sessionId: admin.sessionId,
    username: admin.username,
    fullName: admin.fullName,
    csrfSecret: admin.csrfSecret,
    impersonatingOrgId: admin.impersonatingOrgId,
  };
}

/** Convenience for server components: resolves without throwing. */
export const currentAdmin = (): Promise<AdminSessionUser | null> => getAdminSession();

/**
 * Records a platform-admin action. Every write an admin performs inside a
 * centre goes through here — the requirement is that an override is never
 * silent, so the `isOverride` flag and the target centre are always stored.
 */
export async function auditAdmin(input: {
  adminId: string;
  organizationId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  outcome?: 'success' | 'failure' | 'denied';
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
}): Promise<void> {
  await audit({
    organizationId: input.organizationId ?? null,
    actorAdminId: input.adminId,
    isOverride: Boolean(input.organizationId),
    action: input.action,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    outcome: input.outcome ?? 'success',
    meta: {
      ...(input.meta ?? {}),
      ...(input.before === undefined ? {} : { before: input.before }),
      ...(input.after === undefined ? {} : { after: input.after }),
    },
  });
}

/** Platform-wide counters for the admin dashboard. */
/**
 * The platform bills and reports in Tashkent time, like every centre. Taking a
 * month boundary in UTC would drop the payments made between midnight and 05:00
 * local on the first of the month out of that month's figure.
 */
const PLATFORM_TIMEZONE = 'Asia/Tashkent';

export async function platformStats() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PLATFORM_TIMEZONE,
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now);
  const localYear = Number(parts.find((p) => p.type === 'year')?.value);
  const localMonth = Number(parts.find((p) => p.type === 'month')?.value);
  const [monthStart] = monthBounds(localYear, localMonth, PLATFORM_TIMEZONE);
  const [yearStart] = monthBounds(localYear, 1, PLATFORM_TIMEZONE);

  const [
    centers, activeCenters, suspendedCenters, teachers, students, groups, lessons,
    revenue, registrations30d, byStatus, mrrRows, monthCollected, yearCollected,
  ] = await Promise.all([
    prisma.organization.count({ where: { deletedAt: null } }),
    prisma.organization.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
    prisma.organization.count({ where: { deletedAt: null, status: 'SUSPENDED' } }),
    prisma.organizationMember.count({ where: { role: 'TEACHER', removedAt: null } }),
    prisma.student.count({ where: { deletedAt: null } }),
    prisma.group.count({ where: { deletedAt: null } }),
    prisma.lesson.count({ where: { deletedAt: null } }),
    // Money the centres themselves track, not platform income.
    prisma.payment.aggregate({ _sum: { amountMinor: true }, where: { status: 'COMPLETED' } }),
    prisma.organization.count({
      where: { deletedAt: null, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
    }),
    prisma.subscription.groupBy({
      by: ['status'],
      where: { organization: { deletedAt: null } },
      _count: { _all: true },
    }),
    // Recurring revenue counts only centres actually on a paid term.
    prisma.subscription.aggregate({
      _sum: { amountMinor: true },
      where: { status: 'ACTIVE', organization: { deletedAt: null } },
    }),
    prisma.subscriptionPayment.aggregate({
      _sum: { amountMinor: true },
      where: { status: 'PAID', paidAt: { gte: monthStart } },
    }),
    prisma.subscriptionPayment.aggregate({
      _sum: { amountMinor: true },
      where: { status: 'PAID', paidAt: { gte: yearStart } },
    }),
  ]);

  const count = (status: string) =>
    byStatus.find((row) => row.status === status)?._count._all ?? 0;

  return {
    centers,
    activeCenters,
    suspendedCenters,
    teachers,
    students,
    groups,
    lessons,
    revenueMinor: revenue._sum.amountMinor ?? 0n,
    registrations30d,
    subscriptions: {
      trial: count('TRIAL') + count('TRIALING'),
      active: count('ACTIVE'),
      paymentDue: count('PAYMENT_DUE') + count('PAST_DUE'),
      grace: count('GRACE_PERIOD'),
      suspended: count('SUSPENDED'),
      cancelled: count('CANCELLED') + count('CANCELED'),
    },
    mrrMinor: mrrRows._sum.amountMinor ?? 0n,
    monthCollectedMinor: monthCollected._sum.amountMinor ?? 0n,
    yearCollectedMinor: yearCollected._sum.amountMinor ?? 0n,
  };
}

/** Cheap liveness probes for the dashboard's health tile. */
export async function systemHealth() {
  const started = Date.now();
  let database = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = true;
  } catch {
    database = false;
  }
  return { database, latencyMs: Date.now() - started };
}
