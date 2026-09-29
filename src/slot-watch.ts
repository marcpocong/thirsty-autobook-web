import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { OndaLiveAvailabilityProvider } from './api-booking/live-availability-provider.js';
import { parseAvailability } from './api-booking/availability-parser.js';
import { readPublicBookingRecords, type PublicBookingRecords } from './api-booking/public-bookings.js';
import { MATRIX_COURTS, MATRIX_HOURS, SLOT_STATE_CODE, countCourtHourStates, courtHourStates, encodeCourtHourStates,
  type SlotState } from './api-booking/court-hour-matrix.js';
import type { AvailabilitySnapshot } from './api-booking/types.js';
import { availabilityFreshness, cellKey, decodeMatrix, deriveSlotEvidence, deriveTimeline, describeRead, freshestAvailabilityObservation,
  relativeSeconds, targetEvidence, type AvailabilityObservation, type BookingObservation, type CellEvidence, type EvidenceState,
  type ObservationRef, type ObservedChange, type PublicationEvidence, type RangeState, type ReopeningConfidence, type SlotEvidence,
  type SlotTimelineEntry } from './slot-evidence.js';

export { relativeSeconds } from './slot-evidence.js';
export type { SlotTimelineEntry } from './slot-evidence.js';

/**
 * Release slot watch: a read-only observer of all 112 court-hours around a release.
 * It uses only Onda's public, credential-free availability and booking-record
 * endpoints and never touches a browser, lock, hold, or checkout. It runs in the
 * desktop app's main process, never in the booking runner.
 *
 * Reads launch on their scheduled release-relative times even while earlier reads
 * are still waiting for Onda (release-time reads have taken 3-6 s), up to a small
 * in-flight cap. A launch refused by the cap is recorded as not launched, never as
 * observed. Every read keeps its request start and its response time; answers can
 * arrive out of order, so all evidence is derived in request order.
 */
export const SLOT_WATCH_BEFORE_MS = 60_000;
export const SLOT_WATCH_AFTER_MS = 15 * 60_000;
/** Release-relative launches that may overlap. Six launches, six slots: six 6-second reads all still launch. */
export const SLOT_WATCH_EARLY_OFFSETS_MS: readonly number[] = [0, 250, 500, 1_000, 2_000, 5_000];
export const SLOT_WATCH_MAX_IN_FLIGHT = 6;
/**
 * Pending holds expire 10 minutes after the checkout that created them (hold_expires_at). On 2026-09-24/25 many
 * first-wave holds reopened between the +10:00 and +10:30 reads. A 1 s cadence across this window dates each
 * reopening, i.e. each first-wave hold's creation (commit) + 10 min, or shows that holds reopen in one batch
 * (a periodic cleanup, which would not date them). Same read, same cadence as the first minute after release.
 */
export const SLOT_WATCH_HOLD_EXPIRY_WINDOW_MS: readonly [number, number] = [595_000, 665_000];
/** Release-time reads took up to ~6 s on 2026-09-23/24; the old 5 s limit discarded them. */
export const SLOT_WATCH_READ_TIMEOUT_MS = 15_000;
export const SLOT_WATCH_BOOKING_TIMEOUT_MS = 10_000;
export const SLOT_WATCH_PUBLICATION_BURST_END_MS = 60_000;
export const SLOT_WATCH_HOLD_DURATION_MS = 10 * 60_000;
/** A launch this late (PC sleep, stalled loop) is recorded as not launched. */
const LATE_LAUNCH_MS = 1_000;
const TIMELINE_LIMIT = 600;

export interface SlotWatchSchedule { availability: number[]; bookings: number[] }

/** Availability stays dense; the heavier public-booking endpoint is strategically dense, never concurrent with itself. */
export function slotWatchSchedule(): SlotWatchSchedule {
  const availability = new Set<number>();
  for (let t = -SLOT_WATCH_BEFORE_MS; t < 0; t += 10_000) availability.add(t);
  availability.add(-2_000);
  for (const t of SLOT_WATCH_EARLY_OFFSETS_MS) availability.add(t);
  for (let t = 6_000; t <= 60_000; t += 1_000) availability.add(t);
  for (let t = 65_000; t <= 300_000; t += 5_000) availability.add(t);
  for (let t = 330_000; t <= SLOT_WATCH_AFTER_MS; t += 30_000) availability.add(t);
  for (let t = SLOT_WATCH_HOLD_EXPIRY_WINDOW_MS[0]; t <= SLOT_WATCH_HOLD_EXPIRY_WINDOW_MS[1]; t += 1_000) availability.add(t);
  const bookings = new Set<number>([-SLOT_WATCH_BEFORE_MS]);
  for(let t=0;t<=30_000;t+=2_000)bookings.add(t);
  for(let t=35_000;t<=120_000;t+=5_000)bookings.add(t);
  for(let t=135_000;t<=570_000;t+=15_000)bookings.add(t);
  bookings.add(SLOT_WATCH_AFTER_MS);
  return { availability: [...availability].sort((a, b) => a - b), bookings:[...bookings].sort((a,b)=>a-b) };
}

export type SlotWatchStatus = 'waiting' | 'watching' | 'finished' | 'stopped';
export interface SlotCellView {
  court: number; hour: string;
  /** Current state: from the newest request that has answered. */
  state: SlotState; record: boolean;
  /** Price in the newest answered availability read, never borrowed from an older read. */
  currentPrice?: number | null;
  /** Response offset of the read that showed the latest change. */
  changedSinceReleaseMs?: number;
  first?: EvidenceState; firstPrice?: number | null;
}
export interface SlotWatchCandidate { id:string; court:number; start:string; end:string; label?:string; workerId?:string }
export interface SlotWatchCandidateView extends SlotWatchCandidate { state:RangeState; evidence:ObservationRef|null;
  evidenceAgeUpperBoundMs:number|null; freshness:string; reopening:ReopeningConfidence|null }
