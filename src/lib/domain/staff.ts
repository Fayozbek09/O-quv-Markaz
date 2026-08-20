import { prisma } from '../db';
import { scope, findOwned, assertPermission, type OrgContext } from '../tenant';
import { audit } from '../security/audit';
import { buildTempCredentials } from '../auth/credentials';
import { parseAmountToMinor } from '../money';
import { GRANTABLE, type Permission } from '../rbac';
import { BadRequest, Conflict, Forbidden, NotFound } from '../errors';
import { DEFAULT_NOTIFICATION_TYPES } from '../notifications/notify';
import { DB_LOCALE } from '../i18n/config';
import type { z } from 'zod';
import type { OrgRole } from '@/generated/prisma/enums';
import type {
  createStaffSchema, updateStaffSchema, updateSalarySchema, issueCredentialsSchema,
} from '../validation/schemas';

/** Only permissions the role is allowed to receive are persisted. */
export function sanitizePermissions(
  role: OrgRole,
  input: Record<string, boolean> | undefined,
): Record<string, boolean> {
  if (!input) return {};
  const grantable = new Set<string>(GRANTABLE[role] ?? ([] as readonly Permission[]));
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === true && grantable.has(key)) out[key] = true;
    // A revocation is always allowed — it can only narrow the account.
    else if (value === false) out[key] = false;
  }
  return out;
}

const MEMBER_SELECT = {
  id: true,
  role: true,
  status: true,
  subject: true,
  specialization: true,
  hireDate: true,
  salaryModel: true,
  salaryAmountMinor: true,
  salaryPercentBp: true,
  currency: true,
  permissions: true,
  joinedAt: true,
  user: {
    select: {
      id: true,
      username: true,
      email: true,
      phone: true,
      isActive: true,
      lastLoginAt: true,
      mustChangePassword: true,
      profile: { select: { firstName: true, lastName: true, avatarFileId: true, teachingSubject: true } },
    },
  },
  _count: { select: { groups: true } },
} as const;

type MemberRow = Awaited<ReturnType<typeof loadMembers>>[number];

/** The shape callers get: salary is `null` unless they may read it. */
export type StaffView = Omit<MemberRow, 'salaryAmountMinor' | 'salaryPercentBp' | 'salaryModel'> & {
  salaryModel: MemberRow['salaryModel'] | null;
  salaryAmountMinor: bigint | null;
  salaryPercentBp: number | null;
};

function loadMembers(where: Record<string, unknown>) {
  return prisma.organizationMember.findMany({
    where,
    select: MEMBER_SELECT,
    orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
  });
}

/**
 * Blanks the pay fields for a caller without `salary.read`. Nulling rather than
 * deleting keeps the response shape stable, so a missing key can never be read
 * as "zero salary" by a careless consumer.
 */
function project(member: MemberRow, canReadSalary: boolean): StaffView {
  if (canReadSalary) return member;
  return { ...member, salaryModel: null, salaryAmountMinor: null, salaryPercentBp: null };
}

export async function listStaff(
  ctx: OrgContext,
  options: { role?: OrgRole | 'ALL'; includeRemoved?: boolean } = {},
): Promise<StaffView[]> {
  const rows = await loadMembers({
    ...scope.org(ctx),
    ...(options.includeRemoved ? {} : { removedAt: null }),
    role: options.role && options.role !== 'ALL' ? options.role : { not: 'STUDENT' as const },
  });

  const canReadSalary = ctx.permissions.has('salary.read') && ctx.role !== 'TEACHER';
  // A teacher may always see their own figure, and only their own.
  return rows.map((row) => project(row, canReadSalary || row.user.id === ctx.actorUserId));
}

export async function getStaff(ctx: OrgContext, memberId: string): Promise<StaffView> {
  const member = await prisma.organizationMember.findFirst({
    where: { ...scope.byId(ctx, memberId) },
    select: MEMBER_SELECT,
  });
  if (!member || member.role === 'STUDENT') throw NotFound();

  // A teacher may open only their own record.
  if (ctx.role === 'TEACHER' && member.id !== ctx.memberId) throw NotFound();

  const canReadSalary =
    (ctx.permissions.has('salary.read') && ctx.role !== 'TEACHER') || member.id === ctx.memberId;
  return project(member, canReadSalary);
}

