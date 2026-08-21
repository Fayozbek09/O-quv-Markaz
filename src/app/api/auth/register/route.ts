import { z } from 'zod';
import { headers } from 'next/headers';
import { prisma } from '@/lib/db';
import { json, publicRoute, readJson } from '@/lib/api';
import { startEmailAuthSchema, startPhoneAuthSchema, completeRegistrationSchema } from '@/lib/validation/schemas';
import { requestOtp, verifyOtp } from '@/lib/auth/otp';
import { hashPassword, passwordIssues } from '@/lib/auth/password';
import { createSession, clientIp } from '@/lib/auth/session';
import { audit } from '@/lib/security/audit';
import { enforce } from '@/lib/security/rate-limit';
import { verifyChallenge } from '@/lib/security/challenge';
import { BadRequest, Conflict } from '@/lib/errors';
import { getLocale } from '@/lib/i18n/server';
import { DB_LOCALE } from '@/lib/i18n/config';

const startSchema = z.union([startPhoneAuthSchema, startEmailAuthSchema]);

/** Step 1 - ask for a verification code. */
export const POST = publicRoute(async (request: Request) => {
  const hdrs = await headers();
  const ip = clientIp(hdrs);
  await enforce('auth:register:ip', ip ?? 'unknown');

  const body = await readJson(request, startSchema);

  // Rate limiting bounds one IP; it does not bound a thousand. This step sends
  // an SMS, and an SMS has a price.
  const challenge = await verifyChallenge(body.captchaToken, ip);
  if (!challenge.ok) {
    await audit({
      action: 'auth.register.challenge_failed',
      outcome: 'denied',
      meta: { reason: challenge.reason },
    });
    throw BadRequest('errors.challengeFailed');
  }

  const isPhone = 'phone' in body;
  const identifier = isPhone ? body.phone : body.email;

  const existing = await prisma.user.findFirst({
    where: isPhone ? { phone: identifier } : { email: identifier },
  });
  // An account that already exists still gets the same response shape, so this
  // endpoint cannot be used to enumerate registered phone numbers.
  if (existing && !existing.deletedAt) {
    await audit({ action: 'auth.register.duplicate', outcome: 'denied', entityType: 'user' });
    throw Conflict('auth.accountExists');
  }

  const result = await requestOtp({
    identifier,
    channel: isPhone ? 'SMS' : 'EMAIL',
    purpose: isPhone ? 'PHONE_VERIFY' : 'EMAIL_VERIFY',
    ip,
    locale: await getLocale(),
  });

  return json({ sent: true, expiresAt: result.expiresAt, devCode: result.devCode });
});

/** Step 2 - verify the code, create the account, start a session. */
export const PUT = publicRoute(async (request: Request) => {
  const hdrs = await headers();
  const ip = clientIp(hdrs);
  const body = await readJson(request, completeRegistrationSchema);

  const issues = passwordIssues(body.password);
  if (issues.length > 0) throw BadRequest(issues[0]);

  const purpose = body.channel === 'SMS' ? 'PHONE_VERIFY' : 'EMAIL_VERIFY';
  const verdict = await verifyOtp({ identifier: body.identifier, purpose, code: body.code, ip });
  if (verdict !== 'ok') {
    await audit({ action: 'auth.register.otp_failed', outcome: 'failure', meta: { verdict } });
    throw BadRequest('auth.invalidCode');
  }

  const isPhone = body.channel === 'SMS';
  const duplicate = await prisma.user.findFirst({
    where: isPhone ? { phone: body.identifier } : { email: body.identifier },
  });
  if (duplicate && !duplicate.deletedAt) throw Conflict('auth.accountExists');

  const user = await prisma.user.create({
    data: {
      phone: isPhone ? body.identifier : null,
      phoneVerified: isPhone ? new Date() : null,
      email: isPhone ? null : body.identifier,
      emailVerified: isPhone ? null : new Date(),
      passwordHash: await hashPassword(body.password),
      profile: {
        create: {
          firstName: body.firstName,
          lastName: body.lastName,
          locale: DB_LOCALE[body.locale],
        },
      },
    },
  });

  await createSession(user.id, null);
  await audit({ actorUserId: user.id, action: 'auth.register', entityType: 'user', entityId: user.id });

  return json({ userId: user.id, needsOnboarding: true }, { status: 201 });
});
