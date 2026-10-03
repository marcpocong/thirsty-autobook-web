import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MATRIX_HOURS } from './api-booking/court-hour-matrix.js';
import type { ProviderTraceRecord, ProviderResponseFallback } from './api-booking/checkout-provider-trace.js';
import { decodeMatrix, deriveSlotEvidence, describeRead, RANGE_STATE_LABEL, relativeSeconds, targetEvidence, type AvailabilityObservation,
  type BookingObservation, type EvidenceState, type ObservationRef, type PublicationEvidence, type TargetEvidence } from './slot-evidence.js';

/**
 * Post-run release forensics. Built from files only, after the runner has exited:
 * the runner trace (.local/api-booking/run-progress/<runId>.ndjson), the Slot Watch
 * log (.local/slot-watch/*.ndjson) and the passive provider trace
 * (.local/release-forensics/<runId>/provider-trace.ndjson). Raw evidence is referenced,
 * not copied. Output: summary.json and report.txt next to the provider trace.
 *
 * Evidence and interpretation are kept apart: the report states what each source
 * recorded and when, and never who or what made a court unavailable.
 */
type Line = Record<string, unknown>;
const str = (value: unknown) => typeof value === 'string' ? value : undefined;
const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const tenth = (value: number) => Math.round(value * 10) / 10;
function readLines(path: string): Line[] {
  return readFileSync(path, 'utf8').split('\n').flatMap(line => {
    if (!line.trim()) return [];
    try { const value = JSON.parse(line) as unknown; return value && typeof value === 'object' && !Array.isArray(value) ? [value as Line] : []; } catch { return []; }
  });
}
const endOf = (startTime: string, hours: number) => `${String(Number(startTime.slice(0, 2)) + hours).padStart(2, '0')}:00`;

export interface ObserverLog {
  version: 1 | 2 | 3; path: string; releaseMs: number; date: string;
  availability: AvailabilityObservation[]; bookings: BookingObservation[];
  /** False for version-1 logs, which did not itemize public records per read. */
  bookingsItemized: boolean;
  clockOffsetAtReleaseMs: number | null;
  notLaunched: number; maxInFlight: number | null; earlyOffsetsMs: number[];
}

/** Reads a Slot Watch NDJSON log. Version-1 logs (before Phase 2) are converted for availability only. */
export function readObserverLog(path: string): ObserverLog | undefined {
  const lines = readLines(path), header = lines.find(line => line.type === 'header');
  if (!header || typeof header.date !== 'string') return undefined;
  // Version 3 (bounded-cache evidence, 2026-09-29) keeps the version-2 line shapes and only adds fields.
  if (header.version === 2 || header.version === 3) {
    const releaseMs = num(header.releaseMs)!;
    const clock = lines.filter(line => line.type === 'clock' && Date.parse(String(line.at)) <= releaseMs).at(-1);
    const schedule = header.schedule as { availability?: number[]; maxInFlight?: number } | undefined;
    return { version: header.version as 2 | 3, path, releaseMs, date: header.date,
      availability: lines.filter(line => line.type === 'availability').map(line => line as unknown as AvailabilityObservation),
      bookings: lines.filter(line => line.type === 'bookings').map(line => line as unknown as BookingObservation), bookingsItemized: true,
      clockOffsetAtReleaseMs: num(clock?.offsetMs) ?? num(header.clockOffsetMs) ?? null,
      notLaunched: lines.filter(line => line.type === 'not-launched' && line.kind === 'availability').length,
      maxInFlight: num(schedule?.maxInFlight) ?? null, earlyOffsetsMs: (schedule?.availability ?? []).filter(offset => offset >= 0 && offset < 6_000) };
  }
  if (header.version === 1) {
    const releaseMs = Date.parse(String(header.releaseAt));
    if (!Number.isFinite(releaseMs)) return undefined;
    const availability = lines.filter(line => line.type === 'poll').map((line): AvailabilityObservation => ({
      seq: num(line.seq) ?? 0, scheduledOffsetMs: NaN, requestOffsetMs: Date.parse(String(line.requestedAt)) - releaseMs,
      responseOffsetMs: Date.parse(String(line.respondedAt)) - releaseMs, outcome: line.availability === 'ok' ? 'ok' : 'failed',
      ...(str(line.code) ? { code: str(line.code)! } : {}), targetDatePresent: line.dateReleased === true, ...(str(line.matrix) ? { matrix: str(line.matrix)! } : {}) }));
    return { version: 1, path, releaseMs, date: header.date, availability, bookings: [], bookingsItemized: false,
      clockOffsetAtReleaseMs: null, notLaunched: 0, maxInFlight: 1, earlyOffsetsMs: [] };
  }
  return undefined;
}

/** The Slot Watch log for this release: the one with the most answered reads (earlier watches may have been replaced). */
export function findObserverLog(directory: string, date: string, releaseMs: number): string | undefined {
  if (!existsSync(directory)) return undefined;
  const candidates = readdirSync(directory).filter(name => name.startsWith(`${date}_`) && name.endsWith('.ndjson')).flatMap(name => {
    const path = join(directory, name);
    try { const log = readObserverLog(path); return log && log.releaseMs === releaseMs ? [{ path, reads: log.availability.length, size: statSync(path).size }] : []; }
    catch { return []; }
  });
  return candidates.sort((a, b) => b.reads - a.reads || b.size - a.size)[0]?.path;
}

