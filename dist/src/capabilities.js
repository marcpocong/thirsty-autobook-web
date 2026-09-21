import { liveHandoffProof } from './handoff-evidence.js';
export function verifiedHandoffProof(proof) {
    return !!proof && proof.source === 'authorized-live-bot-handoff' && Number.isFinite(Date.parse(proof.observedAt)) && proof.checkout === true && proof.activeCountdown === true && proof.pending === true && proof.qrPresence === true && proof.amountMatched === true && proof.finalDispatches === 1 && proof.paymentInteractions === 0;
}
export const capabilities = Object.freeze({ selectionReady: true, checkoutReady: true, paymentBoundaryReady: verifiedHandoffProof(liveHandoffProof) });
export function fullBookingReady(gates = capabilities) { return gates.selectionReady && gates.checkoutReady && gates.paymentBoundaryReady; }
export function requireCapability(mode, gates = capabilities) {
    if (mode === 'selection:armed' && !gates.selectionReady)
        throw new Error('SELECTION_NOT_READY');
    if (['race', 'practice:full'].includes(mode) && !fullBookingReady(gates))
        throw new Error('LIVE_RACE_BLOCKED');
}
//# sourceMappingURL=capabilities.js.map