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
  /** Eskiz.uz account e-mail and password, plus the approved sender nickname. */
  ESKIZ_EMAIL: z.string().default(''),
  ESKIZ_PASSWORD: z.string().default(''),
  ESKIZ_FROM: z.string().default('4546'),
  /** Play Mobile credentials, if that gateway is used instead. */
  PLAYMOBILE_LOGIN: z.string().default(''),
  PLAYMOBILE_PASSWORD: z.string().default(''),
  PLAYMOBILE_ORIGINATOR: z.string().default('3700'),

  EMAIL_PROVIDER: z.enum(['console', 'smtp', 'resend']).default('console'),

  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),

  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_WEBHOOK_SECRET: z.string().default(''),

  /**
   * Human-verification challenge on registration and password reset. `none`
   * keeps rate limiting as the only defence, which is a supported way to run.
   */
  /**
   * Bearer token the scheduled subscription job must present. Set by the host
   * (Vercel injects it automatically into its cron requests). Empty means the
   * HTTP cron route is switched off entirely rather than left open.
   */
  CRON_SECRET: z.string().default(''),

  CAPTCHA_PROVIDER: z.enum(['none', 'turnstile', 'hcaptcha', 'recaptcha']).default('none'),
  CAPTCHA_SITE_KEY: z.string().default(''),
  CAPTCHA_SECRET_KEY: z.string().default(''),

  PAYMENT_PROVIDER: z.enum(['manual', 'payme', 'click']).default('manual'),
  PAYME_MERCHANT_ID: z.string().default(''),
  PAYME_SECRET_KEY: z.string().default(''),
  CLICK_MERCHANT_ID: z.string().default(''),
  CLICK_SECRET_KEY: z.string().default(''),
});

/**
 * An unset variable and an empty one are the same thing.
 *
 * Zod applies `.default()` only when a key is `undefined`, but a deployment
 * platform hands over `SMS_PROVIDER=""` for a field the operator left blank in
 * its form — and an empty string is not a member of the enum, so the process
 * refuses to start with a validation error naming a variable nobody meant to
 * set. Vercel does this when it reads `.env.example` to prefill its
 * environment editor, which is the normal way to import a project.
 *
 * Stripping empty values before parsing makes "left blank" mean "use the
 * default", which is what an operator staring at an empty form field expects.
 * Genuinely required variables are unaffected: an empty DATABASE_URL was an
 * error before and is still an error, just a clearer one.
 */
function withoutEmpty(source: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value.trim() === '') continue;
    out[key] = value;
  }
  return out;
}

const parsed = schema.safeParse(withoutEmpty(process.env));

