import { env } from '../env';

/**
 * Delivery adapters. `console` is the local/dev driver; the production drivers
 * are thin wrappers that only need credentials to be filled in.
 */
export interface SmsSender {
  send(to: string, message: string): Promise<void>;
}
export interface EmailSender {
  send(to: string, subject: string, body: string): Promise<void>;
}

const maskPhone = (p: string) => `${p.slice(0, 5)}***${p.slice(-2)}`;
const maskEmail = (e: string) => {
  const [user = '', domain = ''] = e.split('@');
  return `${user.slice(0, 2)}***@${domain}`;
};

const consoleSms: SmsSender = {
  async send(to, message) {
    // Dev only. In production the code itself must never be logged.
    console.info(`[sms:console] -> ${maskPhone(to)}\n${message}`);
  },
};

const consoleEmail: EmailSender = {
  async send(to, subject, body) {
    console.info(`[email:console] -> ${maskEmail(to)}\n${subject}\n${body}`);
  },
};

/**
 * Eskiz.uz is the common Uzbek SMS gateway. Left unimplemented on purpose:
 * it needs ESKIZ_EMAIL/ESKIZ_PASSWORD and a pre-approved template.
 */
const notConfigured = (name: string): SmsSender => ({
  async send() {
    throw new Error(`sms_provider_not_configured:${name}`);
  },
});

export const sms: SmsSender = env.SMS_PROVIDER === 'console' ? consoleSms : notConfigured(env.SMS_PROVIDER);

export const email: EmailSender =
  env.EMAIL_PROVIDER === 'console'
    ? consoleEmail
    : {
        async send() {
          throw new Error(`email_provider_not_configured:${env.EMAIL_PROVIDER}`);
        },
      };