export interface ForensicTarget {
  workerId: string; attemptId: string | null; court: number; startTime: string; endTime: string;
  finalState: string | null; finalCode: string | null;
  post: { offsetMs: number | null; source: 'run-trace' | null };
  response: { statusCode: number | null; errorHint: string | null; responseSource: string | null; completedOffsetMs: number | null; networkDurationMs: number | null };
  grid: TargetEvidence | null;
  provider: null | {
    complete: boolean; protocol: string | null; reused: boolean | null;
    headersOffsetMs: number | null; bodyOffsetMs: number | null; timingSource: 'browser' | 'node-observed' | null;
    dnsMs: number | null; connectMs: number | null; tlsMs: number | null; sendMs: number | null; waitMs: number | null;
    server: string | null; cfRay: string | null; cfMitigated: string | null; vercelId: string | null; requestId: string | null;
    vercelCache: string | null; ageS: number | null; serverTiming: ProviderTraceRecord['response']['serverTiming']; failure: ProviderTraceRecord['failure'];
  };
}
export interface ClockRound { checkpoint: string; offsetMs: number; roundTripMs?: number; sampleCount?: number; spreadMs?: number; uncertaintyMs?: number; deltaMs?: number; adopted: boolean; code?: string }
export interface ReleaseForensicsSummary {
  version: 1; runId: string; mode: string; date: string; reference: 'release' | 'first-post'; referenceMs: number | null;
  status: 'preliminary' | 'final'; generatedAt: string;
  sources: { runProgress: string; observer: string | null; observerVersion: 1 | 2 | 3 | null; providerTrace: string | null };
  clock: { rounds: ClockRound[]; dispatchOffsetMs: number | null; observerOffsetMs: number | null; observerMinusDispatchMs: number | null };
  dispatch: { posts: number; firstPostOffsetMs: number | null; lastPostOffsetMs: number | null; spreadMs: number | null };
  outcome: string | null;
  observer: null | {
    publication: PublicationEvidence; firstPublishedMatrix: string | null; firstPublishedCounts: Record<EvidenceState, number> | null;
    reads: { launched: number; answered: number; failed: number; notLaunched: number; maxInFlight: number | null; earlyOffsetsMs: number[] };
    bookingReads: { answered: number; failed: number; failedCourtQueries: number; itemized: boolean };
    openToUnavailable: number; reopened: number; unavailableWithoutRecordAtFirstPublication: number | null;
  };
  trace: { available: boolean; records: number; complete: number; unavailableWorkers: string[] };
  phase3?:{fingerprint:string|null;candidateCount:number;maxWave2:number;maxRescue:number;maxTotal:number;
    attempts:Array<{attemptId:string;candidateId:string;workerId:string;wave:string;court:number|null;startTime:string|null;endTime:string|null;
      evidenceSeq:number|null;selectedEvidenceSeq:number|null;postOffsetMs:number|null;state:string|null;statusCode:number|null;providerTrace:boolean;
      fallback:ProviderResponseFallback|null}>};
  targets: ForensicTarget[];
  limitations: string[];
  reportPath: string; summaryPath: string;
}
/** Small copy for the desktop Runs view. */
export interface ReleaseForensicsDigest {
  runId: string; date: string; reference: 'release' | 'first-post'; referenceMs: number | null; status: 'preliminary' | 'final'; generatedAt: string;
  firstPostOffsetMs: number | null; lastPostOffsetMs: number | null;
  firstPublished: ObservationRef | null; traceAvailable: boolean; outcome: string | null;
  targets: Array<{ workerId: string; court: number; startTime: string; endTime: string; postOffsetMs: number | null; firstPublishedState: string | null;
    statusCode: number | null; errorHint: string | null; finalState: string | null; headersOffsetMs: number | null; bodyOffsetMs: number | null; protocol: string | null; reused: boolean | null }>;
  reportPath: string;
}

export interface ForensicInputs {
  runProgressPath: string; observerLogPath?: string; providerTracePath?: string; outputDirectory: string;
  status: 'preliminary' | 'final'; now?: () => number;
}

