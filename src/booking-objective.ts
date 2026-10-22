import { COURT_REGISTRY, type Wing } from './court-registry.js';
import { canonicalReleaseTargetId, exactReleaseTarget, releaseTargetEnd, type ExactReleaseTarget } from './release-target.js';
import { isIsoDate, manilaDate, nextReleaseFor, releaseInstantFor } from './wing-release-data.js';
import { isShotgunOffsetMs, type ShotgunAllocationMode, type ShotgunSettings, type ShotgunTimingMode } from './shotgun.js';
import { compileSmartPlan, emptySmartDraft, SMART_EVENING_FROM, SMART_EVENING_RATE, SMART_EVENING_RATE_CONFIRMED_AT, SMART_MAX_SLOTS, SMART_WORKERS,
  type SmartCompiled, type SmartRateEvidence, type SmartSlot } from './precision-simple.js';
import { defaultMethod, defaultStrategy, evaluateCapability, methodsForStrategy, strategiesFor, weakestCapability, METHOD_TO_SETUP,
  type BookingModeId, type CapabilityStatus, type CapabilityVerdict, type CheckoutMethodId, type StrategyId } from './capability-matrix.js';
import { canonicalJson, sha256Hex } from './sha256-pure.js';

/**
 * Unified booking domain model (version 3). Dependency-free: the renderer, main process and tests share one compiler.
 *
 *   A. OBJECTIVE      what outcome is wanted: per-wing (or any-wing) minimum and ideal distinct courts.
 *   B. TARGETS        which exact wing/court/date/hours can satisfy it (registry UUID identity).
 *   C. STRATEGY       how attempts are scheduled: Shotgun, Precision or Normal.
 *   D. CHECKOUT       which validated Onda checkout executes an attempt.
 *   E. ENVIRONMENT    chosen per run (offline simulation, authorized live test, production) — never part of the plan.
 *
 * Strategy compilation delegates to the existing compilers (compileSmartPlan → planShotgun, the Normal request
 * planner). Nothing here dispatches. A temporary hold is never treated as a paid booking.
 */
export const OBJECTIVE_VERSION = 3 as const;
export const WINGS: readonly Wing[] = ['MANGO', 'BUKO'];
export type BookingMode = BookingModeId;
export type ExecutionEnvironment = 'OFFLINE_SIMULATION' | 'AUTHORIZED_LIVE_TEST' | 'PRODUCTION';
export const ENVIRONMENT_LABEL: Readonly<Record<ExecutionEnvironment, string>> = Object.freeze({
  OFFLINE_SIMULATION: 'OFFLINE SIMULATION · every checkout intercepted', AUTHORIZED_LIVE_TEST: 'AUTHORIZED LIVE TEST · may create real pending holds',
  PRODUCTION: 'PRODUCTION · real intended booking' });
export type QuotaScope = 'PER_WING' | 'ANY_WING';
export interface CourtChoice { court: number; priority: number; mandatory?: boolean }
export interface WingGoal {
  enabled: boolean; bookingDate: string;
  /** Distinct courts in this wing (PER_WING scope). */ minimum: number; ideal: number;
  courts: CourtChoice[];
  /** Preferred start first, then alternatives in order. */ startTimes: string[];
  durationHours: number;
  /** Operator-confirmed hourly rate before 4 PM for this wing/date. Evening hours use the venue's fixed rate. */
  dayRate?: { perHour: number; confirmedAt: string; date: string } | null;
}
export interface ObjectiveShotgun {
  budget: number; allocationMode: ShotgunAllocationMode; customCounts?: Record<string, number>;
  windowStartMs: number; windowEndMs: number; timingMode: ShotgunTimingMode;
  /** Literal signed offsets. With customAssignments, index-aligned (offset i goes to target customAssignments[i]). */
  customOffsetsMs?: number[]; customAssignments?: string[];
  timingCapacityOverride?: boolean; allowStandbyConsumption?: boolean;
  presetId: string; source: 'SUGGESTED' | 'PRESET' | 'CUSTOM';
}
export interface ObjectivePrecision { offsetsMs: Record<string, number[]>; useBackups: boolean; retryReopened: boolean }
export interface BookingObjective {
  version: typeof OBJECTIVE_VERSION; mode: BookingMode; targetMode: 'FLEXIBLE' | 'EXACT';
  quotaScope: QuotaScope;
  /** ANY_WING scope only: distinct courts across all enabled wings. */ overall: { minimum: number; ideal: number };
  wings: Record<Wing, WingGoal>;
  price: { maxTotal: number | null; maxPerCheckout: number | null };
  strategy: StrategyId; checkoutMethod: CheckoutMethodId;
  shotgun: ObjectiveShotgun; precision: ObjectivePrecision;
}
export interface ObjectiveTarget extends ExactReleaseTarget {
  id: string; priority: number; mandatory: boolean; startRank: number; courtRank: number; end: string;
}
export interface ObjectiveQuota { scope: QuotaScope; wings: Partial<Record<Wing, { minimum: number; ideal: number }>>; overall?: { minimum: number; ideal: number } }

const HOUR = /^(0[89]|1\d|2[0-3]):00$/;
const hourOf = (start: string) => Number(start.slice(0, 2));
const unique = <T>(values: readonly T[]) => [...new Set(values)];
const clampInt = (value: unknown, min: number, max: number, fallback: number) =>
  Number.isSafeInteger(value) ? Math.min(max, Math.max(min, value as number)) : fallback;

export function defaultShotgun(): ObjectiveShotgun {
  return { budget: 8, allocationMode: 'PRIORITY_WEIGHTED', windowStartMs: -2000, windowEndMs: 0, timingMode: 'AUTO', presetId: 'SUGGESTED', source: 'SUGGESTED' };
}
export function defaultObjective(nowMs: number, mode: BookingMode = 'NEXT_RELEASE'): BookingObjective {
  // Next Release: the date the next release publishes. Available Now: today in Manila (already published).
  const date = (wing: Wing) => mode === 'NEXT_RELEASE' ? nextReleaseFor(nowMs, wing).bookingDate : manilaDate(nowMs);
  const goal = (wing: Wing, enabled: boolean): WingGoal => ({ enabled, bookingDate: date(wing), minimum: 1, ideal: 1,
    courts: [7, 6, 5, 4, 3, 2, 1].map((court, index) => ({ court, priority: index + 1 })), startTimes: ['19:00'], durationHours: 2, dayRate: null });
  const strategy = defaultStrategy(mode);
  return { version: OBJECTIVE_VERSION, mode, targetMode: 'FLEXIBLE', quotaScope: 'PER_WING', overall: { minimum: 1, ideal: 1 },
    wings: { MANGO: goal('MANGO', true), BUKO: goal('BUKO', false) }, price: { maxTotal: null, maxPerCheckout: null },
    strategy, checkoutMethod: defaultMethod(strategy, mode), shotgun: defaultShotgun(), precision: { offsetsMs: {}, useBackups: true, retryReopened: false } };
}
/** Switching mode moves strategy to that mode's default and refreshes dates; courts, times and quotas stay. */
export function withMode(objective: BookingObjective, mode: BookingMode, nowMs: number): BookingObjective {
  if (objective.mode === mode) return objective;
  const fresh = defaultObjective(nowMs, mode), strategy = defaultStrategy(mode);
  return { ...objective, mode, strategy, checkoutMethod: defaultMethod(strategy, mode),
    wings: { MANGO: { ...objective.wings.MANGO, bookingDate: fresh.wings.MANGO.bookingDate }, BUKO: { ...objective.wings.BUKO, bookingDate: fresh.wings.BUKO.bookingDate } } };
}
export function withStrategy(objective: BookingObjective, strategy: StrategyId): BookingObjective {
  const methods = methodsForStrategy(strategy, objective.mode);
  return { ...objective, strategy, checkoutMethod: methods.includes(objective.checkoutMethod) ? objective.checkoutMethod : methods[0]! };
}

