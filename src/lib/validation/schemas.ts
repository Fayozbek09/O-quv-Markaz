import { z } from 'zod';
import {
  amountSchema, currencySchema, hhmmSchema, isoDateSchema, localeSchema,
  optionalEmailSchema, optionalPhoneSchema, optionalText, paginationSchema,
  passwordSchema, phoneSchema, emailSchema, otpCodeSchema, text, timezoneSchema,
  uuidSchema, weekdaysSchema,
} from './common';

/**
 * Every schema is a strict allow-list. `.strict()` rejects unknown keys, which
 * is the mass-assignment defence: a request cannot smuggle `organizationId`,
 * `role` or `id` into a create/update payload.
 */

// ------------------------------------------------------------------ auth
export const startPhoneAuthSchema = z.object({ phone: phoneSchema }).strict();
export const startEmailAuthSchema = z.object({ email: emailSchema }).strict();

export const verifyOtpSchema = z
  .object({
    identifier: z.string().trim().min(3).max(320),
    channel: z.enum(['SMS', 'EMAIL']),
    purpose: z.enum(['PHONE_VERIFY', 'EMAIL_VERIFY', 'PASSWORD_RESET']),
    code: otpCodeSchema,
  })
  .strict();

export const completeRegistrationSchema = z
  .object({
    identifier: z.string().trim().min(3).max(320),
    channel: z.enum(['SMS', 'EMAIL']),
    code: otpCodeSchema,
    password: passwordSchema,
    firstName: text(80).pipe(z.string().min(1, 'errors.required')),
    lastName: optionalText(80),
    locale: localeSchema.default('uz'),
  })
  .strict();

export const loginSchema = z
  .object({
    identifier: z.string().trim().min(3).max(320),
    password: z.string().min(1).max(200),
  })
  .strict();

export const forgotPasswordSchema = z
  .object({ identifier: z.string().trim().min(3).max(320) })
  .strict();

export const resetPasswordSchema = z
  .object({
    identifier: z.string().trim().min(3).max(320),
    channel: z.enum(['SMS', 'EMAIL']),
    code: otpCodeSchema,
    password: passwordSchema,
  })
  .strict();

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema })
  .strict();

export const deleteAccountSchema = z
  .object({ confirm: z.literal('DELETE'), password: z.string().max(200).optional() })
  .strict();

// ------------------------------------------------------------------ profile & workspace
export const updateProfileSchema = z
  .object({
    firstName: text(80).pipe(z.string().min(1, 'errors.required')),
    lastName: optionalText(80),
    bio: optionalText(1000),
    teachingSubject: optionalText(120),
    locale: localeSchema,
    timezone: timezoneSchema,
  })
  .strict();

export const workingHoursSchema = z
  .array(
    z.object({
      weekday: z.number().int().min(1).max(7),
      open: hhmmSchema,
      close: hhmmSchema,
      closed: z.boolean().default(false),
    }),
  )
  .max(7);

export const updateWorkspaceSchema = z
  .object({
    name: text(160).pipe(z.string().min(2, 'errors.required')),
    legalName: optionalText(200),
    address: optionalText(300),
    city: optionalText(80),
    district: optionalText(80),
    phone: optionalPhoneSchema,
    email: optionalEmailSchema,
    description: optionalText(2000),
    website: optionalText(200),
    instagram: optionalText(80),
    telegramHandle: optionalText(64),
    workingHours: workingHoursSchema.default([]),
    defaultCurrency: currencySchema,
    timezone: timezoneSchema,
    locale: localeSchema,
  })
  .strict();

export const onboardingSchema = z
  .object({
    firstName: text(80).pipe(z.string().min(1)),
    lastName: optionalText(80),
    teachingSubject: optionalText(120),
    workspaceName: text(160).pipe(z.string().min(2)),
    timezone: timezoneSchema.default('Asia/Tashkent'),
    currency: currencySchema.default('UZS'),
  })
  .strict();

// ------------------------------------------------------------------ students
export const studentInputSchema = z
  .object({
    firstName: text(80).pipe(z.string().min(1, 'errors.required')),
    lastName: optionalText(80),
    phone: optionalPhoneSchema,
    email: optionalEmailSchema,
    birthDate: isoDateSchema.optional().nullable(),
    notes: optionalText(2000),
    status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']).default('ACTIVE'),
    parentName: optionalText(160),
    parentPhone: optionalPhoneSchema,
    parentRelation: optionalText(40),
    address: optionalText(300),
    studentNo: optionalText(24),
  })
  .strict();

