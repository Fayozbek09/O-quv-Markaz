import { prisma } from './db';
import { Forbidden, NotFound, Unauthorized } from './errors';
import { getSessionUser, type SessionUser } from './auth/session';
import { getAdminSession, type AdminSessionUser } from './auth/admin-session';
import { permissionsFor, ROLE_PERMISSIONS, type Permission } from './rbac';
import type { OrgRole } from '@/generated/prisma/enums';

/**
 * Tenant context. Every data access in the app goes through `requireOrg()` and
 * then scopes its query by `ctx.orgId`. There is no code path that reads a
 * tenant-owned table without an organizationId in the WHERE clause.
 *
 * The context is derived exclusively from the session cookie. Nothing about the
 * tenant, the role or the permission set is ever read from the request body,
 * the query string or a header.
 */
export type OrgContext = {
  /** Null when a platform administrator is acting through the override path. */
  user: SessionUser | null;
  admin: AdminSessionUser | null;
  /** The users.id to attribute writes to; null for a platform-admin override. */
  actorUserId: string | null;
  csrfSecret: string;
  orgId: string;
  role: OrgRole;
  /** organization_members.id — used to scope a teacher to their own groups. */
  memberId: string | null;
  permissions: ReadonlySet<Permission>;
  /** True when the actor is a platform admin inside someone else's centre. */
  isOverride: boolean;
};

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw Unauthorized();
  return user;
}

/** Permission set a platform admin wields inside a centre: everything a centre owner can do. */
const OVERRIDE_PERMISSIONS: ReadonlySet<Permission> = new Set(ROLE_PERMISSIONS.OWNER);

/**
 * Resolves the tenant context, then checks a permission if one is named.
 *
 * Resolution order matters: a centre session wins over an admin session, so an
 * administrator who also happens to be signed in as a centre user cannot
 * accidentally act with elevated rights.
 */
export async function requireOrg(permission?: Permission): Promise<OrgContext> {
  const user = await getSessionUser();

  if (user) {
    if (!user.activeOrgId || !user.role) throw Forbidden('errors.noWorkspace');
    // A student's data lives behind the portal queries, never behind a staff
    // endpoint, so a student session is refused a tenant context outright.
    if (user.role === 'STUDENT') throw Forbidden();

    const ctx: OrgContext = {
      user,
      admin: null,
      actorUserId: user.userId,
      csrfSecret: user.csrfSecret,
      orgId: user.activeOrgId,
      role: user.role,
      memberId: user.memberId,
      permissions: permissionsFor(user.role, user.memberPermissions),
      isOverride: false,
    };
    if (permission) assertPermission(ctx, permission);
    return ctx;
  }

  const admin = await getAdminSession();
  if (admin?.impersonatingOrgId) {
    const org = await prisma.organization.findFirst({
      where: { id: admin.impersonatingOrgId, deletedAt: null },
      select: { id: true },
    });
    if (!org) throw Forbidden();
    const ctx: OrgContext = {
      user: null,
      admin,
      actorUserId: null,
      csrfSecret: admin.csrfSecret,
      orgId: org.id,
      role: 'OWNER',
      memberId: null,
      permissions: OVERRIDE_PERMISSIONS,
      isOverride: true,
    };
    if (permission) assertPermission(ctx, permission);
    return ctx;
  }

  throw Unauthorized();
}

export const hasPermission = (ctx: OrgContext, permission: Permission) =>
  ctx.permissions.has(permission);

export function assertPermission(ctx: OrgContext, permission: Permission): void {
  if (!ctx.permissions.has(permission)) throw Forbidden();
}

/**
 * A teacher only ever sees their own groups. Returns a `where` fragment that is
 * empty for staff who may see the whole centre.
 */
export const teacherScope = (ctx: OrgContext, field = 'teacherId') =>
  ctx.role === 'TEACHER' && ctx.memberId ? { [field]: ctx.memberId } : {};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/**
 * Tenant-scoped filters. Using these instead of hand-written `where` clauses
 * keeps organizationId from being forgotten at a call site.
 */
export const scope = {
  org: (ctx: OrgContext) => ({ organizationId: ctx.orgId }),
  orgLive: (ctx: OrgContext) => ({ organizationId: ctx.orgId, deletedAt: null }),
  /**
   * Rejects a malformed id before it reaches the driver. Without this a value
   * like `not-a-uuid` raises a Postgres cast error, which would surface as a
   * 500 and echo the query back in the server log - a needless disclosure and
   * an easy oracle for probing.
   */
  byId: (ctx: OrgContext, id: string) => {
    if (!isUuid(id)) throw NotFound();
    return { id, organizationId: ctx.orgId };
  },
};

/**
 * Loads a tenant-owned row by id. Returns 404 — not 403 — for rows in other
 * tenants so the response cannot be used to probe for existence (IDOR/BOLA).
 */
type TenantModel =
  | 'student'
  | 'group'
  | 'course'
  | 'lesson'
  | 'payment'
  | 'invoice'
  | 'attendance'
  | 'file'
  | 'notification'
  | 'outboundMessage'
  | 'paymentAdjustment'
  | 'homework'
  | 'homeworkSubmission'
  | 'grade'
  | 'salaryPayment'
  | 'expense'
  | 'organizationMember';

export async function findOwned<T>(
  ctx: OrgContext,
  model: TenantModel,
  id: string,
  extra?: Record<string, unknown>,
): Promise<T> {
  if (!isUuid(id)) throw NotFound();
  const delegate = prisma[model] as unknown as {
    findFirst: (args: unknown) => Promise<T | null>;
  };
  const row = await delegate.findFirst({
    where: { id, organizationId: ctx.orgId, ...(extra ?? {}) },
  });
  if (!row) throw NotFound();
  return row;
}

/**
 * Verifies that a list of ids all belong to the tenant. Used before bulk
 * operations so a crafted array cannot smuggle in another tenant's rows.
 */
export async function assertAllOwned(
  ctx: OrgContext,
  model: 'student' | 'group' | 'lesson' | 'organizationMember',
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  if (!ids.every(isUuid)) throw NotFound();
  const unique = [...new Set(ids)];
  const delegate = prisma[model] as unknown as {
    count: (args: unknown) => Promise<number>;
  };
  const found = await delegate.count({
    where: { id: { in: unique }, organizationId: ctx.orgId },
  });
  if (found !== unique.length) throw NotFound();
}
