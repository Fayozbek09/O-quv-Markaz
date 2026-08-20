import { hash, verify } from '@node-rs/argon2';
import { prisma } from '../db';
import { env } from '../env';
import { numericCode } from '../crypto';
import { enforceAll } from '../security/rate-limit';
import { sms, email } from '../notifications/senders';
import { createTranslator } from '../i18n';
import type { AppLocale } from '../i18n/config';
import type { OtpChannel, OtpPurpose } from '@/generated/prisma/enums';

export const OTP_TTL_MS = 5 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;

// A 6-digit code has only ~20 bits of entropy, so it is peppered with a
// server-side secret and hashed with the same Argon2id parameters as passwords.
// A database dump alone does not yield usable codes.
const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;
const peppered = (code: string, identifier: string) =>
  `${env.OTP_PEPPER}:${identifier}:${code}`;

export type OtpRequestResult = { sent: true; expiresAt: Date; devCode?: string };

/**
 * Issues a one-time code. Any previously outstanding code for the same
 * (identifier, purpose) is consumed first, so only the newest code is valid.
 */
export async function requestOtp(opts: {
  identifier: string;
  channel: OtpChannel;
  purpose: OtpPurpose;
  ip?: string | null;
  locale?: AppLocale;
}): Promise<OtpRequestResult> {
  const { identifier, channel, purpose, ip, locale = 'uz' } = opts;

  await enforceAll([
    ['otp:request:identifier', `${purpose}:${identifier}`],
    ['otp:request:ip', ip ?? undefined],
  ]);

  await prisma.otpCode.updateMany({
    where: { identifier, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const code = numericCode(6);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await prisma.otpCode.create({
    data: {
      identifier,
      channel,
      purpose,
      codeHash: await hash(peppered(code, identifier), ARGON_OPTS),
      maxAttempts: OTP_MAX_ATTEMPTS,
      expiresAt,
    },
  });

  const t = createTranslator(locale);
  const body = `${t('app.name')}: ${code}\n${t('auth.verifyTitle')}`;
  if (channel === 'SMS') await sms.send(identifier, body);
  else await email.send(identifier, `${t('app.name')} — ${t('auth.code')}`, body);

  // Development convenience only; never returned when NODE_ENV=production.
  return env.NODE_ENV === 'production' ? { sent: true, expiresAt } : { sent: true, expiresAt, devCode: code };
}

export type OtpVerdict = 'ok' | 'invalid' | 'expired' | 'used' | 'locked';

/**
 * Verifies and atomically consumes a code. A code is single-use: the row is
 * marked consumed inside the same transaction that validates it, so a replay
 * or a concurrent double-submit cannot both succeed.
 */
export async function verifyOtp(opts: {
  identifier: string;
  purpose: OtpPurpose;
  code: string;
  ip?: string | null;
}): Promise<OtpVerdict> {
  const { identifier, purpose, code, ip } = opts;

  await enforceAll([
    ['otp:verify:identifier', `${purpose}:${identifier}`],
    ['otp:request:ip', ip ?? undefined],
  ]);

  const row = await prisma.otpCode.findFirst({
    where: { identifier, purpose },
    orderBy: { createdAt: 'desc' },
  });

  if (!row) return 'invalid';
  if (row.consumedAt) return 'used';
  if (row.expiresAt < new Date()) return 'expired';
  if (row.attempts >= row.maxAttempts) return 'locked';

  const matches = await verify(row.codeHash, peppered(code, identifier), ARGON_OPTS).catch(() => false);

  if (!matches) {
    await prisma.otpCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    return 'invalid';
  }

  // Consume under a guard on consumedAt so only one concurrent request wins.
  const consumed = await prisma.otpCode.updateMany({
    where: { id: row.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  return consumed.count === 1 ? 'ok' : 'used';
}

/** Verifies without consuming — used to re-check a code during registration. */
export async function peekOtpValid(identifier: string, purpose: OtpPurpose, code: string) {
  const row = await prisma.otpCode.findFirst({
    where: { identifier, purpose },
    orderBy: { createdAt: 'desc' },
  });
  if (!row || row.expiresAt < new Date() || row.attempts >= row.maxAttempts) return false;
  return verify(row.codeHash, peppered(code, identifier), ARGON_OPTS).catch(() => false);
}

export async function purgeExpiredOtps() {
  await prisma.otpCode.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) } },
  });
}
