import { prisma } from '../db';
import { Forbidden, NotFound } from '../errors';
import { gradeRatio } from './grades';
import type { SessionUser } from '../auth/session';

/**
 * The student portal.
 *
 * Every function here starts from the session's own `users.id`, resolves the
 * one `students` row linked to it, and filters by that student's id and their
 * centre. No function takes a student id from the caller, so there is no
 * parameter to tamper with: a student can only ever read themselves.
 */
export type StudentContext = {
  studentId: string;
  organizationId: string;
  firstName: string;
  lastName: string | null;
  studentNo: string | null;
  avatarFileId: string | null;
};

export async function requireStudent(user: SessionUser): Promise<StudentContext> {
  const student = await prisma.student.findFirst({
    where: { userId: user.userId, deletedAt: null },
    select: {
      id: true, organizationId: true, firstName: true, lastName: true,
      studentNo: true, avatarFileId: true,
      organization: { select: { status: true, deletedAt: true } },
    },
  });
  if (!student) throw Forbidden();
  if (student.organization.status !== 'ACTIVE' || student.organization.deletedAt) throw Forbidden();
  return {
    studentId: student.id,
    organizationId: student.organizationId,
    firstName: student.firstName,
    lastName: student.lastName,
    studentNo: student.studentNo,
    avatarFileId: student.avatarFileId,
  };
}

const scoped = (sc: StudentContext) => ({ organizationId: sc.organizationId });

export async function myGroups(sc: StudentContext) {
  return prisma.groupMember.findMany({
    where: { ...scoped(sc), studentId: sc.studentId, leftAt: null },
    select: {
      id: true,
      feeOverrideMinor: true,
      group: {
        select: {
          id: true, name: true, subject: true, room: true, color: true,
          weekdays: true, startTime: true, endTime: true,
          monthlyFeeMinor: true, currency: true, status: true,
          course: { select: { id: true, name: true } },
          teacher: {
            select: {
              id: true,
              subject: true,
              // Only the teacher's public identity — never their salary or contact.
              user: { select: { profile: { select: { firstName: true, lastName: true, avatarFileId: true } } } },
            },
          },
        },
      },
    },
  });
}

export async function myLessons(sc: StudentContext, from: Date, until: Date) {
  const groupIds = (
    await prisma.groupMember.findMany({
      where: { ...scoped(sc), studentId: sc.studentId, leftAt: null },
      select: { groupId: true },
    })
  ).map((g) => g.groupId);
  if (groupIds.length === 0) return [];

  return prisma.lesson.findMany({
    where: {
      ...scoped(sc),
      deletedAt: null,
      groupId: { in: groupIds },
      startsAt: { gte: from, lt: until },
    },
    orderBy: { startsAt: 'asc' },
    select: {
      id: true, startsAt: true, endsAt: true, room: true, topic: true,
      status: true, cancelReason: true,
      group: { select: { id: true, name: true, color: true } },
      teacher: { select: { user: { select: { profile: { select: { firstName: true, lastName: true } } } } } },
    },
  });
}

export async function myAttendance(sc: StudentContext, limit = 50) {
  const [rows, counts] = await Promise.all([
    prisma.attendance.findMany({
      where: { ...scoped(sc), studentId: sc.studentId },
      orderBy: { lesson: { startsAt: 'desc' } },
      take: limit,
      select: {
        id: true, status: true, minutesLate: true, markedAt: true,
        lesson: { select: { id: true, startsAt: true, group: { select: { name: true } } } },
      },
    }),
    prisma.attendance.groupBy({
      by: ['status'],
      where: { ...scoped(sc), studentId: sc.studentId },
      _count: { _all: true },
    }),
  ]);

  const by = Object.fromEntries(counts.map((c) => [c.status, c._count._all]));
  const total = counts.reduce((acc, c) => acc + c._count._all, 0);
  return {
    rows,
    stats: {
      total,
      present: by.PRESENT ?? 0,
      absent: by.ABSENT ?? 0,
      late: by.LATE ?? 0,
      excused: by.EXCUSED ?? 0,
      attendanceRate: total > 0 ? ((by.PRESENT ?? 0) + (by.LATE ?? 0)) / total : null,
      absenceRate: total > 0 ? (by.ABSENT ?? 0) / total : null,
    },
  };
}