if (!parsed.success) {
  // Print the offending keys only — never the values.
  const keys = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
  throw new Error(`Invalid environment configuration. Check: ${keys}`);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';

/**
 * Production preflight.
 *
 * The schema above says a value is *present*. This says it is *fit to serve
 * real people's data*, and it runs only in production so development keeps its
 * conveniences. Every one of these has a way of surviving to launch unnoticed:
 * a session secret copied from the example file signs valid cookies, a console
 * SMS provider accepts a registration and prints the code to a log nobody
 * reads, and `PAYMENT_PROVIDER=payme` with no key answers every merchant call
 * with "insufficient privileges" — each looks like it works until it matters.
 *
 * Failing at boot is the point: a process that will not start is a deployment
 * that gets fixed, while a process that starts wrong is an incident.
 */
export type PreflightProblem = { key: string; problem: string };

/** Any secret containing one of these was copied from an example, not generated. */
const PLACEHOLDER_MARKERS = [
  'dev_only',
  'change_me',
  'changeme',
  'example',
  'placeholder',
  'test_secret',
  'your-secret',
  'xxxxxx',
];

const SECRET_KEYS = ['SESSION_SECRET', 'OTP_PEPPER', 'FILE_URL_SECRET', 'IP_HASH_SECRET'] as const;

export function productionPreflight(
  source: typeof env = env,
): PreflightProblem[] {
  const problems: PreflightProblem[] = [];
  const add = (key: string, problem: string) => problems.push({ key, problem });

  for (const key of SECRET_KEYS) {
    const value = source[key];
    const lowered = value.toLowerCase();
    if (PLACEHOLDER_MARKERS.some((marker) => lowered.includes(marker))) {
      add(key, 'looks like the value from .env.example — generate one with `openssl rand -hex 32`');
    }
    if (new Set(value).size < 12) {
      add(key, 'has too little variety to be a generated secret');
    }
  }

  // Two secrets sharing a value means one compromise is two.
  const seen = new Map<string, string>();
  for (const key of SECRET_KEYS) {
    const previous = seen.get(source[key]);
    if (previous) add(key, `is the same value as ${previous}; each secret must be independent`);
    else seen.set(source[key], key);
  }

  if (!source.APP_URL.startsWith('https://')) {
    add('APP_URL', 'must be https in production — session cookies are `__Host-` and Secure');
  }
  if (/localhost|127\.0\.0\.1/.test(source.APP_URL)) {
    add('APP_URL', 'still points at localhost');
  }

  if (source.SMS_PROVIDER === 'console') {
    add('SMS_PROVIDER', 'is `console`: verification codes would be printed to the log, not sent');
  }
  if (source.SMS_PROVIDER === 'eskiz' && !(source.ESKIZ_EMAIL && source.ESKIZ_PASSWORD)) {
    add('ESKIZ_EMAIL/ESKIZ_PASSWORD', 'are required when SMS_PROVIDER=eskiz');
  }
  if (
    source.SMS_PROVIDER === 'playmobile' &&
    !(source.PLAYMOBILE_LOGIN && source.PLAYMOBILE_PASSWORD)
  ) {
    add('PLAYMOBILE_LOGIN/PLAYMOBILE_PASSWORD', 'are required when SMS_PROVIDER=playmobile');
  }

  if (source.EMAIL_PROVIDER === 'console') {
    add('EMAIL_PROVIDER', 'is `console`: e-mail codes would be printed to the log, not sent');
  }

  if (source.PAYMENT_PROVIDER === 'payme' && !(source.PAYME_MERCHANT_ID && source.PAYME_SECRET_KEY)) {
    add('PAYME_MERCHANT_ID/PAYME_SECRET_KEY', 'are required when PAYMENT_PROVIDER=payme');
  }
  if (source.PAYMENT_PROVIDER === 'click' && !(source.CLICK_MERCHANT_ID && source.CLICK_SECRET_KEY)) {
    add('CLICK_MERCHANT_ID/CLICK_SECRET_KEY', 'are required when PAYMENT_PROVIDER=click');
  }

  if (
    source.CAPTCHA_PROVIDER !== 'none' &&
    !(source.CAPTCHA_SITE_KEY && source.CAPTCHA_SECRET_KEY)
  ) {
    add('CAPTCHA_SITE_KEY/CAPTCHA_SECRET_KEY', 'are required once CAPTCHA_PROVIDER is set');
  }

  if (source.TELEGRAM_BOT_TOKEN && !source.TELEGRAM_WEBHOOK_SECRET) {
    add('TELEGRAM_WEBHOOK_SECRET', 'is required once a bot token is set, or the webhook is open');
  }

  return problems;
}

/**
 * `PAYMENT_PROVIDER=manual` is a legitimate way to launch — a centre pays by
 * transfer and the platform admin records it — so it is a warning rather than
 * a refusal. It is listed separately so the deploy log says so out loud
 * instead of leaving an operator to discover it from a customer.
 */
export function productionWarnings(source: typeof env = env): PreflightProblem[] {
  const warnings: PreflightProblem[] = [];
  if (source.PAYMENT_PROVIDER === 'manual') {
    warnings.push({
      key: 'PAYMENT_PROVIDER',
      problem: 'is `manual`: no online payment can complete; subscriptions renew only when a platform admin records an offline payment',
    });
  }
  if (!source.TELEGRAM_BOT_TOKEN) {
    warnings.push({ key: 'TELEGRAM_BOT_TOKEN', problem: 'is unset: Telegram reminders are disabled' });
  }
  if (source.CAPTCHA_PROVIDER === 'none') {
    warnings.push({
      key: 'CAPTCHA_PROVIDER',
      problem: 'is `none`: registration and password reset are rate limited but not challenged, so a distributed attempt can still run up an SMS bill',
    });
  }
  if (source.STORAGE_DRIVER === 'local') {
    warnings.push({
      key: 'STORAGE_DRIVER',
      problem: 'is `local`: uploads live on this machine\'s disk and are lost if it is replaced',
    });
  }
  return warnings;
}

/**
 * Compiling is not serving.
 *
 * `next build` runs with NODE_ENV=production, and a build machine legitimately
 * has no production secrets — CI should not need the session key to produce a
 * bundle. Running the preflight there turns a correct check into a broken
 * pipeline, so it is skipped during the build phase and runs when the server
 * actually starts (see instrumentation.ts, which calls it explicitly at boot
 * rather than waiting for the first request to a route that happens to import
 * this module).
 */
const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';

export function assertProductionEnvironment(): void {
  const problems = productionPreflight();
  if (problems.length > 0) {
    // Keys and reasons only. A value is never printed, even a bad one.
    const lines = problems.map((p) => `  - ${p.key} ${p.problem}`).join('\n');
    throw new Error(
      `Refusing to start: ${problems.length} production configuration problem(s).\n${lines}\n` +
        'See DEPLOYMENT.md. SKIP_ENV_PREFLIGHT=1 exists for the test harnesses, ' +
        'which run the production build against test configuration on purpose. ' +
        'Setting it on a server that faces real people defeats the check.',
    );
  }
  for (const warning of productionWarnings()) {
    console.warn(`[preflight] ${warning.key} ${warning.problem}`);
  }
}

/** True when the preflight should run: serving, in production, not opted out. */
export const preflightApplies =
  isProd && !isBuildPhase && process.env.SKIP_ENV_PREFLIGHT !== '1';
export const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
export const telegramConfigured = Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET);
