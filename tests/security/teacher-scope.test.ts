import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createTenant, makeMember, makeStudent, makeGroup, makeLesson, truncateAll, db, type Tenant,
} from '../factories';
import { listStudents, getStudent } from '@/lib/domain/students';
import { listGroups, getGroup } from '@/lib/domain/groups';
import { listLessons, getLesson, setLessonStatus } from '@/lib/domain/lessons';
import { markAttendance, attendanceSummary } from '@/lib/domain/attendance';

/**
 * Row-level scoping for teachers.
 *
 * `students.read`, `groups.read` and `lessons.read` are permissions a teacher
 * genuinely needs — they cannot take a register without them. So the permission
 * cannot be the boundary; the query has to be. Before this, a teacher holding
 * those permissions could list every student in the centre, open any student's
 * profile (parent's phone number, debt, payment history), read any group's
 * roster, see the whole centre's timetable, mark a register for a class they do
 * not teach and cancel another teacher's lesson.
 *
 * Everything here calls the domain layer directly: a hidden nav link is not a
 * control, and the refusal has to come from the same code the API calls.
 */
let centre: Tenant;
let mine: Awaited<ReturnType<typeof makeMember>>;
let theirs: Awaited<ReturnType<typeof makeMember>>;
let myGroup: Awaited<ReturnType<typeof makeGroup>>;
let theirGroup: Awaited<ReturnType<typeof makeGroup>>;
let myStudent: Awaited<ReturnType<typeof makeStudent>>;
let theirStudent: Awaited<ReturnType<typeof makeStudent>>;
let myLesson: Awaited<ReturnType<typeof makeLesson>>;
let theirLesson: Awaited<ReturnType<typeof makeLesson>>;

const LIST = {
  status: 'ALL' as const, page: 1, perPage: 100,
  sort: 'name' as const, dir: 'asc' as const, debtOnly: false,
};

beforeAll(async () => {
  await truncateAll();
  centre = await createTenant('Scope Centre');
  mine = await makeMember(centre, 'TEACHER');
  theirs = await makeMember(centre, 'TEACHER');

  myGroup = await makeGroup(centre, 'My Class');
  theirGroup = await makeGroup(centre, 'Their Class');
  await db.group.update({ where: { id: myGroup.id }, data: { teacherId: mine.member.id } });
  await db.group.update({ where: { id: theirGroup.id }, data: { teacherId: theirs.member.id } });

  myStudent = await makeStudent(centre, 'Mine', 'Learner');
  theirStudent = await makeStudent(centre, 'Theirs', 'Learner');
  await db.groupMember.createMany({
    data: [
      { organizationId: centre.org.id, groupId: myGroup.id, studentId: myStudent.id },
      { organizationId: centre.org.id, groupId: theirGroup.id, studentId: theirStudent.id },
    ],
  });

  const past = new Date(Date.now() - 3_600_000);
  myLesson = await makeLesson(centre, myGroup.id, past);
  theirLesson = await makeLesson(centre, theirGroup.id, past);
  await db.lesson.update({ where: { id: myLesson.id }, data: { teacherId: mine.member.id } });
  await db.lesson.update({ where: { id: theirLesson.id }, data: { teacherId: theirs.member.id } });
});

afterAll(() => db.$disconnect());

const notFound = async (fn: () => Promise<unknown>) => {
  await expect(fn()).rejects.toMatchObject({ status: 404 });
};

describe('students', () => {
  it('lists only the students in the classes this teacher takes', async () => {
    const { rows, total } = await listStudents(mine.ctx, LIST);
    expect(total).toBe(1);
    expect(rows.map((r) => r.firstName)).toEqual(['Mine']);
  });

  it("refuses another teacher's student, as a 404 rather than a 403", async () => {
    await notFound(() => getStudent(mine.ctx, theirStudent.id));
    await notFound(() => getStudent(theirs.ctx, myStudent.id));
  });

  it('still lets each teacher open their own', async () => {
    expect((await getStudent(mine.ctx, myStudent.id)).id).toBe(myStudent.id);
    expect((await getStudent(theirs.ctx, theirStudent.id)).id).toBe(theirStudent.id);
  });

  it('leaves the owner seeing the whole centre', async () => {
    const { total } = await listStudents(centre.ctx, LIST);
    expect(total).toBe(2);
  });
});