/** Builds and writes summary.json and report.txt. Only file reads and two small writes. */
export function buildReleaseForensics(input: ForensicInputs): ReleaseForensicsSummary {
  const lines = readLines(input.runProgressPath);
  const first = lines[0] ?? {}, runId = str(first.runId) ?? 'unknown', mode = str(first.mode) ?? 'unknown', date = str(first.targetDate) ?? 'unknown';
  const stages = (name: string) => lines.filter(line => line.stage === name);
  const releaseMs = num(stages('PRECISION_RACE_CONFIGURED')[0]?.releaseMs) ?? num(stages('RUN_CONFIGURATION')[0]?.releaseMs) ?? null;
  const observer = input.observerLogPath && existsSync(input.observerLogPath) ? readObserverLog(input.observerLogPath) : undefined;
  const traceLines = input.providerTracePath && existsSync(input.providerTracePath) ? readLines(input.providerTracePath) : [];
  const traceHeader = traceLines.find(line => line.type === 'header');
  const traces = traceLines.filter(line => line.type === 'provider-trace') as unknown as ProviderTraceRecord[];
  const fallbacks = traceLines.filter(line => line.type === 'response-fallback') as unknown as ProviderResponseFallback[];
  // A release is timed from its instant (trusted clock). An immediate test has none: its offsets are PC-clock
  // intervals from the first POST's request event, all taken by the same clock.
  const reference: 'release' | 'first-post' = releaseMs !== null ? 'release' : 'first-post';
  const postTimes = stages('CHECKOUT_HTTP_POST_INITIATED').map(line => Date.parse(String(line.eventAt ?? line.at))).filter(Number.isFinite);
  const referenceMs = releaseMs ?? (postTimes.length ? Math.min(...postTimes) : null);

  // Clock evidence: T-10M refresh, then the Phase 1 T-60S/T-30S consensus rounds.
  const rounds: ClockRound[] = lines.filter(line => ['NETWORK_CLOCK_REFRESHED', 'NETWORK_CLOCK_CONSENSUS', 'NETWORK_CLOCK_CONSENSUS_REJECTED'].includes(String(line.stage)))
    .flatMap(line => num(line.offsetMs) === undefined && line.stage !== 'NETWORK_CLOCK_CONSENSUS_REJECTED' ? [] : [{ checkpoint: str(line.checkpoint) ?? '?', offsetMs: num(line.offsetMs) ?? NaN,
      ...(num(line.roundTripMs) !== undefined ? { roundTripMs: num(line.roundTripMs)! } : {}), ...(num(line.sampleCount) !== undefined ? { sampleCount: num(line.sampleCount)! } : {}),
      ...(num(line.spreadMs) !== undefined ? { spreadMs: num(line.spreadMs)! } : {}), ...(num(line.uncertaintyMs) !== undefined ? { uncertaintyMs: num(line.uncertaintyMs)! } : {}),
      ...(num(line.deltaMs) !== undefined ? { deltaMs: num(line.deltaMs)! } : {}),
      adopted: line.stage !== 'NETWORK_CLOCK_CONSENSUS_REJECTED' && line.code !== 'CLOCK_JUMP_REJECTED', ...(str(line.code) ? { code: str(line.code)! } : {}) }]);
  const dispatchOffsetMs = rounds.filter(round => round.adopted && Number.isFinite(round.offsetMs)).at(-1)?.offsetMs ?? null;
  const observerOffsetMs = observer?.clockOffsetAtReleaseMs ?? null;

  // Targets: Precision rows when present, otherwise the attempts the run started.
  const precision = stages('PRECISION_TARGET');
  const attemptLines = [...stages('DIAGNOSTIC_ATTEMPT_ARMED'), ...stages('DIAGNOSTIC_ATTEMPT_STARTED')];
  const rows = precision.length ? precision.map(line => ({ workerId: String(line.workerId), court: num(line.court)!, startTime: String(line.startTime), endTime: String(line.endTime) }))
    : [...new Map(attemptLines.filter(line => num(line.court) !== undefined && str(line.startTime) && num(line.durationHours) !== undefined)
      .map(line => [String(line.workerId), { workerId: String(line.workerId), court: num(line.court)!, startTime: String(line.startTime), endTime: endOf(String(line.startTime), num(line.durationHours)!) }])).values()];
  const lastState = (worker: string) => stages('PRECISION_ATTEMPT_STATE').filter(line => line.workerId === worker).at(-1)
    ?? stages('PRIMARY_PROOFLESS_OUTCOME').filter(line => line.workerId === worker).at(-1);
  const byWorker = (name: string, worker: string) => stages(name).filter(line => line.workerId === worker).at(-1);
  const targets: ForensicTarget[] = rows.map(row => {
    const state = lastState(row.workerId), posted = byWorker('CHECKOUT_HTTP_POST_INITIATED', row.workerId), answered = byWorker('CHECKOUT_RESPONSE_COMPLETED', row.workerId);
    const attemptId = str(posted?.attemptId) ?? str(attemptLines.filter(line => line.workerId === row.workerId).at(-1)?.attemptId) ?? null;
    const trace = traces.find(value => value.workerId === row.workerId);
    // POST offset: the run trace's request event (trusted release clock; for an immediate test, PC-clock interval from the first POST).
    const postAtMs = Date.parse(String(posted?.eventAt ?? posted?.at));
    const runOffset = reference === 'release' ? num(posted?.releaseLatenessMs) : posted && referenceMs !== null && Number.isFinite(postAtMs) ? tenth(postAtMs - referenceMs) : undefined;
    const postOffset = runOffset ?? null;
    // Response time = POST offset + PC-clock time between the two run-trace events (both stamped by the same clock).
    const postAt = Date.parse(String(posted?.eventAt ?? posted?.at)), answerAt = Date.parse(String(answered?.eventAt ?? answered?.at));
    const completedOffsetMs = postOffset !== null && Number.isFinite(postAt) && Number.isFinite(answerAt) ? tenth(postOffset + answerAt - postAt) : null;
    let provider: ForensicTarget['provider'] = null;
    if (trace) {
      // Header/body times: the POST instant plus Chrome's own intervals from its network request start.
      const browser = trace.browser, anchor = postOffset, nodeTimes = reference === 'release';
      const headersDelta = browser.headersStartMs ?? browser.headersEndMs, bodyDelta = browser.bodyCompleteMs ?? browser.failedMs;
      const viaBrowser = anchor !== null && headersDelta !== null;
      provider = { complete: trace.complete, protocol: trace.connection.protocol, reused: trace.connection.reused,
        headersOffsetMs: viaBrowser ? tenth(anchor! + headersDelta!) : nodeTimes ? trace.nodeObserved.headersOffsetMs : null,
        bodyOffsetMs: anchor !== null && bodyDelta !== null ? tenth(anchor + bodyDelta) : nodeTimes ? trace.nodeObserved.finishedOffsetMs : null,
        timingSource: viaBrowser ? 'browser' : nodeTimes && trace.nodeObserved.headersOffsetMs !== null ? 'node-observed' : null,
        dnsMs: browser.dnsMs, connectMs: browser.connectMs, tlsMs: browser.tlsMs, sendMs: browser.sendMs, waitMs: browser.waitMs,
        server: trace.response.server, cfRay: trace.response.cfRay, cfMitigated: trace.response.cfMitigated, vercelId: trace.response.vercelId,
        requestId: trace.response.requestId, vercelCache: trace.response.vercelCache, ageS: trace.response.ageS, serverTiming: trace.response.serverTiming, failure: trace.failure };
    }
    return { ...row, attemptId, finalState: str(state?.attemptState) ?? str(state?.status) ?? null, finalCode: str(state?.code) ?? null,
      post: { offsetMs: postOffset, source: runOffset !== undefined ? 'run-trace' : null },
      response: { statusCode: num(answered?.statusCode) ?? trace?.response.status ?? null, errorHint: str(answered?.errorHint) ?? null,
        responseSource: str(answered?.responseSource) ?? null, completedOffsetMs, networkDurationMs: num(answered?.networkDurationMs) ?? null },
      grid: observer ? targetEvidence(observer.availability, observer.bookings, row) : null, provider };
  });
  const p3Header=stages('PHASE3_AUTHORIZATION')[0];
  const p3Candidates=new Map(stages('PHASE3_CANDIDATE').map(line=>[str(line.candidateId),line]));
  const p3Starts=[...stages('PHASE3_WAVE1_STARTED'),...stages('PHASE3_ATTEMPT_RESERVED')];
  const phase3=p3Header?{fingerprint:str(p3Header.fingerprint)??null,candidateCount:num(p3Header.candidateCount)??0,
    maxWave2:num(p3Header.maxWave2)??0,maxRescue:num(p3Header.maxRescue)??0,maxTotal:num(p3Header.maxTotal)??0,
    attempts:p3Starts.flatMap(line=>{
      const attemptId=str(line.attemptId),candidateId=str(line.candidateId),workerId=str(line.workerId),wave=str(line.wave);
      if(!attemptId||!candidateId||!workerId||!wave)return [];
      const candidate=p3Candidates.get(candidateId),posted=stages('CHECKOUT_HTTP_POST_INITIATED').find(value=>value.attemptId===attemptId),
        settled=stages('PHASE3_SETTLED').find(value=>value.attemptId===attemptId),answered=stages('CHECKOUT_RESPONSE_COMPLETED').find(value=>value.attemptId===attemptId),
        verifiedHold=stages('DIAGNOSTIC_VERIFIED_HOLD').some(value=>value.attemptId===attemptId),
        qrHandoff=verifiedHold&&stages('DIAGNOSTIC_QR_HANDOFF').some(value=>value.attemptId===attemptId),
        dispatched=stages('PHASE3_DISPATCH').find(value=>value.attemptId===attemptId);
      // The dispatch record carries the evidence that authorized the POST itself (it can be newer than the reservation's).
      const evidenceSeq=num(dispatched?.evidenceSeq)??num(line.evidenceSeq)??null,selectedEvidenceSeq=num(line.selectedEvidenceSeq)??null;
      return [{attemptId,candidateId,workerId,wave,court:num(candidate?.court)??null,startTime:str(candidate?.startTime)??null,
        endTime:str(candidate?.endTime)??null,evidenceSeq,selectedEvidenceSeq:selectedEvidenceSeq!==evidenceSeq?selectedEvidenceSeq:null,
        postOffsetMs:num(posted?.releaseLatenessMs)??null,state:qrHandoff?'VERIFIED_PENDING_HOLD_QR_HANDOFF':verifiedHold?'VERIFIED_PENDING_HOLD':str(settled?.state)??null,
        statusCode:num(answered?.statusCode)??null,providerTrace:traces.some(value=>value.attemptId===attemptId),
        fallback:fallbacks.find(value=>value.attemptId===attemptId)??null}];
    }).sort((a,b)=>(a.postOffsetMs??Infinity)-(b.postOffsetMs??Infinity))}:undefined;
  const posts = phase3?phase3.attempts.map(value=>value.postOffsetMs).filter((value):value is number=>value!==null):
    targets.map(target => target.post.offsetMs).filter((value): value is number => value !== null);
  const evidence = observer ? deriveSlotEvidence(observer.availability, observer.bookings) : undefined;
  const firstCounts = evidence?.firstPublishedMatrix ? (() => { const codes = [...decodeMatrix(evidence.firstPublishedMatrix).values()], open = codes.filter(code => code === 'O').length,
    unavailable = codes.filter(code => code === 'X').length; return { OPEN: open, UNAVAILABLE: unavailable, UNKNOWN: 112 - open - unavailable }; })() : null;
  const unavailableAtFirst = evidence?.cells.filter(cell => cell.firstPublished?.state === 'UNAVAILABLE') ?? [];
  const summaryPath = join(input.outputDirectory, 'summary.json'), reportPath = join(input.outputDirectory, 'report.txt');
  const traceStatuses = (traceHeader?.traces as Array<{ workerId: string; status: string; code?: string }> | undefined) ?? [];
  const summary: ReleaseForensicsSummary = {
    version: 1, runId, mode, date, reference, referenceMs, status: input.status, generatedAt: new Date((input.now ?? Date.now)()).toISOString(),
    sources: { runProgress: input.runProgressPath, observer: observer?.path ?? null, observerVersion: observer?.version ?? null, providerTrace: traceLines.length ? input.providerTracePath! : null },
    clock: { rounds, dispatchOffsetMs, observerOffsetMs, observerMinusDispatchMs: dispatchOffsetMs !== null && observerOffsetMs !== null ? tenth(observerOffsetMs - dispatchOffsetMs) : null },
    dispatch: { posts: posts.length, firstPostOffsetMs: posts.length ? Math.min(...posts) : null, lastPostOffsetMs: posts.length ? Math.max(...posts) : null,
      spreadMs: posts.length ? tenth(Math.max(...posts) - Math.min(...posts)) : null },
    outcome: str(stages('PHASE3_OUTCOME').at(-1)?.outcome) ?? str(stages('PRECISION_OUTCOME').at(-1)?.outcome) ?? str(stages('FAILED').at(-1)?.code) ?? null,
    observer: observer && evidence ? { publication: evidence.publication, firstPublishedMatrix: evidence.firstPublishedMatrix, firstPublishedCounts: firstCounts,
      reads: { launched: observer.availability.length + observer.notLaunched, answered: observer.availability.filter(value => value.outcome === 'ok').length,
        failed: observer.availability.filter(value => value.outcome === 'failed').length, notLaunched: observer.notLaunched, maxInFlight: observer.maxInFlight, earlyOffsetsMs: observer.earlyOffsetsMs },
      bookingReads: { answered: observer.bookings.filter(value => value.outcome === 'ok').length, failed: observer.bookings.filter(value => value.outcome === 'failed').length,
        failedCourtQueries: observer.bookings.reduce((sum, value) => sum + (value.outcome === 'ok' ? value.failedCourts.length : 0), 0), itemized: observer.bookingsItemized },
      openToUnavailable: evidence.cells.filter(cell => cell.openToUnavailable).length, reopened: evidence.cells.filter(cell => cell.unavailableToOpen).length,
      unavailableWithoutRecordAtFirstPublication: observer.bookingsItemized ? unavailableAtFirst.filter(cell => !cell.firstRecord).length : null } : null,
    trace: { available: traces.length > 0, records: traces.length, complete: traces.filter(value => value.complete).length,
      unavailableWorkers: traceStatuses.filter(value => value.status === 'unavailable').map(value => value.workerId) },
    ...(phase3?{phase3}:{}),
    targets, limitations: [], reportPath, summaryPath };
  summary.limitations = limitations(summary, observer);
  mkdirSync(input.outputDirectory, { recursive: true, mode: 0o700 });
  const write = (path: string, content: string) => { const temporary = `${path}.tmp`; writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 }); renameSync(temporary, path); };
  write(reportPath, releaseForensicsReport(summary));
  write(summaryPath, JSON.stringify(summary));
  return summary;
}