export const enabledWings = (o: Pick<BookingObjective, 'wings'>): Wing[] => WINGS.filter(wing => o.wings[wing].enabled);
export function objectiveQuota(o: BookingObjective): ObjectiveQuota {
  const wings: ObjectiveQuota['wings'] = {};
  for (const wing of enabledWings(o)) wings[wing] = { minimum: o.wings[wing].minimum, ideal: o.wings[wing].ideal };
  return o.quotaScope === 'ANY_WING' ? { scope: 'ANY_WING', wings, overall: { ...o.overall } } : { scope: 'PER_WING', wings };
}
export const quotaIdealTotal = (q: ObjectiveQuota) => q.scope === 'ANY_WING' ? q.overall!.ideal : Object.values(q.wings).reduce((sum, value) => sum + value!.ideal, 0);
export const quotaMinimumTotal = (q: ObjectiveQuota) => q.scope === 'ANY_WING' ? q.overall!.minimum : Object.values(q.wings).reduce((sum, value) => sum + value!.minimum, 0);

/** Structural validation of a stored or edited objective. Returns problems; never repairs silently. */
export function objectiveProblems(o: BookingObjective): string[] {
  const problems: string[] = [];
  if (!o || o.version !== OBJECTIVE_VERSION) return ['Unsupported booking objective version.'];
  if (!['AVAILABLE_NOW', 'NEXT_RELEASE'].includes(o.mode)) problems.push('Choose Available Now or Next Release.');
  if (!strategiesFor(o.mode).includes(o.strategy)) problems.push(`${o.strategy} is not available for ${o.mode === 'AVAILABLE_NOW' ? 'Available Now' : 'Next Release'}.`);
  if (!methodsForStrategy(o.strategy, o.mode).includes(o.checkoutMethod)) problems.push('The checkout method does not fit the selected strategy.');
  const wings = enabledWings(o);
  if (!wings.length) problems.push('Choose at least one wing.');
  if (!['PER_WING', 'ANY_WING'].includes(o.quotaScope)) problems.push('Choose how courts are counted.');
  if (o.quotaScope === 'ANY_WING' && (!Number.isSafeInteger(o.overall.minimum) || !Number.isSafeInteger(o.overall.ideal) || o.overall.minimum < 1 || o.overall.ideal < o.overall.minimum || o.overall.ideal > 14))
    problems.push('Overall courts: minimum must be at least 1 and ideal at least the minimum (up to 14).');
  for (const wing of wings) {
    const g = o.wings[wing], name = wing === 'MANGO' ? 'Mango' : 'Buko';
    if (!isIsoDate(g.bookingDate)) problems.push(`${name}: choose a valid booking date.`);
    if (o.quotaScope === 'PER_WING' && (!Number.isSafeInteger(g.minimum) || !Number.isSafeInteger(g.ideal) || g.minimum < 1 || g.ideal < g.minimum || g.ideal > 7))
      problems.push(`${name}: minimum must be 1–7 and ideal at least the minimum.`);
    const courts = g.courts.map(c => c.court);
    if (!courts.length) problems.push(`${name}: choose at least one acceptable court.`);
    if (courts.some(c => !Number.isInteger(c) || c < 1 || c > 7) || new Set(courts).size !== courts.length) problems.push(`${name}: each court 1–7 may appear once.`);
    if (g.courts.some(c => !Number.isSafeInteger(c.priority) || c.priority < 1)) problems.push(`${name}: court priorities must be whole numbers from 1.`);
    if (o.quotaScope === 'PER_WING' && courts.length < g.ideal) problems.push(`${name}: ideal ${g.ideal} needs at least ${g.ideal} acceptable courts (only ${courts.length} chosen).`);
    if (o.targetMode === 'EXACT') {
      const mandatory = g.courts.filter(c => c.mandatory).length;
      if (!mandatory) problems.push(`${name}: exact mode needs the exact courts marked.`);
      if (o.quotaScope === 'PER_WING' && mandatory !== g.ideal) problems.push(`${name}: exact mode books exactly the marked courts — mark ${g.ideal} court${g.ideal === 1 ? '' : 's'} (marked ${mandatory}).`);
    }
    if (!g.startTimes.length || g.startTimes.some(s => !HOUR.test(s)) || new Set(g.startTimes).size !== g.startTimes.length) problems.push(`${name}: start times must be distinct whole hours from 8 AM to 11 PM.`);
    if (!Number.isInteger(g.durationHours) || g.durationHours < 1 || g.durationHours > 3) problems.push(`${name}: duration must be 1–3 hours (Extended 4–6 h stays in the legacy release editor).`);
    else if (g.startTimes.some(s => HOUR.test(s) && hourOf(s) + g.durationHours > 24)) problems.push(`${name}: a ${g.durationHours}-hour booking from a chosen start would end after midnight.`);
    if (g.dayRate && (!Number.isFinite(g.dayRate.perHour) || g.dayRate.perHour <= 0 || !Number.isFinite(Date.parse(g.dayRate.confirmedAt)))) problems.push(`${name}: the confirmed daytime rate is invalid.`);
  }
  for (const [key, value] of Object.entries(o.price)) if (value !== null && (!Number.isFinite(value) || value <= 0)) problems.push(`Maximum ${key === 'maxTotal' ? 'total' : 'per-checkout'} price must be a positive amount or blank.`);
  return problems;
}

/** Exact targets in each wing: preferred start on every court (by priority) before any alternative start. */
export function enumerateTargets(o: BookingObjective): { targets: ObjectiveTarget[]; byWing: Record<Wing, ObjectiveTarget[]>; problems: string[] } {
  const problems: string[] = [], byWing: Record<Wing, ObjectiveTarget[]> = { MANGO: [], BUKO: [] };
  for (const wing of enabledWings(o)) {
    const g = o.wings[wing], courts = [...g.courts].sort((a, b) => a.priority - b.priority || a.court - b.court);
    g.startTimes.forEach((start, startRank) => courts.forEach((choice, courtRank) => {
      try {
        const exact = exactReleaseTarget({ wing, court: choice.court, start, durationHours: g.durationHours, bookingDate: g.bookingDate });
        byWing[wing].push({ ...exact, id: canonicalReleaseTargetId(exact), priority: 0, mandatory: !!choice.mandatory, startRank, courtRank, end: releaseTargetEnd(exact) });
      } catch { problems.push(`${wing === 'MANGO' ? 'Mango' : 'Buko'} Court ${choice.court} at ${start} is not a valid exact target.`); }
    }));
  }
  // Interleave wings by rank so priorities stay comparable across wings.
  const targets: ObjectiveTarget[] = [];
  const queues = enabledWings(o).map(wing => [...byWing[wing]]);
  while (queues.some(q => q.length)) for (const q of queues) { const next = q.shift(); if (next) targets.push(next); }
  targets.forEach((target, index) => { target.priority = index + 1; });
  return { targets, byWing, problems: unique(problems) };
}

const overlaps = (a: ExactReleaseTarget, b: ExactReleaseTarget) => a.wing === b.wing && a.bookingDate === b.bookingDate && a.court === b.court &&
  hourOf(a.start) < hourOf(b.start) + b.durationHours && hourOf(b.start) < hourOf(a.start) + a.durationHours;
/**
 * Immediate targets for a scheduled release cohort, limited by Precision worker capacity (one worker owns at most six
 * child tabs; a target needs at least one worker). Mandatory courts first, then enough distinct courts per wing to
 * reach each ideal quota, then remaining capacity by interleaved priority. Overlapping same-court windows are moved to
 * backups because the dispatcher rejects them. Nothing is invented: every target comes from the operator's lists.
 */
