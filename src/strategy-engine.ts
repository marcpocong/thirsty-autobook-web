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
  /** Legacy explicit preferred start, retained for old saved metadata. New plans use idealStart. */
  preferredStart?: string;
  /** Explicit ideal start. Old metadata defaults to its earliest accepted hour. */
  idealStart?: string;
}
export const DEFAULT_STRATEGY_GOAL: StrategyGoal = Object.freeze({ idealStart: '17:00', primeFrom: '17:00', primeUntil: '24:00', durations: [3, 2, 1], courts: [7, 6, 5, 4, 3, 2, 1] }) as StrategyGoal;

/**
 * Hour-level evidence for the target date, from the read-only block audit (public-booking records plus the
 * availability feed). Unreleased date: a hour with no public record is NO_KNOWN_PUBLIC_CONFLICT, never OPEN.
 */
export type HourEvidence = 'NOT_CHECKED' | 'NO_KNOWN_PUBLIC_CONFLICT' | 'KNOWN_PUBLIC_BOOKING_CONFLICT' | 'UNKNOWN_PUBLIC_QUERY_FAILED' | 'PUBLISHED_OPEN' | 'PUBLISHED_UNAVAILABLE';
export type WindowEvidence = HourEvidence;
export interface KnownSchedule { date: string; checkedAt: string; hours: ReadonlyMap<string, HourEvidence> }
export const WINDOW_EVIDENCE_LABEL: Record<WindowEvidence, string> = {
  NOT_CHECKED: 'Public schedule not checked',
  NO_KNOWN_PUBLIC_CONFLICT: 'No known public conflict',
  KNOWN_PUBLIC_BOOKING_CONFLICT: 'Known public booking conflict',
  UNKNOWN_PUBLIC_QUERY_FAILED: 'Unknown · public query failed',
  PUBLISHED_OPEN: 'Published open (released schedule)',
  PUBLISHED_UNAVAILABLE: 'Published unavailable',
};
/** Severity order: a window is as bad as its worst hour. */
const SEVERITY: readonly WindowEvidence[] = ['KNOWN_PUBLIC_BOOKING_CONFLICT', 'PUBLISHED_UNAVAILABLE', 'UNKNOWN_PUBLIC_QUERY_FAILED', 'NOT_CHECKED', 'NO_KNOWN_PUBLIC_CONFLICT', 'PUBLISHED_OPEN'];
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

export function validateGoal(goal: StrategyGoal): string[] {
  const problems: string[] = [];
  const from = hourOf(goal.primeFrom), until = hourOf(goal.primeUntil);
  if (!/^(0[89]|1\d|2[0-3]):00$/.test(goal.primeFrom)) problems.push('The prime window must start on a whole hour from 08:00.');
  if (!/^(09|1\d|2[0-3]):00$|^24:00$/.test(goal.primeUntil) || !(until > from)) problems.push('The prime window must end after it starts, at the latest at midnight.');
  if (!goal.durations.length || goal.durations.some(value => ![1, 2, 3].includes(value)) || new Set(goal.durations).size !== goal.durations.length)
    problems.push('Choose one or more distinct durations from 1 to 3 hours.');
  if (!goal.courts.length || goal.courts.some(value => !Number.isInteger(value) || value < 1 || value > 7) || new Set(goal.courts).size !== goal.courts.length)
    problems.push('Choose one or more distinct courts from 1 to 7.');
  if (goal.idealStart !== undefined && (!/^(0[89]|1\d|2[0-3]):00$/.test(goal.idealStart) || hourOf(goal.idealStart) < from || hourOf(goal.idealStart) >= until)) problems.push('Ideal start must be inside the acceptable window.');
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
    .map(hour => ({ hour, evidence: schedule?.hours.get(`${window.court}/${hour}`) ?? (schedule ? 'UNKNOWN_PUBLIC_QUERY_FAILED' : 'NOT_CHECKED') as HourEvidence }));
  const evidence = SEVERITY.find(level => hours.some(hour => hour.evidence === level)) ?? 'UNKNOWN_PUBLIC_QUERY_FAILED';
  return { evidence, hours };
}

