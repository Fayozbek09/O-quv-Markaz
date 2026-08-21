import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  db, truncateAll, createTenant, makeGroup, makeStudent, makeLesson, makeMember, type Tenant,
} from '../factories';
import { Session } from './client';
import { hashPassword } from '@/lib/auth/password';

/**
 * Rendered pages, not just the API.
 *
 * The domain queries are scoped (see tests/security/teacher-scope.test.ts), but
 * several pages ran their own inline Prisma query for a filter dropdown or a
 * picker and scoped it by organization alone. The calendar's group filter named
 * every class in the centre, the attendance picker listed every lesson that
 * day, and a group page shipped the centre's whole student roll to populate an
 * "add student" control the teacher was not allowed to use. None of it was
 * clickable — all of it was readable.
 *
 * This signs in as a real teacher over HTTP and reads the markup, which is the
 * only way to catch a leak that lives in a page rather than in a route.
 */
const PASSWORD = 'CorrectHorse42!';

let centre: Tenant;
let teacherSession: Session;
let ownerSession: Session;
let otherGroupName: string;
let otherStudentName: string;
let ownGroupId: string;

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

beforeAll(async () => {
  await truncateAll();
  const stamp = Date.now().toString(36);
  centre = await createTenant('Pages Centre');

  const mine = await makeMember(centre, 'TEACHER');
  const theirs = await makeMember(centre, 'TEACHER');

  const ownGroup = await makeGroup(centre, `MineClass${stamp}`);
  const otherGroup = await makeGroup(centre, `TheirClass${stamp}`);
  ownGroupId = ownGroup.id;
  otherGroupName = otherGroup.name;
  await db.group.update({ where: { id: ownGroup.id }, data: { teacherId: mine.member.id } });
  await db.group.update({ where: { id: otherGroup.id }, data: { teacherId: theirs.member.id } });

  const ownStudent = await makeStudent(centre, `MineKid${stamp}`, 'Learner');
  const otherStudent = await makeStudent(centre, `TheirKid${stamp}`, 'Learner');
  otherStudentName = `TheirKid${stamp}`;
  await db.groupMember.createMany({
    data: [
      { organizationId: centre.org.id, groupId: ownGroup.id, studentId: ownStudent.id },
      { organizationId: centre.org.id, groupId: otherGroup.id, studentId: otherStudent.id },
    ],
  });

  // Today's lessons, so the attendance picker has something to list.
  const now = new Date();
  const at = new Date(now.getTime() + 60_000);
  const ownLesson = await makeLesson(centre, ownGroup.id, at);
  const otherLesson = await makeLesson(centre, otherGroup.id, at);
  await db.lesson.update({ where: { id: ownLesson.id }, data: { teacherId: mine.member.id } });
  await db.lesson.update({ where: { id: otherLesson.id }, data: { teacherId: theirs.member.id } });

  const hash = await hashPassword(PASSWORD);
  const teacherHandle = `pages.teacher.${stamp}`;
  const ownerHandle = `pages.owner.${stamp}`;
  await db.user.update({
    where: { id: mine.user.id },
    data: { username: teacherHandle, passwordHash: hash },
  });
  await db.user.update({
    where: { id: centre.user.id },
    data: { username: ownerHandle, passwordHash: hash },
  });

  teacherSession = await signIn(teacherHandle);
  ownerSession = await signIn(ownerHandle);
});

afterAll(() => db.$disconnect());

const body = async (session: Session, path: string) => {
  const res = await session.fetch(path);
  expect(res.status, `${path} returned ${res.status}`).toBe(200);
  return res.text();
};

describe('a teacher never reads another teacher in the markup', () => {
  it("the calendar's group filter offers only their own classes", async () => {
    const html = await body(teacherSession, '/calendar');
    expect(html).not.toContain(otherGroupName);
  });

  it('the attendance picker lists only their own lessons', async () => {
    const html = await body(teacherSession, '/attendance');
    expect(html).not.toContain(otherGroupName);
  });

  it('the students list is their own classes', async () => {
    const html = await body(teacherSession, '/students');
    expect(html).not.toContain(otherStudentName);
  });

  it('the groups list is their own classes', async () => {
    const html = await body(teacherSession, '/groups');
    expect(html).not.toContain(otherGroupName);
  });

  it('their own group page carries no picker full of other people’s students', async () => {
    const html = await body(teacherSession, `/groups/${ownGroupId}`);
    expect(html).not.toContain(otherStudentName);
  });

  it('the reception desk, which lists debtors and takings, is refused outright', async () => {
    const res = await teacherSession.fetch('/reception');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/forbidden');
  });
});

describe('the owner is unaffected', () => {
  it('still sees every class and every student', async () => {
    const groups = await body(ownerSession, '/groups');
    expect(groups).toContain(otherGroupName);

    const students = await body(ownerSession, '/students');
    expect(students).toContain(otherStudentName);
  });

  it('still gets the add-student picker on a group page', async () => {
    const html = await body(ownerSession, `/groups/${ownGroupId}`);
    expect(html).toContain(otherStudentName);
  });
});
