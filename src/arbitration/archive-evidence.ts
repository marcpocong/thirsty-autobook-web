import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseVercelId } from '../api-booking/response-evidence.js';
import { clusters, kendallTau, mannWhitney, summarize, type Summary } from './stats.js';

/**
 * Offline analysis of archived release/test evidence (diagnostics-archive/<date>/local).
 * Read-only: no network, no browser, no checkout. Every derived number keeps its provenance:
 *
 *   FACT        read directly from a recorded field (possibly converted between clock domains
 *               whose relationship was itself recorded, e.g. PC wall clock + adopted NTP offset);
 *   INFERENCE   follows from facts plus a stated assumption;
 *   UNKNOWN     the evidence cannot decide it.
 *
 * Clock domains. The runner's dispatch clock is the anchored NTP-consensus clock
 * (TrustedReleaseClock); `releaseLatenessMs` values are on it. Trace `at`/`eventAt` values are the
 * PC wall clock (dispatch = wall + adopted offset). Slot Watch offsets use the observer's offset.
 * Provider-trace `browser.*` values are Chrome-monotonic durations after Chrome's request start.
 * Onda's `hold_expires_at` is the provider's clock. `x-vercel-id` embeds an UNDOCUMENTED number.
 */
export type Line = Record<string, unknown>;
export type Provenance = 'FACT' | 'INFERENCE' | 'UNKNOWN';

export const HOLD_DURATION_MS = 10 * 60_000;

export function parseNdjson(text: string): Line[] {
  return text.split('\n').flatMap(line => {
    if (!line.trim()) return [];
    try { const value = JSON.parse(line) as unknown; return value && typeof value === 'object' && !Array.isArray(value) ? [value as Line] : []; }
    catch { return []; }
  });
}
const num = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const str = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
const epoch = (value: unknown): number | undefined => { const parsed = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(parsed) ? parsed : undefined; };
const tenth = (value: number) => Math.round(value * 10) / 10;

export interface RunTrace { runId: string; mode: string; targetDate: string; bookingMethod: string | null; lines: Line[] }
export function runTrace(lines: Line[]): RunTrace {
  const first = lines[0] ?? {}, config = lines.find(line => line.stage === 'RUN_CONFIGURATION') ?? {};
  return { runId: str(first.runId) ?? 'unknown', mode: str(first.mode) ?? 'unknown', targetDate: str(first.targetDate) ?? '',
    bookingMethod: str(config.bookingMethod) ?? null, lines };
}
export function readRunTraces(runProgressDirectory: string): RunTrace[] {
  if (!existsSync(runProgressDirectory)) return [];
  return readdirSync(runProgressDirectory).filter(name => name.endsWith('.ndjson')).sort()
    .map(name => runTrace(parseNdjson(readFileSync(join(runProgressDirectory, name), 'utf8'))));
}

// ---------------------------------------------------------------------------------------------
// Checkout samples (every recorded checkout POST with its outcome)
// ---------------------------------------------------------------------------------------------
export interface CheckoutSample {
  runId: string; mode: string; method: 'proofless' | 'proof-based'; workerId: string;
  /** PC wall-clock epoch ms of the send evidence (Playwright request event, or slot proofs ready just before the POST). */
  sendAtPcMs: number;
  sendEvidence: 'PLAYWRIGHT_REQUEST_EVENT' | 'SLOT_PROOFS_READY';
  responseAtPcMs: number | null;
  /** POST → response in ms (runner-measured network duration, or proofs-ready → response for the legacy proof path). */
  postMs: number | null;
  statusCode: number | null;
  errorHint: string | null;
  /** Provider-side hold creation (hold_expires_at − 10 min); present only for a verified hold. */
  commitServerMs: number | null;
  /** Number of POSTs in the same run sent within ±250 ms of this one (including itself). */
  concurrentSends: number;
  court: number | null; startTime: string | null; durationHours: number | null;
}