export async function myGrades(sc: StudentContext, limit = 100) {
  const rows = await prisma.grade.findMany({
    where: { ...scoped(sc), studentId: sc.studentId, deletedAt: null },
    orderBy: { gradedAt: 'desc' },
    take: limit,
    select: {
      id: true, scheme: true, valueNumeric: true, valueLetter: true, maxValue: true,
      title: true, comment: true, gradedAt: true,
      group: { select: { id: true, name: true } },
    },
  });

  const ratios = rows.map((r) => gradeRatio(r)).filter((r): r is number => r !== null);
  const average = ratios.length ? (ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100 : null;
  return { rows, average };
}

export async function myHomework(sc: StudentContext, limit = 50) {
  return prisma.homeworkSubmission.findMany({
    where: {
      ...scoped(sc),
      studentId: sc.studentId,
      homework: { deletedAt: null, status: { not: 'DRAFT' } },
    },
    orderBy: { homework: { dueAt: 'desc' } },
    take: limit,
    select: {
      id: true, status: true, submittedAt: true, score: true, feedback: true, note: true,
      homework: {
        select: {
          id: true, title: true, description: true, dueAt: true, maxScore: true,
          group: { select: { id: true, name: true } },
          attachments: { select: { fileId: true, file: { select: { mimeType: true, sizeBytes: true } } } },
        },
      },
    },
  });
}

/** Own money: what was charged, what was paid, what is left. */
export async function myPayments(sc: StudentContext) {
  const [invoices, payments, invoiceAgg, paymentAgg] = await Promise.all([
    prisma.invoice.findMany({
      where: { ...scoped(sc), studentId: sc.studentId, status: { not: 'VOID' } },
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
      take: 24,
      select: {
        id: true, periodYear: true, periodMonth: true, amountMinor: true,
        currency: true, dueDate: true, status: true,
        group: { select: { name: true } },
      },
    }),
    prisma.payment.findMany({
      where: { ...scoped(sc), studentId: sc.studentId, status: 'COMPLETED' },
      orderBy: { paidAt: 'desc' },
      take: 50,
      select: {
        id: true, amountMinor: true, currency: true, paidAt: true, method: true,
        receiptNo: true, note: true, group: { select: { name: true } },
      },
    }),
    prisma.invoice.aggregate({
      _sum: { amountMinor: true },
      where: { ...scoped(sc), studentId: sc.studentId, status: { not: 'VOID' } },
    }),
    prisma.payment.aggregate({
      _sum: { amountMinor: true },
      where: { ...scoped(sc), studentId: sc.studentId, status: 'COMPLETED' },
    }),
  ]);

  const charged = invoiceAgg._sum.amountMinor ?? 0n;
  const paid = paymentAgg._sum.amountMinor ?? 0n;
  return { invoices, payments, chargedMinor: charged, paidMinor: paid, debtMinor: charged - paid };
}

export async function myNotifications(user: SessionUser, limit = 20) {
  return prisma.notification.findMany({
    where: { userId: user.userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/** A student may attach work to their own assignment, and nothing else. */
export async function submitHomework(
  sc: StudentContext,
  homeworkId: string,
  input: { note: string | null; fileId: string | null },
) {
  const submission = await prisma.homeworkSubmission.findFirst({
    where: {
      ...scoped(sc),
      studentId: sc.studentId,
      homeworkId,
      homework: { deletedAt: null, status: 'PUBLISHED' },
    },
    include: { homework: { select: { dueAt: true } } },
  });
  if (!submission) throw NotFound();

  if (input.fileId) {
    const file = await prisma.file.findFirst({
      where: { id: input.fileId, organizationId: sc.organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!file) throw NotFound();
  }

  const now = new Date();
  return prisma.homeworkSubmission.update({
    where: { id: submission.id },
    data: {
      status: now > submission.homework.dueAt ? 'LATE' : 'SUBMITTED',
      submittedAt: now,
      note: input.note,
      fileId: input.fileId,
    },
  });
}
