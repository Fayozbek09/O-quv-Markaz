import type { PaymentProvider } from '../provider';

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
};
