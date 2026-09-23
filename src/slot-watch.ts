import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { OndaLiveAvailabilityProvider } from './api-booking/live-availability-provider.js';
import { parseAvailability } from './api-booking/availability-parser.js';
import { readPublicBookingRecords, type PublicBookingRecords } from './api-booking/public-bookings.js';
import { MATRIX_COURTS, MATRIX_HOURS, SLOT_STATE_CODE, countCourtHourStates, courtHourStates, encodeCourtHourStates,
  type CourtHourStates, type SlotState } from './api-booking/court-hour-matrix.js';
import type { AvailabilitySnapshot } from './api-booking/types.js';

/**
 * Release slot watch: a read-only observer that records the exact state of all
 * 112 court-hours around a release so the operator can see when each slot
 * opened and how quickly it was taken. It uses only Onda's public, credential-free
 * availability and booking-record endpoints and never touches a browser, lock,
 * hold, or checkout.
 */
export const SLOT_WATCH_BEFORE_MS = 60_000;
export const SLOT_WATCH_AFTER_MS = 15 * 60_000;
const TIMELINE_LIMIT = 600;

export interface SlotWatchPoll { offsetMs: number; bookings: boolean }

/** Dense right after release (0.5 s), sparse later; booking records at key moments. */
export function slotWatchSchedule(): SlotWatchPoll[] {
  const plan = new Map<number, boolean>();
  const add = (offsetMs: number, bookings = false) => plan.set(offsetMs, (plan.get(offsetMs) ?? false) || bookings);
  for (let t = -SLOT_WATCH_BEFORE_MS; t < 0; t += 10_000) add(t);
  add(-2_000);
  for (let t = 250; t < 10_000; t += 500) add(t);
  for (let t = 10_000; t <= 60_000; t += 1_000) add(t);
  for (let t = 65_000; t <= 300_000; t += 5_000) add(t);
  for (let t = 330_000; t <= SLOT_WATCH_AFTER_MS; t += 30_000) add(t);
  for (const t of [-SLOT_WATCH_BEFORE_MS, 2_000, 10_000, 30_000, 60_000, 120_000, 300_000, 600_000, SLOT_WATCH_AFTER_MS]) add(t, true);
  return [...plan.entries()].sort((a, b) => a[0] - b[0]).map(([offsetMs, bookings]) => ({ offsetMs, bookings }));
}

export type SlotWatchStatus = 'waiting' | 'watching' | 'finished' | 'stopped';
export interface SlotTimelineEntry {
  /** 'published' summarizes cells that first appeared (were unreleased/unknown) in one read; court is 0 then. */
  seq: number; court: number; hour: string; kind: 'state' | 'record' | 'published';
  from?: SlotState; to?: SlotState; appeared?: boolean; openCount?: number; takenCount?: number;
  /** Response time of the read that first showed the change, network clock. */
  observedAt: string; sinceReleaseMs: number;
  /** Time since the previous successful read: the change happened inside this window. */
  windowMs: number | null;
}
export interface SlotCellView { court: number; hour: string; state: SlotState; record: boolean; changedSinceReleaseMs?: number }
export interface SlotTake { court: number; hour: string; openedSinceReleaseMs: number; takenSinceReleaseMs: number; windowMs: number | null; recordSinceReleaseMs: number | null }
export interface SlotWatchSummary {
  version: 1; id: string; date: string; releaseAt: string; releaseMs: number; startedAt: string; endedAt: string;
  status: 'finished' | 'stopped'; reason: string; clockOffsetMs: number; clockSynced: boolean;
  polls: number; failedPolls: number; medianLatencyMs: number | null;
  /** First read after release in which Onda returned the target date. */
  releaseVisibleSinceReleaseMs: number | null;
  openAtFirstRead: number;
  taken: SlotTake[];
  neverOpen: Array<{ court: number; hour: string; record: boolean }>;
  reopened: Array<{ court: number; hour: string; sinceReleaseMs: number }>;
  stillOpen: number; fastestTakeMs: number | null; finalMatrix: string;
  timeline: SlotTimelineEntry[]; logPath: string; reportPath: string;
}
export interface SlotWatchView {
  id: string; date: string; releaseMs: number; status: SlotWatchStatus; startedAt: string; endsAtMs: number;
  polls: number; failedPolls: number; lastPollAt?: string; lastLatencyMs?: number; lastError?: string;
  dateReleased: boolean | null; cells: SlotCellView[]; timeline: SlotTimelineEntry[]; logPath: string; summary?: SlotWatchSummary;
}
export interface SlotWatchOptions {
  date: string; releaseMs: number; directory: string;
  /** Network-corrected epoch milliseconds. */
  now?: () => number; clockOffsetMs?: number; clockSynced?: boolean;
  readAvailability?: (date: string) => Promise<AvailabilitySnapshot>;
  readBookings?: (date: string) => Promise<PublicBookingRecords>;
  schedule?: SlotWatchPoll[];
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  onUpdate?: (view: SlotWatchView) => void;
}