/**
 * Creates a staff account: a user, a membership and a fresh set of credentials.
 * The plaintext password exists only in the return value of this call.
 */
export async function createStaff(ctx: OrgContext, input: z.infer<typeof createStaffSchema>) {
  if (input.role === 'ADMIN') assertPermission(ctx, 'staff.create');
  if (input.role === 'TEACHER') assertPermission(ctx, 'teachers.create');
  if (input.role === 'RECEPTIONIST') assertPermission(ctx, 'staff.create');

  // Only an owner may mint another administrator.
  if (input.role === 'ADMIN' && ctx.role !== 'OWNER' && !ctx.isOverride) throw Forbidden();

  if (input.email) {
    const clash = await prisma.user.findFirst({ where: { email: input.email, deletedAt: null } });
    if (clash) throw Conflict('staff.emailTaken');
  }
  if (input.phone) {
    const clash = await prisma.user.findFirst({ where: { phone: input.phone, deletedAt: null } });
    if (clash) throw Conflict('staff.phoneTaken');
  }

  const credentials = await buildTempCredentials({
    firstName: input.firstName,
    lastName: input.lastName,
    role: input.role,
    preferred: input.username,
  });

  const salaryAmountMinor = parseAmountToMinor(input.salaryAmount || '0', 'UZS');
  const salaryPercentBp = Math.round(input.salaryPercent * 100);

  const member = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        username: credentials.username,
        email: input.email,
        phone: input.phone,
        passwordHash: credentials.passwordHash,
        mustChangePassword: true,
        credentialsExpireAt: credentials.credentialsExpireAt,
        profile: {
          create: {
            firstName: input.firstName,
            lastName: input.lastName,
            teachingSubject: input.subject,
            locale: DB_LOCALE[input.locale],
          },
        },
      },
    });

    await tx.notificationPreference.createMany({
      data: DEFAULT_NOTIFICATION_TYPES.map((type) => ({
        userId: user.id, type, inApp: true, telegram: false, email: false,
      })),
      skipDuplicates: true,
    });

    return tx.organizationMember.create({
      data: {
        organizationId: ctx.orgId,
        userId: user.id,
        role: input.role,
        subject: input.subject,
        specialization: input.specialization,
        hireDate: input.hireDate ? new Date(`${input.hireDate}T00:00:00Z`) : null,
        salaryModel: input.salaryModel,
        salaryAmountMinor,
        salaryPercentBp,
        permissions: sanitizePermissions(input.role, input.permissions),
      },
      select: MEMBER_SELECT,
    });
  });

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    actorAdminId: ctx.admin?.adminId ?? null,
    isOverride: ctx.isOverride,
    action: input.role === 'TEACHER' ? 'teacher.create' : 'staff.create',
    entityType: 'organization_member',
    entityId: member.id,
    meta: { role: input.role, username: credentials.username },
  });

  return {
    member,
    credentials: {
      username: credentials.username,
      password: credentials.password,
      expiresAt: credentials.credentialsExpireAt,
      usernameWasTaken: credentials.wasTaken,
      requestedUsername: credentials.requested,
    },
  };
}

export async function updateStaff(
  ctx: OrgContext,
  memberId: string,
  input: z.infer<typeof updateStaffSchema>,
) {
  const existing = await prisma.organizationMember.findFirst({
    where: scope.byId(ctx, memberId),
    include: { user: { select: { id: true, email: true, phone: true } } },
  });
  if (!existing || existing.role === 'STUDENT') throw NotFound();
  if (existing.role === 'TEACHER') assertPermission(ctx, 'teachers.update');
  else assertPermission(ctx, 'staff.update');
  if (existing.role === 'OWNER' && ctx.role !== 'OWNER' && !ctx.isOverride) throw Forbidden();

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: existing.userId },
      data: {
        email: input.email,
        phone: input.phone,
        profile: {
          update: {
            firstName: input.firstName,
            lastName: input.lastName,
            teachingSubject: input.subject,
          },
        },
      },
    });
    await tx.organizationMember.update({
      where: { id: existing.id },
      data: {
        subject: input.subject,
        specialization: input.specialization,
        hireDate: input.hireDate ? new Date(`${input.hireDate}T00:00:00Z`) : null,
        status: input.status,
        permissions: sanitizePermissions(existing.role, input.permissions),
      },
    });
  });

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    actorAdminId: ctx.admin?.adminId ?? null,
    isOverride: ctx.isOverride,
    action: 'staff.update',
    entityType: 'organization_member',
    entityId: existing.id,
  });
}

