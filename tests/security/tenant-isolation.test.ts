import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTenant, makeStudent, makeGroup, makeLesson, truncateAll, db, type Tenant } from '../factories';
import { getStudent, listStudents, updateStudent, archiveStudent, studentAttendanceStats } from '@/lib/domain/students';
import { getGroup, addMember, removeMember, updateGroup, generateLessons } from '@/lib/domain/groups';
import { getLesson, updateLesson, setLessonStatus, deleteLesson } from '@/lib/domain/lessons';
import { markAttendance } from '@/lib/domain/attendance';
import { recordPayment, reversePayment, listPayments } from '@/lib/domain/payments';
import { studentBalance, orgBalance, listDebtors } from '@/lib/domain/billing';
import { buildReminder } from '@/lib/domain/reminders';
import { studentInputSchema, studentListQuerySchema, groupInputSchema, lessonInputSchema, paymentListQuerySchema } from '@/lib/validation/schemas';

/**
 * Cross-tenant access. Alice and Bob are two unrelated teachers. Every
 * assertion below is Alice attempting to reach something that belongs to Bob.
 *
 * The expected outcome is always "not found" rather than "forbidden": a 403
 * would confirm that the id exists, which is itself a leak.
 */
let alice: Tenant;
let bob: Tenant;
let bobStudent: Awaited<ReturnType<typeof makeStudent>>;
let bobGroup: Awaited<ReturnType<typeof makeGroup>>;
let bobLesson: Awaited<ReturnType<typeof makeLesson>>;
let bobPaymentId: string;

beforeAll(async () => {
  await truncateAll();
  alice = await createTenant('Alice Studio');
  bob = await createTenant('Bob Center');

  bobStudent = await makeStudent(bob, 'Bobby', 'Secret');
  bobGroup = await makeGroup(bob, 'Bob Group');
  bobLesson = await makeLesson(bob, bobGroup.id, new Date(Date.now() - 3_600_000));

  await db.groupMember.create({
    data: { organizationId: bob.org.id, groupId: bobGroup.id, studentId: bobStudent.id },
  });

  await db.invoice.create({
    data: {
      organizationId: bob.org.id,
      studentId: bobStudent.id,
      groupId: bobGroup.id,
      periodYear: 2026,
      periodMonth: 8,
      amountMinor: 500_000n,
      currency: 'UZS',
      dueDate: new Date('2026-08-05'),
    },
  });

  const payment = await db.payment.create({
    data: {
      organizationId: bob.org.id,
      studentId: bobStudent.id,
      groupId: bobGroup.id,
      amountMinor: 100_000n,
      currency: 'UZS',
      paidAt: new Date(),
      method: 'CASH',
    },
  });
  bobPaymentId = payment.id;

  // Alice has her own, separate data.
  await makeStudent(alice, 'Alisa');
});

afterAll(() => db.$disconnect());

const rejects = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ status: 404 });

describe('1. reading another tenant', () => {
  it('cannot read a student by id', async () => {
    await rejects(getStudent(alice.ctx, bobStudent.id));
  });

  it('cannot read a group by id', async () => {
    await rejects(getGroup(alice.ctx, bobGroup.id));
  });

  it('cannot read a lesson by id', async () => {
    await rejects(getLesson(alice.ctx, bobLesson.id));
  });

  it('never returns another tenant rows in a list', async () => {
    const list = await listStudents(alice.ctx, studentListQuerySchema.parse({ status: 'ALL', perPage: 100 }));
    expect(list.rows.map((s) => s.id)).not.toContain(bobStudent.id);
    expect(list.rows.every((s) => s.organizationId === alice.org.id)).toBe(true);
  });

  it('never returns another tenant payments in a list', async () => {
    const list = await listPayments(alice.ctx, paymentListQuerySchema.parse({ perPage: 100 }));
    expect(list.rows.map((p) => p.id)).not.toContain(bobPaymentId);
  });

  it('excludes another tenant from the debtor report', async () => {
    const debtors = await listDebtors(alice.ctx, { limit: 100 });
    expect(debtors.rows.map((d) => d.studentId)).not.toContain(bobStudent.id);
  });
});

describe('2. mutating another tenant', () => {
  it('cannot update a student', async () => {
    const input = studentInputSchema.parse({ firstName: 'Hacked', status: 'ACTIVE' });
    await rejects(updateStudent(alice.ctx, bobStudent.id, input));

    const untouched = await db.student.findUniqueOrThrow({ where: { id: bobStudent.id } });
    expect(untouched.firstName).toBe('Bobby');
  });

  it('cannot archive a student', async () => {
    await rejects(archiveStudent(alice.ctx, bobStudent.id));
    expect((await db.student.findUniqueOrThrow({ where: { id: bobStudent.id } })).status).toBe('ACTIVE');
  });

  it('cannot update a group', async () => {
    const input = groupInputSchema.parse({ name: 'Hijacked', weekdays: [1], monthlyFee: '1' });
    await rejects(updateGroup(alice.ctx, bobGroup.id, input));
  });

  it('cannot update or cancel a lesson', async () => {
    const input = lessonInputSchema.parse({
      groupId: bobGroup.id, date: '2026-09-01', startTime: '10:00', endTime: '11:00',
    });
    await rejects(updateLesson(alice.ctx, bobLesson.id, input, 'Asia/Tashkent'));
    await rejects(setLessonStatus(alice.ctx, bobLesson.id, { status: 'CANCELLED', cancelReason: 'x' }));
    await rejects(deleteLesson(alice.ctx, bobLesson.id));
  });

  it('cannot reverse a payment', async () => {
    await rejects(reversePayment(alice.ctx, bobPaymentId, 'not mine'));
    expect((await db.payment.findUniqueOrThrow({ where: { id: bobPaymentId } })).status).toBe('COMPLETED');
  });

  it('cannot record a payment against another tenant student', async () => {
    await rejects(
      recordPayment(alice.ctx, {
        studentId: bobStudent.id,
        groupId: null, invoiceId: null,
        amount: '100000', currency: 'UZS',
        paidAt: '2026-08-20', method: 'CASH', note: null, receiptNo: null,
      }),
    );
  });
});

