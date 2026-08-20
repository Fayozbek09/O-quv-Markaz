import { prisma } from '@/lib/db';
import { json, orgMutation, orgRoute, readJson } from '@/lib/api';
import { telegramLinkSchema } from '@/lib/validation/schemas';
import { createLinkToken, LINK_TTL_MS } from '@/lib/integrations/telegram/link';
import { assertAllOwned } from '@/lib/tenant';
import { telegramConfigured } from '@/lib/env';
import { audit } from '@/lib/security/audit';

export const GET = orgRoute(async (ctx) => {
  const accounts = await prisma.telegramAccount.findMany({
    where: { organizationId: ctx.orgId, revokedAt: null },
    select: { id: true, targetType: true, username: true, displayName: true, consentAt: true },
  });
  return json({ configured: telegramConfigured, accounts });
}, 'center.settings');

/**
 * Issues a one-time link code. Identity is bound when the code is redeemed
 * inside Telegram, so the mapping key is always the Telegram user id - a phone
 * number is never used to guess who someone is.
 */
export const POST = orgMutation(async (ctx, request) => {
  const body = await readJson(request, telegramLinkSchema);
  if (body.studentId) await assertAllOwned(ctx, 'student', [body.studentId]);

  const { token, expiresAt } = await createLinkToken({
    organizationId: ctx.orgId,
    targetType: body.targetType,
    studentId: body.studentId ?? null,
    createdByUserId: ctx.actorUserId,
  });

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    action: 'telegram.link.create',
    meta: { targetType: body.targetType },
  });

  return json({
    token,
    expiresAt,
    ttlMinutes: Math.round(LINK_TTL_MS / 60_000),
    configured: telegramConfigured,
  }, { status: 201 });
}, 'center.settings');