function limitations(summary: ReleaseForensicsSummary, observer: ObserverLog | undefined): string[] {
  const list = [
    'An availability read shows Onda\'s state at an unknown moment between its request start and its response. No source here gives the provider-side moment of a change.',
    'Unavailable without a matching public booking record: the cause is not visible in Onda\'s public data.',
    'A public booking record shows that a booking record exists. It does not show who made it, whether it belongs to this bot, or why.',
    'POST initiation is the Playwright request event in the runner (trusted release clock). Header and body times are that instant plus Chrome intervals from its network request start (under 1 ms after the request event); they carry the few-ms delivery lag of that event.',
    'The provider trace enables DevTools Network only after each POST has left, so it never adds work at the release instant; a response that arrives before it is enabled (tens of ms) is not traced.',
    'Response timing and headers describe what arrived at this PC. They do not establish how Onda queued or ordered requests, or why a request was accepted or rejected.',
  ];
  if (!observer) list.push('No Slot Watch log was found for this run: there is no grid evidence.');
  else if (observer.version === 1) list.push('The Slot Watch log is version 1 (before Phase 2): reads were serial, request/response times are network-corrected wall times, and public booking records were not itemized per read, so public-record evidence is not available here.');
  if (summary.clock.observerMinusDispatchMs !== null) list.push(`The observer and the dispatch clocks differ by ${summary.clock.observerMinusDispatchMs.toFixed(1)} ms (observer minus dispatch); comparisons between grid reads and POST times carry that difference.`);
  else if (observer) list.push('The observer clock offset at release is not recorded; grid-read offsets and POST offsets may differ by the change between the T-10 min and final clock rounds.');
  if (!summary.trace.available) list.push('No provider trace was captured for this run (none attached, attach failed, or the run predates Phase 2): response header and body timing are not separated.');
  if (summary.status === 'preliminary') list.push('PRELIMINARY: the Slot Watch was still running when this was generated; later reads may add changes and public records.');
  return list;
}