export function selectImmediate(targets: readonly ObjectiveTarget[], quota: ObjectiveQuota, capacity: number) {
  const chosen: ObjectiveTarget[] = [], warnings: string[] = [];
  const canAdd = (t: ObjectiveTarget) => chosen.length < capacity && !chosen.includes(t) && !chosen.some(c => overlaps(c, t));
  const courtsIn = (wing: Wing) => new Set(chosen.filter(t => t.wing === wing).map(t => t.court));
  for (const t of targets) if (t.mandatory && t.startRank === 0 && canAdd(t)) chosen.push(t);
  const wings = Object.keys(quota.wings) as Wing[];
  const need = (wing: Wing) => quota.scope === 'ANY_WING' ? 0 : quota.wings[wing]!.ideal;
  for (let changed = true; changed;) {
    changed = false;
    for (const wing of wings) {
      if (courtsIn(wing).size >= need(wing)) continue;
      const next = targets.find(t => t.wing === wing && !courtsIn(wing).has(t.court) && canAdd(t));
      if (next) { chosen.push(next); changed = true; }
    }
  }
  if (quota.scope === 'ANY_WING') for (const t of targets) { if (new Set(chosen.map(c => `${c.wing}:${c.court}`)).size >= quota.overall!.ideal) break;
    if (!chosen.some(c => c.wing === t.wing && c.court === t.court) && canAdd(t)) chosen.push(t); }
  for (const t of targets) if (canAdd(t)) chosen.push(t);
  const immediate = targets.filter(t => chosen.includes(t));
  const backups = targets.filter(t => !chosen.includes(t)).slice(0, Math.max(0, SMART_MAX_SLOTS - immediate.length));
  const dropped = targets.length - immediate.length - backups.length;
  if (dropped > 0) warnings.push(`${dropped} acceptable target${dropped === 1 ? '' : 's'} exceed the ${SMART_MAX_SLOTS}-slot plan limit and will not be attempted.`);
  for (const wing of wings) {
    const reach = courtsIn(wing).size;
    if (quota.scope === 'PER_WING' && reach < quota.wings[wing]!.ideal)
      warnings.push(`${wing === 'MANGO' ? 'Mango' : 'Buko'}: only ${reach} distinct court${reach === 1 ? '' : 's'} fit as immediate targets (ideal ${quota.wings[wing]!.ideal}; ${capacity} Precision workers available).`);
  }
  return { immediate, backups, warnings };
}

/** Rate authority for an exact target: venue evening rate from 4 PM, operator-confirmed day rate before it. */
export function targetRate(target: ExactReleaseTarget, goal: Pick<WingGoal, 'dayRate'>): SmartRateEvidence | null {
  const hours = Array.from({ length: target.durationHours }, (_, offset) => hourOf(target.start) + offset);
  const evening = hours.every(h => h >= SMART_EVENING_FROM);
  const day = goal.dayRate && goal.dayRate.date === target.bookingDate ? goal.dayRate : null;
  const perHour = hours.map(h => h >= SMART_EVENING_FROM ? SMART_EVENING_RATE : day?.perHour ?? null);
  if (perHour.some(value => value === null)) return null;
  return { source: evening ? 'venue schedule from 4 PM' : 'operator confirmed day rate with venue evening rate', capturedAt: evening ? SMART_EVENING_RATE_CONFIRMED_AT : day!.confirmedAt,
    status: evening ? 'VENUE_SCHEDULE' : 'OPERATOR_CONFIRMED', date: target.bookingDate, perHour: perHour as number[], actionable: true };
}
const priceOf = (rate: SmartRateEvidence | null) => rate ? rate.perHour.reduce((sum, value) => sum + value, 0) : null;

/**
 * Converts literal (target, offset) pairs into the existing CUSTOM schedule representation without changing any value:
 * planShotgun places shots by rank, so offsets are ordered to land on exactly the operator's targets.
 */
export function literalShotgunSchedule(pairs: ReadonlyArray<{ targetId: string; offsetMs: number }>) {
  const counts: Record<string, number> = {}, perTarget = new Map<string, number[]>();
  for (const pair of pairs) { counts[pair.targetId] = (counts[pair.targetId] ?? 0) + 1; perTarget.set(pair.targetId, [...(perTarget.get(pair.targetId) ?? []), pair.offsetMs]); }
  const placements = Object.entries(counts).flatMap(([id, count]) => Array.from({ length: count }, (_, shotIndex) => ({ id, shotIndex, rank: (shotIndex + .5) / count })))
    .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id) || a.shotIndex - b.shotIndex);
  return { counts, offsets: placements.map(p => perTarget.get(p.id)![p.shotIndex]!) };
}
/** True only for a key that is really present; an absent key is a sparse custom count, not an invalid one. */
const hasCount = (counts: Record<string, number> | undefined, id: string) => !!counts && Object.prototype.hasOwnProperty.call(counts, id);
/**
 * Objective Shotgun settings → existing ShotgunSettings for exactly these immediate targets.
 * CUSTOM allocation: an ABSENT count means 0 attempts (sparse migrated plans). A PRESENT value must be a whole number
 * ≥ 0; anything else (null from a serialized NaN, negative, fractional, infinite, text) stays invalid and is reported
 * with the court it belongs to. Values are never rounded, clamped or replaced.
 */
export function toShotgunSettings(s: ObjectiveShotgun, immediateIds: readonly string[], labelOf?: (id: string) => string): { settings: ShotgunSettings; problems: string[] } {
  const problems: string[] = [];
  const literalAssignments = s.timingMode === 'CUSTOM' && !!s.customAssignments;
  if (s.allocationMode === 'CUSTOM' && !literalAssignments) for (const id of immediateIds) {
    if (!hasCount(s.customCounts, id)) continue;
    const value: unknown = s.customCounts![id];
    if (!Number.isSafeInteger(value) || (value as number) < 0)
      problems.push(`${labelOf?.(id) ?? 'A Shotgun target'}: the attempt count must be a whole number of 0 or more (found ${value === null || value === undefined || value === '' ? 'blank' : String(value)}). It was not changed; correct it.`);
  }
  const base: ShotgunSettings = { enabled: true, budget: s.budget, allocationMode: s.allocationMode, selectedTargetIds: [...immediateIds],
    windowStartMs: s.windowStartMs, windowEndMs: s.windowEndMs, timingMode: s.timingMode, timingCapacityOverride: !!s.timingCapacityOverride,
    allowStandbyConsumption: !!s.allowStandbyConsumption, ...(s.allocationMode === 'CUSTOM' ? { customCounts: Object.fromEntries(immediateIds.map(id => [id, hasCount(s.customCounts, id) ? s.customCounts![id]! : 0])) } : {}),
    ...(s.customOffsetsMs ? { customOffsetsMs: [...s.customOffsetsMs] } : {}) };
  if (s.timingMode === 'CUSTOM' && s.customAssignments) {
    const offsets = s.customOffsetsMs ?? [];
    if (s.customAssignments.length !== offsets.length) problems.push('Every custom attempt needs exactly one target and one offset.');
    if (offsets.some(value => !isShotgunOffsetMs(value))) problems.push('Custom offsets must be whole milliseconds from −2000 through 0. Invalid values are not changed; correct them.');
    const unknown = s.customAssignments.filter(id => !immediateIds.includes(id));
    if (unknown.length) problems.push(`${unknown.length} custom attempt${unknown.length === 1 ? ' targets' : 's target'} a court that is no longer an immediate target.`);
    if (!problems.length) {
      const literal = literalShotgunSchedule(s.customAssignments.map((targetId, index) => ({ targetId, offsetMs: offsets[index]! })));
      const counts = Object.fromEntries(immediateIds.map(id => [id, literal.counts[id] ?? 0]));
      return { settings: { ...base, allocationMode: 'CUSTOM', customCounts: counts, budget: Math.max(1, offsets.length, s.budget), customOffsetsMs: literal.offsets }, problems };
    }
  }
  return { settings: base, problems };
}

export interface NormalCheckoutStep {
  index: number; wing: Wing; date: string; start: string; fallbackStarts: string[]; durationHours: number;
  courtCount: number; priority: number[]; exact: number[] | null; workers: string[]; method: CheckoutMethodId;
  maximum: number | null; expectedHolds: number;
}
export interface CompiledCohort {
  releaseMs: number; releaseAt: string; wings: Wing[]; targetIds: string[];
  immediate: ObjectiveTarget[]; backups: ObjectiveTarget[]; smart: SmartCompiled | null;
}
export interface CompiledObjective {
  objective: BookingObjective; mode: BookingMode; strategy: StrategyId; method: CheckoutMethodId;
  quota: ObjectiveQuota; targets: ObjectiveTarget[]; cohorts: CompiledCohort[]; normalSteps: NormalCheckoutStep[];
  /** Mango scheduled Normal release only: the saved General setup fields. */ generalRelease: null | { COURT_COUNT: number; START_TIME: string; FALLBACK_TIMES: string[]; DURATION_HOURS: number; PREFERRED_COURTS: number[]; BOOKING_METHOD: string };
  capability: Record<Wing, CapabilityVerdict | null>; liveStatus: CapabilityStatus;
  price: { perHoldMax: number | null; expectedIdealTotal: number | null; worstCaseTotal: number | null };
  expectedHolds: { minimum: number; ideal: number; maximumPossible: number };
  attemptCount: number; problems: string[]; warnings: string[]; fingerprint: string;
}
export interface CompileContext { nowMs: number; unavailableWorkers?: ReadonlySet<string>; shotgunCapacity?: { meaningfulSpacingMs: number };
  /** Optional fresh availability (open cells) to rank flexible Available Now courts. Never invents openness. */
  openCells?: ReadonlySet<string>; blockedCells?:ReadonlySet<string>; releaseVerified?: Partial<Record<Wing, boolean>>;
  /** Available Now: browsers that must not take a new checkout (pending/verified hold in that customer context, or no configured customer). */
  normalSkip?: ReadonlySet<string> }