export interface SlotWatchQuality {
  latency:{medianMs:number|null;p95Ms:number|null;minMs:number|null;maxMs:number|null};
  cache:{MISS:number;HIT:number;STALE:number;UNKNOWN:number};
  cacheRates:{MISS:number;HIT:number;STALE:number;UNKNOWN:number};
  contradictions:number;reopenings:{confirmed:number;probable:number;inconsistent:number;unknown:number};
  candidateReopenings:number;bookingCoverage:{planned:number;launched:number;answered:number;successfulCourtQueries:number;totalCourtQueries:number};
  providerPaths:string[];
}
export interface SlotWatchCounts { launched: number; answered: number; failed: number; aborted: number; notLaunched: number }
export interface SlotWatchDigest {
  version: 1 | 2 | 3; legacy?: boolean;
  id: string; date: string; releaseAt: string; releaseMs: number; startedAt: string; endedAt: string;
  status: 'finished' | 'stopped'; reason: string; clockOffsetMs: number; clockSynced: boolean;
  schedule: { earlyOffsetsMs: number[]; maxInFlight: number; readTimeoutMs: number; bookingOffsetsMs: number[] } | null;
  availability: SlotWatchCounts & { maxInFlight: number; medianLatencyMs: number | null };
  bookings: SlotWatchCounts & { failedCourtQueries: number };
  publication: PublicationEvidence;
  firstPublishedMatrix: string | null;
  firstPublishedCounts: Record<EvidenceState, number> | null;
  openToUnavailable: Array<{ court: number; hour: string; record: ObservationRef | null } & ObservedChange>;
  unavailableAtFirstPublication: Array<{ court: number; hour: string; record: ObservationRef | null }>;
  reopened: Array<{ court: number; hour: string;confidence:ReopeningConfidence } & ObservedChange>;
  candidates:SlotWatchCandidateView[];quality:SlotWatchQuality|null;qualityReportPath?:string;
  current: ObservationRef | null; finalMatrix: string; stillOpen: number;
  timeline: SlotTimelineEntry[]; logPath: string; reportPath: string;
}
export interface SlotWatchSummary extends SlotWatchDigest {
  version: 3;
  /** Request-order evidence: one compact row per launched availability read. */
  requestOrder: Array<Omit<AvailabilityObservation, 'matrix' | 'prices'> & { counts?: Record<SlotState, number> }>;
  cells: CellEvidence[];
}
export interface SlotWatchView {
  id: string; date: string; releaseMs: number; status: SlotWatchStatus; startedAt: string; endsAtMs: number;
  polls: number; failedPolls: number; inFlight: number; maxInFlight: number; notLaunched: number;
  lastPollAt?: string; lastLatencyMs?: number; lastError?: string;
  dateReleased: boolean | null; publication: PublicationEvidence; current: ObservationRef | null;
  cells: SlotCellView[]; candidates:SlotWatchCandidateView[]; timeline: SlotTimelineEntry[]; logPath: string; summary?: SlotWatchDigest;
}
/** A read with its edge-cache metadata (both optional for injected readers). */
export interface AvailabilityRead { snapshot: AvailabilitySnapshot; cache?: { status?: string; ageS?: number };
  provider?:AvailabilityObservation['provider'] }
export interface SlotWatchOptions {
  date: string; releaseMs: number; directory: string;
  /** Network-corrected epoch milliseconds. */
  now?: () => number; clockOffsetMs?: number; clockSynced?: boolean;
  /** Current network-clock offset, recorded whenever it changes during the watch. */
  clockOffset?: () => number;
  readAvailability?: (date: string, signal: AbortSignal) => Promise<AvailabilitySnapshot | AvailabilityRead>;
  readBookings?: (date: string, signal: AbortSignal) => Promise<PublicBookingRecords>;
  /** Release-relative launch offsets; a partial schedule leaves the other kind empty. */
  schedule?: Partial<SlotWatchSchedule>;
  maxInFlight?: number; readTimeoutMs?: number; bookingTimeoutMs?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  onUpdate?: (view: SlotWatchView) => void;
  /** Sanitized raw availability fact for the separate race coordinator. Never affects the observer. */
  onObservation?: (observation: AvailabilityObservation) => void;
  /** Exact operator-configured ranges only. Slot Watch never invents candidates. */
  candidates?:readonly SlotWatchCandidate[];
  /** Tests with explicit schedules disable runtime publication/expiry additions by default. */
  dynamicScheduling?:boolean;
}

const cacheOf = (headers: Headers): AvailabilityRead['cache'] => {
  const status = headers.get('x-vercel-cache') ?? '', age = headers.get('age') ?? '';
  const cache = { ...(/^[A-Z_]{2,16}$/.test(status) ? { status } : {}), ...(/^\d{1,7}$/.test(age) ? { ageS: Number(age) } : {}) };
  return Object.keys(cache).length ? cache : undefined;
};
const safeHeader=(value:string|null,max=240)=>value&&value.length<=max&&/^[\x20-\x7E]+$/.test(value)?value:undefined;
const providerOf=(headers:Headers):AvailabilityRead['provider']=>{
  const vercelId=safeHeader(headers.get('x-vercel-id')),date=safeHeader(headers.get('date')),matchedPath=safeHeader(headers.get('x-matched-path'));
  return vercelId||date||matchedPath?{...(vercelId?{vercelId}:{}),...(date?{date}:{}),...(matchedPath?{matchedPath}:{})}:undefined;
};
const withSignal = (signal: AbortSignal): typeof fetch => (input, init) =>
  fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal });
async function liveAvailability(date: string, signal: AbortSignal): Promise<AvailabilityRead> {
  let cache: AvailabilityRead['cache'],provider:AvailabilityRead['provider'];
  const fetcher: typeof fetch = async (input, init) => { const response = await withSignal(signal)(input, init); cache = cacheOf(response.headers);provider=providerOf(response.headers);return response; };
  const envelope = await new OndaLiveAvailabilityProvider({ allowIncompleteRange: true, timeoutMs: SLOT_WATCH_READ_TIMEOUT_MS, fetcher })
    .getAvailability({ startDate: date, endDate: date });
  return { snapshot: parseAvailability(envelope.raw, { startDate: date, endDate: date, capturedAt: envelope.capturedAt,
    fixtureKind: envelope.fixtureKind, label: envelope.label, now: new Date(), maximumAgeMs: 15_000, requireCompleteRange: false }), ...(cache ? { cache } : {}),...(provider?{provider}:{}) };
}
const liveBookings = (date: string, signal: AbortSignal) => readPublicBookingRecords(date, { timeoutMs: SLOT_WATCH_BOOKING_TIMEOUT_MS, fetcher: withSignal(signal) });
const abortableSleep = (ms: number, signal: AbortSignal) => new Promise<void>(done => {
  if (signal.aborted) { done(); return; }
  const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); done(); }, Math.max(0, ms));
  const onAbort = () => { clearTimeout(timer); done(); };
  signal.addEventListener('abort', onAbort, { once: true });
});
const safeCode = (error: unknown) => error instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.message) ? error.message : 'READ_FAILED';
const round = (value: number) => Math.round(value * 10) / 10;
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : null; };
const percentile=(values:number[],fraction:number)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted.length?sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*fraction)-1)]!:null;};
const toSlotState = (code: string | undefined): SlotState => code === 'O' ? 'OPEN' : code === 'X' ? 'TAKEN' : code === 'U' ? 'UNRELEASED' : 'UNKNOWN';
const counts = (matrix: string | null) => {
  if (!matrix) return null;
  const codes = [...decodeMatrix(matrix).values()], open = codes.filter(code => code === 'O').length, unavailable = codes.filter(code => code === 'X').length;
  return { OPEN: open, UNAVAILABLE: unavailable, UNKNOWN: 112 - open - unavailable };
};

