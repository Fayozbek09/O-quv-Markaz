import { headers } from 'next/headers';
import { prisma } from '@/lib/db';
import { json, publicRoute, readJson } from '@/lib/api';
import { loginSchema } from '@/lib/validation/schemas';
import { normalizePhone } from '@/lib/validation/common';
import { fakeVerify, verifyPassword } from '@/lib/auth/password';
import { createSession, clientIp } from '@/lib/auth/session';
import { enforceAll } from '@/lib/security/rate-limit';
import { audit } from '@/lib/security/audit';
import { ROLE_HOME } from '@/lib/rbac';
import { Unauthorized } from '@/lib/errors';

/**
 * The single login page for every centre role.
 *
 * The identifier may be a username, an e-mail address or a phone number; the
 * server decides which. The role is then read from the membership row and the
 * landing route is chosen server-side — the client never states, and is never
 * asked, what role it would like to have.
 */
export const POST = publicRoute(async (request: Request) => {
  const hdrs = await headers();
  const ip = clientIp(hdrs);
  const body = await readJson(request, loginSchema);

  const identifier = body.identifier.trim();
  const asPhone = normalizePhone(identifier);
  const asEmail = identifier.includes('@') ? identifier.toLowerCase() : null;
  const asUsername = /^[a-z0-9._-]{3,64}$/i.test(identifier) ? identifier.toLowerCase() : null;

  await enforceAll([
    ['auth:login:identifier', asPhone ?? asEmail ?? asUsername ?? identifier],
    ['auth:login:ip', ip ?? undefined],
  ]);

  const user = await prisma.user.findFirst({
    where: {
      deletedAt: null,
      isActive: true,
      OR: [
        ...(asPhone ? [{ phone: asPhone }] : []),
        ...(asEmail ? [{ email: asEmail }] : []),
        ...(asUsername ? [{ username: asUsername }] : []),
      ],
    },
    include: {
      memberships: {
        where: { removedAt: null },
        orderBy: { joinedAt: 'asc' },
        include: { organization: { select: { id: true, status: true, deletedAt: true } } },
      },
    },
  });

  if (!user?.passwordHash) {
    // Same work, same timing, same message whether or not the account exists.
    await fakeVerify(body.password);
    await audit({ action: 'auth.login', outcome: 'failure' });
    throw Unauthorized('auth.invalidCredentials');
  }

  const ok = await verifyPassword(user.passwordHash, body.password);
  if (!ok) {
    await audit({ actorUserId: user.id, action: 'auth.login', outcome: 'failure' });
    throw Unauthorized('auth.invalidCredentials');
  }

  // A temporary password that was never used stops working; the centre has to
  // issue a fresh one rather than leave a live credential lying around.
  if (user.credentialsExpireAt && user.credentialsExpireAt < new Date()) {
    await audit({
      actorUserId: user.id,
      action: 'auth.login',
      outcome: 'denied',
      meta: { reason: 'temporary_credentials_expired' },
    });
    throw Unauthorized('auth.credentialsExpired');
  }

  const membership =
    user.memberships.find((m) => m.organization.status === 'ACTIVE' && !m.organization.deletedAt) ??
    null;

  if (user.memberships.length > 0 && !membership) {
    await audit({
      actorUserId: user.id,
      action: 'auth.login',
      outcome: 'denied',
      meta: { reason: 'center_suspended' },
    });
    throw Unauthorized('auth.centerSuspended');
  }

  // A fresh session id on every login - an attacker-fixed cookie is discarded.
  await createSession(user.id, membership?.organizationId ?? null);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({
    organizationId: membership?.organizationId ?? null,
    actorUserId: user.id,
    action: 'auth.login',
    outcome: 'success',
    meta: { role: membership?.role ?? null },
  });

  const redirectTo = user.mustChangePassword
    ? '/change-password'
    : membership
      ? ROLE_HOME[membership.role]
      : '/onboarding';

  return json({
    ok: true,
    hasWorkspace: Boolean(membership),
    mustChangePassword: user.mustChangePassword,
    redirectTo,
  });
});
