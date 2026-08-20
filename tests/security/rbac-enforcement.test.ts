import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTenant, makeMember, makeStudent, makeGroup, truncateAll, db, type Tenant } from '../factories';
import { assertPermission, hasPermission } from '@/lib/tenant';
import { createStaff, listStaff, updateSalary } from '@/lib/domain/staff';
import { createGrade } from '@/lib/domain/grades';
import { recordSalaryPayment } from '@/lib/domain/salary';
import { createExpense } from '@/lib/domain/finance';
import { AppError } from '@/lib/errors';

/**
 * Server-side permission enforcement.
 *
 * Every assertion here calls the domain layer directly, bypassing the UI
 * entirely — a hidden button is not a control, so the refusal has to come from
 * the same place the API calls into.
 */
let tenant: Tenant;
let teacher: Awaited<ReturnType<typeof makeMember>>;
let reception: Awaited<ReturnType<typeof makeMember>>;
let student: Awaited<ReturnType<typeof makeStudent>>;
let group: Awaited<ReturnType<typeof makeGroup>>;

beforeAll(async () => {
  await truncateAll();
  tenant = await createTenant('RBAC Centre');
  teacher = await makeMember(tenant, 'TEACHER');
  reception = await makeMember(tenant, 'RECEPTIONIST');
  student = await makeStudent(tenant, 'Perm', 'Test');
  group = await makeGroup(tenant, 'RBAC Group');
  await db.group.update({ where: { id: group.id }, data: { teacherId: teacher.member.id } });
  await db.groupMember.create({
    data: { organizationId: tenant.org.id, groupId: group.id, studentId: student.id },
  });
});
afterAll(() => db.$disconnect());

const forbidden = async (fn: () => Promise<unknown>) => {
  await expect(fn()).rejects.toMatchObject({ status: 403 });
};

describe('teacher', () => {
  it('cannot create a student', async () => {
    expect(hasPermission(teacher.ctx, 'students.create')).toBe(false);
    await forbidden(async () => assertPermission(teacher.ctx, 'students.create'));
  });

  it('cannot read or record payments', async () => {
    expect(hasPermission(teacher.ctx, 'payments.read')).toBe(false);
    expect(hasPermission(teacher.ctx, 'payments.create')).toBe(false);
  });

  it("cannot change anyone's salary, including their own", async () => {
    await forbidden(() =>
      updateSalary(teacher.ctx, teacher.member.id, {
        salaryModel: 'FIXED',
        salaryAmount: '99000000',
        salaryPercent: 0,
      }),
    );
  });

  it('cannot record a salary payout', async () => {
    await forbidden(() =>
      recordSalaryPayment(teacher.ctx, {
        memberId: teacher.member.id,
        year: 2026,
        month: 6,
        amount: '1000000',
        currency: 'UZS',
        paidAt: '2026-06-10',
        note: null,
      }),
    );
  });

  it('cannot create a teacher account', async () => {
    await forbidden(() =>
      createStaff(teacher.ctx, {
        firstName: 'Sneaky', lastName: null, role: 'TEACHER', phone: null, email: null,
        username: null, subject: null, specialization: null, hireDate: null,
        salaryModel: 'FIXED', salaryAmount: '0', salaryPercent: 0, permissions: {}, locale: 'uz',
      }),
    );
  });

  it('may grade a student in a group they teach', async () => {
    const grade = await createGrade(teacher.ctx, {
      studentId: student.id,
      groupId: group.id,
      lessonId: null, homeworkId: null,
      scheme: 'POINTS_100', valueNumeric: 88, valueLetter: null, maxValue: null,
      title: 'Own group', comment: null, gradedAt: null,
    });
    expect(grade.valueNumeric).toBe(88);
  });

  it('may not grade a student in a group they do not teach', async () => {
    const otherGroup = await makeGroup(tenant, 'Someone Elses Group');
    await db.groupMember.create({
      data: { organizationId: tenant.org.id, groupId: otherGroup.id, studentId: student.id },
    });
    await forbidden(() =>
      createGrade(teacher.ctx, {
        studentId: student.id,
        groupId: otherGroup.id,
        lessonId: null, homeworkId: null,
        scheme: 'POINTS_100', valueNumeric: 100, valueLetter: null, maxValue: null,
        title: null, comment: null, gradedAt: null,
      }),
    );
  });
});

describe('receptionist', () => {
  it('may create students but not write grades', async () => {
    expect(hasPermission(reception.ctx, 'students.create')).toBe(true);
    expect(hasPermission(reception.ctx, 'grades.write')).toBe(false);
    await forbidden(async () => assertPermission(reception.ctx, 'grades.write'));
  });

  it('cannot touch centre settings or billing', async () => {
    await forbidden(async () => assertPermission(reception.ctx, 'center.settings'));
    await forbidden(async () => assertPermission(reception.ctx, 'center.billing'));
    await forbidden(async () => assertPermission(reception.ctx, 'center.delete'));
  });

  it('cannot record an expense', async () => {
    await forbidden(() =>
      createExpense(reception.ctx, {
        category: 'OTHER', title: 'Nope', amount: '1000',
        currency: 'UZS', spentAt: '2026-06-10', note: null,
      }),
    );
  });

  it('sees staff without their salary figures', async () => {
    const rows = await listStaff(reception.ctx);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      if (row.user.id === reception.user.id) continue;
      expect(row.salaryAmountMinor).toBeNull();
      expect(row.salaryModel).toBeNull();
    }
  });

  it('gains only the permissions the owner is allowed to grant', async () => {
    const granted = await makeMember(tenant, 'RECEPTIONIST', {
      'attendance.write': true,
      'center.delete': true,
    });
    expect(hasPermission(granted.ctx, 'attendance.write')).toBe(true);
    expect(hasPermission(granted.ctx, 'center.delete')).toBe(false);
  });
});

describe('owner', () => {
  it('sees salary figures for the whole centre', async () => {
    const rows = await listStaff(tenant.ctx);
    const withSalary = rows.filter((r) => r.salaryAmountMinor !== null);
    expect(withSalary.length).toBe(rows.length);
  });

  it('may set a salary', async () => {
    await updateSalary(tenant.ctx, teacher.member.id, {
      salaryModel: 'FIXED',
      salaryAmount: '5000000',
      salaryPercent: 0,
    });
    const member = await db.organizationMember.findUnique({ where: { id: teacher.member.id } });
    expect(member?.salaryAmountMinor).toBe(5_000_000n);
  });
});

describe('student role', () => {
  it('is refused a staff tenant context outright', async () => {
    // requireOrg reads the session; a STUDENT membership never yields a
    // context, so no staff endpoint is reachable with one.
    const studentMember = await makeMember(tenant, 'STUDENT');
    expect(studentMember.ctx.permissions.size).toBe(0);
    await forbidden(async () => assertPermission(studentMember.ctx, 'students.read'));
  });
});

describe('AppError shape', () => {
  it('reports 403 as forbidden without naming the missing permission', async () => {
    try {
      assertPermission(teacher.ctx, 'payments.read');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).status).toBe(403);
      expect(JSON.stringify(err)).not.toContain('payments.read');
    }
  });
});