export const studentListQuerySchema = paginationSchema
  .extend({
    q: z.string().trim().max(120).optional(),
    status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED', 'ALL']).default('ACTIVE'),
    groupId: uuidSchema.optional(),
    sort: z.enum(['name', 'created', 'debt']).default('name'),
    dir: z.enum(['asc', 'desc']).default('asc'),
    debtOnly: z.coerce.boolean().default(false),
  })
  .strict();

export const csvImportRowSchema = z.object({
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().max(80).optional().default(''),
  phone: z.string().trim().max(24).optional().default(''),
  parent_name: z.string().trim().max(160).optional().default(''),
  parent_phone: z.string().trim().max(24).optional().default(''),
  notes: z.string().trim().max(2000).optional().default(''),
});

// ------------------------------------------------------------------ groups
export const groupInputSchema = z
  .object({
    name: text(120).pipe(z.string().min(1, 'errors.required')),
    subject: optionalText(120),
    courseId: uuidSchema.optional().nullable(),
    teacherId: uuidSchema.optional().nullable(),
    capacity: z.number().int().min(1).max(500).optional().nullable(),
    startDate: isoDateSchema.optional().nullable(),
    endDate: isoDateSchema.optional().nullable(),
    monthlyFee: amountSchema.default('0'),
    currency: currencySchema.default('UZS'),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#2563eb'),
    weekdays: weekdaysSchema.default([]),
    startTime: hhmmSchema.optional().nullable(),
    endTime: hhmmSchema.optional().nullable(),
    room: optionalText(80),
    status: z.enum(['ACTIVE', 'ARCHIVED']).default('ACTIVE'),
  })
  .strict()
  .refine((v) => !v.startTime || !v.endTime || v.startTime < v.endTime, {
    message: 'errors.badRequest',
    path: ['endTime'],
  });

export const groupMemberSchema = z
  .object({ studentId: uuidSchema, feeOverride: amountSchema.optional().nullable() })
  .strict();

export const generateLessonsSchema = z
  .object({ from: isoDateSchema, until: isoDateSchema })
  .strict()
  .refine((v) => v.from <= v.until, { message: 'errors.badRequest', path: ['until'] });

// ------------------------------------------------------------------ lessons
export const lessonInputSchema = z
  .object({
    groupId: uuidSchema,
    date: isoDateSchema,
    startTime: hhmmSchema,
    endTime: hhmmSchema,
    room: optionalText(80),
    topic: optionalText(200),
    teacherId: uuidSchema.optional().nullable(),
  })
  .strict()
  .refine((v) => v.startTime < v.endTime, { message: 'errors.badRequest', path: ['endTime'] });

export const lessonStatusSchema = z
  .object({
    status: z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED']),
    cancelReason: optionalText(300),
  })
  .strict();

export const calendarQuerySchema = z
  .object({ from: isoDateSchema, until: isoDateSchema, groupId: uuidSchema.optional() })
  .strict();

// ------------------------------------------------------------------ attendance
export const attendanceMarkSchema = z
  .object({
    lessonId: uuidSchema,
    entries: z
      .array(
        z.object({
          studentId: uuidSchema,
          status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']),
          minutesLate: z.number().int().min(0).max(600).optional().nullable(),
          note: optionalText(300),
        }),
      )
      .max(200),
  })
  .strict();

// ------------------------------------------------------------------ payments
export const paymentInputSchema = z
  .object({
    studentId: uuidSchema,
    groupId: uuidSchema.optional().nullable(),
    invoiceId: uuidSchema.optional().nullable(),
    amount: amountSchema,
    currency: currencySchema.default('UZS'),
    paidAt: isoDateSchema,
    method: z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'CLICK', 'PAYME', 'UZUM', 'OTHER']),
    note: optionalText(300),
    receiptNo: optionalText(40),
  })
  .strict();

export const paymentReverseSchema = z
  .object({ reason: text(300).pipe(z.string().min(3, 'errors.required')) })
  .strict();

export const paymentListQuerySchema = paginationSchema
  .extend({
    studentId: uuidSchema.optional(),
    groupId: uuidSchema.optional(),
    from: isoDateSchema.optional(),
    until: isoDateSchema.optional(),
    method: z
      .enum(['CASH', 'CARD', 'BANK_TRANSFER', 'CLICK', 'PAYME', 'UZUM', 'OTHER', 'ALL'])
      .default('ALL'),
  })
  .strict();

export const generateInvoicesSchema = z
  .object({
    year: z.number().int().min(2020).max(2100),
    month: z.number().int().min(1).max(12),
    groupId: uuidSchema.optional(),
    dueDay: z.number().int().min(1).max(28).default(5),
  })
  .strict();

