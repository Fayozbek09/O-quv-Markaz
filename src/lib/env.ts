import { z } from 'zod';

/**
 * Server-only environment. Importing this from a Client Component is a build
 * error by design — secrets must never reach the browser bundle.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default('http://localhost:3000'),

  SESSION_SECRET: z.string().min(32),
  OTP_PEPPER: z.string().min(32),
  FILE_URL_SECRET: z.string().min(32),
  IP_HASH_SECRET: z.string().min(32),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage/uploads'),

  SMS_PROVIDER: z.enum(['console', 'eskiz', 'playmobile']).default('console'),
  EMAIL_PROVIDER: z.enum(['console', 'smtp', 'resend']).default('console'),

  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),

  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_WEBHOOK_SECRET: z.string().default(''),

  PAYMENT_PROVIDER: z.enum(['manual', 'payme', 'click']).default('manual'),
  PAYME_MERCHANT_ID: z.string().default(''),
  PAYME_SECRET_KEY: z.string().default(''),
  CLICK_MERCHANT_ID: z.string().default(''),
  CLICK_SECRET_KEY: z.string().default(''),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Print the offending keys only — never the values.
  const keys = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
  throw new Error(`Invalid environment configuration. Check: ${keys}`);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
export const telegramConfigured = Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET);
