import { prisma } from '../db';
import { TooManyRequests } from '../errors';
import { sha256 } from '../crypto';

export type RateRule = { limit: number; windowMs: number };

/**
 * Named limits. Anything that can be brute-forced or abused for cost gets one.
 * Counters live in Postgres so limits hold across processes and restarts.
 */
export const RATE_RULES = {
  'otp:request:identifier': { limit: 3, windowMs: 15 * 60_000 },
  'otp:request:ip': { limit: 10, windowMs: 15 * 60_000 },
  'otp:verify:identifier': { limit: 8, windowMs: 15 * 60_000 },
  'auth:login:identifier': { limit: 8, windowMs: 15 * 60_000 },
  'auth:login:ip': { limit: 30, windowMs: 15 * 60_000 },
  'auth:reset:identifier': { limit: 3, windowMs: 60 * 60_000 },
  'auth:register:ip': { limit: 10, windowMs: 60 * 60_000 },
  'telegram:send:org': { limit: 60, windowMs: 60 * 60_000 },
  'telegram:send:student': { limit: 2, windowMs: 24 * 60 * 60_000 },
  'upload:org': { limit: 60, windowMs: 60 * 60_000 },
  'api:write:user': { limit: 300, windowMs: 60_000 },
  'billing:intent:org': { limit: 10, windowMs: 60 * 60_000 },
} as const satisfies Record<string, RateRule>;

export type RateRuleName = keyof typeof RATE_RULES;

export type RateResult = { ok: boolean; remaining: number; retryAfterSec: number };

/**
 * Fixed-window counter. The unique key is (rule + subject + window index), so
 * concurrent requests collide on the primary key and increment atomically —
 * there is no read-then-write race to exploit.
 */
export async function consume(rule: RateRuleName, subject: string): Promise<RateResult> {
  const { limit, windowMs } = RATE_RULES[rule];
  const now = Date.now();
  const windowIndex = Math.floor(now / windowMs);
  const windowStart = new Date(windowIndex * windowMs);
  const expiresAt = new Date(windowIndex * windowMs + windowMs);
  // Hash the subject: it is often a phone number or email.
  const key = `${rule}:${sha256(subject).slice(0, 40)}:${windowIndex}`;

  const row = await prisma.rateLimitCounter.upsert({
    where: { key },
    create: { key, count: 1, windowStart, expiresAt },
    update: { count: { increment: 1 } },
  });

  const retryAfterSec = Math.max(1, Math.ceil((expiresAt.getTime() - now) / 1000));
  return { ok: row.count <= limit, remaining: Math.max(0, limit - row.count), retryAfterSec };
}

/** Consume and throw a 429 when the bucket is empty. */
export async function enforce(rule: RateRuleName, subject: string): Promise<void> {
  const result = await consume(rule, subject);
  if (!result.ok) {
    throw TooManyRequests('errors.tooManyRequests', { retryAfterSec: result.retryAfterSec });
  }
}

/** Enforce several buckets (e.g. per-identifier AND per-IP) in one call. */
export async function enforceAll(pairs: Array<[RateRuleName, string | null | undefined]>) {
  for (const [rule, subject] of pairs) {
    if (subject) await enforce(rule, subject);
  }
}

export async function purgeExpiredRateLimits() {
  await prisma.rateLimitCounter.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}
