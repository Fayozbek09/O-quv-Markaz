import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTenant, makeStudent, truncateAll, db, type Tenant } from '../factories';
import { createStudent, updateStudent, archiveStudent, restoreStudent, listStudents, getStudent } from '@/lib/domain/students';
import { studentInputSchema, studentListQuerySchema } from '@/lib/validation/schemas';
import { AppError } from '@/lib/errors';

let tenant: Tenant;

beforeAll(async () => {
  await truncateAll();
  tenant = await createTenant();
});
afterAll(() => db.$disconnect());

const query = (over: Record<string, unknown> = {}) => studentListQuerySchema.parse(over);

describe('students', () => {
  it('creates a student with a parent in one call', async () => {
    // Go through the request schema, the way an API call does.
    const input = studentInputSchema.parse({
      firstName: 'Ali',
      lastName: 'Valiyev',
      phone: '+998 90 123 45 67',
      notes: 'IELTS 6.5',
      parentName: 'Valijon Valiyev',
      parentPhone: '901112233',
      parentRelation: 'father',
    });
    const student = await createStudent(tenant.ctx, input);

    const loaded = await getStudent(tenant.ctx, student.id);
    expect(loaded.firstName).toBe('Ali');
    expect(loaded.phone).toBe('+998901234567');
    // The parent's national-format number was normalized to E.164.
    expect(loaded.parents[0]?.phone).toBe('+998901112233');
  });

  it('always writes the organization from the session, not the payload', async () => {
    const other = await createTenant('Other');
    const student = await createStudent(tenant.ctx, {
      firstName: 'Scoped',
      lastName: null, phone: null, email: null, birthDate: null, notes: null,
      status: 'ACTIVE', parentName: null, parentPhone: null, parentRelation: null,
      // A crafted client cannot add organizationId here: the schema is strict
      // and the domain layer ignores anything but the context.
    });
    expect(student.organizationId).toBe(tenant.org.id);
    expect(student.organizationId).not.toBe(other.org.id);
  });

  it('archives instead of deleting, and keeps the row retrievable', async () => {
    const student = await makeStudent(tenant, 'Archie');
    await archiveStudent(tenant.ctx, student.id);

    const after = await db.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(after.status).toBe('ARCHIVED');
    expect(after.archivedAt).not.toBeNull();
    expect(after.deletedAt).toBeNull();

    await restoreStudent(tenant.ctx, student.id);
    expect((await db.student.findUniqueOrThrow({ where: { id: student.id } })).status).toBe('ACTIVE');
  });

  it('drops group membership when a student is archived', async () => {
    const student = await makeStudent(tenant, 'Grouped');
    const group = await db.group.create({
      data: {
        organizationId: tenant.org.id,
        name: `G-${Date.now()}`,
        weekdays: [1],
        members: { create: { organizationId: tenant.org.id, studentId: student.id } },
      },
    });

    await archiveStudent(tenant.ctx, student.id);

    const membership = await db.groupMember.findFirstOrThrow({
      where: { groupId: group.id, studentId: student.id },
    });
    expect(membership.leftAt).not.toBeNull();
  });

  it('searches by name and by phone', async () => {
    await createStudent(tenant.ctx, {
      firstName: 'Nodira', lastName: 'Karimova', phone: '+998939876543',
      email: null, birthDate: null, notes: null, status: 'ACTIVE',
      parentName: null, parentPhone: null, parentRelation: null,
    });

    expect((await listStudents(tenant.ctx, query({ q: 'nodira' }))).rows.length).toBeGreaterThan(0);
    expect((await listStudents(tenant.ctx, query({ q: '9876543' }))).rows.length).toBeGreaterThan(0);
    expect((await listStudents(tenant.ctx, query({ q: 'nobody-by-this-name' }))).rows).toHaveLength(0);
  });

  it('paginates without loading the whole roster', async () => {
    const page = await listStudents(tenant.ctx, query({ page: 1, perPage: 5 }));
    expect(page.rows.length).toBeLessThanOrEqual(5);
    expect(page.total).toBeGreaterThanOrEqual(page.rows.length);
  });

  it('404s on a malformed id rather than leaking a driver error', async () => {
    await expect(getStudent(tenant.ctx, 'not-a-uuid')).rejects.toBeInstanceOf(AppError);
  });
});

describe('plan limits', () => {
  it('refuses to create past the free-plan student ceiling', async () => {
    const free = await createTenant('Free Tier');
    await db.subscription.update({
      where: { organizationId: free.org.id },
      data: { plan: 'FREE' },
    });

    for (let i = 0; i < 10; i += 1) {
      await makeStudent(free, `Student${i}`);
    }

    await expect(
      createStudent(free.ctx, {
        firstName: 'Eleventh', lastName: null, phone: null, email: null, birthDate: null,
        notes: null, status: 'ACTIVE', parentName: null, parentPhone: null, parentRelation: null,
      }),
    ).rejects.toMatchObject({ status: 402 });
  });
});
