import { MATRIX_COURTS, MATRIX_HOURS } from './api-booking/court-hour-matrix.js';

/**
 * Release forensics: pure derivation of court/hour evidence from raw Slot Watch
 * observations. Nothing here reads the network or a clock.
 *
 * An availability read describes Onda's state at some unknown moment between its
 * request start and its response. Reads can overlap and answer out of order, so all
 * derived evidence uses REQUEST order (seq), keeps both boundaries of every read, and
 * never claims the provider-side moment of a change.
 */

/** Offsets are milliseconds since release on the observer's network-corrected clock. */
export interface ObservationRef { seq: number; requestOffsetMs: number; responseOffsetMs: number }

export interface AvailabilityObservation extends ObservationRef {
  scheduledOffsetMs: number;
  outcome: 'ok' | 'failed' | 'aborted';
  code?: string;
  /** Onda flagged the target date as published in this response. */
  targetDatePresent: boolean;
  /** `1:OX?U…,2:…` in 08:00→23:00 order (ok reads only). O open, X unavailable, U unpublished, ? unknown. */
  matrix?: string;
  /** Per-cell price where the response had the slot: prices[court - 1][hourIndex]. */
  prices?: Array<Array<number | null>>;
  /** Edge cache metadata of the response, when present. */
  cache?: { status?: string; ageS?: number };
  /** Allowlisted response metadata only. Never includes cookies, request bodies, identities, or auth values. */
  provider?: { vercelId?: string; date?: string; matchedPath?: string };
}

export interface BookingObservation extends ObservationRef {
  scheduledOffsetMs: number;
  outcome: 'ok' | 'failed' | 'aborted';
  /** Courts whose public booking query failed: their cells are unknown in this read. */
  failedCourts: number[];
  /** `court/HH:00` cells with a matching public booking record, for courts that answered. */
  cells: string[];
  provider?:Array<{court:number;status:number;latencyMs:number;cacheStatus?:string;ageS?:number;vercelId?:string;date?:string;matchedPath?:string}>;
}

export type EvidenceState = 'OPEN' | 'UNAVAILABLE' | 'UNKNOWN';
export type ReopeningConfidence = 'CONFIRMED' | 'PROBABLE' | 'OBSERVATION_INCONSISTENCY' | 'UNKNOWN';
export type FreshnessClass = 'ORIGIN_FRESH' | 'BOUNDED_CACHE' | 'UNBOUNDED';
export interface ObservationFreshness {
  class: FreshnessClass;
  /** Conservative maximum represented age at the shared evaluation point. */
  ageUpperBoundMs: number | null;
  /** Earliest time the represented state could have existed, release-relative. Higher is fresher. */
  representedAtLowerBoundOffsetMs: number | null;
}
/** Two consecutive reads in request order that disagree; the change happened between them. */
export interface ObservedChange {
  before: ObservationRef;
  after: ObservationRef;
  /** The two reads' request/response intervals overlap, so their provider-side order is not established. */
  overlapping: boolean;
}
export interface ReopeningChange extends ObservedChange { confidence: ReopeningConfidence }
export interface CellEvidence {
  court: number; hour: string;
  firstPublished: { state: EvidenceState; price: number | null; observation: ObservationRef } | null;
  firstOpen: ObservationRef | null;
  firstUnavailable: ObservationRef | null;
  openToUnavailable: ObservedChange | null;
  /** First unavailable → OPEN change (a reopen); the cause is not visible in public data. */
  unavailableToOpen: ReopeningChange | null;
  /** OPEN ↔ unavailable changes in request order. */
  changes: number;
  firstRecord: { observation: ObservationRef; previous: ObservationRef | null } | null;
  recordRemoved: { observation: ObservationRef; previous: ObservationRef } | null;
  latest: { state: EvidenceState; observation: ObservationRef | null; record: boolean | null };
}
export interface PublicationEvidence {
  /** Newest unpublished read requested before the first published one. */
  lastUnpublished: ObservationRef | null;
  /** Earliest REQUEST whose response had the date: the first-published grid. */
  firstPublished: (ObservationRef & { cache?: AvailabilityObservation['cache'] }) | null;
  /** Earliest RESPONSE that had the date (may differ when reads overlap). */
  firstPublishedResponse: ObservationRef | null;
}
export interface SlotEvidence {
  publication: PublicationEvidence;
  /** UI rule: the newest REQUEST that has answered. A late answer to an older request never replaces it. */
  current: ObservationRef | null;
  currentFreshness: ObservationFreshness | null;
  currentMatrix: string | null;
  firstPublishedMatrix: string | null;
  cells: CellEvidence[];
}

