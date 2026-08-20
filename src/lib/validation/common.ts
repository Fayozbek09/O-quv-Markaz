import { z } from 'zod';

/**
 * Normalizes Uzbek and international phone input to E.164.
 *   "+998 90 123 45 67" / "998901234567" / "901234567" -> "+998901234567"
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, '');
  let value = digits.startsWith('+') ? digits.slice(1) : digits;
  if (/^00/.test(value)) value = value.slice(2);
  // Bare national Uzbek number (9 digits, operator code 33/88/9x...).
  if (/^\d{9}$/.test(value)) value = `998${value}`;
  if (!/^\d{8,15}$/.test(value)) return null;
  return `+${value}`;
}

export const phoneSchema = z
  .string()
  .trim()
  .min(6)
  .max(24)
  .transform((v, ctx) => {
    const normalized = normalizePhone(v);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'errors.invalidPhone' });
      return z.NEVER;
    }
    return normalized;
  });

export const optionalPhoneSchema = z
  .string()
  .trim()
  .max(24)
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const normalized = normalizePhone(v);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'errors.invalidPhone' });
      return z.NEVER;
    }
    return normalized;
  });

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(320)
  .pipe(z.email({ message: 'errors.invalidEmail' }));

export const optionalEmailSchema = z
  .string()
  .trim()
  .max(320)
  .optional()
  .transform((v) => (v ? v.toLowerCase() : null))
  .refine((v) => v === null || z.email().safeParse(v).success, { message: 'errors.invalidEmail' });

export const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, { message: 'auth.invalidCode' });

export const passwordSchema = z
  .string()
  .min(10, 'auth.passwordRules.tooShort')
  .max(200, 'auth.passwordRules.tooLong');

export const uuidSchema = z.uuid({ message: 'errors.notFound' });

export const localeSchema = z.enum(['uz', 'ru', 'en']);
export const dbLocaleSchema = z.enum(['UZ', 'RU', 'EN']);

/** C0/C1 control characters, which would corrupt CSV exports and log lines. */
const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]', 'g');

/**
 * Free text from users. Control characters are stripped; HTML is deliberately
 * NOT stripped here - React escapes on output and the value must round-trip
 * unchanged (a student may legitimately be recorded as `O'Brien <3`).
 */
export const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, 'errors.tooLong')
    .transform((v) => v.replace(CONTROL_CHARS, ''));

export const optionalText = (max: number) =>
  text(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null));

export const timezoneSchema = z
  .string()
  .max(64)
  .refine(
    (tz) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'errors.badRequest' },
  );

export const currencySchema = z.enum(['UZS', 'USD', 'RUB', 'EUR']);

export const hhmmSchema = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'errors.badRequest');

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'errors.invalidDate')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'errors.invalidDate');

/** Accepts "400000", "400 000", "400 000" (nbsp), "400'000", "1234.50". */
export const amountSchema = z
  .string()
  .trim()
  .max(24)
  .regex(new RegExp("^\\d[\\d\\s\\u00A0']*([.,]\\d{1,2})?$"), 'errors.invalidAmount');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  perPage: z.coerce.number().int().min(5).max(100).default(25),
});

export const weekdaysSchema = z.array(z.number().int().min(1).max(7)).max(7);
