import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import type { OrgContext } from '@/lib/tenant';
import { permissionsFor } from '@/lib/rbac';
import type { OrgRole } from '@/generated/prisma/enums';
import { randomUUID } from 'node:crypto';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
export const db = new PrismaClient({ adapter });

let counter = 0;
const unique = () => `${Date.now()}${(counter += 1)}`;

export type Tenant = Awaited<ReturnType<typeof createTenant>>;

/** Builds a complete, isolated workspace with an OWNER context. */
export async function createTenant(name = 'Test Studio') {
  const suffix = unique();

  const user = await db.user.create({
    data: {
      email: `owner-${suffix}@example.test`,
      emailVerified: new Date(),
      phone: `+9989${suffix.slice(-8)}`,
      phoneVerified: new Date(),
      passwordHash: 'not-a-real-hash',
      profile: { create: { firstName: 'Test', lastName: 'Owner', locale: 'UZ' } },
    },
  });

  const org = await db.organization.create({
    data: {
      name: `${name} ${suffix}`,
      slug: `test-${suffix}`,
      defaultCurrency: 'UZS',
      timezone: 'Asia/Tashkent',
      members: { create: { userId: user.id, role: 'OWNER' } },
      subscription: { create: { plan: 'PRO' } },
    },
    include: { members: true },
  });

  const member = org.members[0]!;
  const ctx = buildContext({
    userId: user.id,
    orgId: org.id,
    memberId: member.id,
    role: 'OWNER',
    email: user.email,
    phone: user.phone,
  });

  return { user, org, member, ctx };
}

/**
 * Builds an OrgContext the same way lib/tenant.ts does, so a test exercises the
 * real permission resolution rather than a hand-written permission set.
 */
export function buildContext(input: {
  userId: string;
  orgId: string;
  memberId: string | null;
  role: OrgRole;
  email?: string | null;
  phone?: string | null;
  memberPermissions?: Record<string, boolean>;
}): OrgContext {
  return {
    orgId: input.orgId,
    role: input.role,
    memberId: input.memberId,
    actorUserId: input.userId,
    csrfSecret: 'test-csrf-secret',
    admin: null,
    isOverride: false,
    permissions: permissionsFor(input.role, input.memberPermissions ?? {}),
    user: {
      sessionId: randomUUID(),
      csrfSecret: 'test-csrf-secret',
      userId: input.userId,
      email: input.email ?? null,
      phone: input.phone ?? null,
      emailVerified: true,
      phoneVerified: true,
      firstName: 'Test',
      lastName: 'Owner',
      locale: 'UZ',
      timezone: 'Asia/Tashkent',
      avatarFileId: null,
      activeOrgId: input.orgId,
      role: input.role,
      memberId: input.memberId,
      memberPermissions: input.memberPermissions ?? {},
      mustChangePassword: false,
    },
  };
}

export async function makeStudent(tenant: Tenant, firstName = 'Ali', lastName = 'Valiyev') {
  return db.student.create({
    data: {
      organizationId: tenant.org.id,
      firstName,
      lastName,
      status: 'ACTIVE',
      parents: {
        create: {
          organizationId: tenant.org.id,
          fullName: `${firstName} parent`,
          phone: '+998901112233',
          isPrimary: true,
        },
      },
    },
  });
}

export async function makeGroup(tenant: Tenant, name = 'Group A', feeMinor = 400_000n) {
  return db.group.create({
    data: {
      organizationId: tenant.org.id,
      name: `${name} ${unique()}`,
      teacherId: tenant.member.id,
      monthlyFeeMinor: feeMinor,
      currency: 'UZS',
      weekdays: [1, 3, 5],
      startTime: '18:00',
      endTime: '19:30',
    },
  });
}

export async function makeLesson(tenant: Tenant, groupId: string, startsAt = new Date()) {
  return db.lesson.create({
    data: {
      organizationId: tenant.org.id,
      groupId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 90 * 60_000),
    },
  });
}

/**
 * Wipes every table between test files. TRUNCATE ... CASCADE is one statement,
 * so it neither depends on delete ordering nor deadlocks against the HTTP
 * server's connection pool the way a long multi-delete transaction can.
 */
export async function truncateAll() {
  await db.$executeRawUnsafe(`
    TRUNCATE TABLE
      outbound_messages, telegram_link_tokens, telegram_accounts, webhook_events,
      audit_logs, rate_limit_counters, otp_codes, notifications,
      notification_preferences, billing_intents, subscriptions,
      payment_adjustments, payments, invoices, attendance, lessons,
      group_members, groups, student_parents, students,
      organization_members, organizations, files, sessions, profiles, users
    RESTART IDENTITY CASCADE
  `);
}

/**
 * Adds a staff member with a given role to an existing tenant and returns a
 * context built the same way the real session resolver builds one.
 */
export async function makeMember(
  tenant: Tenant,
  role: OrgRole,
  overrides: Record<string, boolean> = {},
) {
  const suffix = unique();
  const user = await db.user.create({
    data: {
      username: `${role.toLowerCase()}.${suffix}`,
      passwordHash: 'not-a-real-hash',
      profile: { create: { firstName: role, lastName: 'Member', locale: 'UZ' } },
    },
  });
  const member = await db.organizationMember.create({
    data: {
      organizationId: tenant.org.id,
      userId: user.id,
      role,
      permissions: overrides,
    },
  });
  return {
    user,
    member,
    ctx: buildContext({
      userId: user.id,
      orgId: tenant.org.id,
      memberId: member.id,
      role,
      memberPermissions: overrides,
    }),
  };
}

/** Links a student row to a portal account, as the credentials endpoint does. */
export async function makeStudentAccount(tenant: Tenant, studentId: string) {
  const suffix = unique();
  const user = await db.user.create({
    data: {
      username: `student.${suffix}`,
      passwordHash: 'not-a-real-hash',
      profile: { create: { firstName: 'Portal', lastName: 'Student', locale: 'UZ' } },
    },
  });
  await db.organizationMember.create({
    data: { organizationId: tenant.org.id, userId: user.id, role: 'STUDENT' },
  });
  await db.student.update({ where: { id: studentId }, data: { userId: user.id } });
  return user;
}

/** A SessionUser for a student portal account. */
export function studentSession(userId: string) {
  return {
    sessionId: randomUUID(),
    csrfSecret: 'test-csrf-secret',
    userId,
    email: null,
    phone: null,
    emailVerified: false,
    phoneVerified: false,
    firstName: 'Portal',
    lastName: 'Student',
    locale: 'UZ' as const,
    timezone: 'Asia/Tashkent',
    avatarFileId: null,
    activeOrgId: null,
    role: 'STUDENT' as const,
    memberId: null,
    memberPermissions: {},
    mustChangePassword: false,
  };
}