const ref = (value: ObservationRef): ObservationRef =>
  ({ seq: value.seq, requestOffsetMs: value.requestOffsetMs, responseOffsetMs: value.responseOffsetMs });
export const cellKey = (court: number, hour: string) => `${court}/${hour}`;
const overlapping = (before: ObservationRef, after: ObservationRef) => before.responseOffsetMs > after.requestOffsetMs;

/**
 * Conservative freshness model used by Slot Watch operational state.
 * - MISS/age 0 can have been produced no earlier than request start.
 * - HIT/STALE Age is integer seconds and may be rounded down, so add one full second.
 * - Missing/unsupported cache provenance is unbounded and cannot supersede bounded evidence.
 */
export function availabilityFreshness(observation: AvailabilityObservation, evaluatedOffsetMs: number): ObservationFreshness {
  if (observation.outcome !== 'ok' || !Number.isFinite(evaluatedOffsetMs))
    return { class: 'UNBOUNDED', ageUpperBoundMs: null, representedAtLowerBoundOffsetMs: null };
  const status = observation.cache?.status, ageS = observation.cache?.ageS;
  if (status === 'MISS' && (ageS === undefined || ageS === 0)) {
    const age = evaluatedOffsetMs - observation.requestOffsetMs;
    return Number.isFinite(age) && age >= 0
      ? { class: 'ORIGIN_FRESH', ageUpperBoundMs: age, representedAtLowerBoundOffsetMs: observation.requestOffsetMs }
      : { class: 'UNBOUNDED', ageUpperBoundMs: null, representedAtLowerBoundOffsetMs: null };
  }
  if ((status === 'HIT' || status === 'STALE') && Number.isSafeInteger(ageS) && ageS! >= 0) {
    const representedAt = observation.responseOffsetMs - (ageS! + 1) * 1000;
    const age = evaluatedOffsetMs - representedAt;
    return Number.isFinite(age) && age >= 0
      ? { class: 'BOUNDED_CACHE', ageUpperBoundMs: age, representedAtLowerBoundOffsetMs: representedAt }
      : { class: 'UNBOUNDED', ageUpperBoundMs: null, representedAtLowerBoundOffsetMs: null };
  }
  return { class: 'UNBOUNDED', ageUpperBoundMs: null, representedAtLowerBoundOffsetMs: null };
}

/** Positive means `candidate` is better operational evidence than `current`. */
export function compareAvailabilityFreshness(candidate: AvailabilityObservation, current: AvailabilityObservation,
  evaluatedOffsetMs = Math.max(candidate.responseOffsetMs, current.responseOffsetMs)): number {
  const a = availabilityFreshness(candidate, evaluatedOffsetMs), b = availabilityFreshness(current, evaluatedOffsetMs);
  if (a.representedAtLowerBoundOffsetMs !== null && b.representedAtLowerBoundOffsetMs === null) return 1;
  if (a.representedAtLowerBoundOffsetMs === null && b.representedAtLowerBoundOffsetMs !== null) return -1;
  if (a.representedAtLowerBoundOffsetMs !== null && b.representedAtLowerBoundOffsetMs !== null &&
    a.representedAtLowerBoundOffsetMs !== b.representedAtLowerBoundOffsetMs)
    return a.representedAtLowerBoundOffsetMs - b.representedAtLowerBoundOffsetMs;
  // If neither response is bounded, retain the legacy request-order fallback for display only.
  return candidate.seq - current.seq;
}