describe('groups', () => {
  it('lists only the classes this teacher takes', async () => {
    expect((await listGroups(mine.ctx, true)).map((g) => g.id)).toEqual([myGroup.id]);
    expect((await listGroups(theirs.ctx, true)).map((g) => g.id)).toEqual([theirGroup.id]);
    expect((await listGroups(centre.ctx, true)).length).toBe(2);
  });

  it("refuses another teacher's roster", async () => {
    await notFound(() => getGroup(mine.ctx, theirGroup.id));
    expect((await getGroup(mine.ctx, myGroup.id)).id).toBe(myGroup.id);
  });
});

describe('lessons', () => {
  const range = { from: '2000-01-01', until: '2100-01-01' };

  it('shows a teacher their own timetable only', async () => {
    const forMine = await listLessons(mine.ctx, range, 'Asia/Tashkent');
    expect(forMine.map((l) => l.id)).toEqual([myLesson.id]);

    const forOwner = await listLessons(centre.ctx, range, 'Asia/Tashkent');
    expect(forOwner.length).toBe(2);
  });

  it("refuses to open another teacher's lesson", async () => {
    await notFound(() => getLesson(mine.ctx, theirLesson.id));
  });

  it("refuses to cancel another teacher's lesson", async () => {
    await notFound(() =>
      setLessonStatus(mine.ctx, theirLesson.id, { status: 'CANCELLED', cancelReason: 'probe' }),
    );
    const untouched = await db.lesson.findUniqueOrThrow({ where: { id: theirLesson.id } });
    expect(untouched.status).not.toBe('CANCELLED');
  });

  it('still lets a teacher cancel their own', async () => {
    await setLessonStatus(mine.ctx, myLesson.id, { status: 'CANCELLED', cancelReason: 'ill' });
    const row = await db.lesson.findUniqueOrThrow({ where: { id: myLesson.id } });
    expect(row.status).toBe('CANCELLED');
    await db.lesson.update({ where: { id: myLesson.id }, data: { status: 'SCHEDULED', cancelReason: null } });
  });
});

describe('attendance', () => {
  it("refuses to mark a register for another teacher's class", async () => {
    await notFound(() =>
      markAttendance(mine.ctx, {
        lessonId: theirLesson.id,
        entries: [{ studentId: theirStudent.id, status: 'PRESENT', minutesLate: null, note: null }],
      }),
    );
    expect(await db.attendance.count({ where: { lessonId: theirLesson.id } })).toBe(0);
  });

  it('lets a teacher mark their own', async () => {
    await markAttendance(mine.ctx, {
      lessonId: myLesson.id,
      entries: [{ studentId: myStudent.id, status: 'PRESENT', minutesLate: null, note: null }],
    });
    expect(await db.attendance.count({ where: { lessonId: myLesson.id } })).toBe(1);
  });

  it("reports a teacher's own attendance rate, not the centre's", async () => {
    await markAttendance(theirs.ctx, {
      lessonId: theirLesson.id,
      entries: [{ studentId: theirStudent.id, status: 'ABSENT', minutesLate: null, note: null }],
    });

    const range = { from: new Date('2000-01-01'), until: new Date('2100-01-01') };
    const forMine = await attendanceSummary(mine.ctx, range);
    expect(forMine.PRESENT).toBe(1);
    expect(forMine.ABSENT).toBe(0);

    const forCentre = await attendanceSummary(centre.ctx, range);
    expect(forCentre.PRESENT).toBe(1);
    expect(forCentre.ABSENT).toBe(1);
  });
});
