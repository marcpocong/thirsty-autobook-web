/**
 * Strategy Engine V2: from an operator GOAL (prime window, duration order, court order) and the KNOWN public schedule
 * of the target date to a suggested Smart plan: immediate logical targets (each possibly fanned out), Wave 2
 * candidates and the Rescue pool, inside the 21-candidate authorization.
 *
 * Everything here is a SUGGESTION. It is compiled by precision-simple.ts into the one authoritative backend object
 * (PRECISION_PHASE3); "what will happen" is always described from that object, never from this module.
 * The scores rank the operator's own preferences and the evidence quality; they do not predict who wins
 * Onda's server arbitration. Absence of a public booking on an unreleased date is NOT evidence that a slot will be
 * open at release, so it is never called "open".
 *
 * Dependency-free (types only) so the renderer, the main process and tests share one engine.
 */
import type { SmartDraft, SmartSlot, SmartWorker } from './precision-simple.js';
import {PRECISION_MAX_FAN_OUT} from './workers.js';

export const STRATEGY_MAX_CANDIDATES = 21;
export const STRATEGY_WORKERS: readonly SmartWorker[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
export const PUBLIC_CONFLICT_OVERRIDE = 'OPERATOR_OVERRIDE_PUBLIC_CONFLICT' as const;
/**
 * Largest enumeration accepted by validateGoal(): seven courts, every duration from one to three hours, and the
 * full 08:00-midnight window. Keep the bounded IPC validator aligned with this Strategy-domain limit.
 */
export const STRATEGY_MAX_ENUMERATED_WINDOWS = 7 * ((24 - 8 - 3 + 1) + (24 - 8 - 2 + 1) + (24 - 8 - 1 + 1));

export interface StrategyGoal {
  /** First hour a window may start, "HH:00" (default 17:00). */
  primeFrom: string;
  /** Latest end, "HH:00" or "24:00" (midnight, default). */
  primeUntil: string;
  /** Preferred durations, most preferred first (e.g. [3, 2, 1]). */
  durations: number[];
  /** Court priority, most preferred first. */
  courts: number[];
  /** Preferred start within the prime window; default: its middle for the preferred duration. */
  preferredStart?: string;
}
export const DEFAULT_STRATEGY_GOAL: StrategyGoal = Object.freeze({ primeFrom: '17:00', primeUntil: '24:00', durations: [3, 2, 1], courts: [7, 6, 5, 4, 3, 2, 1] }) as StrategyGoal;

/**
 * Hour-level evidence for the target date, from the read-only block audit (public-booking records plus the
 * availability feed). Unreleased date: a hour with no public record is NO_KNOWN_PUBLIC_CONFLICT, never OPEN.
 */
export type HourEvidence = 'NO_KNOWN_PUBLIC_CONFLICT' | 'KNOWN_PUBLIC_BOOKING_CONFLICT' | 'UNKNOWN_PUBLIC_QUERY_FAILED' | 'PUBLISHED_OPEN' | 'PUBLISHED_UNAVAILABLE';
export type WindowEvidence = HourEvidence;
export interface KnownSchedule { date: string; checkedAt: string; hours: ReadonlyMap<string, HourEvidence> }
export const WINDOW_EVIDENCE_LABEL: Record<WindowEvidence, string> = {
  NO_KNOWN_PUBLIC_CONFLICT: 'No known public conflict',
  KNOWN_PUBLIC_BOOKING_CONFLICT: 'Known public booking conflict',
  UNKNOWN_PUBLIC_QUERY_FAILED: 'Unknown · public query failed',
  PUBLISHED_OPEN: 'Published open (released schedule)',
  PUBLISHED_UNAVAILABLE: 'Published unavailable',
};
/** Severity order: a window is as bad as its worst hour. */
const SEVERITY: readonly WindowEvidence[] = ['KNOWN_PUBLIC_BOOKING_CONFLICT', 'PUBLISHED_UNAVAILABLE', 'UNKNOWN_PUBLIC_QUERY_FAILED', 'NO_KNOWN_PUBLIC_CONFLICT', 'PUBLISHED_OPEN'];
const CONFLICTS: ReadonlySet<WindowEvidence> = new Set(['KNOWN_PUBLIC_BOOKING_CONFLICT', 'PUBLISHED_UNAVAILABLE']);
export const isConflict = (evidence: WindowEvidence) => CONFLICTS.has(evidence);

/** Block-audit cell as emitted by the runner (ui-events blockAudit). */
export interface BlockAuditCell { court: number; hour: string; status: 'OPEN' | 'BLOCKED' | 'UNRELEASED' | 'UNKNOWN'; source: string }
export function knownScheduleFromCells(date: string, checkedAt: string, cells: readonly BlockAuditCell[]): KnownSchedule {
  const hours = new Map<string, HourEvidence>();
  for (const cell of cells) {
    const evidence: HourEvidence = cell.status === 'BLOCKED' ? (cell.source === 'PUBLIC_BOOKING' ? 'KNOWN_PUBLIC_BOOKING_CONFLICT' : 'PUBLISHED_UNAVAILABLE')
      : cell.status === 'OPEN' ? 'PUBLISHED_OPEN' : cell.status === 'UNRELEASED' ? 'NO_KNOWN_PUBLIC_CONFLICT' : 'UNKNOWN_PUBLIC_QUERY_FAILED';
    hours.set(`${cell.court}/${cell.hour}`, evidence);
  }
  return { date, checkedAt, hours };
}

const hourOf = (time: string) => time === '24:00' ? 24 : Number(time.slice(0, 2));
const hourText = (hour: number) => `${String(hour).padStart(2, '0')}:00`;
export interface Window { court: number; start: string; durationHours: number }
export const windowEnd = (window: Window) => hourText(hourOf(window.start) + window.durationHours);
export const windowKey = (window: Window) => `${window.court}/${window.start}/${window.durationHours}`;
const overlaps = (a: Window, b: Window) => a.court === b.court && hourOf(a.start) < hourOf(b.start) + b.durationHours && hourOf(b.start) < hourOf(a.start) + a.durationHours;

export function validateGoal(goal: StrategyGoal): string[] {
  const problems: string[] = [];
  const from = hourOf(goal.primeFrom), until = hourOf(goal.primeUntil);
  if (!/^(0[89]|1\d|2[0-3]):00$/.test(goal.primeFrom)) problems.push('The prime window must start on a whole hour from 08:00.');
  if (!/^(09|1\d|2[0-3]):00$|^24:00$/.test(goal.primeUntil) || !(until > from)) problems.push('The prime window must end after it starts, at the latest at midnight.');
  if (!goal.durations.length || goal.durations.some(value => ![1, 2, 3].includes(value)) || new Set(goal.durations).size !== goal.durations.length)
    problems.push('Choose one or more distinct durations from 1 to 3 hours.');
  if (!goal.courts.length || goal.courts.some(value => !Number.isInteger(value) || value < 1 || value > 7) || new Set(goal.courts).size !== goal.courts.length)
    problems.push('Choose one or more distinct courts from 1 to 7.');
  if (goal.preferredStart !== undefined && !/^(0[89]|1\d|2[0-3]):00$/.test(goal.preferredStart)) problems.push('The preferred start must be a whole hour.');
  return problems;
}

/** Every window inside the prime window: each court × each duration × each start with start + duration ≤ end (midnight included). */
export function enumeratePrimeWindows(goal: StrategyGoal): Window[] {
  if (validateGoal(goal).length) return [];
  const from = hourOf(goal.primeFrom), until = hourOf(goal.primeUntil);
  return goal.courts.flatMap(court => goal.durations.flatMap(durationHours =>
    Array.from({ length: Math.max(0, until - durationHours - from + 1) }, (_, index) => ({ court, start: hourText(from + index), durationHours }))));
}

export function windowEvidence(window: Window, schedule: KnownSchedule | null): { evidence: WindowEvidence; hours: Array<{ hour: string; evidence: HourEvidence }> } {
  const hours = Array.from({ length: window.durationHours }, (_, offset) => hourText(hourOf(window.start) + offset))
    .map(hour => ({ hour, evidence: schedule?.hours.get(`${window.court}/${hour}`) ?? 'UNKNOWN_PUBLIC_QUERY_FAILED' as HourEvidence }));
  const evidence = SEVERITY.find(level => hours.some(hour => hour.evidence === level)) ?? 'UNKNOWN_PUBLIC_QUERY_FAILED';
  return { evidence, hours };
}

/** Explicit, explainable preference score (0–100). It ranks the operator's preferences; it predicts nothing about winning. */
export interface WindowScore { total: number; duration: number; primeFit: number; court: number; evidence: number }
export function preferredStartFor(goal: StrategyGoal, durationHours: number): number {
  if (goal.preferredStart) return hourOf(goal.preferredStart);
  const from = hourOf(goal.primeFrom), lastStart = hourOf(goal.primeUntil) - durationHours;
  return Math.floor((from + Math.max(from, lastStart)) / 2);
}
export function scoreWindow(window: Window, goal: StrategyGoal, evidence: WindowEvidence): WindowScore {
  const durationRank = goal.durations.indexOf(window.durationHours), courtRank = goal.courts.indexOf(window.court);
  const duration = durationRank < 0 ? 0 : 40 * (goal.durations.length - durationRank) / goal.durations.length;
  const court = courtRank < 0 ? 0 : 25 * (goal.courts.length - courtRank) / goal.courts.length;
  const span = Math.max(1, hourOf(goal.primeUntil) - hourOf(goal.primeFrom));
  const primeFit = 20 * Math.max(0, 1 - Math.abs(hourOf(window.start) - preferredStartFor(goal, window.durationHours)) / span);
  const evidenceScore = evidence === 'PUBLISHED_OPEN' ? 15 : evidence === 'NO_KNOWN_PUBLIC_CONFLICT' ? 12 : 0;
  const round = (value: number) => Math.round(value * 10) / 10;
  return { total: round(duration + primeFit + court + evidenceScore), duration: round(duration), primeFit: round(primeFit), court: round(court), evidence: evidenceScore };
}

export type SuggestionIntelligenceMode = 'AUTO' | 'PREFERENCE_ONLY';
export type HistoricalEvidenceStrength = 'NONE' | 'LIMITED' | 'USABLE' | 'STRONG';
export interface HistoricalRangeEvidence {
  court: number; start: string; durationHours: number; wellObserved: number; fullyOpenFirst: number;
  stillOpenAt1s: { observed: number; open: number }; stillOpenAt5s: { observed: number; open: number };
  reopened: number; good: number; fair: number;
}
export interface HistoricalSharedRisk {
  a: string; b: string; sharedCells: number; overlappingHours: number; bothObserved: number; coUnavailable: number; sameEarlyLoss: number;
}
/** Sanitized, same-weekday DTO derived by the desktop process. It contains no paths, customer data, or authorization. */
export interface StrategyHistoricalEvidence {
  targetDate: string; dayOfWeek: string; releasesConsidered: number; wellObservedReleases: number; realReleases: number; historicalPrePhase3: number;
  strength: HistoricalEvidenceStrength; ranges: HistoricalRangeEvidence[]; sharedRisk: HistoricalSharedRisk[];
}
export const historicalStrength = (wellObservedReleases: number): HistoricalEvidenceStrength =>
  wellObservedReleases <= 0 ? 'NONE' : wellObservedReleases < 3 ? 'LIMITED' : wellObservedReleases < 5 ? 'USABLE' : 'STRONG';

export type StrategyPreset = 'BALANCED' | 'RELEASE_FOCUSED' | 'RESCUE_FOCUSED' | 'CUSTOM';
export const STRATEGY_PRESET_LABEL: Record<StrategyPreset, string> = { BALANCED: 'Balanced', RELEASE_FOCUSED: 'Release focused', RESCUE_FOCUSED: 'Rescue focused', CUSTOM: 'Custom' };
export interface PresetAllocation { immediateTargets: number; fanOutWidth: number; standby: number; wave2: boolean; rescue: boolean; rescueMax: number; concurrentWave2: boolean }
/**
 * How a preset spends the ready workers. Nothing is a fixed count: it follows the ready workers and this machine's
 * measured fan-out recommendation (1 when there is no profile). An explicit width is an operator override.
 */
export function presetAllocation(preset: Exclude<StrategyPreset, 'CUSTOM'>, input: { readyWorkers: number; recommendedFanOutWidth: number; fanOutWidthOverride?: number }): PresetAllocation {
  const workers = Math.max(0, Math.min(STRATEGY_WORKERS.length, Math.floor(input.readyWorkers)));
  const recommended = Math.max(1, Math.min(PRECISION_MAX_FAN_OUT, Math.floor(input.recommendedFanOutWidth) || 1));
  const width = (value: number) => Math.max(1, Math.min(PRECISION_MAX_FAN_OUT, input.fanOutWidthOverride ?? value));
  if (!workers) return { immediateTargets: 0, fanOutWidth: 1, standby: 0, wave2: false, rescue: false, rescueMax: 0, concurrentWave2: false };
  if (preset === 'RELEASE_FOCUSED') return { immediateTargets: workers, fanOutWidth: width(recommended), standby: 0, wave2: false, rescue: true, rescueMax: Math.min(2, workers), concurrentWave2: false };
  if (preset === 'RESCUE_FOCUSED') { const immediate = Math.max(1, Math.ceil(workers / 3));
    return { immediateTargets: immediate, fanOutWidth: width(Math.min(recommended, 2)), standby: workers - immediate, wave2: workers - immediate > 0, rescue: true,
      rescueMax: Math.min(7, Math.max(2, workers - immediate)), concurrentWave2: false }; }
  const immediate = Math.max(1, Math.round(workers * 4 / 7));
  return { immediateTargets: immediate, fanOutWidth: width(recommended), standby: workers - immediate, wave2: workers - immediate > 0, rescue: true,
    rescueMax: Math.min(7, Math.max(1, workers - immediate)), concurrentWave2: false };
}

export type RoleAffinity = 'STRONG_WAVE_2' | 'STRONG_RESCUE' | 'SUITABLE_FOR_EITHER' | 'GENERAL_BACKUP';
export interface ScoredWindow extends Window { end: string; evidence: WindowEvidence; score: WindowScore; forced: boolean;
  historical?: HistoricalRangeEvidence; rationale: string[]; roleAffinity?: RoleAffinity }
export interface SuggestedPlan {
  immediate: ScoredWindow[]; backups: ScoredWindow[];
  /** Windows left out and why (known conflicts, failed reads, capacity). */
  excluded: Array<ScoredWindow & { reason: 'KNOWN_CONFLICT' | 'EVIDENCE_UNKNOWN' | 'CAPACITY' | 'OVERLAPS_IMMEDIATE' }>;
  reasons: string[];
  allocation: PresetAllocation;
  intelligence: { requested: SuggestionIntelligenceMode; applied: 'HISTORY_ASSISTED' | 'PREFERENCE_BASED'; strength: HistoricalEvidenceStrength; label: string };
}
export interface SuggestInput {
  goal: StrategyGoal; schedule: KnownSchedule | null; allocation: PresetAllocation;
  intelligenceMode?: SuggestionIntelligenceMode;
  historicalEvidence?: StrategyHistoricalEvidence | null;
  /** Windows the operator deliberately keeps despite a known conflict or failed read. */
  forceInclude?: readonly Window[];
  /** Windows the operator removed; never suggested again. */
  exclude?: readonly Window[];
}

const share = (part: number, whole: number) => whole ? part / whole : -1;
const compareNumbers = (a: readonly number[], b: readonly number[]) => {
  for (let index = 0; index < Math.max(a.length, b.length); index++) if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
  return 0;
};
const riskKey = (a: Window, b: Window) => [windowKey(a), windowKey(b)].sort().join('|');
function aggregateRisk(window: Window, selected: readonly Window[], history: StrategyHistoricalEvidence | null) {
  let sharedCells = 0, overlappingHours = 0, coUnavailable = 0, sameEarlyLoss = 0;
  for (const other of selected) {
    const staticOverlap = rangeClockOverlap(window, other), sameCourt = window.court === other.court;
    sharedCells += sameCourt ? staticOverlap : 0; overlappingHours += staticOverlap;
    const item = history?.sharedRisk.find(value => `${value.a}|${value.b}` === riskKey(window, other));
    if (item) { coUnavailable += item.coUnavailable; sameEarlyLoss += item.sameEarlyLoss; }
  }
  return { sharedCells, overlappingHours, coUnavailable, sameEarlyLoss };
}
function rangeClockOverlap(a: Window, b: Window) {
  return Math.max(0, Math.min(hourOf(a.start) + a.durationHours, hourOf(b.start) + b.durationHours) - Math.max(hourOf(a.start), hourOf(b.start)));
}
function historyLines(item: HistoricalRangeEvidence | undefined, day: string, strength: HistoricalEvidenceStrength): string[] {
  if (!item || !item.wellObserved) return strength === 'NONE' ? [] : [`No well-observed ${day} release covers this range.`];
  const lines = [`Fully open in first usable snapshot in ${item.fullyOpenFirst} of ${item.wellObserved} well-observed ${day} release${item.wellObserved === 1 ? '' : 's'}.`];
  if (item.stillOpenAt1s.observed) lines.push(`Still observed open at +1 s in ${item.stillOpenAt1s.open} of ${item.stillOpenAt1s.observed} measured releases.`);
  if (item.stillOpenAt5s.observed) lines.push(`Still observed open at +5 s in ${item.stillOpenAt5s.open} of ${item.stillOpenAt5s.observed} measured releases.`);
  if (item.reopened) lines.push(`Observed cache-certain reopening in ${item.reopened} of ${item.wellObserved} well-observed releases.`);
  if (strength === 'LIMITED') lines.push(`Limited historical evidence: ${item.wellObserved} well-observed release${item.wellObserved === 1 ? '' : 's'}; history did not change ranking.`);
  return lines;
}
function affinity(item: HistoricalRangeEvidence | undefined): RoleAffinity {
  if (!item) return 'GENERAL_BACKUP';
  const wave2 = item.stillOpenAt1s.observed > 0 && share(item.stillOpenAt1s.open, item.stillOpenAt1s.observed) >= .5;
  const rescue = item.reopened >= 2;
  return wave2 && rescue ? 'SUITABLE_FOR_EITHER' : rescue ? 'STRONG_RESCUE' : wave2 ? 'STRONG_WAVE_2' : 'GENERAL_BACKUP';
}

/**
 * Suggests immediate targets and the backup/Rescue pool.
 * - Known public conflicts are avoided; unknown or failed public reads are excluded (fail closed) unless force-included.
 * - Immediate targets use distinct courts in priority order and are DIVERSIFIED across start times: each court takes
 *   its best window whose start is not yet used by another immediate target, so one time-wide unavailable block
 *   cannot take out every immediate attempt. Only when no unused start remains is a start reused.
 * - The pool (Wave 2 + Rescue) is filled by score up to the 21-candidate authorization.
 */
export function suggestPlan(input: SuggestInput): SuggestedPlan {
  const { goal, allocation } = input;
  const requested = input.intelligenceMode ?? 'AUTO', suppliedHistory = input.historicalEvidence ?? null;
  const strength = suppliedHistory?.strength ?? 'NONE';
  const history = requested === 'AUTO' && (strength === 'USABLE' || strength === 'STRONG') ? suppliedHistory : null;
  const applied = history ? 'HISTORY_ASSISTED' as const : 'PREFERENCE_BASED' as const;
  const rangeHistory = new Map((suppliedHistory?.ranges ?? []).map(value => [windowKey(value), value] as const));
  const removed = new Set((input.exclude ?? []).map(windowKey)), forced = new Set((input.forceInclude ?? []).map(windowKey));
  const scored: ScoredWindow[] = enumeratePrimeWindows(goal).filter(window => !removed.has(windowKey(window))).map(window => {
    const { evidence } = windowEvidence(window, input.schedule);
    const historical = rangeHistory.get(windowKey(window));
    return { ...window, end: windowEnd(window), evidence, score: scoreWindow(window, goal, evidence), forced: forced.has(windowKey(window)), historical,
      rationale: [`Preferred duration rank ${goal.durations.indexOf(window.durationHours) + 1}.`, WINDOW_EVIDENCE_LABEL[evidence], ...historyLines(historical, suppliedHistory?.dayOfWeek ?? 'same-weekday', strength)] };
    // Equal scores: court priority first, then the later start (deeper into the prime evening), so the order is deterministic.
  }).sort((a, b) => b.score.total - a.score.total || goal.courts.indexOf(a.court) - goal.courts.indexOf(b.court) || b.start.localeCompare(a.start));
  const excluded: SuggestedPlan['excluded'] = [];
  const usable = scored.filter(window => {
    if (window.forced) return true;
    if (isConflict(window.evidence)) { excluded.push({ ...window, reason: 'KNOWN_CONFLICT' }); return false; }
    if (window.evidence === 'UNKNOWN_PUBLIC_QUERY_FAILED') { excluded.push({ ...window, reason: 'EVIDENCE_UNKNOWN' }); return false; }
    return true;
  });
  const immediate: ScoredWindow[] = [], usedStarts = new Set<string>();
  // Forced windows the operator chose are honoured first, in their court's priority order.
  for (const window of usable.filter(value => value.forced)) {
    if (immediate.length >= allocation.immediateTargets) break;
    if (immediate.some(value => value.court === window.court)) continue;
    immediate.push(window); usedStarts.add(window.start);
  }
  if (!history) for (const windows of goal.courts.map(court => usable.filter(window => window.court === court))) {
    if (immediate.length >= allocation.immediateTargets) break;
    if (!windows.length || immediate.some(value => value.court === windows[0]!.court)) continue;
    const preferredDuration = goal.durations.find(duration => windows.some(window => window.durationHours === duration));
    const sameDuration = windows.filter(window => window.durationHours === preferredDuration);
    const pick = sameDuration.find(window => !usedStarts.has(window.start)) ?? sameDuration[0];
    if (pick) { immediate.push(pick); usedStarts.add(pick.start); }
  }
  while (history && immediate.length < allocation.immediateTargets) {
    const choices = usable.filter(window => !immediate.some(value => value.court === window.court));
    if (!choices.length) break;
    const ranked = choices.map(window => {
      const h = window.historical, risk = aggregateRisk(window, immediate, history);
      return { window, keys: [goal.durations.indexOf(window.durationHours), window.evidence === 'PUBLISHED_OPEN' ? 0 : 1,
        history ? -share(h?.fullyOpenFirst ?? 0, h?.wellObserved ?? 0) : 0, history ? -share(h?.stillOpenAt1s.open ?? 0, h?.stillOpenAt1s.observed ?? 0) : 0,
        risk.sharedCells, risk.overlappingHours, risk.coUnavailable, risk.sameEarlyLoss, usedStarts.has(window.start) ? 1 : 0,
        goal.courts.indexOf(window.court), -window.score.primeFit, -hourOf(window.start)] };
    }).sort((a, b) => compareNumbers(a.keys, b.keys));
    const pick = ranked[0]?.window;
    if (!pick) break;
    if (immediate.length && !usedStarts.has(pick.start)) pick.rationale.push('Adds a different start time from earlier immediate targets.');
    immediate.push(pick); usedStarts.add(pick.start);
  }
  const reasons: string[] = [];
  const starts = [...new Set(immediate.map(window => window.start))];
  if (immediate.length > 1 && starts.length > 1) reasons.push('Diversified across start times to reduce one-window concentration.');
  if (immediate.length > 1 && starts.length === 1) reasons.push(`Every immediate target shares ${immediate[0]!.start}–${immediate[0]!.end}: no other start time is available under the current goal and evidence.`);
  if (immediate.length < allocation.immediateTargets) reasons.push(`Only ${immediate.length} of ${allocation.immediateTargets} immediate targets could be filled from courts without known conflicts.`);
  const capacity = Math.max(0, STRATEGY_MAX_CANDIDATES - immediate.length);
  const backups: ScoredWindow[] = [];
  const remaining = usable.filter(window => !immediate.some(value => windowKey(value) === windowKey(window)));
  if (!history) while (backups.length < capacity && remaining.length) backups.push(remaining.shift()!);
  while (history && backups.length < capacity && remaining.length) {
    const selected = [...immediate, ...backups];
    const ranked = remaining.map(window => { const h = window.historical, risk = aggregateRisk(window, selected, history), role = affinity(h);
      return { window, role, keys: [goal.durations.indexOf(window.durationHours), window.evidence === 'PUBLISHED_OPEN' ? 0 : 1,
        history ? -share(h?.stillOpenAt1s.open ?? 0, h?.stillOpenAt1s.observed ?? 0) : 0, history ? -share(h?.stillOpenAt5s.open ?? 0, h?.stillOpenAt5s.observed ?? 0) : 0,
        history ? -share(h?.fullyOpenFirst ?? 0, h?.wellObserved ?? 0) : 0, risk.sharedCells, risk.overlappingHours, risk.coUnavailable,
        role === 'STRONG_RESCUE' || role === 'SUITABLE_FOR_EITHER' ? -1 : 0, goal.courts.indexOf(window.court), -window.score.primeFit, -hourOf(window.start)] }; })
      .sort((a, b) => compareNumbers(a.keys, b.keys));
    const best = ranked[0]!; best.window.roleAffinity = best.role;
    if (selected.length && aggregateRisk(best.window, selected, history).overlappingHours === 0) best.window.rationale.push('Adds a different clock-hour block from earlier selections.');
    backups.push(best.window); remaining.splice(remaining.indexOf(best.window), 1);
  }
  for (const window of remaining) excluded.push({ ...window, reason: 'CAPACITY' });
  const conflicts = excluded.filter(window => window.reason === 'KNOWN_CONFLICT').length, unknown = excluded.filter(window => window.reason === 'EVIDENCE_UNKNOWN').length;
  if (conflicts) reasons.push(`${conflicts} window${conflicts === 1 ? '' : 's'} left out because a known public booking conflicts.`);
  if (unknown) reasons.push(`${unknown} window${unknown === 1 ? '' : 's'} left out because the public-booking read failed or is missing (fail closed).`);
  const capacityExcluded = excluded.filter(window => window.reason === 'CAPACITY').length;
  if (capacityExcluded) reasons.push(`${capacityExcluded} window${capacityExcluded === 1 ? '' : 's'} excluded by the candidate-capacity limit after diversification.`);
  const forcedCount = [...immediate, ...backups].filter(window => window.forced && (isConflict(window.evidence) || window.evidence === 'UNKNOWN_PUBLIC_QUERY_FAILED')).length;
  if (forcedCount) reasons.push(`${forcedCount} window${forcedCount === 1 ? ' was' : 's were'} force-included by the operator despite a conflict or failed read.`);
  const legacy = suppliedHistory?.historicalPrePhase3 ? ` · includes ${suppliedHistory.historicalPrePhase3} pre-Phase-3 release${suppliedHistory.historicalPrePhase3 === 1 ? '' : 's'}` : '';
  const label = applied === 'HISTORY_ASSISTED' ? `History-assisted · ${strength.toLowerCase()} same-weekday evidence${legacy}`
    : requested === 'PREFERENCE_ONLY' ? 'Preference-based · operator selected' : `Preference-based · ${strength === 'LIMITED' ? 'insufficient historical evidence' : 'no suitable historical evidence'}`;
  return { immediate, backups, excluded, reasons, allocation, intelligence: { requested, applied, strength, label } };
}

/** Per-slot public-evidence override marker persisted with the authorization (OPERATOR_OVERRIDE_PUBLIC_CONFLICT). */
export interface SlotEvidenceMark { evidence: WindowEvidence; override?: typeof PUBLIC_CONFLICT_OVERRIDE }

/**
 * Turns a suggestion into a Smart draft for precision-simple.compileSmartPlan (rates, workers and advanced overrides
 * are kept from `base`). `fanOutOffsets` gives the child offsets for the allocation's width (from fanout-timing.ts);
 * width 1 means a single child at the release instant.
 */
export function draftFromSuggestion(plan: SuggestedPlan, base: SmartDraft, fanOutOffsets: readonly number[]): SmartDraft {
  const withOverride = (window: ScoredWindow): SmartSlot => ({ court: window.court, start: window.start, durationHours: window.durationHours,
    ...(window.forced && (isConflict(window.evidence) || window.evidence === 'UNKNOWN_PUBLIC_QUERY_FAILED')
      ? { publicEvidence: { evidence: window.evidence, override: PUBLIC_CONFLICT_OVERRIDE } } : {}) });
  const fanOut = fanOutOffsets.length > 1 ? { fanOutOffsetsMs: [...fanOutOffsets] } : fanOutOffsets[0] ? { releaseOffsetMs: fanOutOffsets[0] } : {};
  return { ...base, immediate: plan.immediate.map(window => ({ ...withOverride(window), ...fanOut })), backups: plan.backups.map(withOverride),
    useBackupsImmediately: plan.allocation.concurrentWave2, retryReopened: plan.allocation.rescue,
    maxReopenedAttempts: Math.max(1, plan.allocation.rescueMax || 1),
    advanced: { ...(plan.allocation.standby ? {} : { standby: [] }) } };
}