export function checkoutSamples(trace: RunTrace): CheckoutSample[] {
  const samples: CheckoutSample[] = [];
  const byWorker = new Map<string, Line[]>();
  for (const line of trace.lines) { const worker = str(line.workerId); if (worker) byWorker.set(worker, [...(byWorker.get(worker) ?? []), line]); }
  for (const [workerId, lines] of byWorker) {
    const hold = lines.find(line => line.stage === 'PENDING_HOLD' && str(line.holdExpiresAt));
    const commitServerMs = hold ? (epoch(hold.holdExpiresAt) ?? NaN) - HOLD_DURATION_MS : null;
    const posts = lines.filter(line => line.stage === 'CHECKOUT_HTTP_POST_INITIATED');
    const completions = lines.filter(line => line.stage === 'CHECKOUT_RESPONSE_COMPLETED');
    const target = lines.find(line => line.stage === 'DIAGNOSTIC_ATTEMPT_STARTED' || line.stage === 'DIAGNOSTIC_ATTEMPT_ARMED' || line.stage === 'PENDING_HOLD');
    const describe = { court: num(target?.court) ?? null, startTime: str(target?.startTime) ?? null, durationHours: num(target?.durationHours) ?? null };
    if (posts.length) {
      posts.forEach((post, index) => {
        const done = completions[index];
        const sendAt = epoch(post.eventAt ?? post.at)!;
        samples.push({ runId: trace.runId, mode: trace.mode, method: 'proofless', workerId, sendAtPcMs: sendAt, sendEvidence: 'PLAYWRIGHT_REQUEST_EVENT',
          responseAtPcMs: done ? epoch(done.eventAt ?? done.at) ?? null : null, postMs: num(done?.networkDurationMs) ?? null,
          statusCode: num(done?.statusCode) ?? null, errorHint: str(done?.errorHint) ?? null,
          commitServerMs: index === posts.length - 1 && commitServerMs !== null && Number.isFinite(commitServerMs) ? commitServerMs : null,
          concurrentSends: 0, ...describe });
      });
      continue;
    }
    const proofs = lines.filter(line => line.stage === 'SLOT_PROOFS_READY').at(-1);
    const response = lines.find(line => line.stage === 'CHECKOUT_RESPONSE_RECEIVED');
    if (proofs && response) {
      const sendAt = epoch(proofs.at)!, responseAt = epoch(response.at)!;
      samples.push({ runId: trace.runId, mode: trace.mode, method: 'proof-based', workerId, sendAtPcMs: sendAt, sendEvidence: 'SLOT_PROOFS_READY',
        responseAtPcMs: responseAt, postMs: responseAt - sendAt, statusCode: hold ? 200 : null, errorHint: null,
        commitServerMs: commitServerMs !== null && Number.isFinite(commitServerMs) ? commitServerMs : null, concurrentSends: 0, ...describe });
    }
  }
  for (const sample of samples)
    sample.concurrentSends = samples.filter(other => Math.abs(other.sendAtPcMs - sample.sendAtPcMs) <= 250).length;
  return samples.sort((a, b) => a.sendAtPcMs - b.sendAtPcMs || a.workerId.localeCompare(b.workerId));
}

export interface LaneComparison {
  provenance: Provenance;
  note: string;
  proofless: Summary; proofBased: Summary;
  mannWhitney: ReturnType<typeof mannWhitney>;
  prooflessSamples: number[]; proofBasedSamples: number[];
}
/** Off-peak (Test Now) successful POST durations by lane. Clock-offset free: both ends are on one clock. */
export function compareLanes(samples: readonly CheckoutSample[]): LaneComparison {
  const offPeak = samples.filter(sample => sample.mode === 'live-now' && sample.statusCode === 200 && sample.postMs !== null);
  const proofless = offPeak.filter(sample => sample.method === 'proofless').map(sample => sample.postMs!);
  const proofBased = offPeak.filter(sample => sample.method === 'proof-based').map(sample => sample.postMs!);
  return { provenance: 'FACT',
    note: 'Successful off-peak checkouts only. Proofless: Playwright request event → response (runner network duration). Proof-based: slot proofs ready → response logged (includes a few ms of local work before the POST).',
    proofless: summarize(proofless, 1), proofBased: summarize(proofBased, 1), mannWhitney: mannWhitney(proofless, proofBased),
    prooflessSamples: proofless, proofBasedSamples: proofBased };
}

