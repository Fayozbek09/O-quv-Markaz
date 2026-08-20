import { prisma } from './db';
import { Forbidden, NotFound, Unauthorized } from './errors';
import { getSessionUser, type SessionUser } from './auth/session';
import type { OrgRole } from '@/generated/prisma/enums';

/**
 * Tenant context. Every data access in the app goes through `requireOrg()` and
 * then scopes its query by `ctx.orgId`. There is no code path that reads a
 * tenant-owned table without an organizationId in the WHERE clause.
 */
export type OrgContext = {
  user: SessionUser;
  orgId: string;
  role: OrgRole;
};

const ROLE_RANK: Record<OrgRole, number> = {
  OWNER: 4,
  ADMIN: 3,
  TEACHER: 2,
  ASSISTANT: 1,
};

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw Unauthorized();
  return user;
}

export async function requireOrg(minRole: OrgRole = 'ASSISTANT'): Promise<OrgContext> {
  const user = await requireUser();
  if (!user.activeOrgId || !user.role) throw Forbidden('errors.noWorkspace');
  if (ROLE_RANK[user.role] < ROLE_RANK[minRole]) throw Forbidden();
  return { user, orgId: user.activeOrgId, role: user.role };
}

export const can = (role: OrgRole, minRole: OrgRole) => ROLE_RANK[role] >= ROLE_RANK[minRole];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

export function assertRole(ctx: OrgContext, minRole: OrgRole): void {
  if (!can(ctx.role, minRole)) throw Forbidden();
}

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
  | 'lesson'
  | 'payment'
  | 'invoice'
  | 'attendance'
  | 'file'
  | 'notification'
  | 'outboundMessage'
  | 'paymentAdjustment';

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
  model: 'student' | 'group' | 'lesson',
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
