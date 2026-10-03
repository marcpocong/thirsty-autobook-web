import { createHash } from 'node:crypto';
import { COURT_TO_SPACE_ID } from './availability-parser.js';
import { DurableSubmissionJournal } from './durable-submission-journal.js';
import { THIRSTY_PICKLE_FACILITY_ID } from './live-availability-provider.js';
import { MATRIX_HOURS } from './court-hour-matrix.js';
import { availabilityFreshness, compareAvailabilityFreshness, decodeMatrix, freshestAvailabilityObservation, type AvailabilityObservation } from '../slot-evidence.js';
export type { AvailabilityObservation } from '../slot-evidence.js';
export { freshestAvailabilityObservation } from '../slot-evidence.js';
import { PRECISION_MAX_FAN_OUT, PRECISION_WORKER_IDS, type WorkerId } from '../workers.js';
import { isReleaseOffsetMs } from '../release-offset.js';
import { precisionTargetPlan, type PrecisionTarget } from './precision-race.js';
import type { BookingPlan } from './types.js';

/** Operator authorization is deliberately wider than the seven-worker dispatch fleet. */
export const PRECISION_MAX_CANDIDATES = 21;
export type PrecisionWave = 'WAVE_1' | 'WAVE_2' | 'RESCUE';
export interface CandidatePermissions { wave1: boolean; wave2: boolean; rescue: boolean }
export interface CandidateInput {
  court: number; start: string; durationHours: number; priority: number;
  permissions: CandidatePermissions; rateEvidence: RateEvidence;
  /** Planning-time public evidence and the operator's deliberate override marker (strategy-engine.ts). */
  publicEvidence?: { evidence: string; override?: 'OPERATOR_OVERRIDE_PUBLIC_CONFLICT' };
}
export interface RateEvidence {
  source: string; capturedAt: string; status: 'TARGET_DATE_PUBLISHED' | 'VENUE_SCHEDULE' | 'OPERATOR_CONFIRMED' | 'REFERENCE';
  date: string; perHour: readonly number[]; actionable: boolean;
}
export interface AuthorizedCandidate extends CandidateInput {
  id: string; end: string; logicalKey: string; expectedAmount: number;
}
/** One immediate logical target. With fanOutOffsetsMs it is sent as 2–6 independently tracked children (one per offset). */
export interface Wave1Assignment { workerId: WorkerId; candidateId: string; releaseOffsetMs?: number; fanOutOffsetsMs?: readonly number[] }
export interface PrecisionAuthorizationInput {
  date: string; releaseMs: number; candidates: CandidateInput[];
  wave1: Wave1Assignment[];
  standby: WorkerId[];
  budgets: { wave2: number; rescue: number; total: number };
  concurrentWave2: boolean; rescueEnabled: boolean; authorizedAt: string;
}
export interface FrozenPrecisionAuthorization extends Omit<PrecisionAuthorizationInput, 'candidates' | 'wave1' | 'standby'> {
  candidates: readonly AuthorizedCandidate[]; fingerprint: string; warning: string | null;
  wave1: readonly Readonly<Wave1Assignment>[]; standby: readonly WorkerId[];
}
const endOf = (start: string, duration: number) => `${String(Number(start.slice(0, 2)) + duration).padStart(2, '0')}:00`;
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`));
const isWorker = (id: string): id is WorkerId => PRECISION_WORKER_IDS.includes(id as WorkerId);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const precisionCandidateId = (date: string, value: Pick<CandidateInput, 'court' | 'start' | 'durationHours'>) =>
  hash([date, value.court, value.start, endOf(value.start, value.durationHours)]);

export function candidatesConflict(a: Pick<AuthorizedCandidate, 'court' | 'start' | 'end'>,
  b: Pick<AuthorizedCandidate, 'court' | 'start' | 'end'>): boolean {
  return a.court === b.court && a.start < b.end && b.start < a.end;
}

export function authorizePrecision(input: PrecisionAuthorizationInput): FrozenPrecisionAuthorization {
  if (!validDate(input.date) || !Number.isSafeInteger(input.releaseMs) || input.releaseMs <= 0 ||
    !Number.isFinite(Date.parse(input.authorizedAt))) throw Error('PRECISION_AUTHORIZATION_INVALID');
  if (input.candidates.length < 1 || input.candidates.length > PRECISION_MAX_CANDIDATES) throw Error('PRECISION_CANDIDATE_COUNT_INVALID');
  const candidates = input.candidates.map((value): AuthorizedCandidate => {
    const hour = Number(value.start?.slice(0, 2));
    if (!Number.isInteger(value.court) || !COURT_TO_SPACE_ID[value.court as keyof typeof COURT_TO_SPACE_ID] ||
      !/^(0[89]|1\d|2[0-3]):00$/.test(value.start) || !Number.isInteger(value.durationHours) ||
      value.durationHours < 1 || value.durationHours > 3 || hour + value.durationHours > 24 ||
      !Number.isSafeInteger(value.priority) || value.priority < 1 ||
      !value.permissions || !Object.values(value.permissions).some(Boolean) ||
      !validDate(value.rateEvidence?.date) || !Number.isFinite(Date.parse(value.rateEvidence.capturedAt)) ||
      value.rateEvidence.date !== input.date ||
      !/^[A-Za-z0-9 _./:-]{1,100}$/.test(value.rateEvidence.source) ||
      value.rateEvidence.perHour.length !== value.durationHours ||
      value.rateEvidence.perHour.some(price => !Number.isFinite(price) || price <= 0)) throw Error('PRECISION_CANDIDATE_INVALID');
    const end = endOf(value.start, value.durationHours);
    const logicalKey = DurableSubmissionJournal.key(THIRSTY_PICKLE_FACILITY_ID,
      COURT_TO_SPACE_ID[value.court as keyof typeof COURT_TO_SPACE_ID], input.date, value.start, end);
    return { ...value, permissions: { ...value.permissions }, rateEvidence: { ...value.rateEvidence, perHour: [...value.rateEvidence.perHour] },
      ...(value.publicEvidence ? { publicEvidence: { ...value.publicEvidence } } : {}),
      id: precisionCandidateId(input.date, value), logicalKey, end,
      expectedAmount: value.rateEvidence.perHour.reduce((sum, price) => sum + price, 0) };
  });
  if (new Set(candidates.map(value => value.id)).size !== candidates.length) throw Error('PRECISION_CANDIDATE_DUPLICATE');
  const byId = new Map(candidates.map(value => [value.id, value]));
  const usedWorkers = new Set<WorkerId>(), usedCandidates = new Set<string>();
  for (const assignment of input.wave1) {
    const candidate = byId.get(assignment.candidateId);
    const offsets = assignment.fanOutOffsetsMs;
    if ((assignment.releaseOffsetMs !== undefined && (!isReleaseOffsetMs(assignment.releaseOffsetMs) || offsets)) ||
      (offsets && (!Array.isArray(offsets) || offsets.length < 2 || offsets.length > PRECISION_MAX_FAN_OUT || offsets.some(value => !isReleaseOffsetMs(value)))))
      throw Error('PRECISION_WAVE1_ASSIGNMENT_INVALID');
    if (!isWorker(assignment.workerId) || usedWorkers.has(assignment.workerId) || !candidate?.permissions.wave1 ||
      usedCandidates.has(candidate.id) || !candidate.rateEvidence.actionable || candidate.rateEvidence.status === 'REFERENCE')
      throw Error('PRECISION_WAVE1_ASSIGNMENT_INVALID');
    usedWorkers.add(assignment.workerId); usedCandidates.add(candidate.id);
  }
  if (!input.wave1.length || input.wave1.length > PRECISION_WORKER_IDS.length ||
    input.wave1.some((assignment, index) => input.wave1.slice(index + 1).some(other =>
      candidatesConflict(byId.get(assignment.candidateId)!, byId.get(other.candidateId)!))))
    throw Error('PRECISION_WAVE1_CONFLICT');
  if (new Set(input.standby).size !== input.standby.length ||
    input.standby.some(worker => !isWorker(worker) || usedWorkers.has(worker))) throw Error('PRECISION_STANDBY_INVALID');
  const { wave2, rescue, total } = input.budgets;
  // Every fan-out child is its own send. Without fan-out this is exactly the number of immediate targets, as before.
  const wave1Sends = input.wave1.reduce((sum, value) => sum + (value.fanOutOffsetsMs?.length ?? 1), 0);
  if (![wave2, rescue, total].every(value => Number.isSafeInteger(value) && value >= 0) ||
    wave2 > input.standby.length || rescue > PRECISION_WORKER_IDS.length || total < wave1Sends ||
    total > Math.max(PRECISION_MAX_CANDIDATES, wave1Sends + wave2) + rescue || total > wave1Sends + wave2 + rescue ||
    (wave2 > 0 && !input.standby.length) || (rescue > 0 && !input.rescueEnabled)) throw Error('PRECISION_BUDGET_INVALID');
  const selected = input.wave1.map(value => byId.get(value.candidateId)!);
  const commonStart = selected.every(value => value.start === selected[0]!.start && value.end === selected[0]!.end);
  const warning = selected.length > 1 && commonStart
    ? `All ${selected.length} Wave 1 attempts share ${selected[0]!.start}–${selected[0]!.end}. A time-wide unavailable block would affect every attempt.`
    : null;
  const frozen = { ...input, candidates, wave1: input.wave1.map(value => ({ ...value, ...(value.fanOutOffsetsMs ? { fanOutOffsetsMs: [...value.fanOutOffsetsMs] } : {}) })),
    standby: [...input.standby], budgets: { ...input.budgets }, warning };
  return Object.freeze({ ...frozen,
    candidates: Object.freeze(candidates.map(value => Object.freeze({ ...value,
      permissions: Object.freeze(value.permissions), rateEvidence: Object.freeze({ ...value.rateEvidence,
        perHour: Object.freeze([...value.rateEvidence.perHour]) }) }))),
    wave1: Object.freeze(frozen.wave1.map(value => Object.freeze({ ...value, ...(value.fanOutOffsetsMs ? { fanOutOffsetsMs: Object.freeze([...value.fanOutOffsetsMs]) } : {}) }))),
    standby: Object.freeze([...frozen.standby]), budgets: Object.freeze({ ...frozen.budgets }),
    fingerprint: hash(frozen) });
}

export type EvidenceFitness = 'ACTIONABLE_FRESH' | 'ACTIONABLE_BOUNDED_CACHE' | 'FORENSIC_ONLY_CACHE_AGE_UNKNOWN' | 'FORENSIC_ONLY_STALE' |
  'FORENSIC_ONLY_INCOMPLETE' | 'FORENSIC_ONLY_OUTDATED_REQUEST' | 'UNRELEASED' | 'FAILED';
export interface ActionableObservation { observation: AvailabilityObservation; fitness: EvidenceFitness; ageMs: number;
  representedAtLowerBoundOffsetMs: number | null }
export function isActionableEvidenceFitness(fitness: EvidenceFitness): boolean {
  return fitness === 'ACTIONABLE_FRESH' || fitness === 'ACTIONABLE_BOUNDED_CACHE';
}
/** Conservative upper bound on how old the represented state can be at evaluation time.
 * HTTP Age is an integer number of seconds and can be rounded down, so one full second is
 * added at the response boundary. Time elapsed since that response is then added. */
export function effectiveRepresentedAgeUpperBoundMs(observation: AvailabilityObservation,
  releaseMs: number, evaluatedMs: number): number | null {
  const ageS = observation.cache?.ageS;
  if (!Number.isSafeInteger(ageS) || ageS! < 0) return null;
  const elapsedSinceResponseMs = evaluatedMs - (releaseMs + observation.responseOffsetMs);
  if (!Number.isFinite(elapsedSinceResponseMs) || elapsedSinceResponseMs < 0) return null;
  return (ageS! + 1) * 1000 + elapsedSinceResponseMs;
}
/** MISS/age 0 is genuinely current evidence. HIT or STALE can be actionable only when
 * integer Age metadata gives a conservative upper bound inside the same freshness budget. */
export function classifyActionableObservation(observation: AvailabilityObservation, newestAnsweredSeq: number,
  releaseMs: number, evaluatedMs: number, maxAgeMs: number): ActionableObservation {
  const evaluatedOffsetMs=evaluatedMs-releaseMs,requestAgeMs = evaluatedOffsetMs-observation.requestOffsetMs;
  const cacheStatus = observation.cache?.status;
  const freshness=availabilityFreshness(observation,evaluatedOffsetMs);
  const boundedCacheAgeMs = cacheStatus === 'HIT' || cacheStatus === 'STALE' ? freshness.ageUpperBoundMs : null;
  const ageMs = boundedCacheAgeMs ?? requestAgeMs;
  let fitness: EvidenceFitness;
  if (observation.outcome !== 'ok') fitness = 'FAILED';
  else if (!observation.targetDatePresent || observation.requestOffsetMs < 0) fitness = 'UNRELEASED';
  else if (observation.seq < newestAnsweredSeq) fitness = 'FORENSIC_ONLY_OUTDATED_REQUEST';
  else if (decodeMatrix(observation.matrix).size !== 112 || !observation.prices ||
    observation.prices.length !== 7 || observation.prices.some(row => row.length !== MATRIX_HOURS.length))
    fitness = 'FORENSIC_ONLY_INCOMPLETE';
  else if (cacheStatus === 'HIT' || cacheStatus === 'STALE') {
    if (boundedCacheAgeMs === null) fitness = 'FORENSIC_ONLY_CACHE_AGE_UNKNOWN';
    else if (boundedCacheAgeMs > maxAgeMs) fitness = 'FORENSIC_ONLY_STALE';
    else fitness = 'ACTIONABLE_BOUNDED_CACHE';
  } else if (cacheStatus !== 'MISS' || (observation.cache?.ageS ?? 0) > 0)
    fitness = 'FORENSIC_ONLY_CACHE_AGE_UNKNOWN';
  else if (!Number.isFinite(requestAgeMs) || requestAgeMs < 0 || requestAgeMs > maxAgeMs) fitness = 'FORENSIC_ONLY_STALE';
  else fitness = 'ACTIONABLE_FRESH';
  return { observation, fitness, ageMs, representedAtLowerBoundOffsetMs:freshness.representedAtLowerBoundOffsetMs };
}

/** Freshness window for adaptive evidence: max(6 s, 2 × read latency + security refresh + 1 s), capped at 15 s.
 * Shared by the release runner and the offline replay so both apply the same rule. */
export function adaptiveMaxAgeMs(readLatencyMs: number, securityRefreshMs: number): number {
  return Math.min(15_000, Math.max(6_000, 2 * readLatencyMs + securityRefreshMs + 1000));
}

/** Adaptive evidence fitness at `nowMs`, with the freshness window derived from the observation's own read latency. */
export function adaptiveFitness(observation: AvailabilityObservation, newestSeq: number, releaseMs: number, nowMs: number,
  securityRefreshMs: number): ActionableObservation {
  const latency = Math.max(0, observation.responseOffsetMs - observation.requestOffsetMs);
  return classifyActionableObservation(observation, newestSeq, releaseMs, nowMs, adaptiveMaxAgeMs(latency, securityRefreshMs));
}

type CandidateRange = { state: 'OPEN'; prices: number[] } | { state: 'UNAVAILABLE' | 'UNKNOWN' | 'PRICE_INVALID' };
/** Every required hourly cell of the range, and its price, from one observation. */
function readCandidateRange(candidate: AuthorizedCandidate, observation: AvailabilityObservation): CandidateRange {
  const cells = decodeMatrix(observation.matrix), hours = Number(candidate.start.slice(0, 2));
  const range = Array.from({ length: candidate.durationHours }, (_, offset) => `${String(hours + offset).padStart(2, '0')}:00`);
  const codes = range.map(hour => cells.get(`${candidate.court}/${hour}`));
  if (codes.some(code => code === 'X')) return { state: 'UNAVAILABLE' };
  if (codes.some(code => code !== 'O')) return { state: 'UNKNOWN' };
  const prices = range.map(hour => observation.prices?.[candidate.court - 1]?.[MATRIX_HOURS.indexOf(hour)]);
  if (prices.some(price => typeof price !== 'number' || !Number.isFinite(price) || price <= 0)) return { state: 'PRICE_INVALID' };
  return { state: 'OPEN', prices: prices as number[] };
}

export function candidatePriceFromObservation(candidate: AuthorizedCandidate, evidence: ActionableObservation): number[] | null {
  if (!isActionableEvidenceFitness(evidence.fitness)) return null;
  const range = readCandidateRange(candidate, evidence.observation);
  return range.state === 'OPEN' ? range.prices : null;
}

/** Why an adaptive (Wave 2 / Rescue) attempt was abandoned before its POST. */
export type AdaptiveSkipReason = 'LATEST_NOT_ACTIONABLE' | 'CANDIDATE_NO_LONGER_OPEN' | 'CANDIDATE_STATE_UNKNOWN' |
  'PRICE_INVALID' | 'PRICE_CHANGED' | 'ABORTED' | 'RELEASE_NOT_REACHED' | 'VERIFIED_HOLD_EXISTS' | 'UNKNOWN_ATTEMPT_EXISTS' |
  'CONCURRENT_ATTEMPT_IN_FLIGHT' | 'JOURNAL_BLOCKED' | 'WORKER_UNAVAILABLE' | 'SECURITY_FAILED';
export interface AdaptiveRevalidationInput {
  session: PrecisionSession; candidate: AuthorizedCandidate; wave: 'WAVE_2' | 'RESCUE';
  /** Observation the candidate was selected from; the candidate must have stayed open since. */
  selectedEvidenceSeq: number;
  newestSeq: number; nowMs: number; securityRefreshMs: number; aborted: boolean; verifiedHold: boolean;
  /** Release-clock reading, checked only at the final pre-POST gate. */
  dispatchClockMs?: number;
  /** The caller's own reserved attempt, excluded from the concurrency check. */
  ownAttemptId?: string;
  /** Prices already bound into a reserved request: the newest evidence must still carry exactly these. */
  lockedPrices?: readonly number[];
}
export type AdaptiveRevalidation =
  | { valid: true; evidence: ActionableObservation; evidenceSeq: number; prices: number[] }
  | { valid: false; reason: AdaptiveSkipReason; seq?: number; fitness?: EvidenceFitness };

/**
 * The one rule every adaptive checkpoint (after security preparation, before reservation, immediately
 * before POST) applies. A newer Slot Watch sequence is not by itself a reason to stop: the newest
 * observation must independently be actionable now, and the SAME candidate must still be fully
 * OPEN in it with valid prices, in which case that observation becomes the effective evidence. The
 * candidate is never swapped; an older observation is never used in place of a newer one.
 */
export function revalidateAdaptiveAttempt(input: AdaptiveRevalidationInput): AdaptiveRevalidation {
  const { session, candidate } = input, releaseMs = session.authorization.releaseMs;
  if (input.aborted) return { valid: false, reason: 'ABORTED' };
  if (input.dispatchClockMs !== undefined && !(input.dispatchClockMs >= releaseMs)) return { valid: false, reason: 'RELEASE_NOT_REACHED' };
  if (input.verifiedHold) return { valid: false, reason: 'VERIFIED_HOLD_EXISTS' };
  const blocker = session.adaptiveBlocker(input.wave, input.ownAttemptId);
  if (blocker) return { valid: false, reason: blocker };
  const latest = session.latest;
  if (!latest) return { valid: false, reason: 'LATEST_NOT_ACTIONABLE' };
  const seq = latest.observation.seq;
  const evidence = adaptiveFitness(latest.observation, input.newestSeq, releaseMs, input.nowMs, input.securityRefreshMs);
  if (!isActionableEvidenceFitness(evidence.fitness))
    return { valid: false, reason: 'LATEST_NOT_ACTIONABLE', seq, fitness: evidence.fitness };
  // Open again now is not enough: a fresh read that showed the range unavailable after selection
  // ends this attempt (a later reopening is a new event for the adaptive loop to consider).
  const closedAt = session.lastUnavailableFreshnessOffset(candidate.id),selectedAt=session.evidenceFreshnessOffset(input.selectedEvidenceSeq);
  if (closedAt !== undefined && selectedAt !== undefined && closedAt > selectedAt)
    return { valid: false, reason: 'CANDIDATE_NO_LONGER_OPEN', seq };
  const range = readCandidateRange(candidate, latest.observation);
  if (range.state !== 'OPEN') return { valid: false, seq, reason: range.state === 'UNAVAILABLE' ? 'CANDIDATE_NO_LONGER_OPEN' :
    range.state === 'UNKNOWN' ? 'CANDIDATE_STATE_UNKNOWN' : 'PRICE_INVALID' };
  if (input.lockedPrices && (input.lockedPrices.length !== range.prices.length ||
    input.lockedPrices.some((price, index) => price !== range.prices[index]))) return { valid: false, reason: 'PRICE_CHANGED', seq };
  return { valid: true, evidence, evidenceSeq: seq, prices: range.prices };
}
/** Replaces every request rate from one documented evidence set; no assumed-rate slot survives. */
export function pricedPrecisionPlan(candidate: AuthorizedCandidate, date: string, prices: readonly number[]): BookingPlan {
  if (prices.length !== candidate.durationHours || prices.some(value => !Number.isFinite(value) || value <= 0))
    throw Error('PRECISION_RATE_EVIDENCE_INVALID');
  const target: PrecisionTarget = { court: candidate.court, start: candidate.start, durationHours: candidate.durationHours,
    end: candidate.end, workerId: 'A', targetKey: candidate.logicalKey, assumedAmount: prices.reduce((a, b) => a + b, 0) };
  const base = precisionTargetPlan(target, date), source = base.courts[0]!;
  const slots = source.slots.map((slot, index) => ({ ...slot, price: prices[index]!,
    isNightRate: Number(slot.startTime.slice(0, 2)) >= 16 }));
  const price = prices.reduce((a, b) => a + b, 0), court = { ...source, slots, price };
  return { ...base, courts: [court], chunks: [{ ...base.chunks[0]!, courts: [court], totalPrice: price }], totalPrice: price };
}

/** The exact plan a saved candidate would be sent with at its rate evidence (for the arm-time wire self-check). */
export function candidateWirePlan(date: string, candidate: Pick<CandidateInput, 'court' | 'start' | 'durationHours' | 'rateEvidence'>): BookingPlan {
  const end = endOf(candidate.start, candidate.durationHours);
  const logicalKey = DurableSubmissionJournal.key(THIRSTY_PICKLE_FACILITY_ID,
    COURT_TO_SPACE_ID[candidate.court as keyof typeof COURT_TO_SPACE_ID], date, candidate.start, end);
  return pricedPrecisionPlan({ ...candidate, end, logicalKey } as AuthorizedCandidate, date, candidate.rateEvidence.perHour);
}

/** `evidenceSeq` is the observation that last authorized the request (the effective evidence);
 * `selectedEvidenceSeq` is the one the candidate was first selected from, when they differ.
 * NOT_DISPATCHED is a reservation proven never to have sent its request (a SubmissionDispatchError with
 * dispatched=false, the evidence under which the durable journal also records it as unsent). It stays in
 * the history but consumes no budget and no Rescue reopen epoch. */
export interface RaceAttempt { id: string; candidateId: string; workerId: WorkerId; wave: PrecisionWave;
  state: 'IN_FLIGHT' | 'REJECTED' | 'UNKNOWN' | 'VERIFIED' | 'NOT_DISPATCHED'; evidenceSeq?: number; selectedEvidenceSeq?: number; reopenEpoch?: number;
  /** Fan-out child of an immediate target (the logical parent goal is candidateId). */
  fanOutIndex?: number; fanOutCount?: number }
/** Sends Wave 1 makes: one per immediate target, or one per fan-out child. */
export const wave1SendCount = (authorization: Pick<FrozenPrecisionAuthorization, 'wave1'>) =>
  authorization.wave1.reduce((sum, value) => sum + (value.fanOutOffsetsMs?.length ?? 1), 0);
export class PrecisionSession {
  readonly attempts: RaceAttempt[] = [];
  latest?: ActionableObservation;
  private wave2Selected = false;
  private readonly unavailableAt = new Map<string, {seq:number;responseOffsetMs:number;representedAtLowerBoundOffsetMs:number}>();
  private readonly representedAtBySeq = new Map<number,number>();
  private readonly rangeWasUnavailable = new Map<string, boolean>();
  constructor(readonly authorization: FrozenPrecisionAuthorization) {}
  get status(): 'OBJECTIVE_ACHIEVED' | 'OBJECTIVE_ACHIEVED_EXTRA_HOLD' | 'MANUAL_RECONCILIATION_REQUIRED' |
    'ALL_REJECTED_WAITING_FOR_REOPEN' | 'NOTHING_DISPATCHED' {
    const verified = this.attempts.filter(value => value.state === 'VERIFIED').length;
    if (this.attempts.some(value => value.state === 'UNKNOWN')) return 'MANUAL_RECONCILIATION_REQUIRED';
    if (verified > 1) return 'OBJECTIVE_ACHIEVED_EXTRA_HOLD';
    if (verified) return 'OBJECTIVE_ACHIEVED';
    if (this.attempts.some(value => value.state === 'IN_FLIGHT')) return 'MANUAL_RECONCILIATION_REQUIRED';
    return this.consuming().length ? 'ALL_REJECTED_WAITING_FOR_REOPEN' : 'NOTHING_DISPATCHED';
  }
  /** Attempts that count against budgets and Rescue reopen epochs: every attempt except one proven never sent.
   * A reservation consumes from the moment it is recorded (IN_FLIGHT), so a pending final gate still blocks. */
  private consuming(): RaceAttempt[] { return this.attempts.filter(value => value.state !== 'NOT_DISPATCHED'); }
  observe(evidence: ActionableObservation): void {
    if (!isActionableEvidenceFitness(evidence.fitness)) return;
    const representedAt=evidence.representedAtLowerBoundOffsetMs;
    if(representedAt===null)return;
    this.representedAtBySeq.set(evidence.observation.seq,representedAt);
    if (this.latest && compareAvailabilityFreshness(evidence.observation,this.latest.observation) <= 0) return;
    this.latest = evidence;
    for (const candidate of this.authorization.candidates) {
      const cells = decodeMatrix(evidence.observation.matrix);
      const hours = Number(candidate.start.slice(0, 2));
      const codes = Array.from({ length: candidate.durationHours }, (_, offset) =>
        cells.get(`${candidate.court}/${String(hours + offset).padStart(2, '0')}:00`));
      if (codes.some(value => value !== 'O' && value !== 'X')) continue;
      const unavailable = codes.some(value => value === 'X');
      if (unavailable && !this.rangeWasUnavailable.get(candidate.id)) this.unavailableAt.set(candidate.id,
        {seq:evidence.observation.seq,responseOffsetMs:evidence.observation.responseOffsetMs,representedAtLowerBoundOffsetMs:representedAt});
      this.rangeWasUnavailable.set(candidate.id, unavailable);
    }
  }
  evidenceFreshnessOffset(seq:number):number|undefined{return this.representedAtBySeq.get(seq);}
  lastUnavailableFreshnessOffset(candidateId:string):number|undefined{return this.unavailableAt.get(candidateId)?.representedAtLowerBoundOffsetMs;}
  /** Pure selection; caller must durably reserve and recheck before each dispatch. */
  /**
   * Workers that may take a new attempt of this wave now, in preference order: Wave 2 uses unused standby workers; Rescue
   * uses standby workers first, then immediate workers whose earlier attempts all settled (reuse after a conclusive
   * rejection; any UNKNOWN blocks every adaptive attempt anyway). `rank` (lower first) lets the caller prefer workers whose
   * security context is already prepared; ties keep the default order.
   */
  adaptiveWorkers(wave: 'WAVE_2' | 'RESCUE', rank?: (worker: WorkerId) => number): WorkerId[] {
    const workers = (wave === 'WAVE_2' ? this.authorization.standby : [...this.authorization.standby, ...this.authorization.wave1.map(value => value.workerId)])
      .filter(worker => wave === 'WAVE_2'
        ? !this.attempts.some(value => value.workerId === worker)
        : !this.attempts.some(value => value.workerId === worker && value.state === 'IN_FLIGHT'));
    const unique = [...new Set(workers)];
    return rank ? unique.map((worker, index) => ({ worker, index, key: rank(worker) })).sort((a, b) => a.key - b.key || a.index - b.index).map(value => value.worker) : unique;
  }
  select(wave: 'WAVE_2' | 'RESCUE', nowMs: number, maxAgeMs: number, options: { workerRank?: (worker: WorkerId) => number } = {}): Array<{ candidate: AuthorizedCandidate; workerId: WorkerId; prices: number[]; evidenceSeq: number; reopenEpoch?: number }> {
    if (wave === 'WAVE_2' && this.wave2Selected || wave === 'RESCUE' && !this.authorization.rescueEnabled) return [];
    if (this.attempts.some(value => value.state === 'UNKNOWN' || value.state === 'VERIFIED')) return [];
    if (wave === 'WAVE_2' && !this.authorization.concurrentWave2 && this.attempts.some(value => value.state === 'IN_FLIGHT')) return [];
    if (wave === 'RESCUE' && this.attempts.some(value => value.state === 'IN_FLIGHT')) return [];
    if (wave === 'RESCUE' && !this.attempts.some(value => value.state === 'REJECTED')) return [];
    const evidence = this.latest;
    if (!evidence || !isActionableEvidenceFitness(classifyActionableObservation(evidence.observation, evidence.observation.seq,
      this.authorization.releaseMs, nowMs, maxAgeMs).fitness)) return [];
    const consuming = this.consuming();
    const budget = Math.min(this.authorization.budgets.total - consuming.length,
      this.authorization.budgets[wave === 'WAVE_2' ? 'wave2' : 'rescue'] - consuming.filter(value => value.wave === wave).length);
    if (budget <= 0) return [];
    const byId = new Map(this.authorization.candidates.map(value => [value.id, value]));
    const active = this.attempts.filter(value => value.state === 'IN_FLIGHT' || value.state === 'VERIFIED').map(value => byId.get(value.candidateId)!);
    const workers = this.adaptiveWorkers(wave, options.workerRank);
    const selected: Array<{ candidate: AuthorizedCandidate; workerId: WorkerId; prices: number[]; evidenceSeq: number; reopenEpoch?: number }> = [];
    for (const candidate of [...this.authorization.candidates].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))) {
      if (selected.length >= budget || selected.length >= workers.length) break;
      if (!(wave === 'WAVE_2' ? candidate.permissions.wave2 : candidate.permissions.rescue)) continue;
      if (wave === 'WAVE_2' && this.attempts.some(value => value.candidateId === candidate.id)) continue;
      const unavailable=this.unavailableAt.get(candidate.id);
      const currentRepresentedAt=evidence.representedAtLowerBoundOffsetMs;
      if (wave === 'RESCUE' && (!unavailable || currentRepresentedAt===null || unavailable.representedAtLowerBoundOffsetMs>=currentRepresentedAt ||
        unavailable.responseOffsetMs > evidence.observation.requestOffsetMs ||
        consuming.some(value => value.wave === 'RESCUE' && value.candidateId === candidate.id && value.reopenEpoch === unavailable.seq))) continue;
      if ([...active, ...selected.map(value => value.candidate)].some(value => candidatesConflict(value, candidate))) continue;
      const prices = candidatePriceFromObservation(candidate, evidence);
      if (!prices) continue;
      selected.push({ candidate, workerId: workers[selected.length]!, prices, evidenceSeq: evidence.observation.seq,
        ...(wave === 'RESCUE' ? { reopenEpoch: unavailable!.seq } : {}) });
    }
    // A fresh grid with no eligible target must not spend the one adaptive wave.
    if (wave === 'WAVE_2' && selected.length) this.wave2Selected = true;
    return selected;
  }
  /** Attempt-state gates shared by every adaptive checkpoint. `ownAttemptId` excludes the caller's reservation. */
  adaptiveBlocker(wave: 'WAVE_2' | 'RESCUE', ownAttemptId?: string): 'UNKNOWN_ATTEMPT_EXISTS' | 'VERIFIED_HOLD_EXISTS' | 'CONCURRENT_ATTEMPT_IN_FLIGHT' | undefined {
    if (this.attempts.some(value => value.state === 'UNKNOWN')) return 'UNKNOWN_ATTEMPT_EXISTS';
    if (this.attempts.some(value => value.state === 'VERIFIED')) return 'VERIFIED_HOLD_EXISTS';
    if (wave === 'RESCUE' && this.attempts.some(value => value.id !== ownAttemptId && value.state === 'IN_FLIGHT')) return 'CONCURRENT_ATTEMPT_IN_FLIGHT';
    return undefined;
  }
  /** Sequence of the fresh read that last showed this candidate's range turning unavailable. */
  lastUnavailableSeq(candidateId: string): number | undefined { return this.unavailableAt.get(candidateId)?.seq; }
  record(attempt: RaceAttempt): void {
    if (this.attempts.some(value => value.id === attempt.id)) throw Error('PRECISION_ATTEMPT_DUPLICATE');
    this.attempts.push(attempt);
  }
}