export const debtQuerySchema = paginationSchema
  .extend({ overdueOnly: z.coerce.boolean().default(false), q: z.string().trim().max(120).optional() })
  .strict();

// ------------------------------------------------------------------ reports
export const reportQuerySchema = z
  .object({
    year: z.coerce.number().int().min(2020).max(2100),
    month: z.coerce.number().int().min(1).max(12),
    groupId: uuidSchema.optional(),
    // The export format is part of the query, so the strict schema has to know
    // about it - otherwise ?format=csv is rejected as an unknown key.
    format: z.enum(['json', 'csv']).default('json'),
  })
  .strict();

// ------------------------------------------------------------------ telegram
export const telegramSendReminderSchema = z
  .object({
    studentId: uuidSchema,
    template: z.enum(['DEBT', 'LESSON']),
    locale: localeSchema,
    confirm: z.literal(true),
  })
  .strict();

export const telegramLinkSchema = z
  .object({ targetType: z.enum(['TEACHER', 'PARENT']), studentId: uuidSchema.optional() })
  .strict();

// ------------------------------------------------------------------ notifications
export const notificationPrefSchema = z
  .object({
    prefs: z
      .array(
        z.object({
          type: z.enum(['LESSON_UPCOMING', 'ATTENDANCE_MISSED', 'PAYMENT_OVERDUE', 'MONTHLY_SUMMARY']),
          inApp: z.boolean(),
          telegram: z.boolean(),
          email: z.boolean(),
        }),
      )
      .max(20),
  })
  .strict();

// ------------------------------------------------------------------ billing
/**
 * There is one plan, so checkout takes no plan choice — only how many months
 * the centre wants to settle at once.
 */
export const startCheckoutSchema = z
  .object({ months: z.number().int().min(1).max(12).default(1) })
  .strict();

export const platformPricingSchema = z
  .object({
    monthlyPriceMinor: z.number().int().min(0).max(1_000_000_000),
    currency: currencySchema,
    trialDays: z.number().int().min(0).max(365),
    gracePeriodDays: z.number().int().min(0).max(90),
  })
  .strict();

/** Platform admin recording a payment that arrived outside a provider. */
export const adminManualPaymentSchema = z
  .object({
    amount: amountSchema,
    currency: currencySchema.default('UZS'),
    months: z.number().int().min(1).max(12).default(1),
    reference: text(160).pipe(z.string().min(3, 'errors.required')),
    paidAt: isoDateSchema,
  })
  .strict();

// ------------------------------------------------------------------ centre registration
/** Built-in course catalogue offered at registration; a centre may add its own. */
export const COURSE_CATALOG = [
  'english', 'ielts', 'russian', 'korean', 'turkish', 'arabic', 'chinese',
  'math', 'physics', 'chemistry', 'biology', 'history',
  'programming', 'robotics', 'design', 'sat', 'preschool', 'music', 'art',
] as const;

export const centerRegistrationSchema = z
  .object({
    // owner
    firstName: text(80).pipe(z.string().min(1, 'errors.required')),
    lastName: optionalText(80),
    // centre
    centerName: text(160).pipe(z.string().min(2, 'errors.required')),
    legalName: optionalText(200),
    phone: phoneSchema,
    email: optionalEmailSchema,
    address: optionalText(300),
    city: text(80).pipe(z.string().min(2, 'errors.required')),
    district: optionalText(80),
    description: optionalText(2000),
    telegramHandle: optionalText(64),
    instagram: optionalText(80),
    website: optionalText(200),
    workingHours: workingHoursSchema.default([]),
    courses: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
    timezone: timezoneSchema.default('Asia/Tashkent'),
    currency: currencySchema.default('UZS'),
  })
  .strict();

// ------------------------------------------------------------------ staff (teachers & receptionists)
export const staffPermissionsSchema = z.record(z.string().max(60), z.boolean());

export const createStaffSchema = z
  .object({
    firstName: text(80).pipe(z.string().min(1, 'errors.required')),
    lastName: optionalText(80),
    role: z.enum(['ADMIN', 'RECEPTIONIST', 'TEACHER']),
    phone: optionalPhoneSchema,
    email: optionalEmailSchema,
    username: z.string().trim().max(48).optional().nullable(),
    subject: optionalText(120),
    specialization: optionalText(160),
    hireDate: isoDateSchema.optional().nullable(),
    salaryModel: z.enum(['FIXED', 'PER_LESSON', 'PERCENTAGE', 'MIXED']).default('FIXED'),
    salaryAmount: amountSchema.default('0'),
    salaryPercent: z.number().min(0).max(100).default(0),
    permissions: staffPermissionsSchema.default({}),
    locale: localeSchema.default('uz'),
  })
  .strict();