export interface CommitRunEvidence {
  runId: string; method: string; holds: number; simultaneous: boolean;
  /** Spread of the PC send times of the holds in this run (ms). */
  sendSpreadMs: number;
  /** Spread of the provider-side commit times (ms). Clock-offset free. */
  commitSpreadMs: number;
  /** Spread of the PC response times (ms). */
  responseSpreadMs: number;
  /** Kendall tau between commit order and response order. */
  commitVsResponseTau: number | null;
  /** Per hold, PC-clock based (shifts by the unknown PC offset, identical within the run). */
  perHold: Array<{ workerId: string; durationMs: number; commitMinusSendPcMs: number; responseMinusCommitPcMs: number }>;
  /** Range of the PC clock offset (network − PC) consistent with every commit lying inside its own request window. */
  pcOffsetFeasibleMs: { min: number; max: number };
}
/**
 * Where inside a successful request did the provider create the hold? hold_expires_at − 10 min is the
 * provider-side creation time (the bot's own hold on 2026-09-23 expired exactly 10:00 after capture).
 * The PC clock offset at test time is not recorded, so absolute positions are reported with the
 * offset range that physics allows; spreads and orderings within a run are offset free.
 */
export function commitEvidence(samples: readonly CheckoutSample[]): CommitRunEvidence[] {
  const byRun = new Map<string, CheckoutSample[]>();
  for (const sample of samples) if (sample.commitServerMs !== null && sample.responseAtPcMs !== null) byRun.set(sample.runId, [...(byRun.get(sample.runId) ?? []), sample]);
  return [...byRun.entries()].map(([runId, holds]) => {
    const perHold = holds.map(hold => ({ workerId: hold.workerId, durationMs: Math.round(hold.responseAtPcMs! - hold.sendAtPcMs),
      commitMinusSendPcMs: Math.round(hold.commitServerMs! - hold.sendAtPcMs), responseMinusCommitPcMs: Math.round(hold.responseAtPcMs! - hold.commitServerMs!) }));
    const spread = (values: number[]) => Math.round(Math.max(...values) - Math.min(...values));
    const commitRank = holds.map(hold => hold.commitServerMs!), responseRank = holds.map(hold => hold.responseAtPcMs!);
    return { runId, method: holds[0]!.method, holds: holds.length, simultaneous: spread(holds.map(hold => hold.sendAtPcMs)) <= 50,
      sendSpreadMs: spread(holds.map(hold => hold.sendAtPcMs)), commitSpreadMs: spread(commitRank), responseSpreadMs: spread(responseRank),
      commitVsResponseTau: kendallTau(commitRank, responseRank), perHold,
      pcOffsetFeasibleMs: { min: -Math.min(...perHold.map(hold => hold.responseMinusCommitPcMs)), max: Math.min(...perHold.map(hold => hold.commitMinusSendPcMs)) } };
  }).sort((a, b) => a.runId.localeCompare(b.runId));
}

