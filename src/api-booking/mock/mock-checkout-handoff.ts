import type { CheckoutHandoff } from '../checkout-handoff.js';
import type { CheckoutHandoffResult, PendingHold } from '../types.js';

export class MockCheckoutHandoff implements CheckoutHandoff {
  readonly kind = 'mock-checkout-handoff' as const;

  async prepare(holds: PendingHold[], now: Date): Promise<CheckoutHandoffResult> {
    if (!holds.length || holds.some(hold => !Number.isFinite(Date.parse(hold.holdExpiresAt)) || Date.parse(hold.holdExpiresAt) <= now.getTime())) throw Error('MOCK_HANDOFF_HOLD_EXPIRED');
    return {
      kind: 'mock-checkout-ready', synthetic: true, paymentAutomated: false,
      sessions: holds.map((hold, index) => ({
        synthetic: true, sessionId: `synthetic-checkout-${index + 1}`, holdId: hold.holdId,
        expiresAt: hold.holdExpiresAt, action: 'manual-payment-required',
      })),
    };
  }
}
