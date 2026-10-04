import type { PrewarmFeasibilityResult } from '../../src/api-booking/prewarm-feasibility.js';
import type { Dashboard } from '../types.js';

export const offsetText = (value: number): string => `${value > 0 ? '+' : ''}${value} ms`;
export function acknowledgementKind(problem: string): 'timing' | 'standby' | null {
  if (/^Requested (?:(?:Dense Core|Custom) spacing .*|\d+; recommended maximum for this window .*?)Enable the timing capacity override/.test(problem)) return 'timing';
  if (/^Shotgun would reduce reserved Wave 2 workers from \d+ to \d+\. Enable standby consumption/.test(problem)) return 'standby';
  return null;
}
export function preparationText(value: PrewarmFeasibilityResult | null, required: number): string {
  if (!value) return `PREPARATION · Checking whether all ${required} attempts can be prepared before release… ${required}/${required} required`;
  if (value.projectedOmitted) return `⚠ PREPARATION INCOMPLETE · Forecast: ${value.projectedReady}/${value.configuredWave1Attempts} can be prepared · ${value.projectedOmitted} would be omitted. The release cannot be armed with the saved ${value.configuredWave1Attempts}-attempt plan.`;
  if (value.projectedAtRisk) return `⚠ PREPARATION AT RISK · Forecast: ${value.projectedReady}/${value.configuredWave1Attempts} feasible · ${value.projectedAtRisk} at risk. Live readiness must still be checked.`;
  return `✓ PREPARATION FEASIBLE · Forecast: ${value.projectedReady}/${value.configuredWave1Attempts} attempts can be prepared. Live readiness is checked before arming.`;
}
const verified = (state: string) => ['QR_READY', 'VERIFIED', 'HOLD_VERIFIED', 'HOLD_VERIFIED_QR_ATTENTION'].includes(state);
export function liveOutcome(state: Dashboard): string {
  const parents = state.live?.parents ?? [], children = parents.flatMap(parent => parent.children);
  if (parents.some(parent => parent.wave === 'RESCUE' && parent.children.some(child => verified(child.state)))) return 'RESCUE HOLD VERIFIED';
  if (children.some(child => verified(child.state))) return 'HOLD VERIFIED';
  if (state.live?.outcome?.toUpperCase()==='UNKNOWN' || children.some(child => child.state === 'UNKNOWN')) return 'OUTCOME UNKNOWN';
  if (children.some(child => /429|THROTTL/.test(child.code ?? ''))) return 'PROVIDER THROTTLED';
  if (parents.some(parent => parent.wave === 'RESCUE' && parent.children.some(child => ['PREPARING', 'READY', 'ARMED', 'IN_FLIGHT'].includes(child.state)))) return 'RESCUE ACTIVE';
  const release = parents.filter(parent => parent.wave === 'WAVE_1').flatMap(parent => parent.children);
  const plan=state.booking?.setup.PRECISION_PHASE3;
  const planned = plan?.wave1.reduce((count,group)=>count+(group.fanOutOffsetsMs?.length??1),0) ?? state.booking?.setup.STRATEGY_V2?.shotgun?.exactSchedule.length ?? release.length;
  if (planned > 0 && release.length === planned && release.every(child => child.state === 'REJECTED')) return 'ALL RELEASE ATTEMPTS REJECTED';
  if (children.some(child => child.state === 'IN_FLIGHT')) return children.some(child => child.state === 'ARMED') ? 'DISPATCHING' : 'WAITING FOR PROVIDER';
  if (children.some(child => ['FAILED', 'PREWARM_FAILED', 'NOT_DISPATCHED', 'WINDOW_MISSED', 'OMITTED', 'BROWSER_FAILED', 'IDENTITY_FAILED', 'JOURNAL_BLOCKED'].includes(child.state))) return 'OUTCOME UNKNOWN';
  return 'WAITING FOR RELEASE';
}
