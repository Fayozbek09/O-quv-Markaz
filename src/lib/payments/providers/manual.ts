import type { PaymentProvider, WebhookOutcomeKind, WebhookReply } from '../provider';

/**
 * The default provider on a fresh deployment. It never reports a successful
 * payment: plan changes have to be made by an operator until a real provider
 * is configured. This is deliberate - a stub that fakes success would let
 * anyone self-upgrade.
 */
export const manualProvider: PaymentProvider = {
  name: 'manual',
  configured: false,

  async createCheckout() {
    return { redirectUrl: null, providerRef: null, unavailable: true };
  },

  async verifyWebhook() {
    return { ok: false, reason: 'provider_not_configured' };
  },

  async fetchStatus() {
    return 'pending';
  },

  renderReply(result: WebhookOutcomeKind): WebhookReply {
    // Nothing calls this deployment's webhook legitimately, so the reply only
    // has to be honest about the refusal.
    if (result.kind === 'rejected') return { status: 401, body: { error: result.reason } };
    return { status: 200, body: { ok: true } };
  },
};
