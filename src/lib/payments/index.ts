import { env } from '../env';
import { manualProvider } from './providers/manual';
import { paymeProvider } from './providers/payme';
import type { PaymentProvider } from './provider';

const REGISTRY: Record<string, PaymentProvider> = {
  manual: manualProvider,
  payme: paymeProvider,
  // click: clickProvider - add alongside payme using the same interface.
};

export const paymentProvider: PaymentProvider = REGISTRY[env.PAYMENT_PROVIDER] ?? manualProvider;
export * from './provider';