export const WORKER_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
/** Available Now: one Normal run per provider-supported checkout shape. Mango packs ≤2 courts per checkout per
 * worker; Buko is one exact court per checkout. Each wing gets its own browsers so a pending checkout in one
 * customer context never blocks the other (observed HTTP 409 "existing payment"). */
export function planNormalSteps(o: BookingObjective, ctx: CompileContext) {
  const steps: NormalCheckoutStep[] = [], problems: string[] = [], warnings: string[] = [];
  const free: string[] = WORKER_LETTERS.filter(w => !ctx.normalSkip?.has(w));
  let needed = 0;
  const take = (count: number) => { needed += count; return free.splice(0, count); };
  for (const wing of enabledWings(o)) {
    const g = o.wings[wing], ordered = [...g.courts].sort((a, b) => a.priority - b.priority || a.court - b.court);
    const ideal = o.quotaScope === 'ANY_WING' ? Math.min(o.overall.ideal, ordered.length) : g.ideal;
    const fallbackStarts = g.startTimes.slice(1), maximum = o.price.maxPerCheckout;
    if (wing === 'MANGO') {
      const exact = o.targetMode === 'EXACT' ? ordered.filter(c => c.mandatory).map(c => c.court) : null;
      const count = exact ? exact.length : ideal;
      const workers = take(Math.ceil(count / 2));
      steps.push({ index: steps.length, wing, date: g.bookingDate, start: g.startTimes[0]!, fallbackStarts, durationHours: g.durationHours, courtCount: count,
        priority: ordered.map(c => c.court), exact, workers, method: o.checkoutMethod, maximum, expectedHolds: Math.ceil(count / 2) });
      if (o.quotaScope === 'PER_WING' && g.minimum < g.ideal) warnings.push(`Mango Normal books exactly ${count} courts in one run; it does not reduce to the minimum of ${g.minimum} automatically.`);
    } else {
      if (fallbackStarts.length) warnings.push('Buko Normal supports one exact court at the preferred start; alternative Buko starts are not attempted.');
      const marked = o.targetMode === 'EXACT' ? ordered.filter(c => c.mandatory) : null;
      const open = ctx.openCells;
      const ranked = marked ?? [...ordered].sort((a, b) => {
        const isOpen = (c: CourtChoice) => open ? Array.from({ length: g.durationHours }, (_, i) => `BUKO:${c.court}:${String(hourOf(g.startTimes[0]!) + i).padStart(2, '0')}:00`).every(key => open.has(key)) : false;
        return Number(isOpen(b)) - Number(isOpen(a)) || a.priority - b.priority;
      });
      for (const choice of ranked.slice(0, marked ? marked.length : ideal))
        steps.push({ index: steps.length, wing, date: g.bookingDate, start: g.startTimes[0]!, fallbackStarts: [], durationHours: g.durationHours, courtCount: 1,
          priority: [choice.court], exact: [choice.court], workers: take(1), method: o.checkoutMethod, maximum, expectedHolds: 1 });
    }
  }
  const usable = WORKER_LETTERS.length - (ctx.normalSkip?.size ?? 0);
  if (needed > usable) problems.push(`This goal needs ${needed} separate browsers/customers; only ${usable} are free${ctx.normalSkip?.size ? ` (${[...ctx.normalSkip].sort().join(', ')} hold a pending checkout or have no configured customer)` : ''}.`);
  if (ctx.normalSkip?.size) warnings.push(`Browsers ${[...ctx.normalSkip].sort().join(', ')} are skipped: a pending checkout in that customer context can block another checkout (HTTP 409), or no customer is configured.`);
  return { steps: steps.filter(step => step.workers.length === Math.ceil(step.courtCount / 2) || (step.wing === 'BUKO' && step.workers.length === 1)), problems, warnings };
}