// ---------------------------------------------------------------------------------------------
// Slot Watch observations (v1 serial polls and v2 overlapping reads)
// ---------------------------------------------------------------------------------------------
export interface ReadObservation {
  kind: 'availability' | 'bookings'; seq: number;
  /** Release-relative ms on the observer clock. */
  requestOffsetMs: number; responseOffsetMs: number | null; durationMs: number | null;
  outcome: 'ok' | 'failed' | 'aborted' | 'not-launched';
  published: boolean | null; open: number | null; taken: number | null; records: number | null;
  cache: string | null; matrix: string | null; cells: string[] | null;
}
export interface SlotWatchLog { version: number; releaseMs: number; observerOffsetMs: number | null; reads: ReadObservation[] }
export function parseSlotWatch(lines: Line[]): SlotWatchLog | null {
  const header = lines.find(line => line.type === 'header');
  if (!header) return null;
  const releaseMs = num(header.releaseMs) ?? epoch(header.releaseAt);
  if (releaseMs === undefined) return null;
  const clockLine = lines.filter(line => line.type === 'clock').at(-1);
  const observerOffsetMs = num(clockLine?.offsetMs) ?? num(header.clockOffsetMs) ?? null;
  const reads: ReadObservation[] = [];
  for (const line of lines) {
    if (line.type === 'availability' || line.type === 'bookings') {
      const counts = (line.counts ?? {}) as Record<string, unknown>;
      reads.push({ kind: line.type, seq: num(line.seq) ?? -1, requestOffsetMs: num(line.requestOffsetMs)!, responseOffsetMs: num(line.responseOffsetMs) ?? null,
        durationMs: num(line.durationMs) ?? null, outcome: (str(line.outcome) as ReadObservation['outcome']) ?? 'failed',
        published: typeof line.targetDatePresent === 'boolean' ? line.targetDatePresent : null, open: num(counts.OPEN) ?? null, taken: num(counts.TAKEN) ?? null,
        records: Array.isArray(line.cells) ? line.cells.length : null, cache: str((line.cache as Line | undefined)?.status) ?? null,
        matrix: str(line.matrix) ?? null, cells: Array.isArray(line.cells) ? line.cells.filter((cell): cell is string => typeof cell === 'string') : null });
    } else if (line.type === 'not-launched') {
      reads.push({ kind: 'availability', seq: -1, requestOffsetMs: num(line.scheduledOffsetMs) ?? NaN, responseOffsetMs: null, durationMs: null, outcome: 'not-launched',
        published: null, open: null, taken: null, records: null, cache: null, matrix: null, cells: null });
    } else if (line.type === 'poll') {
      // Version 1: one serial poll = one availability read (+ optional booking records).
      const requested = epoch(line.requestedAt), responded = epoch(line.respondedAt), counts = (line.counts ?? {}) as Record<string, unknown>;
      if (requested === undefined) continue;
      const ok = line.availability === 'ok';
      reads.push({ kind: 'availability', seq: num(line.seq) ?? -1, requestOffsetMs: requested - releaseMs, responseOffsetMs: responded === undefined ? null : responded - releaseMs,
        durationMs: num(line.latencyMs) ?? null, outcome: ok ? 'ok' : 'failed', published: ok ? (num(counts.UNKNOWN) ?? 112) < 112 : null,
        open: ok ? num(counts.OPEN) ?? null : null, taken: ok ? num(counts.TAKEN) ?? null : null, records: num((line.bookingRecords as Line | undefined)?.records) ?? null,
        cache: null, matrix: str(line.matrix) ?? null, cells: null });
    }
  }
  return { version: num(header.version) ?? 1, releaseMs, observerOffsetMs, reads };
}

/**
 * Cells that were taken and then reopened around +10 min, from complete availability reads in request order.
 * Onda's pending hold expires 10 min after the checkout that created it (hold_expires_at − 10 min = commit, FACT
 * from verified holds). A reopening therefore bounds the creation of the hold that blocked the cell:
 *   reopen ≥ hold_expires_at  ⇒  commit ≤ reopen − 10 min  ≤ (first open read's response) − 10 min.
 * If holds reopen exactly at hold_expires_at (lazy expiry) the commit also lies after (last taken read's request) − 10 min.
 * A cancellation would look the same (INFERENCE, not FACT).
 */
