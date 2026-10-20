import type { PrewarmFeasibilityResult } from '../../src/api-booking/prewarm-feasibility.js';
import type { Dashboard } from '../types.js';
import { HOLD_STATES, UNSENT_STATES, summarizeRunOutcome } from '../../src/run-outcome.js';
import type { Recovery } from '../../src/execution-state.js';

/** Preserve the controller's reasons; this adapter changes presentation only. */
export function releaseBlockers(state: Dashboard): Array<{ reason: string; recovery: Recovery }> {
  return (state.releaseReadiness?.checks ?? []).filter(c => c.hardBlock && c.level !== 'GOOD').map(c => ({
    reason: `${c.label}: ${c.detail}`,
    recovery: c.id === 'clock' ? { label: 'Refresh trusted clock', action: 'SYNC_CLOCK' }
      : c.id === 'shotgun-timing' ? /^(FAILED|AT RISK)/.test(c.detail) ? { label: 'Review capacity', action: 'REVIEW_CAPACITY' } : { label: 'Run timing calibration', action: 'CALIBRATE_TIMING' }
      : c.id === 'wave1-preparation-capacity' ? { label: 'Review capacity', action: 'REVIEW_CAPACITY' }
      : c.id === 'config' && state.planDate && !['CURRENT', 'UNDATED'].includes(state.planDate.status) ? { label: 'Review plan date', action: 'REVIEW_PLAN_DATE' }
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

const SENT = new Set(['IN_FLIGHT', 'RESERVED', 'REJECTED', 'UNKNOWN', ...HOLD_STATES]);
/** Distinct courts with a verified hold against the saved plan's required minimum (never counting an initiated request). */
export function courtObjective(state: Dashboard): { held: number[]; required: number; met: boolean } {
  const parents = state.live?.parents ?? [];
  const held = [...new Set(parents.filter(p => p.court !== undefined && p.children.some(c => HOLD_STATES.has(c.state))).map(p => p.court!))].sort((a, b) => b - a);
  const objective = state.booking?.setup.STRATEGY_V2?.objective?.wings?.MANGO as { minimum?: number } | undefined;
  const required = Math.max(1, objective?.minimum ?? 1);
  return { held, required, met: held.length >= required };
}
/** One line per browser for the current run: what its release attempts are doing now. No identifiers or security values. */
export function workerProgress(state: Dashboard): Array<{ worker: string; target: string; status: string; tone: 'ok' | 'running' | 'warn' | 'danger' | 'muted' }> {
  const parents = (state.live?.parents ?? []).filter(p => p.wave === 'WAVE_1' && p.workerId);
  const workers = [...new Set(parents.map(p => p.workerId!))].sort();
  return workers.map(worker => {
    const mine = parents.filter(p => p.workerId === worker), children = mine.flatMap(p => p.children);
    const count = (test: (s: string) => boolean) => children.filter(c => test(c.state)).length;
    const holds = count(s => HOLD_STATES.has(s)), unknown = count(s => s === 'UNKNOWN'), rejected = count(s => s === 'REJECTED'), flying = count(s => s === 'IN_FLIGHT' || s === 'RESERVED');
    const unsent = children.filter(c => UNSENT_STATES.has(c.state)), ready = count(s => s === 'READY'), preparing = children.length - holds - unknown - rejected - flying - unsent.length - ready;
    const status = holds ? `verified hold${holds > 1 ? ` ×${holds}` : ''}` : unknown ? 'outcome UNKNOWN — review, never retried' : flying ? 'request sent · waiting for the provider'
      : rejected ? `rejected${rejected > 1 ? ` ×${rejected}` : ''}` : unsent.length === children.length && children.length ? `not sent · ${(unsent[0]!.code ?? unsent[0]!.state).replaceAll('_', ' ').toLowerCase()}`
        : ready ? `ready · waiting for release${preparing > 0 ? ` (${preparing} preparing)` : ''}` : 'preparing security';
    const target = mine.map(p => `${p.court ? `Court ${p.court}` : 'target'}`).join(' + ');
    return { worker, target, status, tone: holds ? 'ok' : unknown ? 'danger' : flying || ready || preparing > 0 ? 'running' : rejected || unsent.length ? 'warn' : 'muted' };
  });
}
/** Settled run report from the controller's durable accounting (src/run-outcome.ts) and the saved plan. */
export function runReport(state: Dashboard): Array<[string, string]> {
  const r = state.runSummary; if (!r || !r.planned) return [];
  const setup = state.booking?.setup, o = courtObjective(state);
  const reasons = r.unsentReasons ?? {};
  const misses = (reasons.SHOTGUN_TRIGGER_MISSED ?? 0) + (reasons.DIRECT_RELEASE_WINDOW_MISSED ?? 0) + (reasons.WINDOW_MISSED ?? 0);
  const security = Object.entries(reasons).filter(([code]) => /SECURITY|PREWARM/.test(code)).reduce((n, [, v]) => n + v, 0);
  return [['Target date', state.activeApiRelease?.targetDate ?? state.booking?.targetDate ?? '—'],
    ['Strategy', setup?.STRATEGY_V2?.shotgun?.enabled ? 'Shotgun' : setup?.RELEASE_STRATEGY === 'precision' ? 'Precision' : 'General'],
    ['Planned', String(r.planned)], ['Initiated', String(r.initiated)], ['Omitted / unsent', String(r.unsent)], ['Deadline misses', String(misses)],
    ['Security preparation failures', String(security)], ['Verified holds', String(r.holds)], ['Rejected', String(r.rejected)], ['UNKNOWN', String(r.unknown)],
    ['Distinct courts held', o.held.length ? o.held.map(c => `Court ${c}`).join(', ') : 'none'], ['Required quota', `${o.met ? 'ACHIEVED' : 'NOT ACHIEVED'} · ${o.held.length} of ${o.required}`],
    ['Next action', r.nextStep]];
}