/**
 * Salary is a separate call behind `salary.write`, so an account that may edit
 * a teacher's phone number cannot also change what they are paid.
 */
export async function updateSalary(
  ctx: OrgContext,
  memberId: string,
  input: z.infer<typeof updateSalarySchema>,
) {
  assertPermission(ctx, 'salary.write');
  const existing = await findOwned<{ id: string; salaryAmountMinor: bigint; salaryModel: string; salaryPercentBp: number }>(
    ctx,
    'organizationMember',
    memberId,
  );

  const salaryAmountMinor = parseAmountToMinor(input.salaryAmount || '0', 'UZS');
  await prisma.organizationMember.update({
    where: { id: existing.id },
    data: {
      salaryModel: input.salaryModel,
      salaryAmountMinor,
      salaryPercentBp: Math.round(input.salaryPercent * 100),
    },
  });

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    actorAdminId: ctx.admin?.adminId ?? null,
    isOverride: ctx.isOverride,
    action: 'salary.update',
    entityType: 'organization_member',
    entityId: existing.id,
    meta: {
      before: { model: existing.salaryModel, amountMinor: existing.salaryAmountMinor.toString() },
      after: { model: input.salaryModel, amountMinor: salaryAmountMinor.toString() },
    },
  });
}

/** Re-issues credentials. The old password stops working immediately. */
export async function reissueStaffCredentials(
  ctx: OrgContext,
  memberId: string,
  input: z.infer<typeof issueCredentialsSchema>,
) {
  const member = await prisma.organizationMember.findFirst({
    where: scope.byId(ctx, memberId),
    include: { user: { select: { id: true, username: true, profile: true } } },
  });
  if (!member || member.role === 'STUDENT') throw NotFound();
  if (member.role === 'TEACHER') assertPermission(ctx, 'teachers.update');
  else assertPermission(ctx, 'staff.update');
  if (member.role === 'OWNER' && ctx.role !== 'OWNER' && !ctx.isOverride) throw Forbidden();

  const credentials = await buildTempCredentials({
    firstName: member.user.profile?.firstName ?? 'user',
    lastName: member.user.profile?.lastName,
    role: member.role as 'TEACHER' | 'RECEPTIONIST' | 'ADMIN' | 'OWNER',
    preferred: input.username ?? member.user.username,
  });

  // Keep the handle the person already knows unless a new one was requested.
  const username = input.username ? credentials.username : (member.user.username ?? credentials.username);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: member.userId },
      data: {
        username,
        passwordHash: credentials.passwordHash,
        mustChangePassword: true,
        credentialsExpireAt: credentials.credentialsExpireAt,
      },
    }),
    // Every existing session for that account dies with the old password.
    prisma.session.updateMany({
      where: { userId: member.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    actorAdminId: ctx.admin?.adminId ?? null,
    isOverride: ctx.isOverride,
    action: 'staff.credentials.reissue',
    entityType: 'organization_member',
    entityId: member.id,
  });

  return {
    username,
    password: credentials.password,
    expiresAt: credentials.credentialsExpireAt,
  };
}

/** Soft removal: the membership is closed, the person's history is untouched. */
export async function removeStaff(ctx: OrgContext, memberId: string) {
  const member = await prisma.organizationMember.findFirst({ where: scope.byId(ctx, memberId) });
  if (!member || member.role === 'STUDENT') throw NotFound();
  if (member.role === 'TEACHER') assertPermission(ctx, 'teachers.delete');
  else assertPermission(ctx, 'staff.delete');
  if (member.role === 'OWNER') throw BadRequest('staff.cannotRemoveOwner');
  if (member.id === ctx.memberId) throw BadRequest('staff.cannotRemoveSelf');

  await prisma.$transaction([
    prisma.organizationMember.update({
      where: { id: member.id },
      data: { removedAt: new Date(), status: 'INACTIVE' },
    }),
    prisma.session.updateMany({
      where: { userId: member.userId, activeOrgId: ctx.orgId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    actorAdminId: ctx.admin?.adminId ?? null,
    isOverride: ctx.isOverride,
    action: 'staff.remove',
    entityType: 'organization_member',
    entityId: member.id,
    meta: { role: member.role },
  });
}