export function freshestAvailabilityObservation(values: readonly AvailabilityObservation[]): AvailabilityObservation | undefined {
  const answered = values.filter(value => value.outcome === 'ok');
  const evaluated = Math.max(0, ...answered.map(value => value.responseOffsetMs));
  return answered.reduce<AvailabilityObservation | undefined>((best, value) =>
    !best || compareAvailabilityFreshness(value, best, evaluated) > 0 ? value : best, undefined);
}

export function classifyReopening(before: AvailabilityObservation, after: AvailabilityObservation): ReopeningConfidence {
  const evaluated = Math.max(before.responseOffsetMs, after.responseOffsetMs);
  const a = availabilityFreshness(before, evaluated), b = availabilityFreshness(after, evaluated);
  if (overlapping(before, after)) return 'OBSERVATION_INCONSISTENCY';
  if (b.representedAtLowerBoundOffsetMs === null) return 'UNKNOWN';
  if (a.representedAtLowerBoundOffsetMs !== null && b.representedAtLowerBoundOffsetMs <= a.representedAtLowerBoundOffsetMs)
    return 'OBSERVATION_INCONSISTENCY';
  return b.class === 'ORIGIN_FRESH' ? 'CONFIRMED' : 'PROBABLE';
}

/** Decodes one matrix string into code lookups by cell key; unknown or malformed rows stay absent. */
export function decodeMatrix(matrix: string | undefined): Map<string, string> {
  const cells = new Map<string, string>();
  for (const row of (matrix ?? '').split(',')) {
    const [court, codes] = row.split(':');
    if (!court || !codes || !MATRIX_COURTS.includes(Number(court) as never)) continue;
    MATRIX_HOURS.forEach((hour, index) => { const code = codes[index]; if (code) cells.set(cellKey(Number(court), hour), code); });
  }
  return cells;
}
const evidenceState = (code: string | undefined): EvidenceState => code === 'O' ? 'OPEN' : code === 'X' ? 'UNAVAILABLE' : 'UNKNOWN';
const priceAt = (observation: AvailabilityObservation, court: number, hour: string) => {
  const value = observation.prices?.[court - 1]?.[MATRIX_HOURS.indexOf(hour)];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};
const byRequest = <T extends ObservationRef>(values: readonly T[]) => [...values].sort((a, b) => a.seq - b.seq);