async function liveAvailability(date: string): Promise<AvailabilitySnapshot> {
  const envelope = await new OndaLiveAvailabilityProvider({ allowIncompleteRange: true, timeoutMs: 5_000 })
    .getAvailability({ startDate: date, endDate: date });
  return parseAvailability(envelope.raw, { startDate: date, endDate: date, capturedAt: envelope.capturedAt,
    fixtureKind: envelope.fixtureKind, label: envelope.label, now: new Date(), maximumAgeMs: 15_000, requireCompleteRange: false });
}
const abortableSleep = (ms: number, signal: AbortSignal) => new Promise<void>(done => {
  if (signal.aborted) { done(); return; }
  const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); done(); }, Math.max(0, ms));
  const onAbort = () => { clearTimeout(timer); done(); };
  signal.addEventListener('abort', onAbort, { once: true });
});
const key = (court: number, hour: string) => `${court}/${hour}`;
const safeCode = (error: unknown) => error instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.message) ? error.message : 'READ_FAILED';

/** Manila wall time with milliseconds, e.g. 2026-09-24 08:00:00.412. */
export function manilaStamp(ms: number): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}.${String(Math.floor(((ms % 1000) + 1000) % 1000)).padStart(3, '0')}`;
}
/** Signed seconds relative to release with millisecond precision, e.g. +0.412 s. */
export function relativeSeconds(ms: number): string { return `${ms < 0 ? '−' : '+'}${(Math.abs(ms) / 1000).toFixed(3)} s`; }

export class SlotWatch {
  readonly id = randomUUID();
  readonly path: string;
  readonly done: Promise<SlotWatchSummary>;
  private readonly handle: number;
  private readonly abort = new AbortController();
  private readonly now: () => number;
  private readonly startedMs: number;
  private stopReason = 'window complete';
  private status: SlotWatchStatus = 'waiting';
  private states: CourtHourStates | undefined;
  private dateReleased: boolean | null = null;
  private records = new Set<string>();
  private recordsKnown = false;
  private polls = 0;
  private failedPolls = 0;
  private readonly latencies: number[] = [];
  private lastObservedMs: number | undefined;
  private lastError: string | undefined;
  private readonly timeline: SlotTimelineEntry[] = [];
  private readonly changedAt = new Map<string, number>();
  private readonly openedAt = new Map<string, number>();
  private readonly takes = new Map<string, SlotTake>();
  private readonly recordAt = new Map<string, number>();
  private readonly firstPublished = new Map<string, SlotState>();
  private readonly reopened: Array<{ court: number; hour: string; sinceReleaseMs: number }> = [];
  private releaseVisibleSinceReleaseMs: number | null = null;
  private openAtFirstRead: number | undefined;
  private summary: SlotWatchSummary | undefined;

  constructor(private readonly options: SlotWatchOptions) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date) || !Number.isSafeInteger(options.releaseMs)) throw Error('SLOT_WATCH_INPUT_INVALID');
    this.now = options.now ?? Date.now;
    this.startedMs = this.now();
    mkdirSync(options.directory, { recursive: true, mode: 0o700 });
    this.path = join(options.directory, `${options.date}_${this.id}.ndjson`);
    this.handle = openSync(this.path, 'wx', 0o600);
    this.write({ type: 'header', version: 1, id: this.id, date: options.date, releaseAt: new Date(options.releaseMs).toISOString(),
      releaseManila: manilaStamp(options.releaseMs), startedAt: new Date(this.startedMs).toISOString(),
      clockOffsetMs: options.clockOffsetMs ?? 0, clockSynced: options.clockSynced ?? false,
      legend: { O: 'open', X: 'taken / unavailable', U: 'date not released yet', '?': 'unknown (not published or read failed)' },
      note: 'Times are network-clock corrected. A change happened between the previous read and observedAt (windowMs).' });
    this.done = this.run();
  }

  /** Stops early; resolves with the summary written so far. */
  stop(reason: string): Promise<SlotWatchSummary> { if (!this.abort.signal.aborted) { this.stopReason = reason; this.abort.abort(); } return this.done; }

  view(): SlotWatchView {
    const cells = MATRIX_COURTS.flatMap(court => MATRIX_HOURS.map(hour => {
      const changed = this.changedAt.get(key(court, hour));
      return { court, hour, state: this.states?.[court]?.[hour] ?? 'UNKNOWN', record: this.records.has(key(court, hour)),
        ...(changed === undefined ? {} : { changedSinceReleaseMs: changed }) } satisfies SlotCellView;
    }));
    return { id: this.id, date: this.options.date, releaseMs: this.options.releaseMs, status: this.status,
      startedAt: new Date(this.startedMs).toISOString(), endsAtMs: this.options.releaseMs + SLOT_WATCH_AFTER_MS,
      polls: this.polls, failedPolls: this.failedPolls, dateReleased: this.dateReleased, cells, timeline: this.timeline.slice(-300),
      logPath: this.path, ...(this.lastObservedMs !== undefined ? { lastPollAt: new Date(this.lastObservedMs).toISOString() } : {}),
      ...(this.latencies.length ? { lastLatencyMs: this.latencies.at(-1)! } : {}), ...(this.lastError ? { lastError: this.lastError } : {}),
      ...(this.summary ? { summary: this.summary } : {}) };
  }

  private write(value: unknown) { try { writeSync(this.handle, `${JSON.stringify(value)}\n`); } catch { /* Observation must never fail a booking. */ } }
  private publish() { try { this.options.onUpdate?.(this.view()); } catch { /* UI updates are best-effort. */ } }

  private async run(): Promise<SlotWatchSummary> {
    const sleep = this.options.sleep ?? abortableSleep, signal = this.abort.signal;
    try {
      this.publish();
      for (const entry of this.options.schedule ?? slotWatchSchedule()) {
        if (signal.aborted) break;
        const target = this.options.releaseMs + entry.offsetMs;
        // A late start or a slow read skips reads that are already in the past.
        if (target < this.now() - 1_000) continue;
        // Re-check the clock after each wait so PC sleep or a clock resync cannot fire a read early.
        while (!signal.aborted && this.now() < target) await sleep(Math.min(target - this.now(), 60_000), signal);
        if (signal.aborted) break;
        this.status = 'watching';
        await this.poll(entry.bookings);
      }
    } catch { this.stopReason = 'internal error'; }
    this.status = signal.aborted ? 'stopped' : 'finished';
    return this.finish();
  }

  private async poll(withBookings: boolean) {
    const date = this.options.date, releaseMs = this.options.releaseMs;
    const requestedMs = this.now();
    const [availability, bookings] = await Promise.allSettled([
      (this.options.readAvailability ?? liveAvailability)(date),
      withBookings ? (this.options.readBookings ?? (value => readPublicBookingRecords(value)))(date) : Promise.resolve(undefined),
    ]);
    const respondedMs = this.now(), seq = ++this.polls, latencyMs = Math.max(0, Math.round(respondedMs - requestedMs));
    const observedAt = new Date(respondedMs).toISOString(), sinceReleaseMs = Math.round(respondedMs - releaseMs);
    const windowMs = this.lastObservedMs === undefined ? null : Math.round(respondedMs - this.lastObservedMs);
    // Every transition goes to the log; the UI timeline gets real open/taken changes plus one
    // summary per read in which cells first appeared, so release publication is not 112 rows.
    const changes: SlotTimelineEntry[] = [], timeline: SlotTimelineEntry[] = [];
    let publishedOpen = 0, publishedTaken = 0;
    let states: CourtHourStates | undefined;
    if (availability.status === 'fulfilled') {
      states = courtHourStates(availability.value, date);
      this.dateReleased = availability.value.returnedDates[date] === true ? true : availability.value.returnedDates[date] === false ? false : null;
      if (this.dateReleased && sinceReleaseMs >= 0 && this.releaseVisibleSinceReleaseMs === null) this.releaseVisibleSinceReleaseMs = sinceReleaseMs;
      for (const court of MATRIX_COURTS) for (const hour of MATRIX_HOURS) {
        const cell = key(court, hour), next = states[court]![hour]!, previous = this.states?.[court]?.[hour];
        if ((next === 'OPEN' || next === 'TAKEN') && !this.firstPublished.has(cell)) this.firstPublished.set(cell, next);
        if (next === 'OPEN' && !this.openedAt.has(cell)) this.openedAt.set(cell, sinceReleaseMs);
        if (previous === undefined || previous === next) continue;
        const change: SlotTimelineEntry = { seq, court, hour, kind: 'state', from: previous, to: next, observedAt, sinceReleaseMs, windowMs };
        changes.push(change);
        if (previous === 'OPEN' || previous === 'TAKEN') { timeline.push(change); this.changedAt.set(cell, sinceReleaseMs); }
        else if (next === 'OPEN') publishedOpen++;
        else if (next === 'TAKEN') publishedTaken++;
        if (previous === 'OPEN' && next === 'TAKEN' && !this.takes.has(cell))
          this.takes.set(cell, { court, hour, openedSinceReleaseMs: this.openedAt.get(cell) ?? sinceReleaseMs, takenSinceReleaseMs: sinceReleaseMs, windowMs, recordSinceReleaseMs: null });
        if (previous === 'TAKEN' && next === 'OPEN') this.reopened.push({ court, hour, sinceReleaseMs });
      }
      if (this.openAtFirstRead === undefined && this.dateReleased && sinceReleaseMs >= 0) this.openAtFirstRead = countCourtHourStates(states).OPEN;
      this.states = states;
      this.lastObservedMs = respondedMs;
      this.latencies.push(latencyMs);
      this.lastError = undefined;
    } else { this.failedPolls++; this.lastError = safeCode(availability.reason); }
    let bookingSummary: { failedCourts: number[]; records: number } | undefined;
    if (bookings.status === 'fulfilled' && bookings.value) {
      const failed = new Set(bookings.value.failedCourts), next = new Set<string>();
      for (const block of bookings.value.blocks) for (const hour of MATRIX_HOURS) {
        const end = `${String(Number(hour.slice(0, 2)) + 1).padStart(2, '0')}:00`;
        if (block.startTime < end && block.endTime > hour) next.add(key(block.court, hour));
      }
      // A court whose record query failed keeps its last known records.
      for (const cell of this.records) if (failed.has(Number(cell.split('/')[0]))) next.add(cell);
      if (this.recordsKnown) {
        for (const cell of next) if (!this.records.has(cell)) { const entry = this.recordEntry(seq, cell, true, observedAt, sinceReleaseMs, windowMs); changes.push(entry); timeline.push(entry); }
        for (const cell of this.records) if (!next.has(cell)) { const entry = this.recordEntry(seq, cell, false, observedAt, sinceReleaseMs, windowMs); changes.push(entry); timeline.push(entry); }
      }
      for (const cell of next) if (!this.recordAt.has(cell)) this.recordAt.set(cell, sinceReleaseMs);
      this.records = next; this.recordsKnown = true;
      bookingSummary = { failedCourts: [...failed], records: next.size };
    } else if (bookings.status === 'rejected') bookingSummary = { failedCourts: [...MATRIX_COURTS], records: this.records.size };
    this.write({ type: 'poll', seq, requestedAt: new Date(requestedMs).toISOString(), respondedAt: observedAt,
      requestedManila: manilaStamp(requestedMs), respondedManila: manilaStamp(respondedMs), latencyMs,
      sinceReleaseMs, availability: availability.status === 'fulfilled' ? 'ok' : 'failed',
      ...(availability.status === 'rejected' ? { code: safeCode(availability.reason) } : {}),
      ...(states ? { dateReleased: this.dateReleased, counts: countCourtHourStates(states), matrix: encodeCourtHourStates(states) } : {}),
      ...(bookingSummary ? { bookingRecords: bookingSummary } : {}) });
    for (const change of changes) this.write({ type: 'change', ...change, observedManila: manilaStamp(respondedMs) });
    if (publishedOpen || publishedTaken) timeline.unshift({ seq, court: 0, hour: '', kind: 'published', openCount: publishedOpen,
      takenCount: publishedTaken, observedAt, sinceReleaseMs, windowMs });
    this.timeline.push(...timeline);
    if (this.timeline.length > TIMELINE_LIMIT) this.timeline.splice(0, this.timeline.length - TIMELINE_LIMIT);
    this.publish();
  }

  private recordEntry(seq: number, cell: string, appeared: boolean, observedAt: string, sinceReleaseMs: number, windowMs: number | null): SlotTimelineEntry {
    const [court, hour] = cell.split('/');
    return { seq, court: Number(court), hour: hour!, kind: 'record', appeared, observedAt, sinceReleaseMs, windowMs };
  }

  private finish(): SlotWatchSummary {
    const endedMs = this.now(), cells = MATRIX_COURTS.flatMap(court => MATRIX_HOURS.map(hour => ({ court, hour })));
    const taken = [...this.takes.values()].map(take => ({ ...take, recordSinceReleaseMs: this.recordAt.get(key(take.court, take.hour)) ?? null }))
      .sort((a, b) => a.takenSinceReleaseMs - b.takenSinceReleaseMs || a.court - b.court || a.hour.localeCompare(b.hour));
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const reportPath = this.path.replace(/\.ndjson$/, '.txt');
    const summary: SlotWatchSummary = { version: 1, id: this.id, date: this.options.date, releaseAt: new Date(this.options.releaseMs).toISOString(),
      releaseMs: this.options.releaseMs, startedAt: new Date(this.startedMs).toISOString(), endedAt: new Date(endedMs).toISOString(),
      status: this.status === 'stopped' ? 'stopped' : 'finished', reason: this.stopReason,
      clockOffsetMs: this.options.clockOffsetMs ?? 0, clockSynced: this.options.clockSynced ?? false,
      polls: this.polls, failedPolls: this.failedPolls, medianLatencyMs: sorted.length ? sorted[Math.floor(sorted.length / 2)]! : null,
      releaseVisibleSinceReleaseMs: this.releaseVisibleSinceReleaseMs, openAtFirstRead: this.openAtFirstRead ?? 0, taken,
      neverOpen: cells.filter(({ court, hour }) => this.firstPublished.get(key(court, hour)) === 'TAKEN' && !this.openedAt.has(key(court, hour)))
        .map(({ court, hour }) => ({ court, hour, record: this.recordAt.has(key(court, hour)) })),
      reopened: this.reopened, stillOpen: this.states ? countCourtHourStates(this.states).OPEN : 0,
      fastestTakeMs: taken.length ? Math.min(...taken.map(take => take.takenSinceReleaseMs)) : null,
      finalMatrix: this.states ? encodeCourtHourStates(this.states) : '', timeline: this.timeline, logPath: this.path, reportPath };
    this.summary = summary;
    this.write({ type: 'summary', ...summary, timeline: undefined });
    try { closeSync(this.handle); } catch { /* already closed */ }
    try {
      writeFileSync(reportPath, slotWatchReport(summary), { encoding: 'utf8', mode: 0o600 });
      const summaryPath = this.path.replace(/\.ndjson$/, '.summary.json'), temporary = `${summaryPath}.tmp`;
      writeFileSync(temporary, JSON.stringify(summary), { encoding: 'utf8', mode: 0o600 }); renameSync(temporary, summaryPath);
    } catch { /* The NDJSON log already holds every read. */ }
    this.publish();
    return summary;
  }
}

const hourLabel = (hour: string) => { const h = Number(hour.slice(0, 2)); return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`; };

