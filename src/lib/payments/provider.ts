import type { SubscriptionPlan } from '@/generated/prisma/enums';

/**
 * Plan catalogue.
 *
 * There is exactly one live plan: a flat monthly price for the whole centre,
 * with no student, teacher or group ceiling. Its price is NOT taken from here
 * — it is read from platform settings (lib/domain/settings.ts) so the platform
 * admin can change it without a deploy. The numbers below are only the shape,
 * and the legacy rows exist so subscriptions created by the single-tutor
 * product still resolve.
 */
export const PLANS: Record<
  SubscriptionPlan,
  { periodDays: number | null; studentLimit: number | null }
> = {
  STANDARD: { periodDays: 30, studentLimit: null },
  FREE: { periodDays: null, studentLimit: null },
  PRO: { periodDays: 30, studentLimit: null },
  ANNUAL: { periodDays: 365, studentLimit: null },
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
      /**
       * `pending` is for providers whose callback has more than one phase —
       * Click calls once to reserve and again to settle. A pending event is
       * recorded and acknowledged, and leaves the intent untouched.
       */
      outcome: 'succeeded' | 'failed' | 'canceled' | 'pending';
      amountMinor: bigint;
      currency: string;
    };

/**
 * What the webhook pipeline decided about an event. Rendered into whatever
 * shape the gateway's own protocol demands — a provider that gets an
 * unrecognised reply retries, or marks the merchant as failing.
 */
export type WebhookOutcomeKind =
  | { kind: 'rejected'; reason: string }
  | { kind: 'duplicate' }
  | { kind: 'unknown_intent' }
  | { kind: 'amount_mismatch' }
  | { kind: 'settled' }
  | { kind: 'reserved' }
  | { kind: 'not_settled'; outcome: 'failed' | 'canceled' };

export type WebhookReply = { status: number; body: unknown };

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

  /**
   * Renders the HTTP reply this gateway's protocol requires.
   *
   * Returning `{ ok: true }` to a gateway that expects its own envelope is the
   * quiet way an integration fails: the money moves on the payer's side, the
   * gateway never sees an acknowledgement it recognises, and it retries or
   * reverses. Each adapter therefore owns its own reply.
   */
  renderReply(
    result: WebhookOutcomeKind,
    context: { verification?: WebhookVerification; intentId?: string },
  ): WebhookReply;
}