/** Manila wall time with milliseconds, e.g. 2026-09-24 08:00:00.412. */
export function manilaStamp(ms: number): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}.${String(Math.floor(((ms % 1000) + 1000) % 1000)).padStart(3, '0')}`;
}

export class SlotWatch {
  readonly id = randomUUID();
  readonly path: string;
  readonly done: Promise<SlotWatchSummary>;
  private readonly handle: number;
  private readonly abort = new AbortController();
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly startedMs: number;
  private readonly schedule: SlotWatchSchedule;
  private readonly maxInFlight: number;
  private readonly readTimeoutMs: number;
  private readonly bookingTimeoutMs: number;
  private readonly dynamicScheduling:boolean;
  private readonly candidates:readonly SlotWatchCandidate[];
  private eventQueue:Array<{offsetMs:number;kind:'availability'|'bookings'|'publication-burst';source:'base'|'publication'|'expiry'}>=[];
  private readonly eventKeys=new Set<string>();
  private readonly expiryKeys=new Set<string>();
  private stopReason = 'window complete';
  private status: SlotWatchStatus = 'waiting';
  private readonly availability: AvailabilityObservation[] = [];
  private readonly bookings: BookingObservation[] = [];
  private readonly availabilityCounts: SlotWatchCounts = { launched: 0, answered: 0, failed: 0, aborted: 0, notLaunched: 0 };
  private readonly bookingCounts: SlotWatchCounts = { launched: 0, answered: 0, failed: 0, aborted: 0, notLaunched: 0 };
  private failedCourtQueries = 0;
  private availabilityInFlight = 0;
  private bookingInFlight = 0;
  private maxObservedInFlight = 0;
  private readonly inFlight = new Set<Promise<void>>();
  private lastClockOffset: number | undefined;
  private lastResponseMs: number | undefined;
  private lastLatencyMs: number | undefined;
  private lastError: string | undefined;
  private evidence: SlotEvidence = deriveSlotEvidence([]);
  private timeline: SlotTimelineEntry[] = [];
  private summary: SlotWatchSummary | undefined;

  constructor(private readonly options: SlotWatchOptions) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date) || !Number.isSafeInteger(options.releaseMs)) throw Error('SLOT_WATCH_INPUT_INVALID');
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? abortableSleep;
    this.startedMs = this.now();
    const defaults = slotWatchSchedule();
    this.schedule = options.schedule ? { availability: [...options.schedule.availability ?? []], bookings: [...options.schedule.bookings ?? []] } : defaults;
    this.maxInFlight = options.maxInFlight ?? SLOT_WATCH_MAX_IN_FLIGHT;
    this.readTimeoutMs = options.readTimeoutMs ?? SLOT_WATCH_READ_TIMEOUT_MS;
    this.bookingTimeoutMs = options.bookingTimeoutMs ?? SLOT_WATCH_BOOKING_TIMEOUT_MS;
    this.dynamicScheduling=options.dynamicScheduling??!options.schedule;
    this.candidates=[...(options.candidates??[])];
    if (!Number.isInteger(this.maxInFlight) || this.maxInFlight < 1 || this.maxInFlight > 16) throw Error('SLOT_WATCH_INPUT_INVALID');
    mkdirSync(options.directory, { recursive: true, mode: 0o700 });
    this.path = join(options.directory, `${options.date}_${this.id}.ndjson`);
    this.handle = openSync(this.path, 'wx', 0o600);
    this.write({ type: 'header', version: 3, id: this.id, date: options.date, releaseAt: new Date(options.releaseMs).toISOString(), releaseMs: options.releaseMs,
      releaseManila: manilaStamp(options.releaseMs), startedAt: new Date(this.startedMs).toISOString(),
      clockOffsetMs: options.clockOffsetMs ?? 0, clockSynced: options.clockSynced ?? false,
      schedule: { availability: this.schedule.availability, bookings: this.schedule.bookings, maxInFlight: this.maxInFlight,
        readTimeoutMs: this.readTimeoutMs, bookingTimeoutMs: this.bookingTimeoutMs },
      legend: { O: 'open', X: 'unavailable', U: 'date not published', '?': 'unknown (cell missing or read failed)' },
      note: 'Offsets are ms since release on the observer network clock. A read reflects Onda at an unknown moment between its request and its response. Lines are written in response order; seq is request order.' });
    this.done = this.run();
  }

  /** Stops early (in-flight reads are cancelled); resolves with the summary written so far. */
  stop(reason: string): Promise<SlotWatchSummary> { if (!this.abort.signal.aborted) { this.stopReason = reason; this.abort.abort(); } return this.done; }

  view(): SlotWatchView {
    const current = this.evidence.currentMatrix ? decodeMatrix(this.evidence.currentMatrix) : undefined;
    const newest = freshestAvailabilityObservation(this.availability);
    const changed = new Map<string, number>();
    for (const entry of this.timeline) if (entry.kind === 'state') changed.set(cellKey(entry.court, entry.hour), entry.after.responseOffsetMs);
    const cells = this.evidence.cells.map(cell => {
      const key = cellKey(cell.court, cell.hour), since = changed.get(key);
      return { court: cell.court, hour: cell.hour, state: toSlotState(current?.get(key)), record: cell.latest.record === true,
        ...(newest?.prices ? { currentPrice: newest.prices[cell.court - 1]?.[MATRIX_HOURS.indexOf(cell.hour)] ?? null } : {}),
        ...(since === undefined ? {} : { changedSinceReleaseMs: since }),
        ...(cell.firstPublished ? { first: cell.firstPublished.state, firstPrice: cell.firstPublished.price } : {}) } satisfies SlotCellView;
    });
    return { id: this.id, date: this.options.date, releaseMs: this.options.releaseMs, status: this.status,
      startedAt: new Date(this.startedMs).toISOString(), endsAtMs: this.options.releaseMs + SLOT_WATCH_AFTER_MS,
      polls: this.availabilityCounts.answered + this.availabilityCounts.failed, failedPolls: this.availabilityCounts.failed,
      inFlight: this.availabilityInFlight, maxInFlight: this.maxInFlight, notLaunched: this.availabilityCounts.notLaunched,
      dateReleased: newest ? newest.targetDatePresent : null, publication: this.evidence.publication, current: this.evidence.current,
      cells,candidates:this.candidateViews(this.offset(this.now())), timeline: this.timeline.slice(-300), logPath: this.path,
      ...(this.lastResponseMs !== undefined ? { lastPollAt: new Date(this.lastResponseMs).toISOString() } : {}),
      ...(this.lastLatencyMs !== undefined ? { lastLatencyMs: this.lastLatencyMs } : {}), ...(this.lastError ? { lastError: this.lastError } : {}),
      ...(this.summary ? { summary: digestOf(this.summary) } : {}) };
  }

  private write(value: unknown) { try { writeSync(this.handle, `${JSON.stringify(value)}\n`); } catch { /* Observation must never fail a booking. */ } }
  private publish() { try { this.options.onUpdate?.(this.view()); } catch { /* UI updates are best-effort. */ } }
  private offset(epochMs: number) { return round(epochMs - this.options.releaseMs); }
  private candidateViews(evaluatedOffsetMs:number):SlotWatchCandidateView[]{return this.candidates.map(candidate=>{
    const evidence=targetEvidence(this.availability,this.bookings,{court:candidate.court,startTime:candidate.start,endTime:candidate.end});
    const observation=evidence.latest.observation?this.availability.find(value=>value.seq===evidence.latest.observation!.seq):undefined;
    const freshness=observation?availabilityFreshness(observation,evaluatedOffsetMs):null;
    return {...candidate,state:evidence.latest.state,evidence:evidence.latest.observation,
      evidenceAgeUpperBoundMs:freshness?.ageUpperBoundMs??null,freshness:freshness?.class??'UNBOUNDED',
      reopening:evidence.reopen?.confidence??null};
  });}
  private recordClock() {
    try {
      const offset = this.options.clockOffset?.();
      if (offset === undefined || !Number.isFinite(offset) || (this.lastClockOffset !== undefined && Math.abs(offset - this.lastClockOffset) < 0.5)) return;
      this.lastClockOffset = offset;
      this.write({ type: 'clock', at: new Date(this.now()).toISOString(), offsetMs: round(offset) });
    } catch { /* clock evidence is best-effort */ }
  }

  private enqueue(kind:'availability'|'bookings'|'publication-burst',offsetMs:number,source:'base'|'publication'|'expiry'){
    if(offsetMs<-SLOT_WATCH_BEFORE_MS||offsetMs>SLOT_WATCH_AFTER_MS)return;
    const networkKind=kind==='bookings'?'bookings':'availability',key=`${networkKind}:${offsetMs}`;
    if(this.eventKeys.has(key))return;
    this.eventKeys.add(key);this.eventQueue.push({offsetMs,kind,source});
  }
  private scheduleExpiryWindows(){
    if(!this.dynamicScheduling)return;
    for(const cell of this.evidence.cells){const transition=cell.openToUnavailable;if(!transition)continue;
      const key=`${cell.court}/${cell.hour}/${transition.after.seq}`;if(this.expiryKeys.has(key))continue;this.expiryKeys.add(key);
      const start=Math.max(Math.ceil((this.offset(this.now())+1)/1_000)*1_000,
        Math.floor((transition.before.responseOffsetMs+SLOT_WATCH_HOLD_DURATION_MS-2_000)/1_000)*1_000);
      const end=Math.min(SLOT_WATCH_AFTER_MS,Math.ceil((transition.after.responseOffsetMs+SLOT_WATCH_HOLD_DURATION_MS+2_000)/1_000)*1_000);
      if(end<=this.offset(this.now()))continue;
      for(let t=start;t<=end;t+=1_000)this.enqueue('availability',t,'expiry');
      for(let t=Math.ceil(start/2_000)*2_000;t<=end;t+=2_000)this.enqueue('bookings',t,'expiry');
      this.write({type:'expiry-window',court:cell.court,hour:cell.hour,firstUnavailableBracket:{before:transition.before,after:transition.after},
        predictedStartOffsetMs:start,predictedEndOffsetMs:end,holdDurationMs:SLOT_WATCH_HOLD_DURATION_MS});
    }
  }

  private async run(): Promise<SlotWatchSummary> {
    const signal = this.abort.signal;
    try {
      this.publish();
      for(const offsetMs of this.schedule.availability)this.enqueue('availability',offsetMs,'base');
      for(const offsetMs of this.schedule.bookings)this.enqueue('bookings',offsetMs,'base');
      if(this.dynamicScheduling)for(let offsetMs=2_500;offsetMs<=SLOT_WATCH_PUBLICATION_BURST_END_MS;offsetMs+=500)
        this.enqueue('publication-burst',offsetMs,'publication');
      let cursor=0;
      while(!signal.aborted){
        while(cursor<this.eventQueue.length){
          this.eventQueue.sort((a,b)=>a.offsetMs-b.offsetMs||(a.kind==='bookings'?1:-1));
          const event=this.eventQueue[cursor++]!;
          if (signal.aborted) break;
          if(event.kind==='publication-burst'&&this.evidence.publication.firstPublished)continue;
          const target = this.options.releaseMs + event.offsetMs;
          // Points before this watch existed are not part of it.
          if (target < this.startedMs) continue;
          // Re-check the clock after each wait so PC sleep or a clock resync cannot launch a read early.
          while (!signal.aborted && this.now() < target) await this.sleep(Math.min(target - this.now(), 60_000), signal);
          if (signal.aborted) break;
          const kind=event.kind==='bookings'?'bookings':'availability';
          if (this.now() - target > LATE_LAUNCH_MS) { this.notLaunched(kind, event.offsetMs, 'LATE'); continue; }
          this.status = 'watching';
          if (kind === 'availability') this.launchAvailability(event.offsetMs); else this.launchBookings(event.offsetMs);
        }
        if(signal.aborted||!this.inFlight.size)break;
        // An answered read may add a dynamic expiry window after the original queue drained.
        await Promise.allSettled([...this.inFlight]);
        if(cursor>=this.eventQueue.length)break;
      }
      // In-flight reads end on their own timeouts, or at once when the watch is stopped.
      await Promise.allSettled([...this.inFlight]);
    } catch { this.stopReason = 'internal error'; this.abort.abort(); await Promise.allSettled([...this.inFlight]); }
    this.status = signal.aborted ? 'stopped' : 'finished';
    return this.finish();
  }

  private notLaunched(kind: 'availability' | 'bookings', scheduledOffsetMs: number, reason: 'CAP_REACHED' | 'LATE' | 'PREVIOUS_READ_IN_FLIGHT') {
    (kind === 'availability' ? this.availabilityCounts : this.bookingCounts).notLaunched++;
    this.write({ type: 'not-launched', kind, scheduledOffsetMs, at: new Date(this.now()).toISOString(), atOffsetMs: this.offset(this.now()), reason,
      inFlight: kind === 'availability' ? this.availabilityInFlight : this.bookingInFlight });
    this.publish();
  }

  /** Runs one read with its own timeout; stop cancels it. Never rejects synchronously. */
  private timed<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs: number, timeoutCode: string): Promise<T> {
    const controller = new AbortController(), timer = new AbortController(), stop = () => controller.abort();
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (settle: () => void) => { if (settled) return; settled = true; timer.abort(); this.abort.signal.removeEventListener('abort', stop); settle(); };
      controller.signal.addEventListener('abort', () => finish(() => reject(Error(this.abort.signal.aborted ? 'SLOT_WATCH_STOPPED' : timeoutCode))), { once: true });
      this.abort.signal.addEventListener('abort', stop, { once: true });
      if (this.abort.signal.aborted) controller.abort();
      void this.sleep(timeoutMs, timer.signal).then(() => { if (!timer.signal.aborted) controller.abort(); });
      try { work(controller.signal).then(value => finish(() => resolve(value)), error => finish(() => reject(error))); }
      catch (error) { finish(() => reject(error)); }
    });
  }

  private track(promise: Promise<void>) { this.inFlight.add(promise); void promise.finally(() => this.inFlight.delete(promise)); }

  private launchAvailability(scheduledOffsetMs: number) {
    if (this.availabilityInFlight >= this.maxInFlight) { this.notLaunched('availability', scheduledOffsetMs, 'CAP_REACHED'); return; }
    this.recordClock();
    const seq = ++this.availabilityCounts.launched, inFlight = ++this.availabilityInFlight;
    this.maxObservedInFlight = Math.max(this.maxObservedInFlight, inFlight);
    const reader = this.options.readAvailability ?? liveAvailability;
    const requestMs = this.now();
    this.track(this.timed(signal => reader(this.options.date, signal), this.readTimeoutMs, 'AVAILABILITY_READ_TIMEOUT')
      .then(value => this.recordAvailability({ seq, scheduledOffsetMs, requestMs, responseMs: this.now(), inFlight }, value),
        error => this.recordAvailability({ seq, scheduledOffsetMs, requestMs, responseMs: this.now(), inFlight }, undefined, error))
      .catch(() => undefined).finally(() => { this.availabilityInFlight--; }));
  }

  private recordAvailability(read: { seq: number; scheduledOffsetMs: number; requestMs: number; responseMs: number; inFlight: number },
    value: AvailabilitySnapshot | AvailabilityRead | undefined, error?: unknown) {
    const date = this.options.date, base = { seq: read.seq, scheduledOffsetMs: read.scheduledOffsetMs,
      requestOffsetMs: this.offset(read.requestMs), responseOffsetMs: this.offset(read.responseMs) };
    let observation: AvailabilityObservation, detail: Record<string, unknown> = { responseComplete: false };
    if (value) {
      const snapshot = 'snapshot' in value ? value.snapshot : value, cache = 'snapshot' in value ? value.cache : undefined,
        provider='snapshot' in value?value.provider:undefined;
      const states = courtHourStates(snapshot, date), tally = countCourtHourStates(states), flag = snapshot.returnedDates[date];
      const prices = MATRIX_COURTS.map(court => MATRIX_HOURS.map(hour =>
        snapshot.slots.find(slot => slot.date === date && slot.court === court && slot.startTime === hour)?.price ?? null));
      observation = { ...base, outcome: 'ok', targetDatePresent: flag === true,
        matrix: encodeCourtHourStates(states), ...(flag === true ? { prices } : {}), ...(cache ? { cache } : {}),...(provider?{provider}:{}) };
      // Complete = the date was published and every one of the 112 cells was present. A missing cell stays unknown, never open.
      detail = { dateFlag: flag === true ? 'published' : flag === false ? 'unpublished' : 'absent', responseComplete: flag === true && tally.UNKNOWN === 0, counts: tally };
      this.availabilityCounts.answered++;
      this.lastLatencyMs = Math.max(0, Math.round(read.responseMs - read.requestMs)); this.lastResponseMs = read.responseMs; this.lastError = undefined;
    } else {
      const code = safeCode(error), aborted = code === 'SLOT_WATCH_STOPPED';
      observation = { ...base, outcome: aborted ? 'aborted' : 'failed', code, targetDatePresent: false };
      if (aborted) this.availabilityCounts.aborted++; else { this.availabilityCounts.failed++; this.lastError = code; }
    }
    this.availability.push(observation);
    this.write({ type: 'availability', ...observation, durationMs: round(read.responseMs - read.requestMs), inFlightAtLaunch: read.inFlight,
      requestedAt: new Date(read.requestMs).toISOString(), respondedAt: new Date(read.responseMs).toISOString(),
      requestedManila: manilaStamp(read.requestMs), respondedManila: manilaStamp(read.responseMs), ...detail });
    try { this.options.onObservation?.(observation); } catch { /* observer and checkout remain independent */ }
    this.derive();
  }

  private launchBookings(scheduledOffsetMs: number) {
    if (this.bookingInFlight >= 1) { this.notLaunched('bookings', scheduledOffsetMs, 'PREVIOUS_READ_IN_FLIGHT'); return; }
    const seq = ++this.bookingCounts.launched;
    this.bookingInFlight++;
    const reader = this.options.readBookings ?? liveBookings;
    const requestMs = this.now();
    this.track(this.timed(signal => reader(this.options.date, signal), this.bookingTimeoutMs, 'BOOKING_READ_TIMEOUT')
      .then(value => this.recordBookings(seq, scheduledOffsetMs, requestMs, this.now(), value),
        error => this.recordBookings(seq, scheduledOffsetMs, requestMs, this.now(), undefined, error))
      .catch(() => undefined).finally(() => { this.bookingInFlight--; }));
  }

  private recordBookings(seq: number, scheduledOffsetMs: number, requestMs: number, responseMs: number, value: PublicBookingRecords | undefined, error?: unknown) {
    const base = { seq, scheduledOffsetMs, requestOffsetMs: this.offset(requestMs), responseOffsetMs: this.offset(responseMs) };
    let observation: BookingObservation;
    if (value) {
      const failed = [...new Set(value.failedCourts)].filter(court => MATRIX_COURTS.includes(court as never)).sort((a, b) => a - b), cells = new Set<string>();
      for (const block of value.blocks) {
        if (failed.includes(block.court)) continue;
        for (const hour of MATRIX_HOURS) {
          const end = `${String(Number(hour.slice(0, 2)) + 1).padStart(2, '0')}:00`;
          if (block.startTime < end && block.endTime > hour) cells.add(cellKey(block.court, hour));
        }
      }
      observation = { ...base, outcome: 'ok', failedCourts: failed, cells: [...cells].sort(),...(value.provider?{provider:value.provider}:{}) };
      this.bookingCounts.answered++; this.failedCourtQueries += failed.length;
    } else {
      const aborted = safeCode(error) === 'SLOT_WATCH_STOPPED';
      observation = { ...base, outcome: aborted ? 'aborted' : 'failed', failedCourts: [...MATRIX_COURTS], cells: [] };
      if (aborted) this.bookingCounts.aborted++; else this.bookingCounts.failed++;
    }
    this.bookings.push(observation);
    this.write({ type: 'bookings', ...observation, durationMs: round(responseMs - requestMs), requestedAt: new Date(requestMs).toISOString(),
      respondedAt: new Date(responseMs).toISOString(), ...(value ? {} : { code: safeCode(error) }) });
    this.derive();
  }

  /** Recomputed from the raw observations after every answer, so late answers land in request order. */
  private derive() {
    try { this.evidence = deriveSlotEvidence(this.availability, this.bookings); this.timeline = deriveTimeline(this.availability, this.bookings, TIMELINE_LIMIT);
      this.scheduleExpiryWindows(); }
    catch { /* keep the previous derivation; the raw log is complete */ }
    this.publish();
  }

  private finish(): SlotWatchSummary {
    const endedMs = this.now(), evidence = this.evidence;
    const reportPath = this.path.replace(/\.ndjson$/, '.txt');
    const answered = this.availability.filter(value => value.outcome === 'ok');
    const finalMatrix = evidence.currentMatrix ?? '',candidateViews=this.candidateViews(this.offset(endedMs));
    const latencies=answered.map(value=>value.responseOffsetMs-value.requestOffsetMs),cache={MISS:0,HIT:0,STALE:0,UNKNOWN:0};
    for(const value of answered){const status=value.cache?.status;if(status==='MISS'||status==='HIT'||status==='STALE')cache[status]++;else cache.UNKNOWN++;}
    const reopenings={confirmed:0,probable:0,inconsistent:0,unknown:0};
    for(const cell of evidence.cells){const confidence=cell.unavailableToOpen?.confidence;if(confidence==='CONFIRMED')reopenings.confirmed++;
      else if(confidence==='PROBABLE')reopenings.probable++;else if(confidence==='OBSERVATION_INCONSISTENCY')reopenings.inconsistent++;
      else if(confidence==='UNKNOWN')reopenings.unknown++;}
    const providerPaths=[...new Set(answered.flatMap(value=>{const p=value.provider;if(!p)return[];
      return [`${p.matchedPath??'(path unknown)'} · ${p.vercelId??'(edge unknown)'}`];}))].sort().slice(0,50);
    const cacheTotal=Math.max(1,answered.length),cacheRates={MISS:cache.MISS/cacheTotal,HIT:cache.HIT/cacheTotal,STALE:cache.STALE/cacheTotal,UNKNOWN:cache.UNKNOWN/cacheTotal};
    const quality:SlotWatchQuality={latency:{medianMs:median(latencies),p95Ms:percentile(latencies,.95),minMs:latencies.length?Math.min(...latencies):null,maxMs:latencies.length?Math.max(...latencies):null},
      cache,cacheRates,contradictions:reopenings.inconsistent,reopenings,candidateReopenings:candidateViews.filter(value=>value.reopening==='CONFIRMED'||value.reopening==='PROBABLE').length,
      bookingCoverage:{planned:this.schedule.bookings.length,launched:this.bookingCounts.launched,answered:this.bookingCounts.answered,
        successfulCourtQueries:this.bookingCounts.answered*7-this.failedCourtQueries,totalCourtQueries:this.bookingCounts.launched*7},providerPaths};
    const qualityReportPath=this.path.replace(/\.ndjson$/,'.quality.json');
    const summary: SlotWatchSummary = { version: 3, id: this.id, date: this.options.date, releaseAt: new Date(this.options.releaseMs).toISOString(),
      releaseMs: this.options.releaseMs, startedAt: new Date(this.startedMs).toISOString(), endedAt: new Date(endedMs).toISOString(),
      status: this.status === 'stopped' ? 'stopped' : 'finished', reason: this.stopReason,
      clockOffsetMs: this.lastClockOffset ?? this.options.clockOffsetMs ?? 0, clockSynced: this.options.clockSynced ?? false,
      schedule: { earlyOffsetsMs: this.schedule.availability.filter(offset => offset >= 0 && offset < 6_000), maxInFlight: this.maxInFlight,
        readTimeoutMs: this.readTimeoutMs, bookingOffsetsMs: this.schedule.bookings },
      availability: { ...this.availabilityCounts, maxInFlight: this.maxObservedInFlight,
        medianLatencyMs: median(answered.map(value => value.responseOffsetMs - value.requestOffsetMs)) },
      bookings: { ...this.bookingCounts, failedCourtQueries: this.failedCourtQueries },
      publication: evidence.publication, firstPublishedMatrix: evidence.firstPublishedMatrix, firstPublishedCounts: counts(evidence.firstPublishedMatrix),
      openToUnavailable: evidence.cells.filter(cell => cell.openToUnavailable).map(cell => ({ court: cell.court, hour: cell.hour, ...cell.openToUnavailable!,
        record: cell.firstRecord?.observation ?? null })).sort((a, b) => a.after.requestOffsetMs - b.after.requestOffsetMs || a.court - b.court || a.hour.localeCompare(b.hour)),
      unavailableAtFirstPublication: evidence.cells.filter(cell => cell.firstPublished?.state === 'UNAVAILABLE')
        .map(cell => ({ court: cell.court, hour: cell.hour, record: cell.firstRecord?.observation ?? null })),
      reopened: evidence.cells.filter(cell => cell.unavailableToOpen).map(cell => ({ court: cell.court, hour: cell.hour, ...cell.unavailableToOpen! }))
        .sort((a, b) => a.after.requestOffsetMs - b.after.requestOffsetMs || a.court - b.court || a.hour.localeCompare(b.hour)),
      candidates:candidateViews,quality,qualityReportPath,current: evidence.current, finalMatrix, stillOpen: counts(finalMatrix || null)?.OPEN ?? 0,
      timeline: this.timeline, logPath: this.path, reportPath,
      requestOrder: [...this.availability].sort((a, b) => a.seq - b.seq).map(({ matrix, prices: _prices, ...row }) => {
        const cells = decodeMatrix(matrix), tally: Record<SlotState, number> = { OPEN: 0, TAKEN: 0, UNRELEASED: 0, UNKNOWN: 0 };
        for (const code of cells.values()) tally[toSlotState(code)]++;
        return { ...row, ...(matrix ? { counts: tally } : {}) };
      }),
      cells: evidence.cells };
    this.summary = summary;
    this.write({ type: 'summary', ...summary, timeline: undefined, requestOrder: undefined, cells: undefined });
    try { closeSync(this.handle); } catch { /* already closed */ }
    try {
      writeFileSync(reportPath, slotWatchReport(summary), { encoding: 'utf8', mode: 0o600 });
      writeFileSync(qualityReportPath,JSON.stringify({version:1,watchId:this.id,date:this.options.date,generatedAt:new Date(endedMs).toISOString(),quality,candidates:candidateViews},null,2)+'\n',{encoding:'utf8',mode:0o600});
      const summaryPath = this.path.replace(/\.ndjson$/, '.summary.json'), temporary = `${summaryPath}.tmp`;
      writeFileSync(temporary, JSON.stringify(summary), { encoding: 'utf8', mode: 0o600 }); renameSync(temporary, summaryPath);
    } catch { /* The NDJSON log already holds every read. */ }
    this.publish();
    return summary;
  }
}

/** The UI's copy: no per-cell evidence or request rows, and a bounded timeline. */
export function digestOf(summary: SlotWatchSummary | SlotWatchDigest, timelineLimit = 120): SlotWatchDigest {
  const { cells: _cells, requestOrder: _rows, ...rest } = summary as SlotWatchSummary;
  return { ...rest, timeline: rest.timeline.slice(-timelineLimit) };
}

export const hourLabel = (hour: string) => { const h = Number(hour.slice(0, 2)); return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`; };
const bookingRead = (value: ObservationRef) => describeRead(value, '#b');
const change = (value: ObservedChange) =>
  `open in ${describeRead(value.before)}; unavailable in ${describeRead(value.after)}${value.overlapping ? ' (reads overlapped: their provider-side order is not established)' : ''}`;