export function compileObjective(o: BookingObjective, ctx: CompileContext): CompiledObjective {
  const problems = [...objectiveProblems(o)], warnings: string[] = [];
  const quota = objectiveQuota(o);
  const { targets, problems: targetProblems } = enumerateTargets(o);
  problems.push(...targetProblems);
  const wings = enabledWings(o);
  const courtsFor = (wing: Wing) => o.quotaScope === 'ANY_WING' ? Math.max(1, Math.min(7, o.overall.ideal)) : Math.max(1, Math.min(7, o.wings[wing].ideal));
  const capability: Record<Wing, CapabilityVerdict | null> = { MANGO: null, BUKO: null };
  for (const wing of wings) capability[wing] = evaluateCapability({ wing, mode: o.mode, strategy: o.strategy, method: o.checkoutMethod, courts: courtsFor(wing), releaseVerified: ctx.releaseVerified?.[wing] });
  for (const wing of wings) if (capability[wing]!.status === 'BLOCKED') problems.push(`${wing === 'MANGO' ? 'Mango' : 'Buko'}: ${capability[wing]!.reasons[0]}`);
  const liveStatus = weakestCapability(wings.map(wing => capability[wing]!));
  const rateFor = (t: ObjectiveTarget) => targetRate(t, o.wings[t.wing]);

  const cohorts: CompiledCohort[] = [];
  let normalSteps: NormalCheckoutStep[] = [], generalRelease: CompiledObjective['generalRelease'] = null;
  if (o.mode === 'NEXT_RELEASE' && !problems.length) {
    // Separate scheduled cohorts per release instant; dates are never rewritten to share one release.
    const releaseOf = new Map<Wing, number>();
    for (const wing of wings) { try { releaseOf.set(wing, releaseInstantFor(o.wings[wing].bookingDate, wing)); } catch { problems.push(`${wing}: release policy unknown.`); } }
    for (const [wing, releaseMs] of releaseOf) if (releaseMs <= ctx.nowMs) problems.push(`${wing === 'MANGO' ? 'Mango' : 'Buko'} ${o.wings[wing].bookingDate} was already released (${new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(releaseMs)} Manila). Choose the next release date explicitly, or use Available Now for a published date.`);
    const instants = unique([...releaseOf.values()]).sort((a, b) => a - b);
    if (instants.length > 1) warnings.push('Mango and Buko targets release at different instants. They are separate scheduled cohorts under one objective; each is prepared and armed for its own release.');
    for (const releaseMs of instants) {
      const cohortWings = wings.filter(wing => releaseOf.get(wing) === releaseMs);
      const conflicts=(t:ObjectiveTarget)=>Array.from({length:t.durationHours},(_,i)=>`${t.wing}:${t.court}:${String(hourOf(t.start)+i).padStart(2,'0')}:00`).some(key=>ctx.blockedCells?.has(key));
      const allCohortTargets = targets.filter(t => cohortWings.includes(t.wing));
      const blocked=allCohortTargets.filter(conflicts);
      for(const target of blocked) {
        warnings.push(`${target.wing} Court ${target.court} ${target.start}–${target.end}: fresh availability reports a conflict. Review and save any alternative before preparing.`);
        if(target.mandatory)problems.push(`${target.wing} mandatory Court ${target.court} conflicts with fresh availability. The mandatory court was not substituted.`);
      }
      const cohortTargets = allCohortTargets.filter(t=>!conflicts(t));
      const cohortQuota: ObjectiveQuota = { ...quota, wings: Object.fromEntries(cohortWings.map(w => [w, quota.wings[w]!])) };
      const ready = SMART_WORKERS.filter(w => !ctx.unavailableWorkers?.has(w)).length;
      const capacity = o.strategy === 'NORMAL' ? 0 : Math.min(SMART_WORKERS.length, ready);
      const cohort: CompiledCohort = { releaseMs, releaseAt: new Date(releaseMs).toISOString(), wings: cohortWings, targetIds: cohortTargets.map(t => t.id), immediate: [], backups: [], smart: null };
      if (o.strategy !== 'NORMAL') {
        const selection = selectImmediate(cohortTargets, cohortQuota, capacity);
        warnings.push(...selection.warnings);
        cohort.immediate = selection.immediate; cohort.backups = o.strategy === 'PRECISION' && o.precision.useBackups ? selection.backups : [];
        const slot = (t: ObjectiveTarget, immediate: boolean): SmartSlot => {
          const rate = rateFor(t), offsets = immediate && o.strategy === 'PRECISION' ? o.precision.offsetsMs[t.id] ?? [0] : [0];
          return { court: t.court, start: t.start, durationHours: t.durationHours, wing: t.wing, spaceId: t.spaceId, bookingDate: t.bookingDate, priority: t.priority,
            ...(rate ? { rate } : {}), ...(immediate && o.strategy === 'PRECISION' ? offsets.length > 1 ? { fanOutOffsetsMs: [...offsets] } : offsets[0] ? { releaseOffsetMs: offsets[0] } : {} : {}) };
        };
        const missingRates = [...cohort.immediate, ...cohort.backups].filter(t => !rateFor(t));
        if (missingRates.length) problems.push(`Confirm the daytime rate: ${missingRates.length} target${missingRates.length === 1 ? ' has' : 's have'} hours before 4 PM (${unique(missingRates.map(t => t.wing === 'MANGO' ? 'Mango' : 'Buko')).join(' and ')}).`);
        let shotgun: ShotgunSettings | undefined, countProblems = false;
        if (o.strategy === 'SHOTGUN') {
          const label = (id: string) => { const t = cohort.immediate.find(value => value.id === id); return t ? `${t.wing === 'MANGO' ? 'Mango' : 'Buko'} Court ${t.court} · ${t.start}` : 'A Shotgun target'; };
          const converted = toShotgunSettings(o.shotgun, cohort.immediate.map(t => t.id), label); problems.push(...converted.problems); shotgun = converted.settings;
          countProblems = converted.problems.some(p => p.includes('attempt count must be'));
        }
        if (!missingRates.length && cohort.immediate.length) {
          const draft = { ...emptySmartDraft(), immediate: cohort.immediate.map(t => slot(t, true)), backups: cohort.backups.map(t => slot(t, false)),
            useBackupsImmediately: false, retryReopened: o.strategy === 'PRECISION' && o.precision.retryReopened, ...(shotgun ? { shotgun } : {}),
            advanced: o.strategy === 'SHOTGUN' ? { wave2: 0, rescue: 0 } : {} };
          cohort.smart = compileSmartPlan(draft, { targetDate: o.wings[cohortWings[0]!].bookingDate, ...(ctx.unavailableWorkers ? { unavailable: ctx.unavailableWorkers } : {}),
            ...(ctx.shotgunCapacity ? { shotgunCapacity: ctx.shotgunCapacity } : {}) });
          // The same invalid count is already reported above with its court name instead of an internal target ID.
          problems.push(...cohort.smart.problems.filter(p => !(countProblems && p.startsWith('Custom Shotgun count for')))); warnings.push(...cohort.smart.warnings);
        } else if (!cohort.immediate.length) problems.push('No immediate target could be scheduled.');
      }
      cohorts.push(cohort);
    }
    if (o.strategy === 'NORMAL') {
      const mango = o.wings.MANGO;
      if (mango.enabled) {
        const ordered = [...mango.courts].sort((a, b) => a.priority - b.priority || a.court - b.court).map(c => c.court);
        generalRelease = { COURT_COUNT: o.quotaScope === 'ANY_WING' ? o.overall.ideal : mango.ideal, START_TIME: mango.startTimes[0]!, FALLBACK_TIMES: mango.startTimes.slice(1),
          DURATION_HOURS: mango.durationHours, PREFERRED_COURTS: [...ordered, ...[7, 6, 5, 4, 3, 2, 1].filter(c => !ordered.includes(c))], BOOKING_METHOD: METHOD_TO_SETUP[o.checkoutMethod] };
        if (ordered.length < 7) warnings.push('The saved Normal release format needs a priority for all seven Mango courts; unchosen courts are appended after your choices as lower-priority fallbacks.');
      }
    }
  }
  if (o.mode === 'AVAILABLE_NOW' && !problems.length) {
    const planned = planNormalSteps(o, ctx); normalSteps = planned.steps; problems.push(...planned.problems); warnings.push(...planned.warnings);
  }
  // Price review.
  const ratedPrices = targets.map(t => priceOf(rateFor(t))).filter((value): value is number => value !== null);
  const perHoldMax = o.mode === 'AVAILABLE_NOW' ? null : ratedPrices.length ? Math.max(...ratedPrices) : null;
  if (o.price.maxPerCheckout !== null && perHoldMax !== null && o.mode === 'NEXT_RELEASE') {
    const over = targets.filter(t => (priceOf(rateFor(t)) ?? 0) > o.price.maxPerCheckout!);
    if (over.length) problems.push(`${over.length} target${over.length === 1 ? ' exceeds' : 's exceed'} the maximum per-checkout price of ₱${o.price.maxPerCheckout.toLocaleString('en-US')}.`);
  }
  const idealTotal = quotaIdealTotal(quota), minimumTotal = quotaMinimumTotal(quota);
  const attemptCount = cohorts.reduce((sum, c) => sum + (c.smart?.phase3?.wave1.reduce((n, a) => n + (a.fanOutOffsetsMs?.length ?? 1), 0) ?? 0), 0) + normalSteps.length;
  const maximumPossible = o.mode === 'AVAILABLE_NOW' ? normalSteps.reduce((sum, s) => sum + s.expectedHolds, 0)
    : cohorts.reduce((sum, c) => sum + (c.smart?.phase3?.wave1.reduce((n, a) => n + (a.fanOutOffsetsMs?.length ?? 1), 0) ?? 0) + (c.smart?.phase3?.budgets.wave2 ?? 0) + (c.smart?.phase3?.budgets.rescue ?? 0), 0);
  const expectedIdealTotal = perHoldMax === null ? null : perHoldMax * idealTotal;
  if (o.price.maxTotal !== null && expectedIdealTotal !== null && expectedIdealTotal > o.price.maxTotal) problems.push(`The ideal ${idealTotal} court${idealTotal === 1 ? '' : 's'} may cost up to ₱${expectedIdealTotal.toLocaleString('en-US')}, above the maximum total of ₱${o.price.maxTotal.toLocaleString('en-US')}.`);
  if (o.mode === 'NEXT_RELEASE' && o.strategy !== 'NORMAL' && maximumPossible > idealTotal) warnings.push(`Up to ${maximumPossible} attempts can be in flight; already-sent attempts may create extra temporary holds beyond the ideal ${idealTotal}. Each hold is reconciled separately; none is paid automatically.`);
  const fingerprintSource = { v: OBJECTIVE_VERSION, mode: o.mode, strategy: o.strategy, method: o.checkoutMethod, quota, price: o.price,
    cohorts: cohorts.map(c => ({ releaseMs: c.releaseMs, phase3: c.smart?.phase3 ?? null, shotgun: c.smart?.shotgun?.shots ?? null })), normalSteps, generalRelease };
  return { objective: o, mode: o.mode, strategy: o.strategy, method: o.checkoutMethod, quota, targets, cohorts, normalSteps, generalRelease, capability, liveStatus,
    price: { perHoldMax, expectedIdealTotal, worstCaseTotal: perHoldMax === null ? null : perHoldMax * Math.max(maximumPossible, idealTotal) },
    expectedHolds: { minimum: minimumTotal, ideal: idealTotal, maximumPossible }, attemptCount,
    problems: unique(problems), warnings: unique(warnings), fingerprint: sha256Hex(canonicalJson(fingerprintSource)) };
}

