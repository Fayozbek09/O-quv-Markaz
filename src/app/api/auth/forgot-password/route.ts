import { headers } from 'next/headers';
import { prisma } from '@/lib/db';
import { json, publicRoute, readJson } from '@/lib/api';
import { forgotPasswordSchema } from '@/lib/validation/schemas';
import { normalizePhone } from '@/lib/validation/common';
import { requestOtp } from '@/lib/auth/otp';
import { clientIp } from '@/lib/auth/session';
import { enforce } from '@/lib/security/rate-limit';
import { audit } from '@/lib/security/audit';
import { getLocale } from '@/lib/i18n/server';

export const POST = publicRoute(async (request: Request) => {
  const hdrs = await headers();
  const ip = clientIp(hdrs);
  const body = await readJson(request, forgotPasswordSchema);

  const identifier = body.identifier.trim();
  const asPhone = normalizePhone(identifier);
  const asEmail = identifier.includes('@') ? identifier.toLowerCase() : null;
  const key = asPhone ?? asEmail ?? identifier;

  await enforce('auth:reset:identifier', key);

  const user = await prisma.user.findFirst({
    where: {
      deletedAt: null,
      OR: [...(asPhone ? [{ phone: asPhone }] : []), ...(asEmail ? [{ email: asEmail }] : [])],
    },
  });

  // Always answer the same way. Whether a code was actually sent is not
  // observable, so this endpoint cannot enumerate accounts.
  if (user) {
    const channel = asPhone && user.phone === asPhone ? 'SMS' : 'EMAIL';
    await requestOtp({
      identifier: channel === 'SMS' ? (user.phone as string) : (user.email as string),
      channel,
      purpose: 'PASSWORD_RESET',
      ip,
      locale: await getLocale(),
    });
    await audit({ actorUserId: user.id, action: 'auth.reset.request' });
  }

  return json({ sent: true });
});