/** Derives every cell's first-published state, changes and public-record evidence. */
export function deriveSlotEvidence(availability: readonly AvailabilityObservation[], bookings: readonly BookingObservation[] = []): SlotEvidence {
  const answered = byRequest(availability.filter(value => value.outcome === 'ok'));
  const published = answered.filter(value => value.targetDatePresent);
  const first = published[0];
  const firstResponse = [...published].sort((a, b) => a.responseOffsetMs - b.responseOffsetMs || a.seq - b.seq)[0];
  const lastUnpublished = first ? answered.filter(value => !value.targetDatePresent && value.seq < first.seq).at(-1) : answered.filter(value => !value.targetDatePresent).at(-1);
  const current = freshestAvailabilityObservation(answered);
  const decoded = new Map(published.map(value => [value.seq, decodeMatrix(value.matrix)] as const));
  const answeredBookings = byRequest(bookings.filter(value => value.outcome === 'ok'));
  const bookingSets = new Map(answeredBookings.map(value => [value.seq, new Set(value.cells)] as const));
  const currentCells = current?.targetDatePresent ? decoded.get(current.seq) : undefined;

  const cells = MATRIX_COURTS.flatMap(court => MATRIX_HOURS.map((hour): CellEvidence => {
    const key = cellKey(court, hour);
    let firstPublished: CellEvidence['firstPublished'] = null, firstOpen: ObservationRef | null = null, firstUnavailable: ObservationRef | null = null;
    let openToUnavailable: ObservedChange | null = null, unavailableToOpen: ReopeningChange | null = null, changes = 0;
    let previous: { state: 'OPEN' | 'UNAVAILABLE'; observation: AvailabilityObservation } | undefined;
    if (first) firstPublished = { state: evidenceState(decoded.get(first.seq)!.get(key)), price: priceAt(first, court, hour), observation: ref(first) };
    for (const observation of published) {
      const state = evidenceState(decoded.get(observation.seq)!.get(key));
      if (state === 'UNKNOWN') continue; // a missing cell is not evidence either way
      if (state === 'OPEN') firstOpen ??= ref(observation); else firstUnavailable ??= ref(observation);
      if(previous&&compareAvailabilityFreshness(observation,previous.observation)<=0){
        if(previous.state!==state){changes++;const change={before:ref(previous.observation),after:ref(observation),overlapping:overlapping(previous.observation,observation)};
          if(state==='OPEN'&&!unavailableToOpen)unavailableToOpen={...change,confidence:'OBSERVATION_INCONSISTENCY'};}
        continue;
      }
      if (previous && previous.state !== state) {
        changes++;
        const change = { before: ref(previous.observation), after: ref(observation), overlapping: overlapping(previous.observation, observation) };
        if (state === 'UNAVAILABLE') openToUnavailable ??= change;
        else {const next={ ...change, confidence: classifyReopening(previous.observation, observation) };
          if(!unavailableToOpen||unavailableToOpen.confidence==='OBSERVATION_INCONSISTENCY'||unavailableToOpen.confidence==='UNKNOWN')unavailableToOpen=next;}
      }
      previous = { state, observation };
    }
    let firstRecord: CellEvidence['firstRecord'] = null, recordRemoved: CellEvidence['recordRemoved'] = null;
    let lastKnown: { present: boolean; observation: BookingObservation } | undefined;
    for (const observation of answeredBookings) {
      if (observation.failedCourts.includes(court)) continue; // unknown for this court, never "no record"
      const present = bookingSets.get(observation.seq)!.has(key);
      if (present && !firstRecord) firstRecord = { observation: ref(observation), previous: lastKnown && !lastKnown.present ? ref(lastKnown.observation) : null };
      if (!present && lastKnown?.present && !recordRemoved) recordRemoved = { observation: ref(observation), previous: ref(lastKnown.observation) };
      lastKnown = { present, observation };
    }
    return { court, hour, firstPublished, firstOpen, firstUnavailable, openToUnavailable, unavailableToOpen, changes, firstRecord, recordRemoved,
      latest: { state: evidenceState(currentCells?.get(key)), observation: current ? ref(current) : null, record: lastKnown ? lastKnown.present : null } };
  }));
  return {
    publication: { lastUnpublished: lastUnpublished ? ref(lastUnpublished) : null,
      firstPublished: first ? { ...ref(first), ...(first.cache ? { cache: first.cache } : {}) } : null,
      firstPublishedResponse: firstResponse ? ref(firstResponse) : null },
    current: current ? ref(current) : null,
    currentFreshness: current ? availabilityFreshness(current, Math.max(0, ...answered.map(value => value.responseOffsetMs))) : null,
    currentMatrix: current?.matrix ?? null,
    firstPublishedMatrix: first?.matrix ?? null, cells,
  };
}

/** One change for the UI timeline; `after` is the first read that showed it, `before` the previous read that did not. */
export interface SlotTimelineEntry {
  kind: 'published' | 'state' | 'record';
  court: number; hour: string;
  from?: EvidenceState; to?: EvidenceState; appeared?: boolean;
  openCount?: number; unavailableCount?: number; unknownCount?: number;
  before: ObservationRef | null; after: ObservationRef; overlapping: boolean;
}