// ── Saved Mango release plan (the live authorization format) ─────────────────────────────────────────────
/**
 * The live Precision/Shotgun runner authorizes only the legacy undated Mango representation, bound to the release
 * calendar's next target date (exact dated candidates are refused live). This converts a compiled Mango-only cohort
 * into that saved setup through the same compiler, keeping every court, time, worker grouping and literal offset.
 * It refuses — instead of silently re-dating — when the chosen Mango date is not the next release's booking date.
 */
export function savedMangoReleaseSetup(compiled: CompiledObjective, nextMangoBookingDate: string): { setup: Record<string, unknown> | null; problems: string[] } {
  const o = compiled.objective, problems: string[] = [];
  if (o.mode !== 'NEXT_RELEASE') return { setup: null, problems: ['Available Now runs directly; it is not saved as a release plan.'] };
  if (compiled.problems.length) return { setup: null, problems: ['Resolve the plan problems first.'] };
  if (o.wings.BUKO.enabled) problems.push('The live release plan is Mango-only. Turn Buko off to save a live plan; Buko stays in offline rehearsal.');
  if (!o.wings.MANGO.enabled) problems.push('Enable Mango to save a live release plan.');
  if (o.wings.MANGO.bookingDate !== nextMangoBookingDate) problems.push(o.wings.MANGO.bookingDate < nextMangoBookingDate
    ? `Mango ${o.wings.MANGO.bookingDate} has already been released. The next release publishes ${nextMangoBookingDate}; choose that date explicitly to save a live plan.`
    : `The next release publishes Mango ${nextMangoBookingDate}. ${o.wings.MANGO.bookingDate} cannot be saved as the live plan now; keep it as a draft and save it after the earlier release.`);
  if (problems.length) return { setup: null, problems };
  const g = o.wings.MANGO, ordered = [...g.courts].sort((a, b) => a.priority - b.priority || a.court - b.court).map(c => c.court);
  const preferred = [...ordered, ...[7, 6, 5, 4, 3, 2, 1].filter(c => !ordered.includes(c))];
  if (o.strategy === 'NORMAL') {
    const general = compiled.generalRelease!;
    return { setup: { BOOKING_METHOD: general.BOOKING_METHOD, BOOKING_TYPE: 'standard', RELEASE_STRATEGY: 'general', PRECISION_TARGETS: [], PRECISION_FAN_OUT: false, RELEASE_OFFSET_MS: 0,
      COURT_COUNT: general.COURT_COUNT, START_TIME: general.START_TIME, DURATION_HOURS: general.DURATION_HOURS, PREFERRED_COURTS: general.PREFERRED_COURTS, FALLBACK_COURTS: [],
      FALLBACK_TIMES: general.FALLBACK_TIMES, MAX_SELECTION_ATTEMPTS: 3 }, problems };
  }
  const cohort = compiled.cohorts[0]!;
  const legacy = (t: ObjectiveTarget, immediate: boolean): SmartSlot => {
    const offsets = immediate && o.strategy === 'PRECISION' ? o.precision.offsetsMs[t.id] ?? [0] : [0];
    return { court: t.court, start: t.start, durationHours: t.durationHours, priority: t.priority, rate: targetRate(t, g)!,
      ...(immediate && o.strategy === 'PRECISION' ? offsets.length > 1 ? { fanOutOffsetsMs: [...offsets] } : offsets[0] ? { releaseOffsetMs: offsets[0] } : {} : {}) };
  };
  const legacyId = new Map(cohort.immediate.map(t => [t.id, `court-${t.court}:${t.start}:${t.durationHours}h`]));
  let shotgun: ShotgunSettings | undefined;
  if (o.strategy === 'SHOTGUN') {
    const scoped = toShotgunSettings(o.shotgun, cohort.immediate.map(t => t.id)).settings;
    shotgun = { ...scoped, selectedTargetIds: scoped.selectedTargetIds.map(id => legacyId.get(id)!),
      ...(scoped.customCounts ? { customCounts: Object.fromEntries(Object.entries(scoped.customCounts).map(([id, n]) => [legacyId.get(id)!, n])) } : {}) };
  }
  const smart = compileSmartPlan({ ...emptySmartDraft(), immediate: cohort.immediate.map(t => legacy(t, true)), backups: cohort.backups.map(t => legacy(t, false)),
    retryReopened: o.strategy === 'PRECISION' && o.precision.retryReopened, ...(shotgun ? { shotgun } : {}), advanced: o.strategy === 'SHOTGUN' ? { wave2: 0, rescue: 0 } : {} }, { targetDate: g.bookingDate });
  if (!smart.phase3) return { setup: null, problems: smart.problems };
  const hours = cohort.immediate.map(t => hourOf(t.start));
  const quota = compiled.quota;
  // Zero-count alternatives have no wave1 authorization. Keep them in the objective,
  // but serialize only active targets into the runtime's exact Shotgun authorization.
  const activeShotgunIds = new Set(smart.shotgun?.shots.map(shot => shot.logicalTargetId) ?? []);
  const activeCounts = (counts: Record<string, number>) => Object.fromEntries(Object.entries(counts).filter(([id, count]) => activeShotgunIds.has(id) || count !== 0));
  const strategyV2 = { version: 1, preset: 'CUSTOM', goal: { primeFrom: `${String(Math.min(...hours)).padStart(2, '0')}:00`, primeUntil: `${String(Math.min(24, Math.max(...cohort.immediate.map(t => hourOf(t.start) + t.durationHours)))).padStart(2, '0')}:00`,
      durations: [g.durationHours], courts: ordered },
    fanOut: { width: 1, source: 'OPERATOR_OVERRIDE', recommendedWidth: null, timing: 'BALANCED', profileCreatedAt: null },
    ...(smart.shotgun && shotgun ? { shotgun: { version: 1, enabled: true, budget: shotgun.budget, allocationMode: shotgun.allocationMode, selectedTargetIds: shotgun.selectedTargetIds.filter(id => activeShotgunIds.has(id)),
      ...(shotgun.customCounts ? { customCounts: activeCounts(shotgun.customCounts) } : {}), windowStartMs: shotgun.windowStartMs, windowEndMs: shotgun.windowEndMs, timingMode: shotgun.timingMode,
      ...(shotgun.customOffsetsMs ? { customOffsetsMs: shotgun.customOffsetsMs } : {}), timingCapacityOverride: !!shotgun.timingCapacityOverride, allowStandbyConsumption: !!shotgun.allowStandbyConsumption,
      counts: activeCounts(smart.shotgun.counts), exactSchedule: smart.shotgun.shots.map(({ logicalTargetId, shotIndex, configuredOffsetMs }) => ({ logicalTargetId, shotIndex, configuredOffsetMs })),
      capacity: { meaningfulSpacingMs: smart.shotgun.meaningfulSpacingMs, recommendedMaximum: smart.shotgun.recommendedMaximum, warning: smart.shotgun.capacityWarning, groupAnchorMs: smart.shotgun.groupAnchorMs } } } : {}),
    objective: { version: 3, fingerprint: compiled.fingerprint, scope: quota.scope, wings: { MANGO: quota.wings.MANGO! }, ...(quota.overall ? { overall: quota.overall } : {}) } };
  return { setup: { BOOKING_METHOD: 'proofless', BOOKING_TYPE: 'standard', RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: [], PRECISION_FAN_OUT: false, RELEASE_OFFSET_MS: 0,
    PRECISION_PHASE3: smart.phase3, STRATEGY_V2: strategyV2, COURT_COUNT: 1, START_TIME: cohort.immediate[0]!.start, DURATION_HOURS: g.durationHours,
    PREFERRED_COURTS: preferred, FALLBACK_COURTS: [], FALLBACK_TIMES: [], MAX_SELECTION_ATTEMPTS: 3 }, problems };
}