/** Plain-text report. Evidence only: it states what each read returned, never why. */
export function slotWatchReport(summary: SlotWatchSummary): string {
  const a = summary.availability, b = summary.bookings, p = summary.publication,q=summary.quality;
  const lines = [`RELEASE SLOT WATCH — target ${summary.date}`,
    `Release: ${manilaStamp(summary.releaseMs)} Manila · observer network clock ${summary.clockSynced ? `synchronized (offset ${summary.clockOffsetMs.toFixed(1)} ms)` : 'NOT synchronized'}`,
    `Watch ${summary.status}: ${summary.reason}`,
    `Availability reads: ${a.launched} launched · ${a.answered} answered · ${a.failed} failed · ${a.aborted} cancelled · ${a.notLaunched} not launched (cap or late) · max ${a.maxInFlight} in flight (cap ${summary.schedule?.maxInFlight ?? '?'}) · median ${a.medianLatencyMs ?? '?'} ms`,
    `Early launches (release-relative): ${summary.schedule?.earlyOffsetsMs.map(offset => relativeSeconds(offset)).join(', ') ?? '—'}; overlapping reads allowed`,
    `Public booking reads: ${b.launched} launched · ${b.answered} answered · ${b.failed} failed · ${b.failedCourtQueries} failed court queries · ${b.notLaunched} not launched`, '',
    'Each read shows Onda\'s state at an unknown moment between its request and its response. Changes are listed between two reads in request order.', '',
    'FIRST PUBLISHED GRID'];
  if (!p.firstPublished) lines.push('  The target date was not seen in any answered read.');
  else {
    if (p.lastUnpublished) lines.push(`  Last read without the date:   ${describeRead(p.lastUnpublished)}`);
    lines.push(`  First read with the date:     ${describeRead(p.firstPublished)}${p.firstPublished.cache ? ` · edge cache ${p.firstPublished.cache.status ?? '?'}${p.firstPublished.cache.ageS !== undefined ? `, age ${p.firstPublished.cache.ageS} s` : ''}` : ''}`);
    if (p.firstPublishedResponse && p.firstPublishedResponse.seq !== p.firstPublished.seq) lines.push(`  Earliest response with it:    ${describeRead(p.firstPublishedResponse)}`);
    const c = summary.firstPublishedCounts;
    if (c) lines.push(`  Open ${c.OPEN} · unavailable ${c.UNAVAILABLE} · unknown ${c.UNKNOWN}`);
    lines.push(...matrixLines(summary.firstPublishedMatrix ?? ''));
  }
  lines.push('', 'OPEN → UNAVAILABLE (first change per cell)');
  if (!summary.openToUnavailable.length) lines.push('  none observed');
  for (const cell of summary.openToUnavailable)
    lines.push(`  Court ${cell.court} ${hourLabel(cell.hour).padEnd(5)} ${change(cell)}${cell.record ? ` · public booking record first seen ${bookingRead(cell.record)}` : ' · no matching public booking record seen'}`);
  lines.push('', 'UNAVAILABLE IN THE FIRST PUBLISHED GRID');
  if (!summary.unavailableAtFirstPublication.length) lines.push('  none');
  for (const court of MATRIX_COURTS) {
    const cells = summary.unavailableAtFirstPublication.filter(cell => cell.court === court);
    if (cells.length) lines.push(`  Court ${court}: ${cells.map(cell => `${hourLabel(cell.hour)} (${cell.record ? `public booking record, first seen ${relativeSeconds(cell.record.responseOffsetMs)}` : 'no matching public booking record · cause unknown'})`).join(', ')}`);
  }
  lines.push('', 'UNAVAILABLE → OPEN (reopening evidence; cause unknown)');
  if (!summary.reopened.length) lines.push('  none observed');
  for (const cell of summary.reopened)
    lines.push(`  Court ${cell.court} ${hourLabel(cell.hour).padEnd(5)} ${cell.confidence} · unavailable in ${describeRead(cell.before)}; open in ${describeRead(cell.after)}${cell.overlapping ? ' (reads overlapped)' : ''}`);
  lines.push('', 'CONFIGURED CANDIDATES');
  if(!summary.candidates.length)lines.push('  none supplied by the saved booking plan');
  for(const candidate of summary.candidates)lines.push(`  ${candidate.label??candidate.id}: C${candidate.court} ${candidate.start}–${candidate.end} ${candidate.state} · evidence age ≤ ${candidate.evidenceAgeUpperBoundMs===null?'UNKNOWN':`${Math.ceil(candidate.evidenceAgeUpperBoundMs)} ms`} · ${candidate.freshness}${candidate.reopening?` · reopening ${candidate.reopening}`:''}`);
  lines.push('', 'SLOT WATCH QUALITY',
    `  Latency: median ${q?.latency.medianMs??'?'} ms · p95 ${q?.latency.p95Ms??'?'} ms · min ${q?.latency.minMs??'?'} ms · max ${q?.latency.maxMs??'?'} ms`,
    `  Cache: MISS ${q?.cache.MISS??0} (${Math.round((q?.cacheRates.MISS??0)*100)}%) · HIT ${q?.cache.HIT??0} (${Math.round((q?.cacheRates.HIT??0)*100)}%) · STALE ${q?.cache.STALE??0} (${Math.round((q?.cacheRates.STALE??0)*100)}%) · unknown ${q?.cache.UNKNOWN??0} (${Math.round((q?.cacheRates.UNKNOWN??0)*100)}%)`,
    `  Reopenings: confirmed ${q?.reopenings.confirmed??0} · probable ${q?.reopenings.probable??0} · inconsistent ${q?.reopenings.inconsistent??0} · unknown ${q?.reopenings.unknown??0}`,
    `  Candidate reopenings: ${q?.candidateReopenings??0} · contradictions: ${q?.contradictions??0}`,
    `  Public-booking coverage: ${q?.bookingCoverage.answered??0}/${q?.bookingCoverage.launched??0} reads answered · ${q?.bookingCoverage.successfulCourtQueries??0}/${q?.bookingCoverage.totalCourtQueries??0} court queries successful`,
    `  Provider paths/edges: ${q?.providerPaths.length?q.providerPaths.join(' | '):'not exposed'}`,
    `  Quality JSON: ${summary.qualityReportPath??'unavailable'}`);
  lines.push('', `CURRENT MATRIX (freshest bounded evidence${summary.current ? `: ${describeRead(summary.current)}` : ''}; a newer stale response cannot replace fresher evidence)`,
    ...matrixLines(summary.finalMatrix), '',
    'LIMITATIONS',
    '  - A read does not show the provider-side moment of a change; only the request/response interval of the reads around it.',
    '  - Unavailable without a matching public booking record: the cause is not visible in Onda\'s public data.',
    '  - A public booking record shows that a booking record exists. It does not show who made it or why.',
    '  - Responses served from Onda\'s edge cache (x-vercel-cache/age) may reflect an earlier state than the request time.',
    '', `Full read-by-read log (response order, with request order in seq): ${summary.logPath}`);
  return `${lines.join('\n')}\n`;
}
function matrixLines(matrix: string): string[] {
  const lines = [`  (${Object.entries(SLOT_STATE_CODE).map(([state, code]) => `${code} ${state === 'TAKEN' ? 'unavailable' : state === 'UNRELEASED' ? 'not published' : state.toLowerCase()}`).join(', ')})`,
    `       ${MATRIX_HOURS.map(hour => hour.slice(0, 2)).join(' ')}`];
  for (const row of matrix.split(',').filter(Boolean)) {
    const [court, codes] = row.split(':');
    lines.push(`  C${court}   ${[...codes!].map(code => ` ${code}`).join(' ')}`);
  }
  return lines;
}

