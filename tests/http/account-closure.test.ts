import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, truncateAll, createTenant, makeStudent, makeMember, type Tenant } from '../factories';
import { Session } from './client';
import { hashPassword } from '@/lib/auth/password';

/**
 * Closing an account must not destroy a centre's books.
 *
 * The route used to cascade: an owner deleting their account deleted the
 * organization row, and Postgres took every student, payment, invoice, grade
 * and attendance record with it. Deleting the membership rows separately
 * cascaded into `salary_payments`, so a teacher leaving a shared centre erased
 * their own payroll history from that centre's accounts as well.
 */
const PASSWORD = 'CorrectHorse42!';

async function signIn(username: string): Promise<Session> {
  await db.rateLimitCounter.deleteMany();
  const session = new Session();
  const res = await session.fetch('/api/auth/login', {
    method: 'POST',
    json: { identifier: username, password: PASSWORD },
  });
  expect(res.status, await res.clone().text()).toBe(200);
  await session.loadCsrf();
  return session;
}

/** Gives a factory user a real password and handle so it can sign in over HTTP. */
async function makeSignInable(userId: string, username: string) {
  await db.user.update({
    where: { id: userId },
    data: { username, passwordHash: await hashPassword(PASSWORD) },
  });
  return username;
}

let solo: Tenant;
let shared: Tenant;

beforeAll(async () => {
  await truncateAll();
  solo = await createTenant('Solo Centre');
  shared = await createTenant('Shared Centre');
});

afterAll(() => db.$disconnect());

describe('closing a sole owner account keeps the centre records', () => {
  let studentId: string;
  let paymentId: string;
  let orgId: string;

  beforeAll(async () => {
    orgId = solo.org.id;
    const student = await makeStudent(solo, 'Retained', 'Learner');
    studentId = student.id;

    const payment = await db.payment.create({
      data: {
        organizationId: orgId,
        studentId,
        amountMinor: 650_000n,
        currency: 'UZS',
        method: 'CASH',
        status: 'COMPLETED',
        paidAt: new Date(),
      },
    });
    paymentId = payment.id;

    const username = await makeSignInable(solo.user.id, `solo.owner.${Date.now().toString(36)}`);
    const session = await signIn(username);
    const res = await session.fetch('/api/account/delete', {
      method: 'DELETE',
      json: { password: PASSWORD, confirm: 'DELETE' },
      csrf: true,
    });
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it('closes the centre without destroying it', async () => {
    const org = await db.organization.findUnique({ where: { id: orgId } });
    expect(org).not.toBeNull();
    expect(org?.deletedAt).not.toBeNull();
    expect(org?.status).toBe('SUSPENDED');
  });

  it('keeps the students and the money', async () => {
    expect(await db.student.findUnique({ where: { id: studentId } })).not.toBeNull();
    const payment = await db.payment.findUnique({ where: { id: paymentId } });
    expect(payment?.amountMinor).toBe(650_000n);
  });

  it('releases the login identifiers and blocks any further sign-in', async () => {
    const row = await db.user.findUniqueOrThrow({ where: { id: solo.user.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.isActive).toBe(false);
    expect(row.username).toBeNull();
    expect(row.email).toBeNull();
    expect(row.phone).toBeNull();
    expect(row.passwordHash).toBeNull();

    const live = await db.session.count({ where: { userId: solo.user.id, revokedAt: null } });
    expect(live).toBe(0);
  });
});

describe('a member leaving a shared centre', () => {
  it('keeps their payroll history and marks the membership as left', async () => {
    const teacher = await makeMember(shared, 'TEACHER');
    const salary = await db.salaryPayment.create({
      data: {
        organizationId: shared.org.id,
        memberId: teacher.member.id,
        amountMinor: 3_000_000n,
        currency: 'UZS',
        periodYear: 2026,
        periodMonth: 7,
        paidAt: new Date(),
      },
    });

    const username = await makeSignInable(teacher.user.id, `leaver.${Date.now().toString(36)}`);
    const session = await signIn(username);
    const res = await session.fetch('/api/account/delete', {
      method: 'DELETE',
      json: { password: PASSWORD, confirm: 'DELETE' },
      csrf: true,
    });
    expect(res.status, await res.clone().text()).toBe(200);

    const kept = await db.salaryPayment.findUnique({ where: { id: salary.id } });
    expect(kept?.amountMinor).toBe(3_000_000n);

    const membership = await db.organizationMember.findUniqueOrThrow({
      where: { id: teacher.member.id },
    });
    expect(membership.removedAt).not.toBeNull();

    // The centre itself is untouched — it has other people in it.
    const org = await db.organization.findUniqueOrThrow({ where: { id: shared.org.id } });
    expect(org.deletedAt).toBeNull();
  });
});

describe('the last owner of a populated centre', () => {
  it('is refused, rather than leaving the centre with nobody to run it', async () => {
    const centre = await createTenant('Populated Centre');
    await makeMember(centre, 'TEACHER');

    const username = await makeSignInable(centre.user.id, `last.owner.${Date.now().toString(36)}`);
    const session = await signIn(username);
    const res = await session.fetch('/api/account/delete', {
      method: 'DELETE',
      json: { password: PASSWORD, confirm: 'DELETE' },
      csrf: true,
    });

    expect(res.status).toBe(400);
    expect((await res.json()).messageKey).toBe('settings.deleteAccountLastOwner');

    const row = await db.user.findUniqueOrThrow({ where: { id: centre.user.id } });
    expect(row.deletedAt).toBeNull();
  });
});
