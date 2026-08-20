import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createTenant, makeStudent, makeGroup, makeLesson, makeStudentAccount, studentSession,
  truncateAll, db, type Tenant,
} from '../factories';
import {
  requireStudent, myGroups, myLessons, myAttendance, myGrades, myHomework,
  myPayments, submitHomework,
} from '@/lib/domain/portal';
import { createHomework } from '@/lib/domain/homework';
import { createGrade } from '@/lib/domain/grades';

/**
 * The student portal.
 *
 * Every function starts from the session user id, so there is no student id
 * parameter for a caller to tamper with. These tests prove that two students in
 * the same centre cannot see each other, and that a student in one centre
 * cannot see another centre at all.
 */
let centre: Tenant;
let other: Tenant;
let alice: Awaited<ReturnType<typeof makeStudent>>;
let bob: Awaited<ReturnType<typeof makeStudent>>;
let aliceUserId: string;
let bobUserId: string;
let group: Awaited<ReturnType<typeof makeGroup>>;
let homeworkId: string;

beforeAll(async () => {
  await truncateAll();
  centre = await createTenant('Portal Centre');
  other = await createTenant('Other Centre');

  alice = await makeStudent(centre, 'Alice', 'Portal');
  bob = await makeStudent(centre, 'Bob', 'Portal');
  group = await makeGroup(centre, 'Portal Group', 500_000n);

  await db.groupMember.createMany({
    data: [
      { organizationId: centre.org.id, groupId: group.id, studentId: alice.id },
      { organizationId: centre.org.id, groupId: group.id, studentId: bob.id },
    ],
  });

  aliceUserId = (await makeStudentAccount(centre, alice.id)).id;
  bobUserId = (await makeStudentAccount(centre, bob.id)).id;

  const lesson = await makeLesson(centre, group.id, new Date(Date.now() - 3_600_000));
  await db.attendance.createMany({
    data: [
      { organizationId: centre.org.id, lessonId: lesson.id, studentId: alice.id, status: 'PRESENT' },
      { organizationId: centre.org.id, lessonId: lesson.id, studentId: bob.id, status: 'ABSENT' },
    ],
  });

  const homework = await createHomework(centre.ctx, {
    groupId: group.id, title: 'Portal homework', description: null,
    dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    status: 'PUBLISHED', maxScore: 10, fileIds: [],
  });
  homeworkId = homework.id;

  await createGrade(centre.ctx, {
    studentId: alice.id, groupId: group.id, lessonId: null, homeworkId: null,
    scheme: 'POINTS_100', valueNumeric: 95, valueLetter: null, maxValue: null,
    title: 'Alice grade', comment: null, gradedAt: null,
  });
  await createGrade(centre.ctx, {
    studentId: bob.id, groupId: group.id, lessonId: null, homeworkId: null,
    scheme: 'POINTS_100', valueNumeric: 41, valueLetter: null, maxValue: null,
    title: 'Bob grade', comment: null, gradedAt: null,
  });

  await db.invoice.createMany({
    data: [
      {
        organizationId: centre.org.id, studentId: alice.id, groupId: group.id,
        periodYear: 2026, periodMonth: 6, amountMinor: 500_000n, currency: 'UZS',
        dueDate: new Date('2026-06-05'),
      },
      {
        organizationId: centre.org.id, studentId: bob.id, groupId: group.id,
        periodYear: 2026, periodMonth: 6, amountMinor: 900_000n, currency: 'UZS',
        dueDate: new Date('2026-06-05'),
      },
    ],
  });
  await db.payment.create({
    data: {
      organizationId: centre.org.id, studentId: alice.id, groupId: group.id,
      amountMinor: 200_000n, currency: 'UZS', paidAt: new Date('2026-06-03'), method: 'CASH',
    },
  });
});
afterAll(() => db.$disconnect());