/** Explicit, explainable preference score (0–100). It ranks the operator's preferences; it predicts nothing about winning. */
export interface WindowScore { total: number; duration: number; primeFit: number; court: number; evidence: number }
export function preferredStartFor(goal: StrategyGoal, durationHours: number): number {
  return hourOf(goal.idealStart ?? goal.preferredStart ?? goal.primeFrom);
}
export function scoreWindow(window: Window, goal: StrategyGoal, evidence: WindowEvidence): WindowScore {
  const durationRank = goal.durations.indexOf(window.durationHours), courtRank = goal.courts.indexOf(window.court);
  const duration = durationRank < 0 ? 0 : 40 * (goal.durations.length - durationRank) / goal.durations.length;
  const court = courtRank < 0 ? 0 : 25 * (goal.courts.length - courtRank) / goal.courts.length;
  const span = Math.max(1, hourOf(goal.primeUntil) - hourOf(goal.primeFrom));
  const primeFit = 20 * Math.max(0, 1 - Math.abs(hourOf(window.start) - preferredStartFor(goal, window.durationHours)) / span);
  const evidenceScore = evidence === 'PUBLISHED_OPEN' ? 15 : evidence === 'NO_KNOWN_PUBLIC_CONFLICT' ? 12 : evidence === 'UNKNOWN_PUBLIC_QUERY_FAILED' ? -15 : 0;
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
  /** Target ranking, independent of which choices receive initial execution. */
  ranked?: ScoredWindow[];
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
    if (item && item.bothObserved>=3) { coUnavailable += item.coUnavailable; sameEarlyLoss += item.sameEarlyLoss; }
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

/** Legacy evidence/replay adapter. Uses the current shared ranking and portfolio allocator,
 * retaining the replay contract that unknown public reads fail closed unless explicitly included. */
export function suggestPlan(input: SuggestInput): SuggestedPlan {
  const targets=rankTargetPlan(input);
  const unknown=targets.ranked.filter(w=>w.evidence==='UNKNOWN_PUBLIC_QUERY_FAILED'&&!w.forced);
  targets.ranked=targets.ranked.filter(w=>!unknown.includes(w));
  targets.excluded.push(...unknown.map(w=>({...w,reason:'EVIDENCE_UNKNOWN' as const})));
  const result=buildExecutionStrategy(targets,input.allocation);
  if(unknown.length)result.reasons.push(`${unknown.length} windows excluded because the public read failed (fail closed).`);
  return result;
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
    advanced: { ...base.advanced, ...(plan.allocation.standby ? {} : { standby: [] }) } };
}

/** Backward compatible goal migration: the old visible start becomes the explicit ideal. */
export function normalizeStrategyGoal(goal: StrategyGoal): StrategyGoal {
  return {...goal, idealStart: goal.idealStart ?? goal.preferredStart ?? goal.primeFrom};
}
export interface RankedTargetPlan {
  ranked: ScoredWindow[]; excluded: SuggestedPlan['excluded'];
  intelligence: SuggestedPlan['intelligence']; comparableReleases: number;
  goal?: StrategyGoal; history?: StrategyHistoricalEvidence | null;
}
/** Preference/evidence ranking has no workers, timing, allocation or release-mode input. */
export function rankTargetPlan(input: Omit<SuggestInput, 'allocation'>): RankedTargetPlan {
  const goal=normalizeStrategyGoal(input.goal), supplied=input.historicalEvidence;
  const history=input.intelligenceMode!=='PREFERENCE_ONLY' && (supplied?.strength==='USABLE'||supplied?.strength==='STRONG') && supplied.wellObservedReleases>=3 ? supplied : null;
  const excluded: SuggestedPlan['excluded']=[], removed=new Set((input.exclude??[]).map(windowKey));
  const ranked=enumeratePrimeWindows(goal).filter(w=>!removed.has(windowKey(w))).map(w=>{
    const evidence=windowEvidence(w,input.schedule).evidence, forced=(input.forceInclude??[]).some(v=>windowKey(v)===windowKey(w));
    return {...w,end:windowEnd(w),evidence,forced,score:scoreWindow(w,goal,evidence),historical:history?.ranges.find(h=>windowKey(h)===windowKey(w)),rationale:[WINDOW_EVIDENCE_LABEL[evidence],...historyLines(history?.ranges.find(h=>windowKey(h)===windowKey(w)),supplied?.dayOfWeek??'same-weekday',supplied?.strength??'NONE')]};
  }).filter(w=>{if(isConflict(w.evidence)&&!w.forced){excluded.push({...w,reason:'KNOWN_CONFLICT'});return false;}return true;});
  ranked.sort((a,b)=>{
    const evidenceKeys=(w:ScoredWindow)=>[w.forced?0:1,goal.durations.indexOf(w.durationHours), evidenceQuality(w.evidence),
      history?-share(w.historical?.fullyOpenFirst??0,w.historical?.wellObserved??0):0,
      history?-share(w.historical?.stillOpenAt1s.open??0,w.historical?.stillOpenAt1s.observed??0):0,
      Math.abs(hourOf(w.start)-preferredStartFor(goal,w.durationHours)),goal.courts.indexOf(w.court),hourOf(w.start)];
    return compareNumbers(evidenceKeys(a),evidenceKeys(b));
  });
  return {goal,history,ranked,excluded,comparableReleases:history?.wellObservedReleases??0,
    intelligence:{requested:input.intelligenceMode??'AUTO',applied:history?'HISTORY_ASSISTED':'PREFERENCE_BASED',strength:supplied?.strength??'NONE',
      label:history?`Historical evidence used · ${history.wellObservedReleases} comparable releases`:'Historical evidence insufficient · preference ranking used'}};
}
/** Explicit quality ordering; unknown reads are preference-only evidence with a ranking penalty. */
export const evidenceQuality = (value: WindowEvidence): number =>
  ['PUBLISHED_OPEN','NO_KNOWN_PUBLIC_CONFLICT','NOT_CHECKED','UNKNOWN_PUBLIC_QUERY_FAILED','KNOWN_PUBLIC_BOOKING_CONFLICT','PUBLISHED_UNAVAILABLE'].indexOf(value);