const ms = (value: number | null | undefined) => value === null || value === undefined ? '—' : relativeSeconds(value);
const dur = (value: number | null | undefined) => value === null || value === undefined ? '—' : `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })} ms`;
const bookingRead = (value: ObservationRef) => describeRead(value, '#b');

/** Plain-text report: evidence first, limitations last, no causal claims. */
export function releaseForensicsReport(summary: ReleaseForensicsSummary): string {
  const zero = summary.reference === 'release' ? 'the release instant' : 'the first POST request event (immediate test; PC-clock intervals)';
  const lines = [`RELEASE FORENSICS — run ${summary.runId} · target ${summary.date} · mode ${summary.mode}`,
    `Status: ${summary.status.toUpperCase()} · generated ${summary.generatedAt}`,
    `All offsets are relative to ${zero}${summary.referenceMs !== null ? ` (${new Date(summary.referenceMs).toISOString()})` : ''}.`, '',
    '1. RELEASE CLOCK'];
  if (!summary.clock.rounds.length) lines.push('  No clock rounds recorded in the run trace.');
  for (const round of summary.clock.rounds) lines.push(`  ${round.checkpoint.padEnd(6)} offset ${Number.isFinite(round.offsetMs) ? `${round.offsetMs >= 0 ? '+' : ''}${round.offsetMs.toFixed(1)} ms` : '—'}`
    + `${round.sampleCount !== undefined ? ` · ${round.sampleCount} samples` : ''}${round.roundTripMs !== undefined ? ` · RTT ${round.roundTripMs} ms` : ''}${round.spreadMs !== undefined ? ` · spread ${round.spreadMs} ms` : ''}`
    + `${round.uncertaintyMs !== undefined ? ` · ±${round.uncertaintyMs} ms` : ''} · ${round.adopted ? 'used' : `not used${round.code ? ` (${round.code})` : ''}`}`);
  lines.push(`  Observer (Slot Watch) offset at release: ${summary.clock.observerOffsetMs === null ? 'not recorded' : `${summary.clock.observerOffsetMs.toFixed(1)} ms`}`
    + `${summary.clock.observerMinusDispatchMs === null ? '' : ` · observer − dispatch ${summary.clock.observerMinusDispatchMs.toFixed(1)} ms`}`, '',
    '2. POST INITIATION (browser request event)');
  if (!summary.dispatch.posts) lines.push('  No checkout POST was initiated.');
  for (const target of [...summary.targets].filter(value => value.post.offsetMs !== null).sort((a, b) => a.post.offsetMs! - b.post.offsetMs!))
    lines.push(`  Worker ${target.workerId}  ${ms(target.post.offsetMs)}`);
  if (summary.dispatch.posts) lines.push(`  First ${ms(summary.dispatch.firstPostOffsetMs)} · last ${ms(summary.dispatch.lastPostOffsetMs)} · spread ${dur(summary.dispatch.spreadMs)}`);
  lines.push('', '3. FIRST PUBLISHED GRID (Slot Watch)');
  const o = summary.observer;
  if (!o) lines.push('  No Slot Watch evidence for this run.');
  else {
    lines.push(`  Reads: ${o.reads.launched} scheduled · ${o.reads.answered} answered · ${o.reads.failed} failed · ${o.reads.notLaunched} not launched · max in flight ${o.reads.maxInFlight ?? '?'}${o.reads.earlyOffsetsMs.length ? ` · early launches ${o.reads.earlyOffsetsMs.map(value => relativeSeconds(value)).join(', ')}` : ''}`);
    if (o.publication.lastUnpublished) lines.push(`  Last read without the date:  ${describeRead(o.publication.lastUnpublished)}`);
    if (!o.publication.firstPublished) lines.push('  The target date was not seen in any answered read.');
    else {
      const cache = o.publication.firstPublished.cache;
      lines.push(`  First read with the date:    ${describeRead(o.publication.firstPublished)}${cache ? ` · edge cache ${cache.status ?? '?'}${cache.ageS !== undefined ? `, age ${cache.ageS} s` : ''}` : ''}`);
      if (o.firstPublishedCounts) lines.push(`  Open ${o.firstPublishedCounts.OPEN} · unavailable ${o.firstPublishedCounts.UNAVAILABLE} · unknown ${o.firstPublishedCounts.UNKNOWN}`);
      lines.push(`         ${MATRIX_HOURS.map(hour => hour.slice(0, 2)).join(' ')}   (O open, X unavailable, ? unknown)`);
      for (const row of (o.firstPublishedMatrix ?? '').split(',').filter(Boolean)) { const [court, codes] = row.split(':'); lines.push(`    C${court}   ${[...codes!].map(code => ` ${code}`).join(' ')}`); }
    }
  }
  lines.push('', '4. TARGETS');
  if(summary.phase3){
    const p=summary.phase3;
    lines.push(`  Phase 3 race ${p.fingerprint??'unknown'} · ${p.candidateCount} authorized candidates · Wave 2 max ${p.maxWave2} · Rescue max ${p.maxRescue} · total max ${p.maxTotal}`);
    for(const attempt of p.attempts)lines.push(`  ${attempt.wave} · Worker ${attempt.workerId} · Court ${attempt.court??'?'} ${attempt.startTime??'?'}–${attempt.endTime??'?'} · candidate ${attempt.candidateId} · attempt ${attempt.attemptId}`,
      `    Observation #${attempt.evidenceSeq??'pre-release assignment'}${attempt.selectedEvidenceSeq!==null?` (selected on #${attempt.selectedEvidenceSeq})`:''} · POST ${ms(attempt.postOffsetMs)} · ${attempt.state??'unsettled'} · HTTP ${attempt.statusCode??'not recorded'}`,
      `    Passive trace ${attempt.providerTrace?'available':'unavailable'} · response fallback ${attempt.fallback?`HTTP ${attempt.fallback.status}, server ${attempt.fallback.server??'—'}, request ${attempt.fallback.requestId??'—'}`:'unavailable'}`);
    lines.push('');
  }
  if (!summary.targets.length) lines.push('  No targets in the run trace.');
  for (const target of summary.targets) {
    const g = target.grid, p = target.provider;
    lines.push(`  Worker ${target.workerId} · Court ${target.court} · ${target.startTime}–${target.endTime}${target.attemptId ? ` · ${target.attemptId}` : ''}`);
    lines.push(`    POST initiated:              ${target.post.offsetMs === null ? 'not sent' : ms(target.post.offsetMs)}`);
    if (!g) lines.push('    Grid evidence:               none (no Slot Watch log)');
    else if (!g.firstPublished) lines.push('    First published state:       not observed (date never seen in an answered read)');
    else {
      lines.push(`    First published state:       ${RANGE_STATE_LABEL[g.firstPublished.state]} (${g.firstPublished.hours.map(hour => `${hour.hour} ${hour.state === 'OPEN' ? 'open' : hour.state === 'UNAVAILABLE' ? 'unavailable' : 'unknown'}${hour.price !== null ? ` PHP ${hour.price}` : ''}`).join(', ')})`);
      lines.push(`      from read                  ${describeRead(g.firstPublished.observation)}`);
      if (target.post.offsetMs !== null && g.firstPublished.observation.requestOffsetMs > target.post.offsetMs)
        lines.push(`      That read was requested ${((g.firstPublished.observation.requestOffsetMs - target.post.offsetMs) / 1000).toFixed(3)} s after this POST; the grid at POST time was not observed.`);
    }
    if (g) {
      lines.push(`    First fully-open read:       ${g.firstFullyOpen ? describeRead(g.firstFullyOpen) : 'none observed'}`);
      lines.push(`    First unavailable read:      ${g.firstUnavailable ? `${describeRead(g.firstUnavailable.observation)} (${g.firstUnavailable.hours.join(', ')})` : 'none observed'}`);
      lines.push(`    Public booking record:       ${summary.observer?.bookingReads.itemized === false ? 'not available (version-1 log)' : g.firstRecord ? `${bookingRead(g.firstRecord.observation)} (${g.firstRecord.hours.join(', ')})` : 'none seen during the watch'}`);
      lines.push(`    Reopened (fully open again): ${g.reopen ? `${describeRead(g.reopen.after)} after ${describeRead(g.reopen.before)}${g.reopen.overlapping ? ' (reads overlapped)' : ''}` : 'none observed'}`);
    }
    lines.push(`    Checkout:                    ${target.response.statusCode === null ? 'no response recorded' : `HTTP ${target.response.statusCode}`}${target.response.errorHint ? ` · hint ${target.response.errorHint}` : ''}${target.finalState ? ` · ${target.finalState}` : ''}${target.finalCode ? ` (${target.finalCode})` : ''}`);
    lines.push(`    Response recorded by runner: ${ms(target.response.completedOffsetMs)}${target.response.networkDurationMs !== null ? ` (network duration ${dur(target.response.networkDurationMs)})` : ''}`);
    if (!p) lines.push('    Provider trace:              unavailable');
    else {
      lines.push(`    Response headers:            ${ms(p.headersOffsetMs)}${p.timingSource === 'node-observed' ? ' (Node receipt)' : ''}`);
      lines.push(`    Body complete:               ${ms(p.bodyOffsetMs)}${p.failure ? ` · failed ${p.failure.errorText}${p.failure.canceled ? ' (canceled)' : ''}` : ''}`);
      lines.push(`    Protocol / connection:       ${p.protocol ?? 'not exposed'} · reused ${p.reused === null ? 'not exposed' : p.reused ? 'yes' : 'no'} · dns ${dur(p.dnsMs)} · connect ${dur(p.connectMs)} · tls ${dur(p.tlsMs)} · send ${dur(p.sendMs)} · wait ${dur(p.waitMs)}`);
      lines.push(`    Provider IDs:                x-vercel-id ${p.vercelId ?? '—'} · x-request-id ${p.requestId ?? '—'} · cf-ray ${p.cfRay ?? '—'}${p.cfMitigated ? ` · cf-mitigated ${p.cfMitigated}` : ''}`);
      lines.push(`    Server / cache / timing:     ${p.server ?? '—'} · x-vercel-cache ${p.vercelCache ?? '—'}${p.ageS !== null ? ` · age ${p.ageS} s` : ''} · server-timing ${p.serverTiming ? p.serverTiming.map(entry => `${entry.name}${entry.durMs !== undefined ? `=${entry.durMs} ms` : ''}`).join(', ') : '—'}`);
    }
    lines.push('');
  }
  lines.push('5. AVAILABILITY TRANSITIONS');
  if (!o) lines.push('  No Slot Watch evidence.');
  else lines.push(`  OPEN → unavailable (cells): ${o.openToUnavailable} · unavailable → OPEN (cells): ${o.reopened}. Per-cell read pairs are in the Slot Watch report and summary.`);
  lines.push('', '6. PUBLIC BOOKING EVIDENCE');
  if (!o) lines.push('  No Slot Watch evidence.');
  else if (!o.bookingReads.itemized) lines.push('  Not itemized in this (version-1) log.');
  else lines.push(`  ${o.bookingReads.answered} public booking reads answered · ${o.bookingReads.failed} failed · ${o.bookingReads.failedCourtQueries} failed court queries`,
    `  Unavailable in the first published grid without any matching public booking record during the watch: ${o.unavailableWithoutRecordAtFirstPublication} cells (cause unknown).`);
  lines.push('', '7. PROVIDER / NETWORK TRACE');
  lines.push(summary.trace.available ? `  ${summary.trace.records} traced POST(s), ${summary.trace.complete} complete${summary.trace.unavailableWorkers.length ? ` · unavailable for ${summary.trace.unavailableWorkers.join(', ')}` : ''}. Details per target above.`
    : `  Not available${summary.trace.unavailableWorkers.length ? ` (attach failed for ${summary.trace.unavailableWorkers.join(', ')})` : ''}.`);
  lines.push('', '8. CHECKOUT OUTCOME', `  ${summary.outcome ?? 'not recorded'}`, '', '9. LIMITATIONS', ...summary.limitations.map(item => `  - ${item}`), '',
    'SOURCES', `  Runner trace:   ${summary.sources.runProgress}`, `  Slot Watch log: ${summary.sources.observer ?? '—'}`, `  Provider trace: ${summary.sources.providerTrace ?? '—'}`);
  return `${lines.join('\n')}\n`;
}

export function forensicsDigest(summary: ReleaseForensicsSummary): ReleaseForensicsDigest {
  return { runId: summary.runId, date: summary.date, reference: summary.reference, referenceMs: summary.referenceMs, status: summary.status, generatedAt: summary.generatedAt,
    firstPostOffsetMs: summary.dispatch.firstPostOffsetMs, lastPostOffsetMs: summary.dispatch.lastPostOffsetMs,
    firstPublished: summary.observer?.publication.firstPublished ? { seq: summary.observer.publication.firstPublished.seq,
      requestOffsetMs: summary.observer.publication.firstPublished.requestOffsetMs, responseOffsetMs: summary.observer.publication.firstPublished.responseOffsetMs } : null,
    traceAvailable: summary.trace.available, outcome: summary.outcome,
    targets: summary.targets.map(target => ({ workerId: target.workerId, court: target.court, startTime: target.startTime, endTime: target.endTime,
      postOffsetMs: target.post.offsetMs, firstPublishedState: target.grid?.firstPublished ? RANGE_STATE_LABEL[target.grid.firstPublished.state] : null,
      statusCode: target.response.statusCode, errorHint: target.response.errorHint, finalState: target.finalState,
      headersOffsetMs: target.provider?.headersOffsetMs ?? null, bodyOffsetMs: target.provider?.bodyOffsetMs ?? null,
      protocol: target.provider?.protocol ?? null, reused: target.provider?.reused ?? null })),
    reportPath: summary.reportPath };
}

/** Newest-first digests of generated forensic reports, for the Runs view. */
export function readReleaseForensicsHistory(directory: string, limit = 8): ReleaseForensicsDigest[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap(name => { const path = join(directory, name, 'summary.json'); return existsSync(path) ? [{ path, mtime: statSync(path).mtimeMs }] : []; })
    .sort((a, b) => b.mtime - a.mtime).slice(0, limit).flatMap(({ path }) => {
      try { const value = JSON.parse(readFileSync(path, 'utf8')) as ReleaseForensicsSummary; return value.version === 1 && Array.isArray(value.targets) ? [forensicsDigest(value)] : []; }
      catch { return []; }
    });
}

/** Locates a run's inputs under an installation root. */
export function forensicInputsFor(root: string, runId: string, observerLogPath?: string): Omit<ForensicInputs, 'status'> | undefined {
  if (!/^[0-9a-f-]{36}$/.test(runId)) return undefined;
  const runProgressPath = join(root, '.local/api-booking/run-progress', `${runId}.ndjson`);
  if (!existsSync(runProgressPath)) return undefined;
  const outputDirectory = join(root, '.local/release-forensics', runId), providerTracePath = join(outputDirectory, 'provider-trace.ndjson');
  let observer = observerLogPath;
  if (!observer) {
    const first = readLines(runProgressPath);
    const releaseMs = num(first.find(line => line.stage === 'PRECISION_RACE_CONFIGURED')?.releaseMs) ?? num(first.find(line => line.stage === 'RUN_CONFIGURATION')?.releaseMs);
    const date = str(first[0]?.targetDate);
    if (releaseMs !== undefined && date) observer = findObserverLog(join(root, '.local/slot-watch'), date, releaseMs);
  }
  return { runProgressPath, outputDirectory, ...(existsSync(providerTracePath) ? { providerTracePath } : {}), ...(observer ? { observerLogPath: observer } : {}) };
}