/** Every observed change in request order (newest `limit` kept): publication, OPEN ↔ unavailable, public records. */
export function deriveTimeline(availability: readonly AvailabilityObservation[], bookings: readonly BookingObservation[] = [], limit = 600): SlotTimelineEntry[] {
  const entries: SlotTimelineEntry[] = [];
  const answered = byRequest(availability.filter(value => value.outcome === 'ok'));
  const published = answered.filter(value => value.targetDatePresent);
  const first = published[0];
  if (first) {
    const codes = [...decodeMatrix(first.matrix).values()], before = answered.filter(value => !value.targetDatePresent && value.seq < first.seq).at(-1);
    entries.push({ kind: 'published', court: 0, hour: '', openCount: codes.filter(code => code === 'O').length,
      unavailableCount: codes.filter(code => code === 'X').length, unknownCount: 112 - codes.filter(code => code === 'O' || code === 'X').length,
      before: before ? ref(before) : null, after: ref(first), overlapping: before ? overlapping(before, first) : false });
  }
  const previous = new Map<string, { state: EvidenceState; observation: AvailabilityObservation }>();
  for (const observation of published) {
    const cells = decodeMatrix(observation.matrix);
    for (const court of MATRIX_COURTS) for (const hour of MATRIX_HOURS) {
      const key = cellKey(court, hour), state = evidenceState(cells.get(key));
      if (state === 'UNKNOWN') continue;
      const prior = previous.get(key);
      if (prior && prior.state !== state) entries.push({ kind: 'state', court, hour, from: prior.state, to: state,
        before: ref(prior.observation), after: ref(observation), overlapping: overlapping(prior.observation, observation) });
      previous.set(key, { state, observation });
    }
  }
  const known = new Map<string, { present: boolean; observation: BookingObservation }>();
  for (const observation of byRequest(bookings.filter(value => value.outcome === 'ok'))) {
    const cells = new Set(observation.cells);
    for (const court of MATRIX_COURTS) {
      if (observation.failedCourts.includes(court)) continue;
      for (const hour of MATRIX_HOURS) {
        const key = cellKey(court, hour), present = cells.has(key), prior = known.get(key);
        if (prior && prior.present !== present) entries.push({ kind: 'record', court, hour, appeared: present,
          before: ref(prior.observation), after: ref(observation), overlapping: overlapping(prior.observation, observation) });
        known.set(key, { present, observation });
      }
    }
  }
  entries.sort((a, b) => a.after.requestOffsetMs - b.after.requestOffsetMs || (a.kind === 'published' ? -1 : b.kind === 'published' ? 1 : 0) ||
    a.court - b.court || a.hour.localeCompare(b.hour));
  return entries.slice(-limit);
}

export type RangeState = 'FULLY_OPEN' | 'PARTIALLY_UNAVAILABLE' | 'FULLY_UNAVAILABLE' | 'UNKNOWN_INCOMPLETE';
/** A multi-hour range is FULLY_OPEN only when every hour is OPEN; any unknown hour makes it UNKNOWN_INCOMPLETE. */
export function rangeState(states: readonly EvidenceState[]): RangeState {
  if (!states.length || states.some(state => state === 'UNKNOWN')) return 'UNKNOWN_INCOMPLETE';
  if (states.every(state => state === 'OPEN')) return 'FULLY_OPEN';
  if (states.every(state => state === 'UNAVAILABLE')) return 'FULLY_UNAVAILABLE';
  return 'PARTIALLY_UNAVAILABLE';
}
/** The whole hours a court range covers, e.g. 15:00–18:00 → 15:00, 16:00, 17:00. */
export function rangeHours(startTime: string, endTime: string): string[] {
  const start = Number(startTime.slice(0, 2)), end = endTime === '00:00' ? 24 : Number(endTime.slice(0, 2));
  if (!/^\d{2}:00$/.test(startTime) || !/^\d{2}:00$/.test(endTime) || !(start < end)) return [];
  return Array.from({ length: end - start }, (_, index) => `${String(start + index).padStart(2, '0')}:00`).filter(hour => MATRIX_HOURS.includes(hour));
}

export interface TargetRange { court: number; startTime: string; endTime: string }
export interface TargetEvidence {
  hours: string[];
  firstPublished: { observation: ObservationRef; state: RangeState; hours: Array<{ hour: string; state: EvidenceState; price: number | null }> } | null;
  firstFullyOpen: ObservationRef | null;
  firstUnavailable: { observation: ObservationRef; hours: string[] } | null;
  firstRecord: { observation: ObservationRef; hours: string[] } | null;
  /** First FULLY_OPEN read after an unavailable one (request order). */
  reopen: ReopeningChange | null;
  latest: { observation: ObservationRef | null; state: RangeState; freshness: ObservationFreshness | null };
}