export interface HoldReopening {
  court: number; hour: string;
  lastTakenRead: { seq: number; requestOffsetMs: number; responseOffsetMs: number };
  firstOpenRead: { seq: number; requestOffsetMs: number; responseOffsetMs: number };
  reopenWindowMs: [number, number];
  commitNoLaterThanMs: number;
  commitWindowIfExactExpiryMs: [number, number];
  retakenBy: { seq: number; requestOffsetMs: number; responseOffsetMs: number } | null;
}
type MatrixRead = { seq: number; requestOffsetMs: number; responseOffsetMs: number | null; matrix?: string | null };
const cellCodes = (matrix: string) => {
  const codes = new Map<string, string>();
  for (const row of matrix.split(',')) {
    const [court, states] = row.split(':');
    if (!court || !states) continue;
    [...states].forEach((code, index) => codes.set(`${court}/${String(8 + index).padStart(2, '0')}:00`, code));
  }
  return codes;
};
export function holdReopenings(reads: readonly MatrixRead[], windowMs: [number, number] = [HOLD_DURATION_MS - 300_000, HOLD_DURATION_MS + 300_000]): HoldReopening[] {
  const complete = reads.filter(read => read.matrix && !/[?U]/.test(read.matrix) && read.responseOffsetMs !== null && Number.isFinite(read.responseOffsetMs)
    && read.requestOffsetMs >= windowMs[0] && read.requestOffsetMs <= windowMs[1]).sort((a, b) => a.requestOffsetMs - b.requestOffsetMs || a.seq - b.seq);
  const brief = (read: MatrixRead) => ({ seq: read.seq, requestOffsetMs: read.requestOffsetMs, responseOffsetMs: read.responseOffsetMs! });
  const result: HoldReopening[] = [];
  const decoded = complete.map(read => cellCodes(read.matrix!));
  for (let index = 1; index < complete.length; index++) {
    for (const [cell, code] of decoded[index]!) {
      if (code !== 'O' || decoded[index - 1]!.get(cell) !== 'X') continue;
      const before = complete[index - 1]!, after = complete[index]!;
      const retaken = complete.slice(index + 1).find((_, offset) => decoded[index + 1 + offset]!.get(cell) === 'X');
      const [court, hour] = cell.split('/');
      result.push({ court: Number(court), hour: hour!, lastTakenRead: brief(before), firstOpenRead: brief(after),
        reopenWindowMs: [before.requestOffsetMs, after.responseOffsetMs!], commitNoLaterThanMs: after.responseOffsetMs! - HOLD_DURATION_MS,
        commitWindowIfExactExpiryMs: [before.requestOffsetMs - HOLD_DURATION_MS, after.responseOffsetMs! - HOLD_DURATION_MS], retakenBy: retaken ? brief(retaken) : null });
    }
  }
  return result;
}

/**
 * Reads that were PROVABLY STALE: they reported fewer taken cells than a read that had already COMPLETED before
 * they were even sent. Taken cells only return through cancellation or hold expiry (10 min), so in the first
 * minutes a lower count means the read was served from an older view of the data (e.g. a lagging replica or a
 * cache). FACT: the counts and times; INFERENCE: "older view" (a burst of cancellations would also lower counts).
 */
