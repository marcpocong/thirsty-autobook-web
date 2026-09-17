import type { CheckoutHandoffResult, PendingHold } from './types.js';

export interface CheckoutHandoff {
  readonly kind: 'mock-checkout-handoff';
  prepare(holds: PendingHold[], now: Date): Promise<CheckoutHandoffResult>;
}

export const PAYMENT_AUTOMATION_ENABLED = false as const;