describe('3. crossing tenants through a relationship', () => {
  it('cannot add its own student to another tenant group', async () => {
    const aliceStudent = await makeStudent(alice, 'Mine');
    await rejects(addMember(alice.ctx, bobGroup.id, aliceStudent.id));
  });

  it('cannot add another tenant student to its own group', async () => {
    const aliceGroup = await makeGroup(alice, 'Alice Group');
    await rejects(addMember(alice.ctx, aliceGroup.id, bobStudent.id));
  });

  it('cannot remove a member from another tenant group', async () => {
    await rejects(removeMember(alice.ctx, bobGroup.id, bobStudent.id));
    const still = await db.groupMember.findFirstOrThrow({
      where: { groupId: bobGroup.id, studentId: bobStudent.id },
    });
    expect(still.leftAt).toBeNull();
  });

  it('cannot generate lessons into another tenant group', async () => {
    await rejects(
      generateLessons(alice.ctx, bobGroup.id, { from: '2026-09-01', until: '2026-09-30' }, 'Asia/Tashkent'),
    );
  });

  it('cannot mark attendance on another tenant lesson', async () => {
    await rejects(
      markAttendance(alice.ctx, {
        lessonId: bobLesson.id,
        entries: [{ studentId: bobStudent.id, status: 'ABSENT', minutesLate: null, note: null }],
      }),
    );
  });

  it('cannot smuggle a foreign student into an attendance payload for its own lesson', async () => {
    const aliceGroup = await makeGroup(alice, 'Attendance Group');
    const aliceStudent = await makeStudent(alice, 'Legit');
    await db.groupMember.create({
      data: { organizationId: alice.org.id, groupId: aliceGroup.id, studentId: aliceStudent.id },
    });
    const aliceLesson = await makeLesson(alice, aliceGroup.id);

    await rejects(
      markAttendance(alice.ctx, {
        lessonId: aliceLesson.id,
        entries: [
          { studentId: aliceStudent.id, status: 'PRESENT', minutesLate: null, note: null },
          { studentId: bobStudent.id, status: 'PRESENT', minutesLate: null, note: null },
        ],
      }),
    );

    // The whole batch is rejected: no partial write reached the database.
    expect(await db.attendance.count({ where: { lessonId: aliceLesson.id } })).toBe(0);
  });

  it('cannot build a Telegram reminder for another tenant student', async () => {
    await rejects(buildReminder(alice.ctx, { studentId: bobStudent.id, template: 'DEBT', locale: 'uz' }));
  });
});

describe('4. aggregates stay tenant-scoped', () => {
  it('another tenant balance reads as zero, not as their real figure', async () => {
    const balance = await studentBalance(alice.ctx, bobStudent.id);
    expect(balance.expectedMinor).toBe(0n);
    expect(balance.paidMinor).toBe(0n);
    expect(balance.debtMinor).toBe(0n);
  });

  it('organization totals do not include another tenant money', async () => {
    const bobTotals = await orgBalance(bob.ctx);
    expect(bobTotals.expectedMinor).toBe(500_000n);

    const aliceTotals = await orgBalance(alice.ctx);
    expect(aliceTotals.expectedMinor).toBe(0n);
    expect(aliceTotals.paidMinor).toBe(0n);
  });

  it('attendance statistics do not include another tenant records', async () => {
    const stats = await studentAttendanceStats(alice.ctx, bobStudent.id);
    expect(stats.total).toBe(0);
  });
});

describe('16. archived and soft-deleted rows stay isolated', () => {
  it('an archived student in another tenant is still unreachable', async () => {
    await db.student.update({
      where: { id: bobStudent.id },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    await rejects(getStudent(alice.ctx, bobStudent.id));

    const all = await listStudents(alice.ctx, studentListQuerySchema.parse({ status: 'ALL', perPage: 100 }));
    expect(all.rows.map((s) => s.id)).not.toContain(bobStudent.id);
  });

  it('a soft-deleted lesson in another tenant is still unreachable', async () => {
    await db.lesson.update({ where: { id: bobLesson.id }, data: { deletedAt: new Date() } });
    await rejects(getLesson(alice.ctx, bobLesson.id));
  });
});
