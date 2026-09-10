import { liveHandoffProof,type LiveHandoffProof } from './handoff-evidence.js';
export function verifiedHandoffProof(proof:LiveHandoffProof|null):boolean {
  return !!proof&&proof.source==='authorized-live-bot-handoff'&&Number.isFinite(Date.parse(proof.observedAt))&&proof.checkout===true&&proof.activeCountdown===true&&proof.pending===true&&proof.qrPresence===true&&proof.amountMatched===true&&proof.finalDispatches===1&&proof.paymentInteractions===0;
}
export interface Capabilities {selectionReady:boolean;checkoutReady:boolean;paymentBoundaryReady:boolean}
export const capabilities:Readonly<Capabilities> = Object.freeze({ selectionReady: true, checkoutReady: true, paymentBoundaryReady: verifiedHandoffProof(liveHandoffProof) });
export function fullBookingReady(gates=capabilities){return gates.selectionReady&&gates.checkoutReady&&gates.paymentBoundaryReady;}
export function requireCapability(mode: string,gates=capabilities) {
  if (mode === 'selection:armed' && !gates.selectionReady) throw new Error('SELECTION_NOT_READY');
  if (['race','practice:full'].includes(mode) && !fullBookingReady(gates)) throw new Error('LIVE_RACE_BLOCKED');
}
