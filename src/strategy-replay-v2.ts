import { compileSmartPlan, confirmSmartRates, emptySmartDraft } from './precision-simple.js';
import { MATRIX_COURTS, MATRIX_HOURS } from './api-booking/court-hour-matrix.js';
import type { ObserverLog } from './release-forensics.js';
import type { ReleaseRecord } from './release-intelligence.js';
import { replayRelease, type ReplayPlan, type ReplayResult } from './strategy-replay.js';
import { DEFAULT_STRATEGY_GOAL, draftFromSuggestion, presetAllocation, suggestPlan, type HourEvidence, type KnownSchedule, type StrategyGoal, type StrategyPreset,
  type StrategyHistoricalEvidence, type SuggestedPlan, type SuggestionIntelligenceMode } from './strategy-engine.js';

/**
 * Strategy V2 replay: COUNTERFACTUAL strategy analysis. It asks what a proposed Strategy V2 would have done with the
 * evidence a recorded release actually produced:
 *   - the known schedule is the newest public-booking read made BEFORE release (what the operator could have seen);
 *   - the Strategy Engine suggests and compiles the plan exactly as the Strategy view would;
 *   - the compiled plan runs through the production Phase 3 replay (strategy-replay.ts) twice: immediate attempts
 *     rejected, and immediate attempts UNKNOWN (which must block every later send).
 * It reports observed opportunities and blocks only. It never claims that a booking would have succeeded.
 */
export const COUNTERFACTUAL_LABEL = 'Counterfactual strategy analysis: what the proposed plan would have been allowed to try on this recorded evidence. It does not show that any booking would have succeeded.';
export interface StrategyReplayInput { goal?: StrategyGoal; preset?: Exclude<StrategyPreset, 'CUSTOM'>; readyWorkers?: number; fanOutWidth?: number;
  intelligenceMode?:SuggestionIntelligenceMode; historicalEvidence?:StrategyHistoricalEvidence|null;
  /** Child offsets for the fan-out width (from fanout-timing.ts); default spaced 10 ms, last child at 0. */
  fanOutOffsetsMs?: number[]; securityRefreshMs?: number }
export interface StrategyReplayV2 {
  counterfactual: true; label: string; releaseKey: string; targetDate: string;
  knownSchedule: { readAtOffsetMs: number | null; knownConflicts: number; unknownCourts: number[] };
  suggestion: Pick<SuggestedPlan, 'reasons' | 'allocation'> & { immediate: string[]; backups: number; excludedConflicts: number; excludedUnknown: number };
  authorizedCandidates: number; immediateTargets: number; immediateSends: number; fanOutWidth: number;
  wave2: ReplayResult['backup']; rescue: ReplayResult['rescue'];
  /** Openings of authorized backup/Rescue candidates seen only in evidence the rules may not act on (stale, unbounded cache, incomplete). */
  skippedStaleOpenings: number;
  /** In the UNKNOWN scenario nothing later may be sent; true when that held. */
  unknownBlocksLaterSends: boolean;
  statement: string; rejectedScenario: ReplayResult; unknownScenario: ReplayResult;
}
const hourText = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

/** Known schedule from the newest pre-release public-booking read of the log (null when none was recorded). */
export function scheduleFromObserverLog(log: ObserverLog): { schedule: KnownSchedule | null; readAtOffsetMs: number | null; unknownCourts: number[] } {
  const read = log.bookings.filter(value => value.outcome === 'ok' && value.requestOffsetMs < 0).sort((a, b) => b.requestOffsetMs - a.requestOffsetMs)[0];
  if (!read || !log.bookingsItemized) return { schedule: null, readAtOffsetMs: null, unknownCourts: [...MATRIX_COURTS] };
  const hours = new Map<string, HourEvidence>(), booked = new Set(read.cells);
  for (const court of MATRIX_COURTS) for (const hour of MATRIX_HOURS) hours.set(`${court}/${hour}`,
    read.failedCourts.includes(court) ? 'UNKNOWN_PUBLIC_QUERY_FAILED' : booked.has(`${court}/${hour}`) ? 'KNOWN_PUBLIC_BOOKING_CONFLICT' : 'NO_KNOWN_PUBLIC_CONFLICT');
  return { schedule: { date: log.date, checkedAt: new Date(log.releaseMs + read.requestOffsetMs).toISOString(), hours }, readAtOffsetMs: read.requestOffsetMs, unknownCourts: [...read.failedCourts] };
}