// ── Outcome reconciliation ───────────────────────────────────────────────────────────────────────────────
export type AttemptState = 'HOLD_VERIFIED' | 'HOLD_VERIFIED_QR_ATTENTION' | 'QR_READY' | 'REJECTED' | 'UNKNOWN' | 'NOT_DISPATCHED' | 'WINDOW_MISSED' | 'OMITTED' | 'SUPPRESSED';
export interface AttemptOutcome {
  wing: Wing; court: number; date: string; start: string; end: string; state: AttemptState | string; code?: string;
  bookingIds?: string[]; transactionId?: string; holdExpiresAt?: string;
  /** Only an authoritative provider payment record may set 'CONFIRMED'. A hold is never paid by inference. */
  payment?: 'PENDING' | 'CONFIRMED';
}
export type ObjectiveOutcomeStatus = 'NONE' | 'PARTIAL' | 'MINIMUM' | 'IDEAL' | 'UNKNOWN';
const HOLD_STATES = new Set(['HOLD_VERIFIED', 'HOLD_VERIFIED_QR_ATTENTION', 'QR_READY']);
export const isHoldState = (state: string) => HOLD_STATES.has(state);
/**
 * Quota evaluation over independently reconciled provider results. Distinct courts count once per wing; the same
 * provider booking reported twice is a duplicate, not a second court; holds beyond a wing's ideal are extra holds.
 */
export function evaluateObjectiveOutcome(quota: ObjectiveQuota, outcomes: readonly AttemptOutcome[]) {
  const seenBookings = new Set<string>(), holds: AttemptOutcome[] = [];
  let duplicates = 0;
  for (const o of outcomes.filter(o => isHoldState(o.state))) {
    const key = o.transactionId ?? (o.bookingIds?.length ? o.bookingIds.join(',') : `${o.wing}|${o.court}|${o.date}|${o.start}|${o.end}`);
    if (seenBookings.has(key)) { duplicates++; continue; }
    seenBookings.add(key); holds.push(o);
  }
  const unknown = outcomes.filter(o => o.state === 'UNKNOWN').length;
  const wings = Object.keys(quota.wings) as Wing[];
  const perWing = wings.map(wing => {
    const own = holds.filter(h => h.wing === wing), courts = unique(own.map(h => h.court));
    const q = quota.wings[wing]!, counted = quota.scope === 'PER_WING' ? Math.min(courts.length, q.ideal) : courts.length;
    const unknownHere = outcomes.filter(o => o.wing === wing && o.state === 'UNKNOWN').length;
    const status: ObjectiveOutcomeStatus = quota.scope === 'ANY_WING' ? (courts.length ? 'PARTIAL' : 'NONE')
      : courts.length >= q.ideal ? 'IDEAL' : unknownHere ? 'UNKNOWN' : courts.length >= q.minimum ? 'MINIMUM' : courts.length ? 'PARTIAL' : 'NONE';
    return { wing, minimum: q.minimum, ideal: q.ideal, courts, holds: own.length, counted, extraHolds: own.length - counted, unknown: unknownHere, status };
  });
  const distinctCourts = unique(holds.map(h => `${h.wing}:${h.court}`)).length;
  let status: ObjectiveOutcomeStatus;
  if (quota.scope === 'ANY_WING') {
    const o = quota.overall!;
    status = distinctCourts >= o.ideal ? 'IDEAL' : unknown ? 'UNKNOWN' : distinctCourts >= o.minimum ? 'MINIMUM' : distinctCourts ? 'PARTIAL' : 'NONE';
  } else status = perWing.every(w => w.status === 'IDEAL') ? 'IDEAL' : unknown ? 'UNKNOWN' : perWing.every(w => w.status === 'IDEAL' || w.status === 'MINIMUM') ? 'MINIMUM' : holds.length ? 'PARTIAL' : 'NONE';
  const counted = quota.scope === 'ANY_WING' ? Math.min(distinctCourts, quota.overall!.ideal) : perWing.reduce((sum, w) => sum + w.counted, 0);
  return { status, perWing, holds: holds.length, distinctCourts, counted, extraHolds: holds.length - counted, duplicates, unknown,
    paymentPending: holds.filter(h => h.payment !== 'CONFIRMED').length, paymentConfirmed: holds.filter(h => h.payment === 'CONFIRMED').length,
    needsReview: unknown > 0 || duplicates > 0 };
}
export const OUTCOME_LABEL: Readonly<Record<ObjectiveOutcomeStatus, string>> = Object.freeze({
  NONE: 'No courts achieved', PARTIAL: 'Partially achieved (below minimum)', MINIMUM: 'Minimum achieved', IDEAL: 'Ideal achieved', UNKNOWN: 'Outcome unknown — needs review' });

// ── Migration ────────────────────────────────────────────────────────────────────────────────────────────
interface LegacySetupLike {
  BOOKING_METHOD: string; BOOKING_TYPE: string; RELEASE_STRATEGY?: string; COURT_COUNT: number; START_TIME: string; DURATION_HOURS: number;
  PREFERRED_COURTS: number[]; FALLBACK_TIMES: string[];
  PRECISION_PHASE3?: { candidates: Array<{ court: number; start: string; durationHours: number; wing?: Wing; bookingDate?: string; priority: number }>; wave1: Array<{ candidateIndex: number; releaseOffsetMs?: number; fanOutOffsetsMs?: number[] }> };
  STRATEGY_V2?: { shotgun?: { enabled: boolean; budget: number; allocationMode: ShotgunAllocationMode; customCounts?: Record<string, number>; windowStartMs: number; windowEndMs: number;
    timingMode: ShotgunTimingMode; customOffsetsMs?: number[]; timingCapacityOverride?: boolean; allowStandbyConsumption?: boolean } };
}
/**
 * In-memory interpretation of an old saved Mango plan. Legacy numeric targets are Mango; saved bytes, durable journal
 * keys and allocation metadata are never rewritten. Returns notes describing anything the v3 model cannot represent.
 */
