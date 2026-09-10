// Evidence gates, not user settings. Final handoff remains unverified on live Onda.
export const capabilities = Object.freeze({ selectionReady: true, checkoutReady: true, paymentBoundaryReady: false });
export function requireCapability(mode: string) {
  if (mode === 'selection:armed' && !capabilities.selectionReady) throw new Error('SELECTION_NOT_READY');
  if (mode === 'race' && !(capabilities.selectionReady && capabilities.checkoutReady && capabilities.paymentBoundaryReady)) throw new Error('LIVE_RACE_BLOCKED');
}
