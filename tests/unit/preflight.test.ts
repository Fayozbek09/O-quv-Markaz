import { describe, it, expect } from 'vitest';
import { productionPreflight, productionWarnings, env } from '@/lib/env';

/**
 * The production preflight.
 *
 * Each rule exists because the mistake it catches is silent: a session secret
 * copied from the example file signs perfectly valid cookies, a `console` SMS
 * provider accepts a registration and prints the code to a log nobody reads,
 * and `PAYMENT_PROVIDER=payme` with no key answers every merchant call with
 * "insufficient privileges". They all look like a working deployment.
 */
const GOOD = {
  ...env,
  NODE_ENV: 'production' as const,
  APP_URL: 'https://oquvmarkaz.uz',
  SESSION_SECRET: '7f3a9c1e8b42d605af97e3c8b1d40a26f5e79b3c8d1a4b206',
  OTP_PEPPER: 'b19e4c7a3f6d802e5b8c1a94f7d3e6021c9b5a8d4e7f30126',
  FILE_URL_SECRET: 'd42f8a1c6b9e35704f2a8d6c1b953e78a4f0d2c6b8e19537',
  IP_HASH_SECRET: 'a83b5f2d9c4e17608b3a6d1f9e5c2740b7d8a3f1c6e94025',
  SMS_PROVIDER: 'eskiz' as const,
  ESKIZ_EMAIL: 'centre@example.uz',
  ESKIZ_PASSWORD: 'a-real-password',
  EMAIL_PROVIDER: 'smtp' as const,
  PAYMENT_PROVIDER: 'click' as const,
  CLICK_MERCHANT_ID: '12345',
  CLICK_SECRET_KEY: 'a-real-click-key',
  TELEGRAM_BOT_TOKEN: '',
  TELEGRAM_WEBHOOK_SECRET: '',
};

const keysOf = (problems: { key: string }[]) => problems.map((p) => p.key);

describe('a well-configured production environment', () => {
  it('raises nothing', () => {
    expect(productionPreflight(GOOD)).toEqual([]);
  });
});

describe('secrets', () => {
  it('refuses a secret copied from the example file', () => {
    const problems = productionPreflight({
      ...GOOD,
      SESSION_SECRET: 'dev_only_session_secret_change_me_0123456789abcdef0123456789abcdef',
    });
    expect(keysOf(problems)).toContain('SESSION_SECRET');
  });

  it('refuses a secret with too little variety to have been generated', () => {
    const problems = productionPreflight({ ...GOOD, OTP_PEPPER: 'a'.repeat(64) });
    expect(keysOf(problems)).toContain('OTP_PEPPER');
  });

  it('refuses two secrets sharing one value, so one compromise is not two', () => {
    const shared = GOOD.SESSION_SECRET;
    const problems = productionPreflight({ ...GOOD, FILE_URL_SECRET: shared });
    expect(keysOf(problems)).toContain('FILE_URL_SECRET');
  });

  it('never puts a secret value in the problem text', () => {
    const secret = 'dev_only_session_secret_change_me_0123456789abcdef';
    const problems = productionPreflight({ ...GOOD, SESSION_SECRET: secret });
    for (const problem of problems) {
      expect(JSON.stringify(problem)).not.toContain(secret);
    }
  });
});

describe('the public URL', () => {
  it('must be https, because the session cookie is __Host- and Secure', () => {
    expect(keysOf(productionPreflight({ ...GOOD, APP_URL: 'http://oquvmarkaz.uz' })))
      .toContain('APP_URL');
  });

  it('must not still point at localhost', () => {
    expect(keysOf(productionPreflight({ ...GOOD, APP_URL: 'https://localhost:3000' })))
      .toContain('APP_URL');
  });
});

describe('message delivery', () => {
  it('refuses a console SMS provider: a code printed to a log was never sent', () => {
    expect(keysOf(productionPreflight({ ...GOOD, SMS_PROVIDER: 'console' })))
      .toContain('SMS_PROVIDER');
  });

  it('refuses a console e-mail provider for the same reason', () => {
    expect(keysOf(productionPreflight({ ...GOOD, EMAIL_PROVIDER: 'console' })))
      .toContain('EMAIL_PROVIDER');
  });

  it('refuses a named SMS gateway with no credentials', () => {
    const problems = productionPreflight({ ...GOOD, ESKIZ_PASSWORD: '' });
    expect(keysOf(problems)).toContain('ESKIZ_EMAIL/ESKIZ_PASSWORD');
  });

  it('refuses Play Mobile with no credentials', () => {
    const problems = productionPreflight({
      ...GOOD, SMS_PROVIDER: 'playmobile', PLAYMOBILE_LOGIN: '', PLAYMOBILE_PASSWORD: '',
    });
    expect(keysOf(problems)).toContain('PLAYMOBILE_LOGIN/PLAYMOBILE_PASSWORD');
  });
});

describe('payments', () => {
  it('refuses Payme with no merchant key', () => {
    const problems = productionPreflight({
      ...GOOD, PAYMENT_PROVIDER: 'payme', PAYME_MERCHANT_ID: '', PAYME_SECRET_KEY: '',
    });
    expect(keysOf(problems)).toContain('PAYME_MERCHANT_ID/PAYME_SECRET_KEY');
  });

  it('refuses Click with no service key', () => {
    const problems = productionPreflight({ ...GOOD, CLICK_SECRET_KEY: '' });
    expect(keysOf(problems)).toContain('CLICK_MERCHANT_ID/CLICK_SECRET_KEY');
  });

  it('allows the manual provider, but says so out loud', () => {
    const config = { ...GOOD, PAYMENT_PROVIDER: 'manual' as const };
    expect(productionPreflight(config)).toEqual([]);
    expect(keysOf(productionWarnings(config))).toContain('PAYMENT_PROVIDER');
  });
});

describe('Telegram', () => {
  it('refuses a bot token with no webhook secret, which would leave the webhook open', () => {
    const problems = productionPreflight({ ...GOOD, TELEGRAM_BOT_TOKEN: '123:abc' });
    expect(keysOf(problems)).toContain('TELEGRAM_WEBHOOK_SECRET');
  });

  it('is content for the bot to be absent entirely', () => {
    expect(productionPreflight(GOOD)).toEqual([]);
  });
});

describe('warnings are advice, not refusals', () => {
  it('names local storage as a durability risk without blocking a launch', () => {
    const config = { ...GOOD, STORAGE_DRIVER: 'local' as const };
    expect(productionPreflight(config)).toEqual([]);
    expect(keysOf(productionWarnings(config))).toContain('STORAGE_DRIVER');
  });
});
