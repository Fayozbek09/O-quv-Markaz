import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import type { StudentModel, GroupModel, GroupMemberModel } from '../src/generated/prisma/models';
import { hash } from '@node-rs/argon2';
import { randomUUID } from 'node:crypto';

/**
 * Development seed. Creates two independent workspaces so that tenant
 * isolation can be exercised by hand as well as by the automated tests.
 */
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;
const TZ = 'Asia/Tashkent';
const UZS = 'UZS';

/** Tashkent is UTC+5 year-round, so a fixed offset is correct here. */
function tashkentUtc(dateIso: string, hhmm: string): Date {
  return new Date(`${dateIso}T${hhmm}:00+05:00`);
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

async function reset() {
  // Order matters only where cascades do not cover it.
  await prisma.$transaction([
    prisma.outboundMessage.deleteMany(),
    prisma.telegramLinkToken.deleteMany(),
    prisma.webhookEvent.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.rateLimitCounter.deleteMany(),
    prisma.otpCode.deleteMany(),
    prisma.organization.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

async function createTeacher(input: {
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  subject: string;
  orgName: string;
}) {
  const user = await prisma.user.create({
    data: {
      email: input.email,
      emailVerified: new Date(),
      phone: input.phone,
      phoneVerified: new Date(),
      passwordHash: await hash('Ustozly2026!', ARGON),
      profile: {
        create: {
          firstName: input.firstName,
          lastName: input.lastName,
          teachingSubject: input.subject,
          locale: 'UZ',
          timezone: TZ,
        },
      },
    },
  });

  const org = await prisma.organization.create({
    data: {
      name: input.orgName,
      slug: `${input.orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomUUID().slice(0, 6)}`,
      defaultCurrency: UZS,
      timezone: TZ,
      locale: 'UZ',
      members: { create: { userId: user.id, role: 'OWNER' } },
      subscription: { create: { plan: 'FREE' } },
    },
    include: { members: true },
  });

  await prisma.notificationPreference.createMany({
    data: (['LESSON_UPCOMING', 'ATTENDANCE_MISSED', 'PAYMENT_OVERDUE', 'MONTHLY_SUMMARY'] as const).map(
      (type) => ({ userId: user.id, type, inApp: true, telegram: false, email: false }),
    ),
  });

  return { user, org, member: org.members[0]! };
}

const STUDENTS = [
  ['Ali', 'Valiyev', '+998901234501', 'Valijon Valiyev', '+998901112201'],
  ['Nodira', 'Karimova', '+998901234502', 'Dilnoza Karimova', '+998901112202'],
  ['Sardor', 'Rahimov', '+998901234503', 'Rustam Rahimov', '+998901112203'],
  ['Malika', 'Yusupova', '+998901234504', 'Gulnora Yusupova', '+998901112204'],
  ['Jasur', 'Toshmatov', '+998901234505', 'Toshmat Toshmatov', '+998901112205'],
  ['Zilola', 'Ergasheva', '+998901234506', 'Ergash Ergashev', '+998901112206'],
  ['Bekzod', 'Nazarov', '+998901234507', 'Nazar Nazarov', '+998901112207'],
  ['Kamola', 'Sobirova', '+998901234508', 'Sobir Sobirov', '+998901112208'],
  ['Doston', 'Umarov', '+998901234509', 'Umar Umarov', '+998901112209'],
  ['Sevara', 'Qodirova', '+998901234510', 'Qodir Qodirov', '+998901112210'],
] as const;

async function main() {
  console.info('seed: resetting');
  await reset();

  // ---------------------------------------------------------------- tenant A
  const a = await createTeacher({
    email: 'ustoz@ustozly.uz',
    phone: '+998901112233',
    firstName: 'Aziza',
    lastName: 'Karimova',
    subject: 'Ingliz tili',
    orgName: 'Aziza English Studio',
  });

  const students: StudentModel[] = [];
  for (const [firstName, lastName, phone, parentName, parentPhone] of STUDENTS) {
    students.push(
      await prisma.student.create({
        data: {
          organizationId: a.org.id,
          firstName,
          lastName,
          phone,
          status: 'ACTIVE',
          parents: {
            create: {
              organizationId: a.org.id,
              fullName: parentName,
              phone: parentPhone,
              relation: 'parent',
              isPrimary: true,
            },
          },
        },
      }),
    );
  }

  const groupSpecs = [
    { name: 'IELTS Evening A', subject: 'IELTS', weekdays: [1, 3, 5], start: '18:00', end: '19:30', fee: 450_000n, color: '#2f62d8', take: [0, 1, 2, 3] },
    { name: 'General English B1', subject: 'General English', weekdays: [2, 4], start: '17:00', end: '18:30', fee: 350_000n, color: '#0f9d58', take: [4, 5, 6] },
    { name: 'Beginners Morning', subject: 'Beginner English', weekdays: [1, 3], start: '09:00', end: '10:30', fee: 300_000n, color: '#e8710a', take: [7, 8, 9] },
  ];

  const groups: Array<{ group: GroupModel & { members: GroupMemberModel[] }; spec: (typeof groupSpecs)[number] }> = [];
  for (const spec of groupSpecs) {
    const group = await prisma.group.create({
      data: {
        organizationId: a.org.id,
        name: spec.name,
        subject: spec.subject,
        teacherId: a.member.id,
        monthlyFeeMinor: spec.fee,
        currency: UZS,
        color: spec.color,
        weekdays: spec.weekdays,
        startTime: spec.start,
        endTime: spec.end,
        room: 'Room 1',
        status: 'ACTIVE',
        members: {
          create: spec.take.map((index) => ({
            organizationId: a.org.id,
            studentId: students[index]!.id,
          })),
        },
      },
      include: { members: true },
    });
    groups.push({ group, spec });
  }

  // ---------------------------------------------------------------- lessons
  const today = new Date();
  let lessonCount = 0;
  let attendanceCount = 0;

  for (const { group, spec } of groups) {
    for (let offset = -21; offset <= 14; offset += 1) {
      const day = addDays(today, offset);
      const weekday = ((day.getUTCDay() + 6) % 7) + 1; // 1 = Monday
      if (!spec.weekdays.includes(weekday)) continue;

      const dateIso = isoDate(day);
      const lesson = await prisma.lesson.create({
        data: {
          organizationId: a.org.id,
          groupId: group.id,
          teacherId: a.member.id,
          startsAt: tashkentUtc(dateIso, spec.start),
          endsAt: tashkentUtc(dateIso, spec.end),
          room: 'Room 1',
          status: offset < 0 ? 'COMPLETED' : 'SCHEDULED',
        },
      });
      lessonCount += 1;

      // Only past lessons carry attendance.
      if (offset >= 0) continue;

      for (const [index, member] of group.members.entries()) {
        // A deterministic spread: mostly present, with a few absences and lates.
        const bucket = (index + offset + 21) % 10;
        const status = bucket === 3 ? 'ABSENT' : bucket === 7 ? 'LATE' : bucket === 8 ? 'EXCUSED' : 'PRESENT';

        await prisma.attendance.create({
          data: {
            organizationId: a.org.id,
            lessonId: lesson.id,
            studentId: member.studentId,
            status,
            minutesLate: status === 'LATE' ? 10 : null,
            markedByUserId: a.user.id,
          },
        });
        attendanceCount += 1;
      }
    }
  }

  // ---------------------------------------------------------------- money
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;

  let invoiceCount = 0;
  let paymentCount = 0;

  for (const period of [{ y: prevYear, m: prevMonth }, { y: year, m: month }]) {
    for (const { group } of groups) {
      for (const [index, member] of group.members.entries()) {
        const invoice = await prisma.invoice.create({
          data: {
            organizationId: a.org.id,
            studentId: member.studentId,
            groupId: group.id,
            periodYear: period.y,
            periodMonth: period.m,
            amountMinor: group.monthlyFeeMinor,
            currency: UZS,
            dueDate: new Date(Date.UTC(period.y, period.m - 1, 5)),
          },
        });
        invoiceCount += 1;

        // Last month is fully settled; this month leaves a realistic tail of debt.
        const isCurrent = period.y === year && period.m === month;
        const behaviour = isCurrent ? index % 3 : 0; // 0 = paid, 1 = partial, 2 = unpaid
        if (behaviour === 2) continue;

        const amount = behaviour === 1 ? group.monthlyFeeMinor / 2n : group.monthlyFeeMinor;

        await prisma.payment.create({
          data: {
            organizationId: a.org.id,
            studentId: member.studentId,
            groupId: group.id,
            invoiceId: invoice.id,
            amountMinor: amount,
            currency: UZS,
            paidAt: new Date(Date.UTC(period.y, period.m - 1, 3 + (index % 5))),
            method: index % 2 === 0 ? 'CASH' : 'CARD',
            createdByUserId: a.user.id,
          },
        });
        paymentCount += 1;

        if (behaviour === 0) {
          await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'PAID' } });
        }
      }
    }
  }

  // ---------------------------------------------------------------- tenant B
  // A second, unrelated workspace. Nothing here should ever be visible from A.
  const b = await createTeacher({
    email: 'boshqa@ustozly.uz',
    phone: '+998907776655',
    firstName: 'Bobur',
    lastName: 'Aliyev',
    subject: 'Matematika',
    orgName: 'Bobur Math Center',
  });

  const otherStudent = await prisma.student.create({
    data: {
      organizationId: b.org.id,
      firstName: 'Sirli',
      lastName: 'Oquvchi',
      phone: '+998907770001',
      status: 'ACTIVE',
    },
  });

  const otherGroup = await prisma.group.create({
    data: {
      organizationId: b.org.id,
      name: 'Algebra 9-sinf',
      subject: 'Matematika',
      teacherId: b.member.id,
      monthlyFeeMinor: 400_000n,
      currency: UZS,
      weekdays: [2, 5],
      startTime: '16:00',
      endTime: '17:30',
      members: { create: { organizationId: b.org.id, studentId: otherStudent.id } },
    },
  });

  await prisma.invoice.create({
    data: {
      organizationId: b.org.id,
      studentId: otherStudent.id,
      groupId: otherGroup.id,
      periodYear: year,
      periodMonth: month,
      amountMinor: 400_000n,
      currency: UZS,
      dueDate: new Date(Date.UTC(year, month - 1, 5)),
    },
  });

  console.info(`
seed complete
-------------
Workspace A: ${a.org.name}
  login: ustoz@ustozly.uz  /  +998901112233
  password: Ustozly2026!
  students: ${students.length}   groups: ${groups.length}
  lessons: ${lessonCount}   attendance rows: ${attendanceCount}
  invoices: ${invoiceCount}   payments: ${paymentCount}

Workspace B: ${b.org.name}   (used to verify tenant isolation)
  login: boshqa@ustozly.uz  /  +998907776655
  password: Ustozly2026!
`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