/** Newest-first digests of finished watches, for the history list (older version-1 files are shown as legacy). */
export function readSlotWatchHistory(directory: string, limit = 12): SlotWatchDigest[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter(name => name.endsWith('.summary.json'))
    .map(name => ({ name, mtime: statSync(join(directory, name)).mtimeMs })).sort((a, b) => b.mtime - a.mtime).slice(0, limit)
    .flatMap(({ name }) => {
      try {
        const value = JSON.parse(readFileSync(join(directory, name), 'utf8')) as Record<string, unknown>;
        if ((value.version === 2||value.version===3) && typeof value.id === 'string' && typeof value.date === 'string' && Array.isArray(value.timeline))
          return [digestOf({candidates:[],quality:null,...value} as unknown as SlotWatchSummary)];
        if (value.version === 1 && typeof value.id === 'string' && typeof value.date === 'string') return [legacyDigest(value)];
        return [];
      } catch { return []; }
    });
}
const emptyCounts = (): SlotWatchCounts => ({ launched: 0, answered: 0, failed: 0, aborted: 0, notLaunched: 0 });
/** Version-1 files (before 2026-09-24 Phase 2) kept only response times; their details stay in their own report. */
function legacyDigest(value: Record<string, unknown>): SlotWatchDigest {
  const polls = Number(value.polls) || 0, failed = Number(value.failedPolls) || 0;
  return { version: 1, legacy: true, id: String(value.id), date: String(value.date), releaseAt: String(value.releaseAt ?? ''), releaseMs: Number(value.releaseMs) || 0,
    startedAt: String(value.startedAt ?? ''), endedAt: String(value.endedAt ?? ''), status: value.status === 'stopped' ? 'stopped' : 'finished',
    reason: String(value.reason ?? ''), clockOffsetMs: Number(value.clockOffsetMs) || 0, clockSynced: value.clockSynced === true, schedule: null,
    availability: { ...emptyCounts(), launched: polls, answered: polls - failed, failed, maxInFlight: 1, medianLatencyMs: typeof value.medianLatencyMs === 'number' ? value.medianLatencyMs : null },
    bookings: { ...emptyCounts(), failedCourtQueries: 0 },
    publication: { lastUnpublished: null, firstPublished: null, firstPublishedResponse: null }, firstPublishedMatrix: null, firstPublishedCounts: null,
    openToUnavailable: [], unavailableAtFirstPublication: [], reopened: [], candidates:[],quality:null,current: null,
    finalMatrix: typeof value.finalMatrix === 'string' ? value.finalMatrix : '', stillOpen: Number(value.stillOpen) || 0, timeline: [],
    logPath: String(value.logPath ?? ''), reportPath: String(value.reportPath ?? '') };
}