export interface StaleReadEvidence {
  reads: number; provablyStale: number;
  byDuration: { fastUnder500ms: { reads: number; stale: number }; slowOver2s: { reads: number; stale: number } };
  examples: Array<{ requestOffsetMs: number; responseOffsetMs: number; durationMs: number; taken: number; alreadySeenTaken: number; seenBy: { requestOffsetMs: number; responseOffsetMs: number } }>;
}
export function staleReadEvidence(log: SlotWatchLog, windowMs: [number, number] = [0, 120_000]): StaleReadEvidence {
  const reads = log.reads.filter(read => read.kind === 'availability' && read.outcome === 'ok' && read.published && read.taken !== null && read.responseOffsetMs !== null
    && read.requestOffsetMs >= windowMs[0] && read.requestOffsetMs < windowMs[1]);
  const examples: StaleReadEvidence['examples'] = [];
  let fast = 0, fastStale = 0, slow = 0, slowStale = 0;
  for (const read of reads) {
    const duration = read.responseOffsetMs! - read.requestOffsetMs;
    const earlier = reads.filter(other => other.responseOffsetMs! <= read.requestOffsetMs).sort((a, b) => b.taken! - a.taken! || a.responseOffsetMs! - b.responseOffsetMs!)[0];
    const stale = earlier !== undefined && read.taken! < earlier.taken!;
    if (duration < 500) { fast++; if (stale) fastStale++; }
    if (duration >= 2_000) { slow++; if (stale) slowStale++; }
    if (stale) examples.push({ requestOffsetMs: read.requestOffsetMs, responseOffsetMs: read.responseOffsetMs!, durationMs: duration, taken: read.taken!,
      alreadySeenTaken: earlier.taken!, seenBy: { requestOffsetMs: earlier.requestOffsetMs, responseOffsetMs: earlier.responseOffsetMs! } });
  }
  return { reads: reads.length, provablyStale: examples.length, byDuration: { fastUnder500ms: { reads: fast, stale: fastStale }, slowOver2s: { reads: slow, stale: slowStale } }, examples };
}

export interface CongestionEvidence {
  releaseMs: number; source: string;
  /** Reads requested in [0, 120 s) after release: request offset, duration, outcome. */
  reads: Array<{ requestOffsetMs: number; responseOffsetMs: number | null; durationMs: number | null; outcome: string; published: boolean | null }>;
  /** Response offset of the last read requested within 120 s that took ≥ 2 s (or failed after ≥ 2 s). */
  lastSlowReadResponseMs: number | null;
  /** First read requested after release that answered in < 500 ms with the date published. */
  firstFastPublishedRead: { requestOffsetMs: number; durationMs: number } | null;
  /** Groups of ≥ 3 read completions within 150 ms of each other whose requests span ≥ 3 s ("stall then flush"). */
  flushes: Array<{ startMs: number; endMs: number; reads: number; requestSpanMs: number }>;
}
export function congestionEvidence(log: SlotWatchLog, source: string): CongestionEvidence {
  const window = log.reads.filter(read => read.kind === 'availability' && read.outcome !== 'not-launched' && read.requestOffsetMs >= 0 && read.requestOffsetMs < 120_000)
    .sort((a, b) => a.requestOffsetMs - b.requestOffsetMs);
  const slow = window.filter(read => (read.durationMs ?? 0) >= 2_000);
  const fast = window.find(read => read.outcome === 'ok' && read.published && (read.durationMs ?? Infinity) < 500);
  const completions = window.filter(read => read.responseOffsetMs !== null).map(read => ({ id: String(read.requestOffsetMs), at: read.responseOffsetMs! }));
  const flushes = clusters(completions, 150).filter(group => group.ids.length >= 3).map(group => {
    const requests = group.ids.map(Number);
    return { startMs: tenth(group.start), endMs: tenth(group.end), reads: group.ids.length, requestSpanMs: tenth(Math.max(...requests) - Math.min(...requests)) };
  }).filter(group => group.requestSpanMs >= 3_000);
  return { releaseMs: log.releaseMs, source,
    reads: window.map(read => ({ requestOffsetMs: tenth(read.requestOffsetMs), responseOffsetMs: read.responseOffsetMs === null ? null : tenth(read.responseOffsetMs),
      durationMs: read.durationMs, outcome: read.outcome, published: read.published })),
    lastSlowReadResponseMs: slow.length ? tenth(Math.max(...slow.map(read => read.responseOffsetMs ?? read.requestOffsetMs + (read.durationMs ?? 0)))) : null,
    firstFastPublishedRead: fast ? { requestOffsetMs: tenth(fast.requestOffsetMs), durationMs: fast.durationMs! } : null, flushes };
}

