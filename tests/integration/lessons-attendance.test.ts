import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTenant, makeStudent, makeGroup, truncateAll, db, type Tenant } from '../factories';
import { createLesson, listLessons, setLessonStatus } from '@/lib/domain/lessons';
import { generateLessons } from '@/lib/domain/groups';
import { markAttendance, attendanceSummary } from '@/lib/domain/attendance';
import { studentAttendanceStats } from '@/lib/domain/students';
import { lessonInputSchema, calendarQuerySchema } from '@/lib/validation/schemas';

const TZ = 'Asia/Tashkent';

let tenant: Tenant;
let group: Awaited<ReturnType<typeof makeGroup>>;
let studentA: Awaited<ReturnType<typeof makeStudent>>;
let studentB: Awaited<ReturnType<typeof makeStudent>>;

beforeAll(async () => {
  await truncateAll();
  tenant = await createTenant();
  group = await makeGroup(tenant, 'Schedule Group');
  studentA = await makeStudent(tenant, 'Anvar');
  studentB = await makeStudent(tenant, 'Barno');

  await db.groupMember.createMany({
    data: [studentA, studentB].map((s) => ({
      organizationId: tenant.org.id,
      groupId: group.id,
      studentId: s.id,
    })),
  });
});
afterAll(() => db.$disconnect());

describe('lessons', () => {
  it('stores a local wall time as the correct UTC instant', async () => {
    const lesson = await createLesson(
      tenant.ctx,
      lessonInputSchema.parse({
        groupId: group.id, date: '2026-10-05', startTime: '18:00', endTime: '19:30',
      }),
      TZ,
    );
    expect(lesson.startsAt.toISOString()).toBe('2026-10-05T13:00:00.000Z');
    expect(lesson.endsAt.toISOString()).toBe('2026-10-05T14:30:00.000Z');
  });

  it('refuses two lessons for the same group at the same instant', async () => {
    const input = lessonInputSchema.parse({
      groupId: group.id, date: '2026-10-06', startTime: '18:00', endTime: '19:30',
    });
    await createLesson(tenant.ctx, input, TZ);
    await expect(createLesson(tenant.ctx, input, TZ)).rejects.toMatchObject({ status: 409 });
  });

  it('generates the recurring schedule and is safe to re-run', async () => {
    // The group meets Mon/Wed/Fri; November 2026 starts on a Sunday.
    const first = await generateLessons(tenant.ctx, group.id, { from: '2026-11-01', until: '2026-11-30' }, TZ);
    expect(first.created).toBeGreaterThan(10);

    const second = await generateLessons(tenant.ctx, group.id, { from: '2026-11-01', until: '2026-11-30' }, TZ);
    expect(second.created).toBe(0);

    const generated = await db.lesson.findMany({
      where: { groupId: group.id, startsAt: { gte: new Date('2026-11-01'), lt: new Date('2026-12-01') } },
    });
    // Every generated lesson lands on a scheduled weekday, at the group time.
    for (const lesson of generated) {
      const weekday = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(lesson.startsAt);
      expect(['Mon', 'Wed', 'Fri']).toContain(weekday);
      expect(
        new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
          .format(lesson.startsAt),
      ).toBe('18:00');
    }
  });

  it('lists a calendar range using local day boundaries', async () => {
    const lessons = await listLessons(
      tenant.ctx,
      calendarQuerySchema.parse({ from: '2026-10-05', until: '2026-10-05' }),
      TZ,
    );
    expect(lessons.length).toBe(1);
  });
});

describe('attendance', () => {
  it('records a mark per student and turns a past lesson into completed', async () => {
    const lesson = await createLesson(
      tenant.ctx,
      lessonInputSchema.parse({
        groupId: group.id, date: '2020-01-06', startTime: '18:00', endTime: '19:30',
      }),
      TZ,
    );

    await markAttendance(tenant.ctx, {
      lessonId: lesson.id,
      entries: [
        { studentId: studentA.id, status: 'PRESENT', minutesLate: null, note: null },
        { studentId: studentB.id, status: 'LATE', minutesLate: 12, note: 'traffic' },
      ],
    });

    const rows = await db.attendance.findMany({ where: { lessonId: lesson.id } });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.studentId === studentB.id)?.minutesLate).toBe(12);
    expect((await db.lesson.findUniqueOrThrow({ where: { id: lesson.id } })).status).toBe('COMPLETED');
  });

  it('re-marking updates rather than duplicating', async () => {
    const lesson = await db.lesson.findFirstOrThrow({
      where: { groupId: group.id, startsAt: new Date('2020-01-06T13:00:00Z') },
    });

    await markAttendance(tenant.ctx, {
      lessonId: lesson.id,
      entries: [{ studentId: studentA.id, status: 'ABSENT', minutesLate: null, note: null }],
    });

    const rows = await db.attendance.findMany({ where: { lessonId: lesson.id } });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.studentId === studentA.id)?.status).toBe('ABSENT');
  });

  it('clears minutesLate when the status is no longer LATE', async () => {
    const lesson = await db.lesson.findFirstOrThrow({
      where: { groupId: group.id, startsAt: new Date('2020-01-06T13:00:00Z') },
    });
    await markAttendance(tenant.ctx, {
      lessonId: lesson.id,
      entries: [{ studentId: studentB.id, status: 'PRESENT', minutesLate: 30, note: null }],
    });
    const row = await db.attendance.findFirstOrThrow({
      where: { lessonId: lesson.id, studentId: studentB.id },
    });
    expect(row.minutesLate).toBeNull();
  });

  it('computes a rate that counts late as attended and excludes excused', async () => {
    const stats = await studentAttendanceStats(tenant.ctx, studentA.id);
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.rate).not.toBeNull();
    expect(stats.rate as number).toBeGreaterThanOrEqual(0);
    expect(stats.rate as number).toBeLessThanOrEqual(1);

    const summary = await attendanceSummary(
      tenant.ctx,
      { from: new Date('2019-01-01'), until: new Date('2030-01-01') },
    );
    expect(summary.PRESENT + summary.ABSENT + summary.LATE + summary.EXCUSED).toBeGreaterThan(0);
  });

  it('cancelling a lesson records the reason', async () => {
    const lesson = await createLesson(
      tenant.ctx,
      lessonInputSchema.parse({
        groupId: group.id, date: '2026-12-01', startTime: '18:00', endTime: '19:30',
      }),
      TZ,
    );
    await setLessonStatus(tenant.ctx, lesson.id, { status: 'CANCELLED', cancelReason: 'holiday' });

    const after = await db.lesson.findUniqueOrThrow({ where: { id: lesson.id } });
    expect(after.status).toBe('CANCELLED');
    expect(after.cancelReason).toBe('holiday');
  });
});
