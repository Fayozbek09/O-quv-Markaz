import { env } from '../../env';
import type { SmsSender } from '../senders';

/**
 * Play Mobile (playmobile.uz) — the other gateway commonly used in Uzbekistan.
 *
 * Simpler than Eskiz: HTTP Basic auth on every request, no token to hold. The
 * body is JSON with a `messages` array, so one call could carry a batch; the
 * OTP path only ever sends one.
 *
 * As with Eskiz, the originator has to be approved before real numbers accept
 * it, and the message body carries a one-time code and is never logged.
 */
const ENDPOINT = 'https://send.smsxabar.uz/broker-api/send';
const TIMEOUT_MS = 10_000;

const configured = () => Boolean(env.PLAYMOBILE_LOGIN && env.PLAYMOBILE_PASSWORD);

/** Play Mobile expects `998XXXXXXXXX`, like Eskiz. */
export function toPlayMobilePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('998') ? digits : `998${digits.replace(/^0+/, '')}`;
}

export const playMobileSms: SmsSender = {
  async send(to, message) {
    if (!configured()) throw new Error('sms_provider_not_configured:playmobile');

    const auth = Buffer.from(`${env.PLAYMOBILE_LOGIN}:${env.PLAYMOBILE_PASSWORD}`).toString(
      'base64',
    );

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Basic ${auth}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          {
            // Their own reference for the message; a random id keeps two
            // concurrent sends from colliding.
            'message-id': crypto.randomUUID(),
            recipient: toPlayMobilePhone(to),
            sms: {
              originator: env.PLAYMOBILE_ORIGINATOR,
              content: { text: message },
            },
          },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`playmobile_send_failed:${response.status}`);
    }
  },
};