// ---------------------------------------------------------------------------------------------
// Release-day checkout attempts
// ---------------------------------------------------------------------------------------------
export interface ReleaseAttempt {
  workerId: string; court: number | null; startTime: string | null;
  /** Send offset on the dispatch clock (Playwright request event), when recorded. */
  sendOffsetMs: number | null; sendProvenance: Provenance;
  responseOffsetMs: number | null; networkDurationMs: number | null; statusCode: number | null; errorHint: string | null;
}
/**
 * Proofless release attempts from a live runner trace. The runner's network duration starts when the
 * transport's post() begins, i.e. at the CHECKOUT_PRE_POST mark, so response = pre-POST + duration.
 */
export function releaseAttempts(trace: RunTrace): ReleaseAttempt[] {
  const attempts: ReleaseAttempt[] = [];
  for (const post of trace.lines.filter(line => line.stage === 'CHECKOUT_HTTP_POST_INITIATED')) {
    const workerId = str(post.workerId)!;
    const done = trace.lines.find(line => line.stage === 'CHECKOUT_RESPONSE_COMPLETED' && line.workerId === workerId);
    const prePost = trace.lines.find(line => line.stage === 'CHECKOUT_PRE_POST' && line.workerId === workerId);
    const target = trace.lines.find(line => (line.stage === 'DIAGNOSTIC_ATTEMPT_ARMED' || line.stage === 'DIAGNOSTIC_ATTEMPT_STARTED') && line.workerId === workerId);
    const send = num(post.releaseLatenessMs) ?? null, network = num(done?.networkDurationMs) ?? null;
    const start = num(prePost?.releaseLatenessMs) ?? send;
    attempts.push({ workerId, court: num(target?.court) ?? null, startTime: str(target?.startTime) ?? null, sendOffsetMs: send, sendProvenance: send === null ? 'UNKNOWN' : 'FACT',
      responseOffsetMs: start !== null && network !== null ? tenth(start + network) : null, networkDurationMs: network,
      statusCode: num(done?.statusCode) ?? null, errorHint: str(done?.errorHint) ?? null });
  }
  return attempts.sort((a, b) => (a.sendOffsetMs ?? Infinity) - (b.sendOffsetMs ?? Infinity) || a.workerId.localeCompare(b.workerId));
}
export function orderingEvidence(attempts: readonly ReleaseAttempt[]) {
  const complete = attempts.filter(attempt => attempt.sendOffsetMs !== null && attempt.responseOffsetMs !== null);
  const byResponse = [...complete].sort((a, b) => a.responseOffsetMs! - b.responseOffsetMs!);
  const gaps = byResponse.slice(1).map((attempt, index) => tenth(attempt.responseOffsetMs! - byResponse[index]!.responseOffsetMs!));
  return { sendOrder: complete.map(attempt => attempt.workerId), responseOrder: byResponse.map(attempt => attempt.workerId),
    sendVsResponseTau: kendallTau(complete.map(attempt => attempt.sendOffsetMs!), complete.map(attempt => attempt.responseOffsetMs!)),
    responseGapsMs: gaps, firstResponseMs: byResponse[0]?.responseOffsetMs ?? null, lastResponseMs: byResponse.at(-1)?.responseOffsetMs ?? null };
}