export const updateStaffSchema = z
  .object({
    firstName: text(80).pipe(z.string().min(1, 'errors.required')),
    lastName: optionalText(80),
    phone: optionalPhoneSchema,
    email: optionalEmailSchema,
    subject: optionalText(120),
    specialization: optionalText(160),
    hireDate: isoDateSchema.optional().nullable(),
    status: z.enum(['ACTIVE', 'ON_LEAVE', 'INACTIVE']).default('ACTIVE'),
    permissions: staffPermissionsSchema.default({}),
  })
  .strict();

/** Salary edits are a separate, separately-permissioned payload. */
export const updateSalarySchema = z
  .object({
    salaryModel: z.enum(['FIXED', 'PER_LESSON', 'PERCENTAGE', 'MIXED']),
    salaryAmount: amountSchema.default('0'),
    salaryPercent: z.number().min(0).max(100).default(0),
  })
  .strict();

export const staffRoleSchema = z.object({ role: z.enum(['ADMIN', 'RECEPTIONIST', 'TEACHER']) }).strict();

/** Issues (or re-issues) portal credentials for a student or staff member. */
export const issueCredentialsSchema = z
  .object({ username: z.string().trim().max(48).optional().nullable() })
  .strict();

// ------------------------------------------------------------------ courses
export const courseInputSchema = z
  .object({
    name: text(120).pipe(z.string().min(1, 'errors.required')),
    catalogKey: z.string().trim().max(40).optional().nullable(),
    description: optionalText(1000),
    defaultFee: amountSchema.default('0'),
    currency: currencySchema.default('UZS'),
    durationMonths: z.number().int().min(1).max(60).optional().nullable(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#2563eb'),
    isActive: z.boolean().default(true),
  })
  .strict();

// ------------------------------------------------------------- announcements
export const announcementInputSchema = z
  .object({
    title: text(160).pipe(z.string().min(1, 'errors.required')),
    body: text(4000).pipe(z.string().min(1, 'errors.required')),
    audience: z.enum(['EVERYONE', 'STAFF', 'TEACHERS', 'STUDENTS', 'GROUP']).default('EVERYONE'),
    /** Honoured only when the audience is GROUP; ignored otherwise. */
    groupId: uuidSchema.optional().nullable(),
    expiresAt: z
      .string()
      .trim()
      .max(40)
      .refine((v) => !Number.isNaN(Date.parse(v)), 'errors.invalidDate')
      .optional()
      .nullable(),
    pinned: z.boolean().default(false),
  })
  .strict();

// ------------------------------------------------------------------ homework
export const homeworkInputSchema = z
  .object({
    groupId: uuidSchema,
    title: text(200).pipe(z.string().min(1, 'errors.required')),
    description: optionalText(4000),
    dueAt: z.string().trim().max(40).refine((v) => !Number.isNaN(Date.parse(v)), 'errors.invalidDate'),
    status: z.enum(['DRAFT', 'PUBLISHED', 'CLOSED']).default('PUBLISHED'),
    maxScore: z.number().int().min(1).max(1000).optional().nullable(),
    fileIds: z.array(uuidSchema).max(10).default([]),
  })
  .strict();

export const homeworkListQuerySchema = paginationSchema
  .extend({
    groupId: uuidSchema.optional(),
    status: z.enum(['DRAFT', 'PUBLISHED', 'CLOSED', 'ALL']).default('ALL'),
  })
  .strict();

export const submissionMarkSchema = z
  .object({
    entries: z
      .array(
        z.object({
          studentId: uuidSchema,
          status: z.enum(['ASSIGNED', 'SUBMITTED', 'LATE', 'MISSING', 'GRADED']),
          score: z.number().int().min(0).max(1000).optional().nullable(),
          feedback: optionalText(2000),
        }),
      )
      .max(200),
  })
  .strict();

export const studentSubmitSchema = z
  .object({ note: optionalText(2000), fileId: uuidSchema.optional().nullable() })
  .strict();

// ------------------------------------------------------------------ grades
export const gradeInputSchema = z
  .object({
    studentId: uuidSchema,
    groupId: uuidSchema.optional().nullable(),
    lessonId: uuidSchema.optional().nullable(),
    homeworkId: uuidSchema.optional().nullable(),
    scheme: z.enum(['POINTS_100', 'POINTS_5', 'LETTER']).default('POINTS_100'),
    valueNumeric: z.number().int().min(0).max(1000).optional().nullable(),
    valueLetter: z.string().trim().max(4).optional().nullable(),
    maxValue: z.number().int().min(1).max(1000).optional().nullable(),
    title: optionalText(160),
    comment: optionalText(1000),
    gradedAt: isoDateSchema.optional().nullable(),
  })
  .strict();

export const gradeBulkSchema = z
  .object({
    groupId: uuidSchema,
    scheme: z.enum(['POINTS_100', 'POINTS_5', 'LETTER']).default('POINTS_100'),
    title: optionalText(160),
    gradedAt: isoDateSchema.optional().nullable(),
    entries: z
      .array(
        z.object({
          studentId: uuidSchema,
          valueNumeric: z.number().int().min(0).max(1000).optional().nullable(),
          valueLetter: z.string().trim().max(4).optional().nullable(),
          comment: optionalText(1000),
        }),
      )
      .max(200),
  })
  .strict();

export const gradeListQuerySchema = paginationSchema
  .extend({ studentId: uuidSchema.optional(), groupId: uuidSchema.optional() })
  .strict();

// ------------------------------------------------------------------ payroll & expenses
export const salaryPaymentSchema = z
  .object({
    memberId: uuidSchema,
    year: z.number().int().min(2020).max(2100),
    month: z.number().int().min(1).max(12),
    amount: amountSchema,
    currency: currencySchema.default('UZS'),
    paidAt: isoDateSchema,
    note: optionalText(300),
  })
  .strict();

export const salaryQuerySchema = z
  .object({
    year: z.coerce.number().int().min(2020).max(2100),
    month: z.coerce.number().int().min(1).max(12),
    memberId: uuidSchema.optional(),
  })
  .strict();

export const expenseInputSchema = z
  .object({
    category: z.enum(['RENT', 'UTILITIES', 'SALARY', 'MARKETING', 'EQUIPMENT', 'TAX', 'OTHER']),
    title: text(200).pipe(z.string().min(1, 'errors.required')),
    amount: amountSchema,
    currency: currencySchema.default('UZS'),
    spentAt: isoDateSchema,
    note: optionalText(300),
  })
  .strict();

export const financeQuerySchema = z
  .object({
    year: z.coerce.number().int().min(2020).max(2100),
    month: z.coerce.number().int().min(1).max(12).optional(),
    format: z.enum(['json', 'csv']).default('json'),
  })
  .strict();

// ------------------------------------------------------------------ platform administration
export const adminLoginSchema = z
  .object({
    username: z.string().trim().min(3).max(64),
    password: z.string().min(1).max(200),
  })
  .strict();

export const adminCenterCreateSchema = z
  .object({
    centerName: text(160).pipe(z.string().min(2, 'errors.required')),
    city: text(80).pipe(z.string().min(2, 'errors.required')),
    district: optionalText(80),
    phone: phoneSchema,
    email: optionalEmailSchema,
    address: optionalText(300),
    ownerFirstName: text(80).pipe(z.string().min(1, 'errors.required')),
    ownerLastName: optionalText(80),
    ownerUsername: z.string().trim().max(48).optional().nullable(),
    courses: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
    timezone: timezoneSchema.default('Asia/Tashkent'),
    currency: currencySchema.default('UZS'),
  })
  .strict();

export const adminCenterUpdateSchema = z
  .object({
    name: text(160).pipe(z.string().min(2, 'errors.required')),
    legalName: optionalText(200),
    phone: optionalPhoneSchema,
    email: optionalEmailSchema,
    address: optionalText(300),
    city: optionalText(80),
    district: optionalText(80),
    description: optionalText(2000),
  })
  .strict();

export const adminSuspendSchema = z
  .object({ reason: text(300).pipe(z.string().min(3, 'errors.required')) })
  .strict();

export const adminDeleteCenterSchema = z
  .object({ confirm: z.literal('DELETE'), reason: text(300).pipe(z.string().min(3, 'errors.required')) })
  .strict();

export const adminImpersonateSchema = z
  .object({ organizationId: uuidSchema, reason: text(300).pipe(z.string().min(3, 'errors.required')) })
  .strict();

export const adminAuditQuerySchema = paginationSchema
  .extend({
    organizationId: uuidSchema.optional(),
    action: z.string().trim().max(80).optional(),
    overridesOnly: z.coerce.boolean().default(false),
  })
  .strict();

export const adminCenterQuerySchema = paginationSchema
  .extend({
    q: z.string().trim().max(120).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'ALL']).default('ALL'),
  })
  .strict();
