import { compileObjective, type BookingObjective, type CompileContext } from './booking-objective.js';
import { forecastPreparation, fullyReady } from './quick-shotgun.js';
import type { PrewarmFeasibilityResult } from './api-booking/prewarm-feasibility.js';

export interface BudgetAdvice {
  preferred: number; compiled: number; recommended: number | null; executable: number;
  status: 'BLOCKED' | 'NEEDS_EVIDENCE' | 'LOCALLY_SUPPORTED'; reasons: string[];
}
/** Proposals only. A lower count needs a new exact-topology calibration after owner acceptance. */
export function adviseDailyBudget(objective: BookingObjective, context: CompileContext, evidence: {
  prior?: PrewarmFeasibilityResult | null; connectedWorkers: ReadonlySet<string>;
  calibrationMatches: boolean; providerVolumePermitted: boolean; blockedSubmission: boolean;
}): BudgetAdvice {
  const preferred = objective.shotgun.budget, plan = compileObjective(objective, context);
  const unavailable = new Set(['A','B','C','D','E','F','G'].filter(w => context.unavailableWorkers?.has(w) || !evidence.connectedWorkers.has(w)));
  const reasons = [...plan.problems]; let recommended: number | null = null;
  const custom = objective.shotgun.timingMode === 'CUSTOM' || objective.shotgun.allocationMode === 'CUSTOM';
  for (let n = preferred; n >= 1; n--) {
    if (custom && n !== preferred) break;
    const candidate = structuredClone(objective); candidate.shotgun.budget = n;
    const compiled = compileObjective(candidate, { ...context, unavailableWorkers: unavailable });
    const cohorts = compiled.cohorts;
    if (!compiled.problems.length && cohorts.length && cohorts.every(c => c.smart?.phase3 && fullyReady(forecastPreparation(c.smart.phase3, unavailable, evidence.prior)))) { recommended = n; break; }
  }
  if (!recommended) reasons.push('No fully preparable count is established with the currently connected authorized workers. Prepare browsers and review capacity.');
  else if (recommended < preferred) reasons.push(`Preferred ${preferred}; preparation forecast supports a proposal of ${recommended}. Review and accept it, then calibrate that exact schedule.`);
  if (evidence.prior?.p95Source !== 'COMPATIBLE_MEASURED_HISTORY') reasons.push('Preparation uses a fallback estimate; compatible measured preparation evidence is missing.');
  if (!evidence.calibrationMatches) reasons.push('The current saved topology lacks applicable timing calibration. Historic lower-density results do not qualify this proposal.');
  if (!evidence.providerVolumePermitted) reasons.push('Provider permission for this request volume is unverified. Owner attestation is required for the exact live plan.');
  if (evidence.blockedSubmission) reasons.push('A lock, possible hold or unresolved submission needs review; no retry is proposed.');
  const supported = !plan.problems.length && recommended === preferred && evidence.prior?.p95Source === 'COMPATIBLE_MEASURED_HISTORY' && evidence.calibrationMatches && evidence.providerVolumePermitted && !evidence.blockedSubmission;
  return { preferred, compiled: plan.attemptCount, recommended, executable: supported ? plan.attemptCount : 0,
    status: evidence.blockedSubmission || plan.problems.length ? 'BLOCKED' : supported ? 'LOCALLY_SUPPORTED' : 'NEEDS_EVIDENCE', reasons };
}
