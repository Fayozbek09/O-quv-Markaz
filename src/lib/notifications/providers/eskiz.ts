import { env } from '../../env';
import type { SmsSender } from '../senders';

/**
 * Eskiz.uz — the gateway most Uzbek businesses use.
 *
 * The API is token-based: sign in once with the account e-mail and password,
 * hold the bearer token, and re-authenticate when it is refused. Tokens last
 * about a month, so the login call is rare; it is cached in module scope rather
 * than persisted, which means a restart costs one extra request and nothing
 * else.
 *
 * Two things Eskiz will refuse in production, and neither is a bug here:
 *   - an unapproved message template. Eskiz moderates the text; the OTP message
 *     has to be registered in the cabinet before it will send to real numbers.
 *   - an unapproved sender nickname. Until one is granted, `ESKIZ_FROM` stays
 *     on the shared `4546` short code.
 *
 * The message body carries a one-time code, so it is never logged — not on
 * success, and not in an error path.
 */
const BASE = 'https://notify.eskiz.uz/api';
const TIMEOUT_MS = 10_000;

let cachedToken: string | null = null;

const configured = () => Boolean(env.ESKIZ_EMAIL && env.ESKIZ_PASSWORD);

/**
 * Eskiz wants a bare `998XXXXXXXXX` — no plus, no spaces, no brackets. The rest
 * of the application stores E.164, so it is normalised here rather than at the
 * call site.
 */
export function toEskizPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('998') ? digits : `998${digits.replace(/^0+/, '')}`;
}

async function authenticate(): Promise<string> {
  const form = new FormData();
  form.append('email', env.ESKIZ_EMAIL);
  form.append('password', env.ESKIZ_PASSWORD);

  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    // The status is safe to surface; the body may echo the credentials.
    throw new Error(`eskiz_auth_failed:${response.status}`);
  }

  const payload = (await response.json()) as { data?: { token?: string } };
  const token = payload.data?.token;
  if (!token) throw new Error('eskiz_auth_no_token');

  cachedToken = token;
  return token;
}

async function post(token: string, to: string, message: string): Promise<Response> {
  const form = new FormData();
  form.append('mobile_phone', to);
  form.append('message', message);
  form.append('from', env.ESKIZ_FROM);

  return fetch(`${BASE}/message/sms/send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

export const eskizSms: SmsSender = {
  async send(to, message) {
    if (!configured()) throw new Error('sms_provider_not_configured:eskiz');

    const phone = toEskizPhone(to);
    let token = cachedToken ?? (await authenticate());
    let response = await post(token, phone, message);

    // A cached token that has expired comes back as 401. Sign in again and
    // retry exactly once, so a bad password cannot become a request loop.
    if (response.status === 401) {
      cachedToken = null;
      token = await authenticate();
      response = await post(token, phone, message);
    }

    if (!response.ok) {
      let reason = String(response.status);
      try {
        const body = (await response.json()) as { message?: unknown };
        // Eskiz's own message names the fault (bad template, no balance, and
        // so on) and contains nothing we sent.
        if (typeof body.message === 'string') reason = `${reason}:${body.message.slice(0, 120)}`;
      } catch {
        /* a non-JSON error body tells us nothing worth keeping */
      }
      throw new Error(`eskiz_send_failed:${reason}`);
    }
  },
};

/** Exported for tests: lets a case start from a known cache state. */
export function __resetEskizToken() {
  cachedToken = null;
}
