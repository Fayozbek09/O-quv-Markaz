import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238), the second factor for the platform administrator.
 *
 * Written out rather than pulled in: the algorithm is thirty lines, and the
 * account it guards holds every centre's data — a dependency in that path is a
 * supply-chain question it does not need to answer.
 *
 * SHA-1 is not a choice made here. Every authenticator app — Google
 * Authenticator, Authy, 1Password, Aegis — implements RFC 6238's default, and
 * an implementation that used SHA-256 would simply refuse to pair with them.
 * TOTP does not rely on collision resistance; it relies on HMAC with a secret
 * the attacker does not have.
 */
const DIGITS = 6;
const PERIOD_SECONDS = 30;

/**
 * How far out of step a clock may be. One step either side is the usual
 * allowance: it covers a phone a few seconds fast without widening the window
 * an attacker gets to guess in.
 */
const DRIFT_STEPS = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** A 160-bit secret, in the base32 an authenticator app expects. */
export function generateTotpSecret(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('invalid_base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The code for one time step. */
export function totpAt(secret: string, step: number): string {
  const key = base32Decode(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));

  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export const currentStep = (at: Date = new Date()) =>
  Math.floor(at.getTime() / 1000 / PERIOD_SECONDS);

/**
 * Verifies a code, returning the step it matched so the caller can refuse to
 * accept that same step twice.
 *
 * Replay is the failure people forget: a code stays valid for thirty seconds,
 * so one read over someone's shoulder — or one phished code — is reusable
 * within that window unless the step is burned. The caller records the returned
 * step; see `platform_admins.totpLastStep`.
 */
export function verifyTotp(
  secret: string,
  code: string,
  options: { at?: Date; lastUsedStep?: number | null } = {},
): { ok: false } | { ok: true; step: number } {
  const candidate = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(candidate)) return { ok: false };

  const now = currentStep(options.at);
  for (let drift = -DRIFT_STEPS; drift <= DRIFT_STEPS; drift += 1) {
    const step = now + drift;
    if (options.lastUsedStep != null && step <= options.lastUsedStep) continue;

    const expected = totpAt(secret, step);
    // Both are six ASCII digits, so the buffers are equal length by construction.
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(candidate))) {
      return { ok: true, step };
    }
  }
  return { ok: false };
}

/**
 * The `otpauth://` URI an authenticator app scans.
 *
 * The secret is in this string, so it belongs on the enrolment screen and
 * nowhere else — never in a log, never in an audit row.
 */
export function totpUri(secret: string, account: string, issuer = "O'quv Markaz"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Recovery codes, for the phone that is lost or wiped. Without them, losing the
 * authenticator means losing the platform account, and the only way back is a
 * shell on the server.
 */
export function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const raw = randomBytes(5).toString('hex').toUpperCase(); // 10 chars
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}
