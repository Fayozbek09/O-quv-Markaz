import type { SubscriptionPlan } from '@/generated/prisma/enums';

/**
 * Plan catalogue. Prices are in minor units of the plan currency (UZS has no
 * subunit, so 25000 = 25 000 so'm).
 */
export const PLANS: Record<
  SubscriptionPlan,
  { priceMinor: bigint; currency: string; periodDays: number | null; studentLimit: number | null }
> = {
  FREE: { priceMinor: 0n, currency: 'UZS', periodDays: null, studentLimit: 10 },
  PRO: { priceMinor: 25_000n, currency: 'UZS', periodDays: 30, studentLimit: null },
  ANNUAL: { priceMinor: 199_000n, currency: 'UZS', periodDays: 365, studentLimit: null },
};

export type CheckoutSession = {
  /** Where the browser should be sent to complete payment. */
  redirectUrl: string | null;
  /** Provider-side reference for reconciliation. */
  providerRef: string | null;
  /** True when the provider cannot be used on this deployment. */
  unavailable?: boolean;
};

export type WebhookVerification =
  | { ok: false; reason: string }
  | {
      ok: true;
      externalId: string;
      /** The intent this event settles. */
      idempotencyKey: string;
      outcome: 'succeeded' | 'failed' | 'canceled';
      amountMinor: bigint;
      currency: string;
    };

/**
 * Every payment provider implements this. Nothing in the app marks a
 * subscription active from a browser response - only `verifyWebhook` (or an
 * explicit server-side `fetchStatus`) can do that.
 */
export interface PaymentProvider {
  readonly name: string;
  readonly configured: boolean;

  createCheckout(input: {
    organizationId: string;
    plan: SubscriptionPlan;
    amountMinor: bigint;
    currency: string;
    idempotencyKey: string;
    returnUrl: string;
  }): Promise<CheckoutSession>;

  /** Verifies the signature/auth of a raw webhook body. */
  verifyWebhook(input: {
    rawBody: string;
    headers: Record<string, string>;
  }): Promise<WebhookVerification>;

  /** Server-side source of truth, used to reconcile a pending intent. */
  fetchStatus(providerRef: string): Promise<'pending' | 'succeeded' | 'failed' | 'canceled'>;
}
