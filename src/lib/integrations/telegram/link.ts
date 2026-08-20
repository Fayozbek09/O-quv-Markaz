import { prisma } from '../../db';
import { randomToken, sha256 } from '../../crypto';
import type { TelegramTargetType } from '@/generated/prisma/enums';

export const LINK_TTL_MS = 15 * 60_000;

/**
 * A Telegram account is bound to a workspace only by redeeming a token that the
 * teacher generated. Identity is never inferred from a phone number - the
 * mapping key is the Telegram user id supplied by Telegram itself.
 */
export async function createLinkToken(input: {
  organizationId: string;
  targetType: TelegramTargetType;
  studentId?: string | null;
  createdByUserId: string;
}) {
  const token = randomToken(24);
  const expiresAt = new Date(Date.now() + LINK_TTL_MS);

  await prisma.telegramLinkToken.create({
    data: {
      organizationId: input.organizationId,
      tokenHash: sha256(token),
      targetType: input.targetType,
      studentId: input.studentId ?? null,
      createdByUserId: input.createdByUserId,
      expiresAt,
    },
  });

  return { token, expiresAt };
}

export type RedeemResult =
  | { ok: false; reason: 'invalid' | 'expired' | 'used' }
  | { ok: true; organizationId: string; targetType: TelegramTargetType; studentId: string | null };

/** Single-use redemption, guarded so a replayed token cannot link twice. */
export async function redeemLinkToken(token: string): Promise<RedeemResult> {
  const row = await prisma.telegramLinkToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row) return { ok: false, reason: 'invalid' };
  if (row.consumedAt) return { ok: false, reason: 'used' };
  if (row.expiresAt < new Date()) return { ok: false, reason: 'expired' };

  const claimed = await prisma.telegramLinkToken.updateMany({
    where: { id: row.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (claimed.count !== 1) return { ok: false, reason: 'used' };

  return {
    ok: true,
    organizationId: row.organizationId,
    targetType: row.targetType,
    studentId: row.studentId,
  };
}
