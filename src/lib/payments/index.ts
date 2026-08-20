import { env } from '../env';
import { manualProvider } from './providers/manual';
import { paymeProvider } from './providers/payme';
import { clickProvider } from './providers/click';
import type { PaymentProvider } from './provider';

const REGISTRY: Record<string, PaymentProvider> = {
  manual: manualProvider,
  payme: paymeProvider,
  click: clickProvider,
};

export const paymentProvider: PaymentProvider = REGISTRY[env.PAYMENT_PROVIDER] ?? manualProvider;
export * from './provider';
