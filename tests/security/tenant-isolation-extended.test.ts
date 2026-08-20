import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createTenant, makeMember, makeStudent, makeGroup, truncateAll, db, type Tenant,
} from '../factories';
import { createHomework, getHomework, markSubmissions, deleteHomework, listHomework } from '@/lib/domain/homework';
import { createGrade, listGrades, deleteGrade, createGradesBulk } from '@/lib/domain/grades';
import { createCourse, updateCourse, deleteCourse, listCourses } from '@/lib/domain/courses';
import { getStaff, updateSalary, removeStaff, reissueStaffCredentials } from '@/lib/domain/staff';
import { recordSalaryPayment, salarySheet } from '@/lib/domain/salary';
import { createExpense, listExpenses } from '@/lib/domain/finance';

/**
 * Cross-tenant access for everything the platform added on top of the original
 * product. Alice always plays the attacker and only ever holds ids belonging
 * to Bob.
 *
 * The expected outcome stays "not found" rather than "forbidden": a 403 would
 * confirm the id exists, which is itself a leak.
 */
let alice: Tenant;
let bob: Tenant;
let bobTeacher: Awaited<ReturnType<typeof makeMember>>;
let bobStudent: Awaited<ReturnType<typeof makeStudent>>;
let bobGroup: Awaited<ReturnType<typeof makeGroup>>;
let bobHomeworkId: string;
let bobGradeId: string;
let bobCourseId: string;
let bobExpenseId: string;

beforeAll(async () => {
  await truncateAll();
  alice = await createTenant('Alice Centre');
  bob = await createTenant('Bob Centre');

  bobTeacher = await makeMember(bob, 'TEACHER');
  bobStudent = await makeStudent(bob, 'Bobby', 'Secret');
  bobGroup = await makeGroup(bob, 'Bob Group');
  await db.group.update({ where: { id: bobGroup.id }, data: { teacherId: bobTeacher.member.id } });
  await db.groupMember.create({
    data: { organizationId: bob.org.id, groupId: bobGroup.id, studentId: bobStudent.id },
  });

  const course = await createCourse(bob.ctx, {
    name: 'Bob Secret Course', catalogKey: null, description: null,
    defaultFee: '500000', currency: 'UZS', durationMonths: null,
    color: '#2563eb', isActive: true,
  });
  bobCourseId = course.id;

  const homework = await createHomework(bob.ctx, {
    groupId: bobGroup.id,
    title: 'Bob homework',
    description: null,
    dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    status: 'PUBLISHED',
    maxScore: 10,
    fileIds: [],
  });
  bobHomeworkId = homework.id;

  const grade = await createGrade(bob.ctx, {
    studentId: bobStudent.id, groupId: bobGroup.id, lessonId: null, homeworkId: null,
    scheme: 'POINTS_100', valueNumeric: 91, valueLetter: null, maxValue: null,
    title: 'Bob grade', comment: null, gradedAt: null,
  });
  bobGradeId = grade.id;

  const expense = await createExpense(bob.ctx, {
    category: 'RENT', title: 'Bob rent', amount: '8000000',
    currency: 'UZS', spentAt: '2026-06-01', note: null,
  });
  bobExpenseId = expense.id;
});
afterAll(() => db.$disconnect());

const notFound = async (fn: () => Promise<unknown>) => {
  await expect(fn()).rejects.toMatchObject({ status: 404 });
};

describe('homework across tenants', () => {
  it('stays out of the other list', async () => {
    const list = await listHomework(alice.ctx, { page: 1, perPage: 25, status: 'ALL' });
    expect(list.rows.some((r) => r.id === bobHomeworkId)).toBe(false);
    expect(list.total).toBe(0);
  });

  it('404s when read by id', async () => {
    await notFound(() => getHomework(alice.ctx, bobHomeworkId));
  });

  it('404s when marked', async () => {
    await notFound(() =>
      markSubmissions(alice.ctx, bobHomeworkId, {
        entries: [{ studentId: bobStudent.id, status: 'GRADED', score: 10, feedback: null }],
      }),
    );
  });

  it('404s when deleted, and the row survives', async () => {
    await notFound(() => deleteHomework(alice.ctx, bobHomeworkId));
    const still = await db.homework.findUnique({ where: { id: bobHomeworkId } });
    expect(still?.deletedAt).toBeNull();
  });

  it('cannot be created against a foreign group', async () => {
    await notFound(() =>
      createHomework(alice.ctx, {
        groupId: bobGroup.id, title: 'Injected', description: null,
        dueAt: new Date().toISOString(), status: 'PUBLISHED', maxScore: null, fileIds: [],
      }),
    );
  });
});