export function replayStrategyV2(log: ObserverLog, record: Pick<ReleaseRecord, 'key' | 'origin' | 'quality' | 'attempts'>, input: StrategyReplayInput = {}): StrategyReplayV2 {
  const goal = input.goal ?? DEFAULT_STRATEGY_GOAL, known = scheduleFromObserverLog(log);
  const allocation = presetAllocation(input.preset ?? 'BALANCED', { readyWorkers: input.readyWorkers ?? 7, recommendedFanOutWidth: input.fanOutWidth ?? 1 });
  const suggestion = suggestPlan({ goal, schedule: known.schedule, allocation, intelligenceMode:input.intelligenceMode, historicalEvidence:input.historicalEvidence });
  const width = allocation.fanOutWidth, offsets = input.fanOutOffsetsMs ?? Array.from({ length: width }, (_, index) => (index - width + 1) * 10 + 0);
  // Replay-only rates: grid prices drive every adaptive send; immediate prices never matter to what is observed.
  const draft = draftFromSuggestion(suggestion, { ...emptySmartDraft(), rates: confirmSmartRates(600, 700, 'VENUE_SCHEDULE', log.date, new Date(log.releaseMs - 3_600_000)) },
    width > 1 ? offsets : [0]);
  const compiled = compileSmartPlan(draft, { targetDate: log.date });
  const empty = (): ReplayResult => ({ releaseKey: record.key, targetDate: log.date, releaseAt: new Date(log.releaseMs).toISOString(), origin: record.origin, quality: record.quality.label,
    statement: 'Evidence was insufficient to evaluate authorized opportunities.', assumptions: [], censored: ['No plan could be suggested from the pre-release evidence.'], immediate: [],
    fitness: {}, backup: null, rescue: [], conflicts: [], forensicOpenings: [] });
  const plan: ReplayPlan | null = compiled.phase3 ? { candidates: compiled.phase3.candidates, standby: compiled.phase3.standby, budgets: compiled.phase3.budgets,
    concurrentWave2: compiled.phase3.concurrentWave2, rescueEnabled: compiled.phase3.rescueEnabled,
    wave1: compiled.phase3.wave1.map(value => ({ workerId: value.workerId, candidateIndex: value.candidateIndex, ...(value.fanOutOffsetsMs ? { fanOutOffsetsMs: value.fanOutOffsetsMs } : {}) })) } : null;
  const options = { ...(input.securityRefreshMs !== undefined ? { securityRefreshMs: input.securityRefreshMs } : {}) };
  const rejected = plan ? replayRelease(plan, log, record, { ...options, immediateResult: 'REJECTED' }) : empty();
  const unknown = plan ? replayRelease(plan, log, record, { ...options, immediateResult: 'UNKNOWN' }) : empty();
  const sends = compiled.phase3 ? compiled.phase3.wave1.reduce((sum, value) => sum + (value.fanOutOffsetsMs?.length ?? 1), 0) : 0;
  return { counterfactual: true, label: COUNTERFACTUAL_LABEL, releaseKey: record.key, targetDate: log.date,
    knownSchedule: { readAtOffsetMs: known.readAtOffsetMs, knownConflicts: known.schedule ? [...known.schedule.hours.values()].filter(value => value === 'KNOWN_PUBLIC_BOOKING_CONFLICT').length : 0,
      unknownCourts: known.unknownCourts },
    suggestion: { reasons: suggestion.reasons, allocation: suggestion.allocation, immediate: suggestion.immediate.map(window => `C${window.court} ${window.start}-${window.end}`),
      backups: suggestion.backups.length, excludedConflicts: suggestion.excluded.filter(value => value.reason === 'KNOWN_CONFLICT').length,
      excludedUnknown: suggestion.excluded.filter(value => value.reason === 'EVIDENCE_UNKNOWN').length },
    authorizedCandidates: compiled.phase3?.candidates.length ?? 0, immediateTargets: compiled.phase3?.wave1.length ?? 0, immediateSends: sends, fanOutWidth: width,
    wave2: rejected.backup, rescue: rejected.rescue,
    skippedStaleOpenings: rejected.forensicOpenings.filter(value => !['ACTIONABLE_FRESH', 'ACTIONABLE_BOUNDED_CACHE'].includes(value.fitness)).length,
    unknownBlocksLaterSends: !unknown.backup && unknown.rescue.length === 0,
    statement: rejected.statement, rejectedScenario: rejected, unknownScenario: unknown };
}

/** Plain-text report (no private data: only courts, hours, offsets and counts). */
export function strategyReplayText(result: StrategyReplayV2): string {
  const lines = [result.label, '', `Release ${result.releaseKey} (target ${result.targetDate})`,
    `Known schedule: ${result.knownSchedule.readAtOffsetMs === null ? 'no pre-release public-booking read' : `public bookings read ${(result.knownSchedule.readAtOffsetMs / 1000).toFixed(1)} s before release`}; `
      + `${result.knownSchedule.knownConflicts} booked court-hours${result.knownSchedule.unknownCourts.length ? `; unknown courts ${result.knownSchedule.unknownCourts.join(',')}` : ''}`,
    `Authorized candidates: ${result.authorizedCandidates} · immediate targets: ${result.immediateTargets} · fan-out ${result.fanOutWidth} per target (${result.immediateSends} sends)`,
    `Immediate: ${result.suggestion.immediate.join(', ') || 'none'}`, ...result.suggestion.reasons.map(reason => `  ${reason}`),
    `Wave 2: ${result.wave2 ? `${result.wave2.selections.map(value => `C${value.court} ${value.startTime}-${value.endTime} (worker ${value.workerId})`).join(', ')} at +${(result.wave2.atResponseOffsetMs / 1000).toFixed(1)} s` : 'no actionable opportunity'}`,
    `Rescue: ${result.rescue.length ? result.rescue.map(value => `C${value.court} ${value.startTime}-${value.endTime} at +${(value.atResponseOffsetMs / 1000).toFixed(1)} s (worker ${value.workerId})`).join('; ') : 'no actionable reopening'}`,
    `Openings visible only in non-actionable evidence: ${result.skippedStaleOpenings}`,
    `UNKNOWN scenario blocks every later send: ${result.unknownBlocksLaterSends ? 'yes' : 'NO'}`,
    `Statement: ${result.statement}`, ...result.rejectedScenario.censored.map(value => `Censored: ${value}`)];
  return `${lines.join('\n')}\n`;
}
export const replayWindowsForGoal = (goal: StrategyGoal) => Array.from({ length: (goal.primeUntil === '24:00' ? 24 : Number(goal.primeUntil.slice(0, 2))) - Number(goal.primeFrom.slice(0, 2)) }, (_, index) => hourText(Number(goal.primeFrom.slice(0, 2)) + index));