export function objectiveFromLegacySetup(setup: LegacySetupLike, nowMs: number): { objective: BookingObjective; notes: string[] } {
  const base = defaultObjective(nowMs, 'NEXT_RELEASE'), notes: string[] = ['Migrated from the saved Mango release plan; the saved file is unchanged until you save from Booking Setup.'];
  const mango = { ...base.wings.MANGO };
  const method = ({ proofless: 'PROOFLESS', 'api-first': 'API_FRESH_PROOF', browser: 'BROWSER', hybrid: 'HYBRID' } as Record<string, CheckoutMethodId>)[setup.BOOKING_METHOD] ?? 'API_FRESH_PROOF';
  const phase3 = setup.RELEASE_STRATEGY === 'precision' ? setup.PRECISION_PHASE3 : undefined;
  if (phase3) {
    const immediate = unique(phase3.wave1.map(a => a.candidateIndex)).map(i => phase3.candidates[i]!).filter(Boolean);
    const ordered = [...immediate].sort((a, b) => a.priority - b.priority);
    const courts = unique(ordered.map(c => c.court)), starts = unique(ordered.map(c => c.start));
    mango.courts = courts.map((court, index) => ({ court, priority: index + 1 }));
    mango.startTimes = starts.length ? starts : [setup.START_TIME];
    mango.durationHours = ordered[0]?.durationHours ?? 2; mango.minimum = 1; mango.ideal = 1;
    if (unique(ordered.map(c => c.durationHours)).length > 1) notes.push('Targets had different durations; the first target\'s duration is used.');
    const shotgun = setup.STRATEGY_V2?.shotgun;
    const strategy: StrategyId = shotgun?.enabled ? 'SHOTGUN' : 'PRECISION';
    const offsetsMs: Record<string, number[]> = {};
    for (const assignment of phase3.wave1) { const c = phase3.candidates[assignment.candidateIndex]; if (!c) continue;
      try { const t = exactReleaseTarget({ wing: 'MANGO', court: c.court, start: c.start, durationHours: c.durationHours, bookingDate: mango.bookingDate });
        offsetsMs[canonicalReleaseTargetId(t)] = [...(offsetsMs[canonicalReleaseTargetId(t)] ?? []), ...(assignment.fanOutOffsetsMs ?? [assignment.releaseOffsetMs ?? 0])]; } catch { /* reported by compile */ } }
    const objective: BookingObjective = { ...base, wings: { ...base.wings, MANGO: mango }, strategy, checkoutMethod: 'PROOFLESS',
      precision: { ...base.precision, offsetsMs },
      shotgun: shotgun ? { budget: shotgun.budget, allocationMode: shotgun.allocationMode, windowStartMs: shotgun.windowStartMs, windowEndMs: shotgun.windowEndMs, timingMode: shotgun.timingMode,
        ...(shotgun.timingMode === 'CUSTOM' && shotgun.customOffsetsMs ? { customOffsetsMs: [...shotgun.customOffsetsMs] } : {}),
        timingCapacityOverride: !!shotgun.timingCapacityOverride, allowStandbyConsumption: !!shotgun.allowStandbyConsumption, presetId: shotgun.timingMode === 'DENSE_CORE' ? 'DENSE_CORE' : 'FULLY_CUSTOM', source: 'CUSTOM' } : base.shotgun };
    if (shotgun?.allocationMode === 'CUSTOM' && shotgun.customCounts) {
      // Legacy undated IDs (court-7:19:00:3h) map onto the same Mango targets on the migrated booking date.
      const counts: Record<string, number> = {};
      for (const [legacyId, count] of Object.entries(shotgun.customCounts)) {
        const match = /^court-([1-7]):((?:0[89]|1\d|2[0-3]):00):([1-3])h$/.exec(legacyId);
        if (!match) continue;
        try { counts[canonicalReleaseTargetId(exactReleaseTarget({ wing: 'MANGO', court: Number(match[1]), start: match[2]!, durationHours: Number(match[3]), bookingDate: mango.bookingDate }))] = count; } catch { /* reported by compile */ }
      }
      objective.shotgun = { ...objective.shotgun, customCounts: counts };
    }
    const backups = phase3.candidates.length - immediate.length;
    if (backups > 0) notes.push(`The saved plan also has ${backups} backup choice${backups === 1 ? '' : 's'}${setup.PRECISION_PHASE3 && 'budgets' in setup.PRECISION_PHASE3 ? '' : ''} that Booking Setup does not list as acceptable targets. They stay in the saved plan until you Prepare from Booking Setup.`);
    return { objective, notes };
  }
  if (setup.BOOKING_TYPE === 'extended' || setup.DURATION_HOURS > 3) notes.push(`The saved ${setup.DURATION_HOURS}-hour Extended plan is outside the 1–3 hour objective model and stays editable in the legacy release editor.`);
  mango.courts = setup.PREFERRED_COURTS.map((court, index) => ({ court, priority: index + 1 }));
  mango.startTimes = unique([setup.START_TIME, ...setup.FALLBACK_TIMES].filter(s => HOUR.test(s)));
  mango.durationHours = Math.min(3, Math.max(1, setup.DURATION_HOURS));
  mango.minimum = clampInt(setup.COURT_COUNT, 1, 7, 1); mango.ideal = mango.minimum;
  return { objective: { ...base, wings: { ...base.wings, MANGO: mango }, strategy: 'NORMAL', checkoutMethod: method }, notes };
}
/** The previous dual-wing planning wrapper: ANY_ONE → any wing 1/1, ONE_PER_WING → each wing 1/1. */
export function objectiveFromDualWingPlan(plan: { objective: 'ANY_ONE' | 'ONE_PER_WING'; targets: Array<{ wing: Wing; court: number; start: string; durationHours: number; bookingDate: string; priority: number }>;
  shotgun: { budget: number; allocationMode: ShotgunAllocationMode; customCounts?: Record<string, number>; windowStartMs: number; windowEndMs: number; timingMode: ShotgunTimingMode; customOffsetsMs?: number[]; timingCapacityOverride?: boolean; allowStandbyConsumption?: boolean } }, nowMs: number): BookingObjective {
  const base = defaultObjective(nowMs, 'NEXT_RELEASE'), wings = { ...base.wings };
  for (const wing of WINGS) {
    const own = plan.targets.filter(t => t.wing === wing).sort((a, b) => a.priority - b.priority);
    wings[wing] = own.length ? { ...wings[wing], enabled: true, bookingDate: own[0]!.bookingDate, minimum: 1, ideal: 1, durationHours: own[0]!.durationHours,
      courts: unique(own.map(t => t.court)).map((court, index) => ({ court, priority: index + 1 })), startTimes: unique(own.map(t => t.start)) } : { ...wings[wing], enabled: false };
  }
  return { ...base, wings, quotaScope: plan.objective === 'ANY_ONE' ? 'ANY_WING' : 'PER_WING', overall: { minimum: 1, ideal: 1 }, strategy: 'SHOTGUN', checkoutMethod: 'PROOFLESS',
    shotgun: { ...plan.shotgun, presetId: plan.shotgun.timingMode === 'CUSTOM' ? 'FULLY_CUSTOM' : 'SUGGESTED', source: 'CUSTOM' } };
}
/**
 * A stored Next Release draft whose date has already been released is moved to that wing's next release date. Custom
 * Shotgun counts, literal assignments and Precision offsets are keyed by date-specific target IDs; they are carried to
 * the SAME wing, court, start and duration on the new date, so the operator's allocation is not silently emptied
 * (October 18: a moved draft showed 0 attempts). Values are never changed; every move is reported in a note, and the
 * result is only a draft until the operator saves it.
 */
export function rebaseReleasedDates(o: BookingObjective, nowMs: number): { objective: BookingObjective; notes: string[] } {
  if (o.mode !== 'NEXT_RELEASE') return { objective: o, notes: [] };
  const next: BookingObjective = JSON.parse(JSON.stringify(o)), notes: string[] = [], moved: Wing[] = [];
  for (const wing of WINGS) {
    try {
      if (releaseInstantFor(next.wings[wing].bookingDate, wing) > nowMs) continue;
      const to = nextReleaseFor(nowMs, wing).bookingDate;
      if (next.wings[wing].enabled) notes.push(`${wing === 'MANGO' ? 'Mango' : 'Buko'} ${next.wings[wing].bookingDate} has already been released; the draft now targets the next release date ${to}. Review it, then save the release plan.`);
      next.wings[wing].bookingDate = to; moved.push(wing);
    } catch { /* an invalid date is reported by compile */ }
  }
  if (!moved.length) return { objective: o, notes };
  // Old date-specific ID → new ID for the same wing/court/start/duration (and nothing else).
  const remap = new Map<string, string>();
  const keyOf = (id: string) => { const m = /^v2:(MANGO|BUKO):([^:]+):\d{4}-\d{2}-\d{2}:(.+)$/.exec(id); return m && moved.includes(m[1] as Wing) ? `${m[1]}:${m[2]}:${m[3]}` : null; };
  const fresh = new Map(enumerateTargets(next).targets.map(t => [keyOf(t.id), t.id] as const));
  const ids = [...Object.keys(o.shotgun.customCounts ?? {}), ...(o.shotgun.customAssignments ?? []), ...Object.keys(o.precision.offsetsMs)];
  for (const id of ids) { const key = keyOf(id), target = key ? fresh.get(key) : undefined; if (target && target !== id) remap.set(id, target); }
  const move = (id: string) => remap.get(id) ?? id;
  if (next.shotgun.customCounts) next.shotgun.customCounts = Object.fromEntries(Object.entries(next.shotgun.customCounts).map(([id, n]) => [move(id), n]));
  if (next.shotgun.customAssignments) next.shotgun.customAssignments = next.shotgun.customAssignments.map(move);
  next.precision.offsetsMs = Object.fromEntries(Object.entries(next.precision.offsetsMs).map(([id, v]) => [move(id), v]));
  if (remap.size) notes.push(`Attempt allocations and offsets were carried to the same courts and hours on the new date (${remap.size} target${remap.size === 1 ? '' : 's'}); no value was changed.`);
  return { objective: next, notes };
}
/** Accepts unknown stored JSON; returns a valid v3 objective or null. Never guesses a missing wing as anything but Mango. */
export function parseStoredObjective(value: unknown): BookingObjective | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as BookingObjective;
  if (o.version !== OBJECTIVE_VERSION || !o.wings?.MANGO || !o.wings?.BUKO || !o.shotgun || !o.precision || !o.price) return null;
  return structuredCloneSafe(o);
}
const structuredCloneSafe = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const courtLabel = (wing: Wing, court: number) => COURT_REGISTRY.find(c => c.wing === wing && c.number === court)?.displayName ?? `${wing} ${court}`;