/** Allocate a bounded portfolio from the full ranking. Primary is immutable; duration and evidence
 * stay ahead of diversification. Nearby alternatives (within one preference-score band) reduce
 * shared failure without sending a preferred evening goal to a distant window just for variety. */
export function buildExecutionStrategy(targets:RankedTargetPlan,allocation:PresetAllocation):SuggestedPlan {
  const immediate:ScoredWindow[]=targets.ranked.length?[targets.ranked[0]!]:[];
  const reasons:string[]=[];
  while(immediate.length<Math.max(1,allocation.immediateTargets)) {
    const choices=targets.ranked.filter(w=>!immediate.some(v=>v.court===w.court));
    if(!choices.length)break;
    const best=choices[0]!;
    const eligible=choices.filter(w=>w.durationHours===best.durationHours && evidenceQuality(w.evidence)<=evidenceQuality(best.evidence)
      && w.score.total>=best.score.total-10);
    const keys=(w:ScoredWindow)=>{
      const risk=aggregateRisk(w,immediate,targets.history??null);
      const h=w.historical;
      return [evidenceQuality(w.evidence),targets.history?-share(h?.fullyOpenFirst??0,h?.wellObserved??0):0,
        targets.history?-share(h?.stillOpenAt1s.open??0,h?.stillOpenAt1s.observed??0):0,
        risk.coUnavailable,risk.sameEarlyLoss,immediate.some(v=>v.start===w.start)?1:0,
        risk.overlappingHours,-w.score.total,targets.ranked.indexOf(w)];
    };
    const pick=[...eligible].sort((a,b)=>compareNumbers(keys(a),keys(b)))[0]??best;
    immediate.push(pick);
  }
  const starts=new Set(immediate.map(w=>w.start));
  if(immediate.length>1)reasons.push(starts.size>1?'Diversified across start times to reduce one-window concentration.':
    'Immediate targets share a start: no comparable alternative start is available within the duration, evidence and preference limits.');
  const selected=new Set(immediate.map(windowKey));
  const remaining=targets.ranked.filter(w=>!selected.has(windowKey(w)));
  if(targets.history)remaining.sort((a,b)=>{
    const keys=(w:ScoredWindow)=>{const h=w.historical,risk=aggregateRisk(w,immediate,targets.history??null);return [targets.goal?.durations.indexOf(w.durationHours)??0,evidenceQuality(w.evidence),
      -share(h?.stillOpenAt1s.open??0,h?.stillOpenAt1s.observed??0),-share(h?.stillOpenAt5s.open??0,h?.stillOpenAt5s.observed??0),risk.coUnavailable,-w.score.total];};
    return compareNumbers(keys(a),keys(b));
  });
  const backups=remaining.slice(0,STRATEGY_MAX_CANDIDATES-immediate.length).map(w=>({...w,roleAffinity:affinity(w.historical)}));
  if([...immediate,...backups].some(w=>w.forced))reasons.push('Conflicting targets were force-included by the operator.');
  const kept=new Set([...immediate,...backups].map(windowKey));
  return {ranked:targets.ranked.filter(w=>kept.has(windowKey(w))),immediate,backups,
    excluded:[...targets.excluded,...targets.ranked.filter(w=>!kept.has(windowKey(w))).map(w=>({...w,reason:'CAPACITY' as const}))],
    allocation,intelligence:targets.intelligence,reasons};
}
