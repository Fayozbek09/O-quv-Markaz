import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import type { OrgContext } from '@/lib/tenant';
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

  const ctx: OrgContext = {
    orgId: org.id,
    role: 'OWNER',
    user: {
      sessionId: randomUUID(),
      csrfSecret: 'test-csrf-secret',
      userId: user.id,
      email: user.email,
      phone: user.phone,
      emailVerified: true,
      phoneVerified: true,
      firstName: 'Test',
      lastName: 'Owner',
      locale: 'UZ',
      timezone: 'Asia/Tashkent',
      avatarFileId: null,
      activeOrgId: org.id,
      role: 'OWNER',
    },
  };

  return { user, org, member: org.members[0]!, ctx };
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
