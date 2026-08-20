import { headers } from 'next/headers';
import { prisma } from '@/lib/db';
import { json, publicRoute, readJson } from '@/lib/api';
import { loginSchema } from '@/lib/validation/schemas';
import { normalizePhone } from '@/lib/validation/common';
import { fakeVerify, verifyPassword } from '@/lib/auth/password';
import { createSession, clientIp } from '@/lib/auth/session';
import { enforceAll } from '@/lib/security/rate-limit';
import { audit } from '@/lib/security/audit';
import { Unauthorized } from '@/lib/errors';

export const POST = publicRoute(async (request: Request) => {
  const hdrs = await headers();
  const ip = clientIp(hdrs);
  const body = await readJson(request, loginSchema);

  const identifier = body.identifier.trim();
  const asPhone = normalizePhone(identifier);
  const asEmail = identifier.includes('@') ? identifier.toLowerCase() : null;

  await enforceAll([
    ['auth:login:identifier', asPhone ?? asEmail ?? identifier],
    ['auth:login:ip', ip ?? undefined],
  ]);

  const user = await prisma.user.findFirst({
    where: {
      deletedAt: null,
      isActive: true,
      OR: [...(asPhone ? [{ phone: asPhone }] : []), ...(asEmail ? [{ email: asEmail }] : [])],
    },
    include: { memberships: { where: { removedAt: null }, orderBy: { joinedAt: 'asc' }, take: 1 } },
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

  // A fresh session id on every login - an attacker-fixed cookie is discarded.
  await createSession(user.id, user.memberships[0]?.organizationId ?? null);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({ actorUserId: user.id, action: 'auth.login', outcome: 'success' });

  return json({ ok: true, hasWorkspace: user.memberships.length > 0 });
});
