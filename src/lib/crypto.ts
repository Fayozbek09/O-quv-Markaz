import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from './env';

export const sha256 = (input: string | Buffer) =>
  createHash('sha256').update(input).digest('hex');

export const hmac = (key: string, input: string) =>
  createHmac('sha256', key).update(input).digest('hex');

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** Constant-time string comparison that does not leak length via early exit. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Cryptographically uniform numeric code (no modulo bias). */
export function numericCode(digits = 6): string {
  const max = 10 ** digits;
  const limit = Math.floor(0xffffffff / max) * max;
  for (;;) {
    const n = randomBytes(4).readUInt32BE(0);
    if (n < limit) return String(n % max).padStart(digits, '0');
  }
}

/** IPs are personal data — store only a keyed pseudonym. */
export const hashIp = (ip: string | null | undefined) =>
  ip ? hmac(env.IP_HASH_SECRET, ip).slice(0, 64) : null;
