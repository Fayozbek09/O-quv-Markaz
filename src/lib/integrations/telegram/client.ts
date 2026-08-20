import { env, telegramConfigured } from '../../env';

/**
 * Minimal Bot API client. Only the two methods the product needs are exposed,
 * so a compromised call site cannot, for example, change the bot's webhook.
 */
const API = (method: string) => `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;

export type TelegramSendResult = { ok: true; messageId: number } | { ok: false; error: string };

export async function sendMessage(chatId: bigint | string, text: string): Promise<TelegramSendResult> {
  if (!telegramConfigured) return { ok: false, error: 'bot_not_configured' };

  try {
    const res = await fetch(API('sendMessage'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId.toString(),
        text,
        // Plain text: the message body contains user-controlled names, and
        // parse_mode would turn `_` or `*` in a name into broken markup.
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json()) as { ok: boolean; result?: { message_id: number }; description?: string };
    if (!json.ok || !json.result) return { ok: false, error: json.description ?? 'send_failed' };
    return { ok: true, messageId: json.result.message_id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.name : 'network_error' };
  }
}

export async function setWebhook(url: string): Promise<boolean> {
  if (!telegramConfigured) return false;
  const res = await fetch(API('setWebhook'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url,
      secret_token: env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ['message'],
    }),
  });
  const json = (await res.json()) as { ok: boolean };
  return json.ok;
}
