import type { PrewarmFeasibilityResult } from '../../src/api-booking/prewarm-feasibility.js';
import type { Dashboard } from '../types.js';
import { HOLD_STATES, UNSENT_STATES, summarizeRunOutcome } from '../../src/run-outcome.js';
import type { Recovery } from '../../src/execution-state.js';

/** Preserve the controller's reasons; this adapter changes presentation only. */
export function releaseBlockers(state: Dashboard): Array<{ reason: string; recovery: Recovery }> {
  return (state.releaseReadiness?.checks ?? []).filter(c => c.hardBlock && c.level !== 'GOOD').map(c => ({
    reason: `${c.label}: ${c.detail}`,
    recovery: c.id === 'clock' ? { label: 'Refresh trusted clock', action: 'SYNC_CLOCK' }
      : c.id === 'wave1-preparation-capacity' || c.id === 'shotgun-timing' ? { label: 'Review capacity', action: 'REVIEW_CAPACITY' }
      : c.id === 'shotgun-topology' ? { label: 'Recheck browsers', action: 'RECHECK_BROWSERS' }
      : c.id === 'security-check' ? { label: 'Run security check', action: 'CHECK_SECURITY' }
      : { label: 'Review release checks', action: 'REVIEW_READINESS' }
  }));
}

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
const verified = (state: string) => HOLD_STATES.has(state);
/**
 * Outcome first. UNKNOWN is reserved for an attempt that may have been sent without a confirmed result; a definitively
 * unsent attempt (permit revoked, nothing initiated) is reported as unsent, never as unknown or rejected.
 */
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
  const summary = summarizeRunOutcome(children, planned);
  if (summary.settled && summary.planned) return summary.rejected ? 'ALL SENT ATTEMPTS REJECTED' : 'NOTHING DISPATCHED';
  const active = state.operation !== 'idle' || !!state.activeApiRelease;
  // The runner ended without settling every attempt: say so instead of guessing an outcome.
  if (!active && children.some(child => UNSENT_STATES.has(child.state) || child.state === 'FAILED')) return 'RESULT INCOMPLETE · REVIEW ACTIVITY';
  return 'WAITING FOR RELEASE';
}