// ---------------------------------------------------------------------------------------------
// Provider trace (x-vercel-id, browser timing, body sizes)
// ---------------------------------------------------------------------------------------------
export interface ProviderEvidence {
  workerId: string; status: number | null; encodedBytes: number | null; sizeClass: 'SMALL_~220B' | 'LARGE_~400B' | 'OTHER' | null;
  vercelId: string | null; edgeRegion: string | null; functionRegion: string | null;
  /** UNDOCUMENTED number embedded in x-vercel-id, relative to release (INFERENCE if read as edge receipt). */
  embeddedOffsetMs: number | null;
  /** Upper bound on Chrome's network request start on the dispatch clock: min(request event, headers event − browser headers offset). */
  browserRequestStartUpperBoundMs: number | null;
  sendMs: number | null; waitMs: number | null; headersNodeMs: number | null; protocol: string | null; reused: boolean | null;
}
export function providerEvidence(lines: Line[], releaseMs: number, requestEventMs: ReadonlyMap<string, number>): ProviderEvidence[] {
  return lines.filter(line => line.type === 'provider-trace').map(line => {
    const workerId = str(line.workerId)!, response = (line.response ?? {}) as Line, browser = (line.browser ?? {}) as Line;
    const nodeObserved = (line.nodeObserved ?? {}) as Line, connection = (line.connection ?? {}) as Line;
    const bytes = num(response.encodedBytes) ?? null, vercelId = str(response.vercelId) ?? null, parsed = parseVercelId(vercelId);
    const headersNode = num(nodeObserved.headersOffsetMs), headersBrowser = num(browser.headersStartMs), requestEvent = requestEventMs.get(workerId);
    const bounds = [requestEvent, headersNode !== undefined && headersBrowser !== undefined ? headersNode - headersBrowser : undefined].filter((value): value is number => value !== undefined);
    return { workerId, status: num(response.status) ?? null, encodedBytes: bytes,
      sizeClass: bytes === null ? null : bytes >= 180 && bytes <= 260 ? 'SMALL_~220B' as const : bytes >= 350 && bytes <= 450 ? 'LARGE_~400B' as const : 'OTHER' as const,
      vercelId, edgeRegion: parsed?.edgeRegion ?? null, functionRegion: parsed?.functionRegion ?? null,
      embeddedOffsetMs: parsed?.embeddedMs !== null && parsed?.embeddedMs !== undefined ? parsed.embeddedMs - releaseMs : null,
      browserRequestStartUpperBoundMs: bounds.length ? tenth(Math.min(...bounds)) : null,
      sendMs: num(browser.sendMs) ?? null, waitMs: num(browser.waitMs) ?? null, headersNodeMs: headersNode ?? null,
      protocol: str(connection.protocol) ?? null, reused: typeof connection.reused === 'boolean' ? connection.reused : null };
  }).sort((a, b) => a.workerId.localeCompare(b.workerId));
}

/** Clock-offset free check of the x-vercel-id number against our own send times. */
export function vercelIdConsistency(evidence: readonly ProviderEvidence[], requestEventMs: ReadonlyMap<string, number>) {
  const rows = evidence.filter(item => item.embeddedOffsetMs !== null && requestEventMs.has(item.workerId))
    .map(item => ({ workerId: item.workerId, requestEventMs: requestEventMs.get(item.workerId)!, embeddedOffsetMs: item.embeddedOffsetMs!,
      embeddedMinusRequestEventMs: tenth(item.embeddedOffsetMs! - requestEventMs.get(item.workerId)!),
      embeddedMinusResponseMs: item.headersNodeMs === null ? null : tenth(item.embeddedOffsetMs! - item.headersNodeMs) }));
  const lags = rows.map(row => row.embeddedMinusRequestEventMs);
  return { rows, lagSummary: summarize(lags, 1),
    embeddedSpreadMs: rows.length ? tenth(Math.max(...rows.map(row => row.embeddedOffsetMs)) - Math.min(...rows.map(row => row.embeddedOffsetMs))) : null,
    requestEventSpreadMs: rows.length ? tenth(Math.max(...rows.map(row => row.requestEventMs)) - Math.min(...rows.map(row => row.requestEventMs))) : null,
    orderTau: kendallTau(rows.map(row => row.requestEventMs), rows.map(row => row.embeddedOffsetMs)),
    closerToSendThanResponse: rows.every(row => row.embeddedMinusResponseMs === null || Math.abs(row.embeddedMinusRequestEventMs) < Math.abs(row.embeddedMinusResponseMs)) };
}