/** Plain-text report for reading the release outcome without tools. */
export function slotWatchReport(summary: SlotWatchSummary): string {
  const lines = [`RELEASE SLOT WATCH — target ${summary.date}`,
    `Release: ${manilaStamp(summary.releaseMs)} Manila · network clock ${summary.clockSynced ? `synchronized (offset ${summary.clockOffsetMs.toFixed(1)} ms)` : 'NOT synchronized'}`,
    `Watch ${summary.status}: ${summary.reason} · ${summary.polls} reads (${summary.failedPolls} failed) · median read ${summary.medianLatencyMs ?? '?'} ms`,
    `Target date first visible: ${summary.releaseVisibleSinceReleaseMs === null ? 'not observed after release' : relativeSeconds(summary.releaseVisibleSinceReleaseMs)}`,
    `Open at first read: ${summary.openAtFirstRead} · still open at end: ${summary.stillOpen}`,
    `Fastest take: ${summary.fastestTakeMs === null ? 'none observed' : relativeSeconds(summary.fastestTakeMs)}`, '',
    'TAKEN AFTER OPENING (a slot changed between the previous read and the time shown)'];
  if (!summary.taken.length) lines.push('  none observed');
  for (const take of summary.taken) lines.push(`  ${relativeSeconds(take.takenSinceReleaseMs).padStart(11)}  Court ${take.court} ${hourLabel(take.hour).padEnd(5)} open ${relativeSeconds(take.openedSinceReleaseMs)} → taken${take.windowMs === null ? '' : ` (±${(take.windowMs / 1000).toFixed(3)} s)`}${take.recordSinceReleaseMs === null ? '' : ` · booking record seen ${relativeSeconds(take.recordSinceReleaseMs)}`}`);
  lines.push('', 'NEVER OPEN (already unavailable at the first published read)');
  if (!summary.neverOpen.length) lines.push('  none');
  for (const court of MATRIX_COURTS) {
    const cells = summary.neverOpen.filter(cell => cell.court === court);
    if (cells.length) lines.push(`  Court ${court}: ${cells.map(cell => `${hourLabel(cell.hour)}${cell.record ? ' (booked)' : ' (no booking record — likely venue block)'}`).join(', ')}`);
  }
  lines.push('', 'REOPENED LATER (for example an unpaid hold expiring)');
  if (!summary.reopened.length) lines.push('  none');
  for (const cell of summary.reopened) lines.push(`  ${relativeSeconds(cell.sinceReleaseMs).padStart(11)}  Court ${cell.court} ${hourLabel(cell.hour)}`);
  lines.push('', `FINAL MATRIX (${Object.entries(SLOT_STATE_CODE).map(([state, code]) => `${code} ${state.toLowerCase()}`).join(', ')})`,
    `       ${MATRIX_HOURS.map(hour => hour.slice(0, 2)).join(' ')}`);
  for (const row of summary.finalMatrix.split(',').filter(Boolean)) {
    const [court, codes] = row.split(':');
    lines.push(`  C${court}   ${[...codes!].map(code => ` ${code}`).join(' ')}`);
  }
  lines.push('', `Full read-by-read log: ${summary.logPath}`);
  return `${lines.join('\n')}\n`;
}

/** Newest-first summaries of finished watches, for the Runs history. */
export function readSlotWatchHistory(directory: string, limit = 20): SlotWatchSummary[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter(name => name.endsWith('.summary.json'))
    .map(name => ({ name, mtime: statSync(join(directory, name)).mtimeMs })).sort((a, b) => b.mtime - a.mtime).slice(0, limit)
    .flatMap(({ name }) => {
      try {
        const value = JSON.parse(readFileSync(join(directory, name), 'utf8')) as SlotWatchSummary;
        return value.version === 1 && typeof value.id === 'string' && typeof value.date === 'string' && Array.isArray(value.taken) ? [value] : [];
      } catch { return []; }
    });
}