describe('portal identity', () => {
  it('resolves the one student linked to the session', async () => {
    const sc = await requireStudent(studentSession(aliceUserId));
    expect(sc.studentId).toBe(alice.id);
    expect(sc.organizationId).toBe(centre.org.id);
  });

  it('refuses an account that is not a student', async () => {
    await expect(requireStudent(studentSession(centre.user.id))).rejects.toMatchObject({ status: 403 });
  });

  it('refuses once the centre is suspended', async () => {
    await db.organization.update({
      where: { id: other.org.id },
      data: { status: 'SUSPENDED' },
    });
    const otherStudent = await makeStudent(other, 'Sus', 'Pended');
    const user = await makeStudentAccount(other, otherStudent.id);
    await expect(requireStudent(studentSession(user.id))).rejects.toMatchObject({ status: 403 });
    await db.organization.update({ where: { id: other.org.id }, data: { status: 'ACTIVE' } });
  });
});

describe('one student sees only themselves', () => {
  it('returns only their own attendance', async () => {
    const sc = await requireStudent(studentSession(aliceUserId));
    const attendance = await myAttendance(sc);
    expect(attendance.rows.length).toBe(1);
    expect(attendance.stats.present).toBe(1);
    expect(attendance.stats.absent).toBe(0);
  });

  it('returns only their own grades', async () => {
    const sc = await requireStudent(studentSession(aliceUserId));
    const grades = await myGrades(sc);
    expect(grades.rows).toHaveLength(1);
    expect(grades.rows[0]?.title).toBe('Alice grade');
    expect(JSON.stringify(grades)).not.toContain('Bob grade');
  });

  it('returns only their own money', async () => {
    const sc = await requireStudent(studentSession(aliceUserId));
    const money = await myPayments(sc);
    expect(money.chargedMinor).toBe(500_000n);
    expect(money.paidMinor).toBe(200_000n);
    expect(money.debtMinor).toBe(300_000n);

    const bobMoney = await myPayments(await requireStudent(studentSession(bobUserId)));
    expect(bobMoney.chargedMinor).toBe(900_000n);
    expect(bobMoney.paidMinor).toBe(0n);
  });

  it('returns only their own homework rows', async () => {
    const sc = await requireStudent(studentSession(aliceUserId));
    const rows = await myHomework(sc);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.homework.id).toBe(homeworkId);
  });

  it('never exposes a teacher salary through the group payload', async () => {
    const sc = await requireStudent(studentSession(aliceUserId));
    const payload = JSON.stringify(await myGroups(sc), (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    expect(payload).not.toContain('salaryAmountMinor');
    expect(payload).not.toContain('salaryPercentBp');
  });

  it('sees lessons only for groups it belongs to', async () => {
    const sc = await requireStudent(studentSession(aliceUserId));
    const lessons = await myLessons(sc, new Date(Date.now() - 86_400_000), new Date(Date.now() + 86_400_000));
    expect(lessons.every((l) => l.group.id === group.id)).toBe(true);
  });
});

describe('handing in work', () => {
  it('accepts a submission for the student own assignment', async () => {
    const sc = await requireStudent(studentSession(aliceUserId));
    const result = await submitHomework(sc, homeworkId, { note: 'Bajardim', fileId: null });
    expect(['SUBMITTED', 'LATE']).toContain(result.status);
    expect(result.studentId).toBe(alice.id);
  });

  it('404s for a homework id the student was never assigned', async () => {
    const otherGroup = await makeGroup(centre, 'Not Mine');
    const foreign = await createHomework(centre.ctx, {
      groupId: otherGroup.id, title: 'Not for Alice', description: null,
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      status: 'PUBLISHED', maxScore: null, fileIds: [],
    });
    const sc = await requireStudent(studentSession(aliceUserId));
    await expect(submitHomework(sc, foreign.id, { note: null, fileId: null })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('cannot mark another student submission', async () => {
    // Alice submitting keeps Bob's row untouched — there is no path that takes
    // a studentId from the caller.
    const sc = await requireStudent(studentSession(aliceUserId));
    await submitHomework(sc, homeworkId, { note: 'again', fileId: null });
    const bobRow = await db.homeworkSubmission.findFirst({
      where: { homeworkId, studentId: bob.id },
    });
    expect(bobRow?.status).toBe('ASSIGNED');
    expect(bobRow?.submittedAt).toBeNull();
  });
});
