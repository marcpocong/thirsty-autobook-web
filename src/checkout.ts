import { Safety } from './safety.js';
import { Telemetry } from './telemetry.js';

// Contract shared by offline boundary tests and the evidence-based Onda DOM adapter.
export interface BookingSummary {
  venue: string; date: string; court: number; start: string; end: string;
  duration: number; amount: number; currency: string;
}
export interface CheckoutAdapter {
  review(): Promise<BookingSummary>;
  fillPlayer(player: Player): Promise<Player>;
  playerProceed(): Promise<void>;
  paymentSummary(): Promise<BookingSummary>;
  acceptTerms(): Promise<boolean>;
  finalOndaAction(): Promise<void>;
}
export interface Player { fullName: string; phone: string; email: string }
export function validateSummary(actual: BookingSummary, expected: BookingSummary, maximumPrice: number, stage: 'REVIEW' | 'PAYMENT') {
  for (const key of ['venue', 'date', 'court', 'start', 'end', 'duration', 'currency'] as const) {
    if (actual[key] !== expected[key]) throw new Error(`${stage}_MISMATCH`);
  }
  if (!Number.isFinite(actual.amount) || actual.amount <= 0 || actual.amount > maximumPrice || (stage === 'PAYMENT' && actual.amount !== expected.amount)) throw new Error(`${stage}_PRICE_MISMATCH`);
}
export async function checkout(adapter: CheckoutAdapter, safety: Safety, t: Telemetry, expected: BookingSummary, player: Player, maximumPrice: number, authorizeTerms: boolean) {
  safety.lock();
  const review = await adapter.review(); safety.check(); t.mark('reviewDetected');
  validateSummary(review, expected, maximumPrice, 'REVIEW'); t.mark('reviewValidated');
  safety.check(); t.mark('playerFillStarted');
  const actual = await adapter.fillPlayer(player); safety.check();
  if (actual.fullName !== player.fullName || actual.phone !== player.phone || actual.email !== player.email) throw new Error('PLAYER_VALUES_MISMATCH');
  t.mark('playerFillCompleted');
  safety.check(); t.mark('playerProceedStarted'); await adapter.playerProceed(); safety.check(); t.mark('playerProceedClicked');
  safety.check(); const payment = await adapter.paymentSummary(); safety.check(); t.mark('paymentSummaryDetected');
  validateSummary(payment, review, maximumPrice, 'PAYMENT'); t.mark('paymentSummaryValidated');
  if (!authorizeTerms) { t.mark('automationStopped'); return 'TERMS_NOT_AUTHORIZED' as const; }
  safety.check(); if (!await adapter.acceptTerms()) throw new Error('TERMS_NOT_CHECKED'); t.mark('termsChecked');
  await safety.finalAction(() => adapter.finalOndaAction());
  t.mark('finalOndaButtonClicked'); t.mark('paymentBoundaryReached'); t.mark('automationStopped');
  return 'PAYMENT_BOUNDARY_REACHED' as const;
}