/** Range-level evidence for one exact target. Forensic only: never used to choose or send a checkout. */
export function targetEvidence(availability: readonly AvailabilityObservation[], bookings: readonly BookingObservation[], target: TargetRange): TargetEvidence {
  const hours = rangeHours(target.startTime, target.endTime);
  const published = byRequest(availability.filter(value => value.outcome === 'ok' && value.targetDatePresent));
  const answered = byRequest(availability.filter(value => value.outcome === 'ok'));
  const statesOf = (observation: AvailabilityObservation) => { const cells = decodeMatrix(observation.matrix); return hours.map(hour => evidenceState(cells.get(cellKey(target.court, hour)))); };
  const first = published[0];
  let firstFullyOpen: ObservationRef | null = null, firstUnavailable: TargetEvidence['firstUnavailable'] = null, reopen: ReopeningChange | null = null;
  let lastUnavailable: AvailabilityObservation | undefined,operational:AvailabilityObservation|undefined;
  for (const observation of published) {
    const states = statesOf(observation), state = rangeState(states);
    if(operational&&compareAvailabilityFreshness(observation,operational)<=0){
      if(state==='FULLY_OPEN'&&lastUnavailable&&!reopen)reopen={before:ref(lastUnavailable),after:ref(observation),
        overlapping:overlapping(lastUnavailable,observation),confidence:'OBSERVATION_INCONSISTENCY'};
      continue;
    }
    operational=observation;
    if (state === 'FULLY_OPEN') {
      firstFullyOpen ??= ref(observation);
      if (lastUnavailable) {const next={ before: ref(lastUnavailable), after: ref(observation), overlapping: overlapping(lastUnavailable, observation),
        confidence: classifyReopening(lastUnavailable, observation) };
        if(!reopen||reopen.confidence==='OBSERVATION_INCONSISTENCY'||reopen.confidence==='UNKNOWN')reopen=next;}
      lastUnavailable = undefined;
    } else if (states.includes('UNAVAILABLE')) {
      firstUnavailable ??= { observation: ref(observation), hours: hours.filter((_, index) => states[index] === 'UNAVAILABLE') };
      lastUnavailable = observation;
    }
  }
  let firstRecord: TargetEvidence['firstRecord'] = null;
  for (const observation of byRequest(bookings.filter(value => value.outcome === 'ok'))) {
    if (observation.failedCourts.includes(target.court)) continue;
    const matched = hours.filter(hour => observation.cells.includes(cellKey(target.court, hour)));
    if (matched.length) { firstRecord = { observation: ref(observation), hours: matched }; break; }
  }
  const current = freshestAvailabilityObservation(answered);
  const evaluated = Math.max(0, ...answered.map(value => value.responseOffsetMs));
  return { hours,
    firstPublished: first ? { observation: ref(first), state: rangeState(statesOf(first)),
      hours: hours.map((hour, index) => ({ hour, state: statesOf(first)[index]!, price: priceAt(first, target.court, hour) })) } : null,
    firstFullyOpen, firstUnavailable, firstRecord, reopen,
    latest: { observation: current ? ref(current) : null, state: current?.targetDatePresent ? rangeState(statesOf(current)) : 'UNKNOWN_INCOMPLETE',
      freshness: current ? availabilityFreshness(current, evaluated) : null } };
}

export const RANGE_STATE_LABEL: Record<RangeState, string> = {
  FULLY_OPEN: 'FULLY OPEN', PARTIALLY_UNAVAILABLE: 'PARTIALLY UNAVAILABLE', FULLY_UNAVAILABLE: 'FULLY UNAVAILABLE', UNKNOWN_INCOMPLETE: 'UNKNOWN / INCOMPLETE',
};
/** Signed seconds with millisecond precision, e.g. +0.412 s. */
export function relativeSeconds(ms: number): string { return `${ms < 0 ? '−' : '+'}${(Math.abs(ms) / 1000).toFixed(3)} s`; }
/** `#12 request +0.250 s → response +0.880 s` */
export function describeRead(value: ObservationRef, prefix = '#'): string {
  return `${prefix}${value.seq} request ${relativeSeconds(value.requestOffsetMs)} → response ${relativeSeconds(value.responseOffsetMs)}`;
}
