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

export const updateWorkspaceSchema = z
  .object({
    name: text(160).pipe(z.string().min(2, 'errors.required')),
    address: optionalText(300),
    phone: optionalPhoneSchema,
    telegramHandle: optionalText(64),
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
    teacherId: uuidSchema.optional().nullable(),
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
export const startCheckoutSchema = z.object({ plan: z.enum(['PRO', 'ANNUAL']) }).strict();