describe('grades across tenants', () => {
  it('stays out of the other list', async () => {
    const list = await listGrades(alice.ctx, { page: 1, perPage: 50 });
    expect(list.rows.some((r) => r.id === bobGradeId)).toBe(false);
  });

  it('404s when deleted, and the row survives', async () => {
    await notFound(() => deleteGrade(alice.ctx, bobGradeId));
    const still = await db.grade.findUnique({ where: { id: bobGradeId } });
    expect(still?.deletedAt).toBeNull();
  });

  it('cannot grade a foreign student', async () => {
    await notFound(() =>
      createGrade(alice.ctx, {
        studentId: bobStudent.id, groupId: null, lessonId: null, homeworkId: null,
        scheme: 'POINTS_100', valueNumeric: 5, valueLetter: null, maxValue: null,
        title: null, comment: null, gradedAt: null,
      }),
    );
  });

  it('cannot bulk-grade a foreign group', async () => {
    await notFound(() =>
      createGradesBulk(alice.ctx, {
        groupId: bobGroup.id, scheme: 'POINTS_100', title: null, gradedAt: null,
        entries: [{ studentId: bobStudent.id, valueNumeric: 100, valueLetter: null, comment: null }],
      }),
    );
  });
});

describe('courses across tenants', () => {
  it('stays out of the other list', async () => {
    const rows = await listCourses(alice.ctx);
    expect(rows.some((c) => c.id === bobCourseId)).toBe(false);
  });

  it('404s on update and delete, and the row survives', async () => {
    await notFound(() =>
      updateCourse(alice.ctx, bobCourseId, {
        name: 'Hijacked', catalogKey: null, description: null, defaultFee: '0',
        currency: 'UZS', durationMonths: null, color: '#000000', isActive: true,
      }),
    );
    await notFound(() => deleteCourse(alice.ctx, bobCourseId));
    const still = await db.course.findUnique({ where: { id: bobCourseId } });
    expect(still?.name).toBe('Bob Secret Course');
  });
});

describe('staff and payroll across tenants', () => {
  it('404s when a foreign member is read', async () => {
    await notFound(() => getStaff(alice.ctx, bobTeacher.member.id));
  });

  it('404s when a foreign salary is edited', async () => {
    await notFound(() =>
      updateSalary(alice.ctx, bobTeacher.member.id, {
        salaryModel: 'FIXED', salaryAmount: '1', salaryPercent: 0,
      }),
    );
  });

  it('404s when a foreign member is removed, and the membership survives', async () => {
    await notFound(() => removeStaff(alice.ctx, bobTeacher.member.id));
    const still = await db.organizationMember.findUnique({ where: { id: bobTeacher.member.id } });
    expect(still?.removedAt).toBeNull();
  });

  it('404s when credentials are re-issued for a foreign member', async () => {
    await notFound(() => reissueStaffCredentials(alice.ctx, bobTeacher.member.id, { username: null }));
  });

  it('404s when a payout targets a foreign member', async () => {
    await notFound(() =>
      recordSalaryPayment(alice.ctx, {
        memberId: bobTeacher.member.id, year: 2026, month: 6, amount: '1000',
        currency: 'UZS', paidAt: '2026-06-10', note: null,
      }),
    );
  });

  it('keeps the salary sheet inside the calling centre', async () => {
    const sheet = await salarySheet(alice.ctx, { year: 2026, month: 6 }, 'Asia/Tashkent');
    expect(sheet.some((line) => line.memberId === bobTeacher.member.id)).toBe(false);
  });
});

describe('expenses across tenants', () => {
  it('stays out of the other list', async () => {
    const rows = await listExpenses(alice.ctx, 2026, 6);
    expect(rows.some((e) => e.id === bobExpenseId)).toBe(false);
  });
});

describe('malformed identifiers', () => {
  it('404s rather than surfacing a driver error', async () => {
    await notFound(() => getHomework(alice.ctx, 'not-a-uuid'));
    await notFound(() => getStaff(alice.ctx, "1' OR '1'='1"));
    await notFound(() => deleteGrade(alice.ctx, '../../etc/passwd'));
  });
});
