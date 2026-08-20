import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import type { StudentModel, GroupModel, GroupMemberModel } from '../src/generated/prisma/models';
import { hash } from '@node-rs/argon2';
import { randomInt, randomUUID } from 'node:crypto';

/**
 * Development seed.
 *
 * Builds two independent education centres so tenant isolation can be exercised
 * by hand as well as by the automated tests, plus one account for every role so
 * each dashboard has something real behind it.
 *
 * Staff and student passwords here are development fixtures and are printed at
 * the end. The platform-administrator password is generated, printed once and
 * never stored in readable form — see scripts/create-admin.ts.
 */
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;
const TZ = 'Asia/Tashkent';
const UZS = 'UZS';
const DAY = 86_400_000;

/** A shared fixture password, used only by the seeded demo accounts. */
const DEMO_PASSWORD = 'Demo-Markaz-2026!';

/** Tashkent is UTC+5 year-round, so a fixed offset is correct here. */
function tashkentUtc(dateIso: string, hhmm: string): Date {
  return new Date(`${dateIso}T${hhmm}:00+05:00`);
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);

async function reset() {
  await prisma.$transaction([
    prisma.outboundMessage.deleteMany(),
    prisma.telegramLinkToken.deleteMany(),
    prisma.webhookEvent.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.rateLimitCounter.deleteMany(),
    prisma.otpCode.deleteMany(),
    prisma.adminSession.deleteMany(),
    prisma.organization.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

type NewUser = { username: string; firstName: string; lastName: string; email?: string; phone?: string };

async function createUser(input: NewUser) {
  return prisma.user.create({
    data: {
      username: input.username,
      email: input.email,
      emailVerified: input.email ? new Date() : null,
      phone: input.phone,
      phoneVerified: input.phone ? new Date() : null,
      passwordHash: await hash(DEMO_PASSWORD, ARGON),
      profile: { create: { firstName: input.firstName, lastName: input.lastName, locale: 'UZ', timezone: TZ } },
    },
  });
}

async function notificationDefaults(userId: string) {
  await prisma.notificationPreference.createMany({
    data: (
      [
        'LESSON_UPCOMING', 'LESSON_CANCELLED', 'ATTENDANCE_MISSED', 'HOMEWORK_ASSIGNED',
        'GRADE_POSTED', 'PAYMENT_OVERDUE', 'PAYMENT_RECEIVED', 'MONTHLY_SUMMARY',
      ] as const
    ).map((type) => ({ userId, type, inApp: true, telegram: false, email: false })),
    skipDuplicates: true,
  });
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
  ['Otabek', 'Mirzayev', '+998901234511', 'Mirza Mirzayev', '+998901112211'],
  ['Shahnoza', 'Tursunova', '+998901234512', 'Tursun Tursunov', '+998901112212'],
] as const;

async function main() {
  console.info('seed: resetting');
  await reset();

  // ---------------------------------------------------------------- platform admin
  const { ensurePlatformAdmin } = await import('../scripts/create-admin');
  const admin = await ensurePlatformAdmin({ quiet: true });

  // ---------------------------------------------------------------- centre A
  const ownerUser = await createUser({
    username: 'owner.karimova',
    firstName: 'Aziza',
    lastName: 'Karimova',
    email: 'egasi@oquvmarkaz.uz',
    phone: '+998901112233',
  });
  await notificationDefaults(ownerUser.id);

  const org = await prisma.organization.create({
    data: {
      name: "Bilim Ziyo o'quv markazi",
      legalName: 'BILIM ZIYO MCHJ',
      slug: `bilim-ziyo-${randomUUID().slice(0, 6)}`,
      city: 'Toshkent',
      district: 'Chilonzor',
      address: "Chilonzor 19-mavze, 12-uy",
      phone: '+998712001020',
      email: 'info@bilimziyo.uz',
      description: "Til, aniq fanlar va dasturlash bo'yicha o'quv markaz.",
      telegramHandle: '@bilimziyo',
      workingHours: [
        { weekday: 1, open: '09:00', close: '20:00', closed: false },
        { weekday: 2, open: '09:00', close: '20:00', closed: false },
        { weekday: 3, open: '09:00', close: '20:00', closed: false },
        { weekday: 4, open: '09:00', close: '20:00', closed: false },
        { weekday: 5, open: '09:00', close: '20:00', closed: false },
        { weekday: 6, open: '10:00', close: '16:00', closed: false },
        { weekday: 7, open: '00:00', close: '00:00', closed: true },
      ],
      defaultCurrency: UZS,
      timezone: TZ,
      locale: 'UZ',
      status: 'ACTIVE',
      members: { create: { userId: ownerUser.id, role: 'OWNER' } },
    },
    include: { members: true },
  });

  // A trial that is a few days old, so the countdown banner has something to show.
  const trialStart = new Date(Date.now() - 12 * DAY);
  await prisma.subscription.create({
    data: {
      organizationId: org.id,
      plan: 'STANDARD',
      status: 'TRIAL',
      trialStartedAt: trialStart,
      trialEndsAt: new Date(trialStart.getTime() + 30 * DAY),
      nextPaymentAt: new Date(trialStart.getTime() + 30 * DAY),
      amountMinor: 300_000n,
      currency: UZS,
      currentPeriodStart: trialStart,
      currentPeriodEnd: new Date(trialStart.getTime() + 30 * DAY),
    },
  });

  // ---------------------------------------------------------------- staff
  const receptionUser = await createUser({
    username: 'reception.tosheva',
    firstName: 'Nigora',
    lastName: 'Tosheva',
    phone: '+998901112244',
  });
  await notificationDefaults(receptionUser.id);
  const receptionMember = await prisma.organizationMember.create({
    data: {
      organizationId: org.id,
      userId: receptionUser.id,
      role: 'RECEPTIONIST',
      hireDate: new Date(Date.UTC(2025, 8, 1)),
      salaryModel: 'FIXED',
      salaryAmountMinor: 4_000_000n,
      currency: UZS,
      permissions: { 'attendance.write': true },
    },
  });

  const teacherSpecs = [
    {
      username: 'teacher.saidova', firstName: 'Dilbar', lastName: 'Saidova',
      subject: 'Ingliz tili', specialization: 'IELTS / General English',
      phone: '+998901112255', salaryModel: 'PERCENTAGE' as const,
      salaryAmountMinor: 0n, salaryPercentBp: 4000,
    },
    {
      username: 'teacher.rustamov', firstName: 'Anvar', lastName: 'Rustamov',
      subject: 'Matematika', specialization: 'Algebra va geometriya',
      phone: '+998901112266', salaryModel: 'FIXED' as const,
      salaryAmountMinor: 6_500_000n, salaryPercentBp: 0,
    },
  ];

  const teachers = [];
  for (const spec of teacherSpecs) {
    const user = await createUser({
      username: spec.username,
      firstName: spec.firstName,
      lastName: spec.lastName,
      phone: spec.phone,
    });
    await notificationDefaults(user.id);
    const member = await prisma.organizationMember.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        role: 'TEACHER',
        subject: spec.subject,
        specialization: spec.specialization,
        hireDate: new Date(Date.UTC(2025, 5, 15)),
        salaryModel: spec.salaryModel,
        salaryAmountMinor: spec.salaryAmountMinor,
        salaryPercentBp: spec.salaryPercentBp,
        currency: UZS,
      },
    });
    teachers.push({ user, member, spec });
  }

  // ---------------------------------------------------------------- courses
  const courseSpecs = [
    { name: 'Ingliz tili', catalogKey: 'english', fee: 450_000n, color: '#2f62d8' },
    { name: 'IELTS', catalogKey: 'ielts', fee: 650_000n, color: '#7c3aed' },
    { name: 'Matematika', catalogKey: 'math', fee: 400_000n, color: '#0f9d58' },
    { name: 'Dasturlash', catalogKey: 'programming', fee: 700_000n, color: '#e8710a' },
  ];
  const courses = [];
  for (const spec of courseSpecs) {
    courses.push(
      await prisma.course.create({
        data: {
          organizationId: org.id,
          name: spec.name,
          catalogKey: spec.catalogKey,
          defaultFeeMinor: spec.fee,
          currency: UZS,
          color: spec.color,
          durationMonths: 6,
        },
      }),
    );
  }

  // ---------------------------------------------------------------- students
  const students: StudentModel[] = [];
  for (const [index, row] of STUDENTS.entries()) {
    const [firstName, lastName, phone, parentName, parentPhone] = row;
    students.push(
      await prisma.student.create({
        data: {
          organizationId: org.id,
          firstName,
          lastName,
          phone,
          studentNo: `2026-${String(index + 1).padStart(4, '0')}`,
          status: 'ACTIVE',
          parents: {
            create: {
              organizationId: org.id,
              fullName: parentName,
              phone: parentPhone,
              relation: 'ota-ona',
              isPrimary: true,
            },
          },
        },
      }),
    );
  }

  // The first three students get a portal login so /student has real data.
  const studentLogins: Array<{ username: string; name: string }> = [];
  for (const student of students.slice(0, 3)) {
    const username = `student.${student.lastName?.toLowerCase() ?? 'oquvchi'}`;
    const user = await createUser({
      username,
      firstName: student.firstName,
      lastName: student.lastName ?? '',
    });
    await notificationDefaults(user.id);
    await prisma.organizationMember.create({
      data: { organizationId: org.id, userId: user.id, role: 'STUDENT' },
    });
    await prisma.student.update({ where: { id: student.id }, data: { userId: user.id } });
    studentLogins.push({ username, name: `${student.firstName} ${student.lastName}` });
  }

  // ---------------------------------------------------------------- groups
  const groupSpecs = [
    {
      name: 'IELTS Evening A', course: 1, teacher: 0, weekdays: [1, 3, 5],
      start: '18:00', end: '19:30', fee: 650_000n, room: '201', take: [0, 1, 2, 3],
    },
    {
      name: 'General English B1', course: 0, teacher: 0, weekdays: [2, 4],
      start: '17:00', end: '18:30', fee: 450_000n, room: '202', take: [4, 5, 6, 7],
    },
    {
      name: 'Matematika 9-sinf', course: 2, teacher: 1, weekdays: [1, 3],
      start: '09:00', end: '10:30', fee: 400_000n, room: '105', take: [8, 9, 10, 11],
    },
  ];

  const groups: Array<{
    group: GroupModel & { members: GroupMemberModel[] };
    spec: (typeof groupSpecs)[number];
  }> = [];

  for (const spec of groupSpecs) {
    const group = await prisma.group.create({
      data: {
        organizationId: org.id,
        name: spec.name,
        subject: courses[spec.course]!.name,
        courseId: courses[spec.course]!.id,
        teacherId: teachers[spec.teacher]!.member.id,
        capacity: 12,
        monthlyFeeMinor: spec.fee,
        currency: UZS,
        color: courses[spec.course]!.color,
        weekdays: spec.weekdays,
        startTime: spec.start,
        endTime: spec.end,
        room: spec.room,
        status: 'ACTIVE',
        startDate: new Date(Date.UTC(2026, 0, 15)),
        members: {
          create: spec.take.map((index) => ({
            organizationId: org.id,
            studentId: students[index]!.id,
          })),
        },
      },
      include: { members: true },
    });
    groups.push({ group, spec });
  }

  // ---------------------------------------------------------------- lessons & attendance
  const today = new Date();
  let lessonCount = 0;
  let attendanceCount = 0;

  for (const { group, spec } of groups) {
    for (let offset = -28; offset <= 14; offset += 1) {
      const day = addDays(today, offset);
      const weekday = ((day.getUTCDay() + 6) % 7) + 1;
      if (!spec.weekdays.includes(weekday)) continue;

      const dateIso = isoDate(day);
      // One cancelled lesson, so the "lesson cancelled" path has an example.
      const cancelled = offset === 2 && group.name.startsWith('IELTS');

      const lesson = await prisma.lesson.create({
        data: {
          organizationId: org.id,
          groupId: group.id,
          teacherId: group.teacherId,
          startsAt: tashkentUtc(dateIso, spec.start),
          endsAt: tashkentUtc(dateIso, spec.end),
          room: spec.room,
          status: cancelled ? 'CANCELLED' : offset < 0 ? 'COMPLETED' : 'SCHEDULED',
          cancelReason: cancelled ? "O'qituvchi kasal" : null,
        },
      });
      lessonCount += 1;

      if (offset >= 0) continue;

      for (const [index, member] of group.members.entries()) {
        const bucket = (index + offset + 28) % 10;
        const status = bucket === 3 ? 'ABSENT' : bucket === 7 ? 'LATE' : bucket === 8 ? 'EXCUSED' : 'PRESENT';
        await prisma.attendance.create({
          data: {
            organizationId: org.id,
            lessonId: lesson.id,
            studentId: member.studentId,
            status,
            minutesLate: status === 'LATE' ? 10 : null,
            markedByUserId: teachers[spec.teacher]!.user.id,
          },
        });
        attendanceCount += 1;
      }
    }
  }

  // ---------------------------------------------------------------- homework & grades
  let homeworkCount = 0;
  let gradeCount = 0;

  for (const { group, spec } of groups) {
    for (const [hwIndex, title] of ['Unit 3 — Reading', 'Unit 4 — Writing task'].entries()) {
      const homework = await prisma.homework.create({
        data: {
          organizationId: org.id,
          groupId: group.id,
          teacherId: teachers[spec.teacher]!.member.id,
          title: `${group.name}: ${title}`,
          description: "Darslikdagi mashqlarni bajaring va daftarga yozing.",
          dueAt: addDays(today, hwIndex === 0 ? -3 : 4),
          status: 'PUBLISHED',
          maxScore: 10,
        },
      });
      homeworkCount += 1;

      for (const [index, member] of group.members.entries()) {
        const overdue = hwIndex === 0;
        const status = overdue
          ? index % 4 === 0
            ? 'MISSING'
            : index % 3 === 0
              ? 'LATE'
              : 'GRADED'
          : 'ASSIGNED';
        await prisma.homeworkSubmission.create({
          data: {
            organizationId: org.id,
            homeworkId: homework.id,
            studentId: member.studentId,
            status,
            submittedAt: status === 'GRADED' || status === 'LATE' ? addDays(today, -3) : null,
            score: status === 'GRADED' ? 7 + (index % 4) : null,
            markedByUserId: status === 'ASSIGNED' ? null : teachers[spec.teacher]!.user.id,
          },
        });
      }
    }

    for (const [index, member] of group.members.entries()) {
      for (const [gradeIndex, label] of ['Oraliq nazorat', 'Yakuniy test'].entries()) {
        await prisma.grade.create({
          data: {
            organizationId: org.id,
            studentId: member.studentId,
            groupId: group.id,
            teacherId: teachers[spec.teacher]!.member.id,
            scheme: 'POINTS_100',
            valueNumeric: 65 + ((index * 7 + gradeIndex * 11) % 30),
            maxValue: 100,
            title: label,
            gradedAt: addDays(today, gradeIndex === 0 ? -14 : -4),
          },
        });
        gradeCount += 1;
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
            organizationId: org.id,
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

        const isCurrent = period.y === year && period.m === month;
        const behaviour = isCurrent ? index % 3 : 0; // 0 = paid, 1 = partial, 2 = unpaid
        if (behaviour === 2) continue;

        const amount = behaviour === 1 ? group.monthlyFeeMinor / 2n : group.monthlyFeeMinor;
        await prisma.payment.create({
          data: {
            organizationId: org.id,
            studentId: member.studentId,
            groupId: group.id,
            invoiceId: invoice.id,
            amountMinor: amount,
            currency: UZS,
            paidAt: new Date(Date.UTC(period.y, period.m - 1, 3 + (index % 5))),
            method: index % 2 === 0 ? 'CASH' : 'CARD',
            receiptNo: `R-${period.y}${String(period.m).padStart(2, '0')}-${randomInt(1000, 9999)}`,
            createdByUserId: receptionUser.id,
          },
        });
        paymentCount += 1;

        if (behaviour === 0) {
          await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'PAID' } });
        }
      }
    }
  }

  // Last month's payroll and running costs, so the net figure is a real one.
  for (const teacher of teachers) {
    await prisma.salaryPayment.create({
      data: {
        organizationId: org.id,
        memberId: teacher.member.id,
        periodYear: prevYear,
        periodMonth: prevMonth,
        amountMinor: teacher.spec.salaryModel === 'FIXED' ? 6_500_000n : 5_200_000n,
        currency: UZS,
        model: teacher.spec.salaryModel,
        paidAt: new Date(Date.UTC(prevYear, prevMonth - 1, 28)),
      },
    });
  }
  await prisma.salaryPayment.create({
    data: {
      organizationId: org.id,
      memberId: receptionMember.id,
      periodYear: prevYear,
      periodMonth: prevMonth,
      amountMinor: 4_000_000n,
      currency: UZS,
      model: 'FIXED',
      paidAt: new Date(Date.UTC(prevYear, prevMonth - 1, 28)),
    },
  });

  for (const [category, title, amount] of [
    ['RENT', 'Ijara — oktabr', 8_000_000n],
    ['UTILITIES', 'Kommunal xizmatlar', 1_200_000n],
    ['MARKETING', 'Instagram reklama', 900_000n],
  ] as const) {
    await prisma.expense.create({
      data: {
        organizationId: org.id,
        category,
        title,
        amountMinor: amount,
        currency: UZS,
        spentAt: new Date(Date.UTC(year, month - 1, 8)),
        createdByUserId: ownerUser.id,
      },
    });
  }

  // ---------------------------------------------------------------- centre B
  // A second, unrelated centre. Nothing here should ever be visible from A.
  const otherOwner = await createUser({
    username: 'owner.aliyev',
    firstName: 'Bobur',
    lastName: 'Aliyev',
    email: 'boshqa@oquvmarkaz.uz',
    phone: '+998907776655',
  });
  await notificationDefaults(otherOwner.id);

  const orgB = await prisma.organization.create({
    data: {
      name: 'Zamon Math Center',
      slug: `zamon-${randomUUID().slice(0, 6)}`,
      city: 'Samarqand',
      phone: '+998662001030',
      defaultCurrency: UZS,
      timezone: TZ,
      members: { create: { userId: otherOwner.id, role: 'OWNER' } },
    },
    include: { members: true },
  });
  await prisma.subscription.create({
    data: {
      organizationId: orgB.id,
      plan: 'STANDARD',
      status: 'ACTIVE',
      subscriptionStartedAt: new Date(Date.now() - 20 * DAY),
      subscriptionEndsAt: new Date(Date.now() + 10 * DAY),
      lastPaymentAt: new Date(Date.now() - 20 * DAY),
      nextPaymentAt: new Date(Date.now() + 10 * DAY),
      amountMinor: 300_000n,
      currency: UZS,
    },
  });

  const otherStudent = await prisma.student.create({
    data: {
      organizationId: orgB.id,
      firstName: 'Sirli',
      lastName: 'Oquvchi',
      phone: '+998907770001',
      studentNo: '2026-0001',
      status: 'ACTIVE',
    },
  });

  const otherGroup = await prisma.group.create({
    data: {
      organizationId: orgB.id,
      name: 'Algebra 9-sinf',
      subject: 'Matematika',
      teacherId: orgB.members[0]!.id,
      monthlyFeeMinor: 400_000n,
      currency: UZS,
      weekdays: [2, 5],
      startTime: '16:00',
      endTime: '17:30',
      members: { create: { organizationId: orgB.id, studentId: otherStudent.id } },
    },
  });

  await prisma.invoice.create({
    data: {
      organizationId: orgB.id,
      studentId: otherStudent.id,
      groupId: otherGroup.id,
      periodYear: year,
      periodMonth: month,
      amountMinor: 400_000n,
      currency: UZS,
      dueDate: new Date(Date.UTC(year, month - 1, 5)),
    },
  });

  // ---------------------------------------------------------------- report
  const { printCredentials } = await import('../scripts/create-admin');
  printCredentials(admin.username, admin.password, admin.rotated);

  console.info(`
seed complete
-------------
Centre A: ${org.name}  (Toshkent)
  subscription: TRIAL, 18 days left of 30

  owner        owner.karimova
  reception    reception.tosheva
  teacher      teacher.saidova     (percentage salary)
  teacher      teacher.rustamov    (fixed salary)
  students     ${studentLogins.map((s) => s.username).join(', ')}

  password for every seeded centre account: ${DEMO_PASSWORD}

  courses ${courses.length}  groups ${groups.length}  students ${students.length}
  lessons ${lessonCount}  attendance ${attendanceCount}
  homework ${homeworkCount}  grades ${gradeCount}
  invoices ${invoiceCount}  payments ${paymentCount}

Centre B: ${orgB.name}  (Samarqand — used to verify tenant isolation)
  owner        owner.aliyev
  subscription: ACTIVE
`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
