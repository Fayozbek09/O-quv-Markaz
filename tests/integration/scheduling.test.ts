import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createTenant, makeStudent, makeGroup, makeMember, makeStudentAccount,
  truncateAll, db, type Tenant,
} from '../factories';
import { createLesson, updateLesson, setLessonStatus } from '@/lib/domain/lessons';
import { lessonInputSchema } from '@/lib/validation/schemas';

const TZ = 'Asia/Tashkent';

/** Two groups so a clash can be attributed to the teacher or the room rather
 *  than to the group, which would mask the thing under test. */
let tenant: Tenant;
let groupA: Awaited<ReturnType<typeof makeGroup>>;
let groupB: Awaited<ReturnType<typeof makeGroup>>;
let teacher: Awaited<ReturnType<typeof makeMember>>;
let otherTeacher: Awaited<ReturnType<typeof makeMember>>;
let student: Awaited<ReturnType<typeof makeStudent>>;
let studentUserId: string;

const lesson = (over: Record<string, unknown>) =>
  lessonInputSchema.parse({
    groupId: groupA.id, date: '2027-03-01', startTime: '18:00', endTime: '19:30', ...over,
  });

beforeAll(async () => {
  await truncateAll();
  tenant = await createTenant('Scheduling Centre');
  groupA = await makeGroup(tenant, 'Group A');
  groupB = await makeGroup(tenant, 'Group B');
  teacher = await makeMember(tenant, 'TEACHER');
  otherTeacher = await makeMember(tenant, 'TEACHER');

  student = await makeStudent(tenant, 'Dilnoza');
  studentUserId = (await makeStudentAccount(tenant, student.id)).id;
  await db.groupMember.create({
    data: { organizationId: tenant.org.id, groupId: groupA.id, studentId: student.id },
  });
});
afterAll(() => db.$disconnect());

describe('schedule conflicts', () => {
  it('refuses a lesson that overlaps another for the same group', async () => {
    await createLesson(tenant.ctx, lesson({ date: '2027-03-02' }), TZ);
    // Starts an hour into the existing lesson: a real overlap, not an equal start.
    await expect(
      createLesson(tenant.ctx, lesson({ date: '2027-03-02', startTime: '19:00', endTime: '20:30' }), TZ),
    ).rejects.toMatchObject({ status: 409, messageKey: 'lessons.conflict.group' });
  });

  it('allows a lesson that starts exactly when the previous one ends', async () => {
    await createLesson(tenant.ctx, lesson({ date: '2027-03-03' }), TZ);
    const back2back = await createLesson(
      tenant.ctx,
      lesson({ date: '2027-03-03', startTime: '19:30', endTime: '21:00' }),
      TZ,
    );
    expect(back2back.startsAt.toISOString()).toBe('2027-03-03T14:30:00.000Z');
  });

  it('refuses to double-book a teacher across two groups', async () => {
    await createLesson(tenant.ctx, lesson({ date: '2027-03-04', teacherId: teacher.member.id }), TZ);
    await expect(
      createLesson(
        tenant.ctx,
        lesson({ groupId: groupB.id, date: '2027-03-04', startTime: '19:00', endTime: '20:00', teacherId: teacher.member.id }),
        TZ,
      ),
    ).rejects.toMatchObject({ status: 409, messageKey: 'lessons.conflict.teacher' });
  });

  it('lets a different teacher take the same slot in another group', async () => {
    await createLesson(tenant.ctx, lesson({ date: '2027-03-05', teacherId: teacher.member.id }), TZ);
    const ok = await createLesson(
      tenant.ctx,
      lesson({ groupId: groupB.id, date: '2027-03-05', teacherId: otherTeacher.member.id }),
      TZ,
    );
    expect(ok.id).toBeTruthy();
  });

  it('refuses to double-book a room across two groups', async () => {
    await createLesson(tenant.ctx, lesson({ date: '2027-03-06', room: '204' }), TZ);
    await expect(
      createLesson(
        tenant.ctx,
        lesson({ groupId: groupB.id, date: '2027-03-06', startTime: '19:00', endTime: '20:00', room: '204' }),
        TZ,
      ),
    ).rejects.toMatchObject({ status: 409, messageKey: 'lessons.conflict.room' });
  });

  it('frees the slot once the clashing lesson is cancelled', async () => {
    const first = await createLesson(tenant.ctx, lesson({ date: '2027-03-07', room: '301' }), TZ);
    await setLessonStatus(tenant.ctx, first.id, { status: 'CANCELLED', cancelReason: 'holiday' });

    const replacement = await createLesson(
      tenant.ctx,
      lesson({ groupId: groupB.id, date: '2027-03-07', room: '301' }),
      TZ,
    );
    expect(replacement.id).not.toBe(first.id);
  });

  it('does not treat a lesson as a conflict with itself when edited', async () => {
    const created = await createLesson(tenant.ctx, lesson({ date: '2027-03-08', room: '112' }), TZ);
    const moved = await updateLesson(
      tenant.ctx,
      created.id,
      lesson({ date: '2027-03-08', startTime: '18:30', endTime: '20:00', room: '112' }),
      TZ,
    );
    expect(moved?.startsAt.toISOString()).toBe('2027-03-08T13:30:00.000Z');
  });

  it('does not look at another centre when checking for a clash', async () => {
    const other = await createTenant('Neighbour Centre');
    const otherGroup = await makeGroup(other, 'Their Group');
    await createLesson(tenant.ctx, lesson({ date: '2027-03-09', room: '400' }), TZ);

    // Same wall time, same room name, different centre: must be allowed.
    const ok = await createLesson(
      other.ctx,
      lessonInputSchema.parse({
        groupId: otherGroup.id, date: '2027-03-09', startTime: '18:00', endTime: '19:30', room: '400',
      }),
      TZ,
    );
    expect(ok.organizationId).toBe(other.org.id);
  });
});

