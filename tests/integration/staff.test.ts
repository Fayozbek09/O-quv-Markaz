import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTenant, truncateAll, db, type Tenant } from '../factories';
import { createStaff, reissueStaffCredentials, removeStaff, listStaff } from '@/lib/domain/staff';
import { generateUsername, usernameAvailable, nextStudentNo } from '@/lib/auth/credentials';
import { verifyPassword } from '@/lib/auth/password';
import { createStaffSchema } from '@/lib/validation/schemas';

let tenant: Tenant;

beforeAll(async () => {
  await truncateAll();
  tenant = await createTenant('Staff Centre');
});
afterAll(() => db.$disconnect());

const input = (over: Record<string, unknown> = {}) =>
  createStaffSchema.parse({
    firstName: 'Dilbar',
    lastName: 'Saidova',
    role: 'TEACHER',
    salaryModel: 'FIXED',
    salaryAmount: '5000000',
    ...over,
  });

describe('creating a staff account', () => {
  it('generates a username and a password nobody chose', async () => {
    const result = await createStaff(tenant.ctx, input());

    expect(result.credentials.username).toMatch(/^teacher\./);
    expect(result.credentials.password).toHaveLength(14);
    expect(result.member.role).toBe('TEACHER');

    const user = await db.user.findUnique({ where: { id: result.member.user.id } });
    // Only the hash is stored, and it verifies against the returned password.
    expect(user?.passwordHash).not.toContain(result.credentials.password);
    expect(await verifyPassword(user!.passwordHash!, result.credentials.password)).toBe(true);
  });

  it('forces a password change at first sign-in and expires the credential', async () => {
    const result = await createStaff(tenant.ctx, input({ firstName: 'Anvar', lastName: 'Rustamov' }));
    const user = await db.user.findUnique({ where: { id: result.member.user.id } });
    expect(user?.mustChangePassword).toBe(true);
    expect(user?.credentialsExpireAt).toBeInstanceOf(Date);
    expect(user!.credentialsExpireAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('never issues the same password twice', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const result = await createStaff(tenant.ctx, input({ firstName: `Unique${i}`, lastName: 'Teacher' }));
      seen.add(result.credentials.password);
    }
    expect(seen.size).toBe(5);
  });

  it('records the salary the caller asked for', async () => {
    const result = await createStaff(
      tenant.ctx,
      input({ firstName: 'Percent', lastName: 'Teacher', salaryModel: 'PERCENTAGE', salaryPercent: 40 }),
    );
    const member = await db.organizationMember.findUnique({ where: { id: result.member.id } });
    expect(member?.salaryModel).toBe('PERCENTAGE');
    expect(member?.salaryPercentBp).toBe(4000);
  });

  it('writes an audit entry without the password in it', async () => {
    const result = await createStaff(tenant.ctx, input({ firstName: 'Audited', lastName: 'Teacher' }));
    const log = await db.auditLog.findFirst({
      where: { organizationId: tenant.org.id, entityId: result.member.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(log?.action).toBe('teacher.create');
    expect(JSON.stringify(log?.meta)).not.toContain(result.credentials.password);
  });

  it('rejects a role a centre user may not mint', async () => {
    expect(() => createStaffSchema.parse({ ...input(), role: 'OWNER' })).toThrow();
    expect(() => createStaffSchema.parse({ ...input(), role: 'STUDENT' })).toThrow();
  });

  it('refuses a duplicate e-mail address', async () => {
    await createStaff(tenant.ctx, input({ firstName: 'First', email: 'shared@example.test' }));
    await expect(
      createStaff(tenant.ctx, input({ firstName: 'Second', email: 'shared@example.test' })),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('username collisions', () => {
  it('never returns a handle that is already taken', async () => {
    const first = await generateUsername({ firstName: 'Aziz', lastName: 'Aziz', role: 'TEACHER' });
    await db.user.create({
      data: { username: first.username, passwordHash: 'x', profile: { create: { firstName: 'A' } } },
    });

    const second = await generateUsername({ firstName: 'Aziz', lastName: 'Aziz', role: 'TEACHER' });
    expect(second.username).not.toBe(first.username);
    expect(second.wasTaken).toBe(true);
    expect(await usernameAvailable(second.username)).toBe(true);
  });

  it('suffixes sequentially so the handle stays readable', async () => {
    const base = 'teacher.collide.test';
    await db.user.create({
      data: { username: base, passwordHash: 'x', profile: { create: { firstName: 'A' } } },
    });
    const next = await generateUsername({
      firstName: 'X', lastName: 'Y', role: 'TEACHER', preferred: base,
    });
    expect(next.username).toBe(`${base}2`);
    expect(next.requested).toBe(base);
  });

  it('tells the creator which handle was actually issued', async () => {
    const taken = 'teacher.requested.taken';
    await db.user.create({
      data: { username: taken, passwordHash: 'x', profile: { create: { firstName: 'A' } } },
    });
    const result = await createStaff(
      tenant.ctx,
      input({ firstName: 'Requested', lastName: 'Handle', username: taken }),
    );
    expect(result.credentials.usernameWasTaken).toBe(true);
    expect(result.credentials.requestedUsername).toBe(taken);
    expect(result.credentials.username).not.toBe(taken);
  });

  it('is globally unique, not merely unique inside one centre', async () => {
    const otherCentre = await createTenant('Rival Centre');
    const mine = await createStaff(tenant.ctx, input({ firstName: 'Globally', lastName: 'Unique' }));
    const theirs = await createStaff(
      otherCentre.ctx,
      input({ firstName: 'Globally', lastName: 'Unique' }),
    );
    expect(theirs.credentials.username).not.toBe(mine.credentials.username);
  });

  it('will not hand out a reserved handle', async () => {
    const result = await generateUsername({
      firstName: 'A', lastName: 'B', role: 'TEACHER', preferred: 'admin',
    });
    expect(result.username).not.toBe('admin');
  });
});

describe('re-issuing credentials', () => {
  it('keeps the handle, replaces the secret and kills live sessions', async () => {
    const created = await createStaff(tenant.ctx, input({ firstName: 'Rotate', lastName: 'Me' }));
    const userId = created.member.user.id;

    await db.session.create({
      data: {
        userId,
        tokenHash: `hash-${Date.now()}`,
        csrfSecret: 'secret',
        expiresAt: new Date(Date.now() + 86_400_000),
        absoluteExpiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const reissued = await reissueStaffCredentials(tenant.ctx, created.member.id, { username: null });

    expect(reissued.username).toBe(created.credentials.username);
    expect(reissued.password).not.toBe(created.credentials.password);

    const user = await db.user.findUnique({ where: { id: userId } });
    expect(await verifyPassword(user!.passwordHash!, created.credentials.password)).toBe(false);
    expect(await verifyPassword(user!.passwordHash!, reissued.password)).toBe(true);
    expect(user?.mustChangePassword).toBe(true);

    const live = await db.session.count({ where: { userId, revokedAt: null } });
    expect(live).toBe(0);
  });
});

describe('removing staff', () => {
  it('closes the membership without deleting the person or their history', async () => {
    const created = await createStaff(tenant.ctx, input({ firstName: 'Leaving', lastName: 'Soon' }));
    await removeStaff(tenant.ctx, created.member.id);

    const member = await db.organizationMember.findUnique({ where: { id: created.member.id } });
    expect(member?.removedAt).not.toBeNull();
    expect(member?.status).toBe('INACTIVE');

    const user = await db.user.findUnique({ where: { id: created.member.user.id } });
    expect(user).not.toBeNull();
    expect(user?.deletedAt).toBeNull();

    const rows = await listStaff(tenant.ctx);
    expect(rows.some((r) => r.id === created.member.id)).toBe(false);
  });

  it('refuses to remove the centre owner', async () => {
    await expect(removeStaff(tenant.ctx, tenant.member.id)).rejects.toMatchObject({ status: 400 });
  });
});

describe('student numbers', () => {
  it('is unique inside the centre', async () => {
    const first = await nextStudentNo(tenant.org.id);
    await db.student.create({
      data: { organizationId: tenant.org.id, firstName: 'Numbered', studentNo: first },
    });
    const second = await nextStudentNo(tenant.org.id);
    expect(second).not.toBe(first);
  });
});
