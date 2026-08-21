import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { env, telegramConfigured } from '@/lib/env';
import { safeEqual, sha256 } from '@/lib/crypto';
import { redeemLinkToken } from '@/lib/integrations/telegram/link';
import { sendMessage } from '@/lib/integrations/telegram/client';
import { audit } from '@/lib/security/audit';

/**
 * Telegram webhook.
 *
 * The only thing that authenticates this endpoint is the secret token Telegram
 * echoes in `X-Telegram-Bot-Api-Secret-Token` (set when the webhook was
 * registered). Without a match the request is dropped before any parsing - the
 * URL being public is not sufficient authorisation.
 *
 * Responses are always 200 with an empty body so Telegram does not retry, and
 * so an attacker probing the endpoint learns nothing from status codes.
 */
const ok = () => new NextResponse(null, { status: 200 });

type TelegramUpdate = {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    chat?: { id?: number };
    from?: { id?: number; username?: string; first_name?: string; last_name?: string; is_bot?: boolean };
  };
};

export async function POST(request: Request) {
  if (!telegramConfigured) return ok();

  const provided = request.headers.get('x-telegram-bot-api-secret-token');
  if (!provided || !safeEqual(provided, env.TELEGRAM_WEBHOOK_SECRET)) {
    await audit({ action: 'telegram.webhook.rejected', outcome: 'denied' });
    return ok();
  }

  const raw = await request.text();
  if (raw.length > 64 * 1024) return ok();

  let update: TelegramUpdate;
  try {
    update = JSON.parse(raw) as TelegramUpdate;
  } catch {
    return ok();
  }

  // Replay protection: each update_id is processed at most once.
  if (typeof update.update_id === 'number') {
    try {
      await prisma.webhookEvent.create({
        data: {
          provider: 'telegram',
          externalId: String(update.update_id),
          signatureOk: true,
          payloadHash: sha256(raw),
          processedAt: new Date(),
        },
      });
    } catch {
      return ok(); // unique violation = already handled
    }
  }

  const message = update.message;
  const from = message?.from;
  const chatId = message?.chat?.id;
  if (!message?.text || !from?.id || from.is_bot || typeof chatId !== 'number') return ok();

  // Accept "/start <token>" and a bare token.
  const text = message.text.trim();
  const token = text.startsWith('/start') ? text.slice(6).trim() : text;
  if (!token || token.length > 100) {
    await sendMessage(BigInt(chatId), "O'quv Markaz: /start <code>");
    return ok();
  }

  const redeemed = await redeemLinkToken(token);
  if (!redeemed.ok) {
    await sendMessage(BigInt(chatId), "O'quv Markaz: code is invalid or has expired.");
    return ok();
  }

  const displayName = [from.first_name, from.last_name].filter(Boolean).join(' ') || null;

  if (redeemed.targetType === 'PARENT' && redeemed.studentId) {
    // Parent consent: the chat id is written only after they redeemed the code
    // themselves, inside Telegram.
    await prisma.studentParent.updateMany({
      where: { studentId: redeemed.studentId, organizationId: redeemed.organizationId },
      data: { telegramChatId: BigInt(chatId), telegramLinkedAt: new Date() },
    });
  } else {
    await prisma.telegramAccount.upsert({
      where: {
        organizationId_telegramUserId: {
          organizationId: redeemed.organizationId,
          telegramUserId: BigInt(from.id),
        },
      },
      create: {
        organizationId: redeemed.organizationId,
        targetType: redeemed.targetType,
        telegramUserId: BigInt(from.id),
        chatId: BigInt(chatId),
        username: from.username ?? null,
        displayName,
      },
      update: { chatId: BigInt(chatId), username: from.username ?? null, displayName, revokedAt: null },
    });
  }

  await audit({
    organizationId: redeemed.organizationId,
    action: 'telegram.link.redeem',
    meta: { targetType: redeemed.targetType },
  });

  await sendMessage(BigInt(chatId), "O'quv Markaz: connected.");
  return ok();
}