describe('lesson change notifications', () => {
  it('tells the group when a lesson is cancelled, once', async () => {
    const created = await createLesson(tenant.ctx, lesson({ date: '2027-04-01' }), TZ);
    await setLessonStatus(tenant.ctx, created.id, { status: 'CANCELLED', cancelReason: 'snow' });

    const notes = await db.notification.findMany({
      where: { userId: studentUserId, type: 'LESSON_CANCELLED' },
    });
    const forThisLesson = notes.filter(
      (n) => (n.payload as { lessonId?: string }).lessonId === created.id,
    );
    expect(forThisLesson).toHaveLength(1);

    // Re-cancelling an already cancelled lesson must not notify again.
    await setLessonStatus(tenant.ctx, created.id, { status: 'CANCELLED', cancelReason: 'snow' });
    const again = await db.notification.count({
      where: { userId: studentUserId, type: 'LESSON_CANCELLED', payload: { path: ['lessonId'], equals: created.id } },
    });
    expect(again).toBe(1);
  });

  it('tells the group when a lesson moves, and stays quiet when it does not', async () => {
    const created = await createLesson(tenant.ctx, lesson({ date: '2027-04-02' }), TZ);

    // Same time, new room: nothing worth a notification.
    await updateLesson(tenant.ctx, created.id, lesson({ date: '2027-04-02', room: '9' }), TZ);
    expect(
      await db.notification.count({
        where: { userId: studentUserId, type: 'LESSON_RESCHEDULED', payload: { path: ['lessonId'], equals: created.id } },
      }),
    ).toBe(0);

    await updateLesson(
      tenant.ctx,
      created.id,
      lesson({ date: '2027-04-02', startTime: '16:00', endTime: '17:30', room: '9' }),
      TZ,
    );
    expect(
      await db.notification.count({
        where: { userId: studentUserId, type: 'LESSON_RESCHEDULED', payload: { path: ['lessonId'], equals: created.id } },
      }),
    ).toBe(1);
  });

  it('respects a student who muted lesson notifications', async () => {
    await db.notificationPreference.upsert({
      where: { userId_type: { userId: studentUserId, type: 'LESSON_CANCELLED' } },
      create: { userId: studentUserId, type: 'LESSON_CANCELLED', inApp: false },
      update: { inApp: false },
    });

    const created = await createLesson(tenant.ctx, lesson({ date: '2027-04-03' }), TZ);
    await setLessonStatus(tenant.ctx, created.id, { status: 'CANCELLED' });

    expect(
      await db.notification.count({
        where: { userId: studentUserId, type: 'LESSON_CANCELLED', payload: { path: ['lessonId'], equals: created.id } },
      }),
    ).toBe(0);
  });
});
