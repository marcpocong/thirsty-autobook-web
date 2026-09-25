import { parseVercelId } from '../api-booking/response-evidence.js';
import { targetEvidence, type AvailabilityObservation, type BookingObservation } from '../slot-evidence.js';
import type { Line, Provenance } from './archive-evidence.js';

/**
 * Normalized, machine-readable timeline of one release (schema `release-timeline/v1`).
 *
 * Every event is placed on the runner's DISPATCH clock (the anchored NTP consensus adopted at the
 * last pre-release round), in ms relative to the release instant. Conversions:
 *   - `releaseLatenessMs` fields are already on the dispatch clock (0.1 ms resolution);
 *   - PC wall-clock `eventAt`/`at` values: + dispatch offset (1 ms resolution → ±1 ms);
 *   - Slot Watch offsets: + (dispatch offset − observer offset);
 *   - provider-trace `nodeObserved.*`: already on the dispatch clock (Node receipt time);
 *   - the `x-vercel-id` number: its own (provider) clock, UNDOCUMENTED meaning → INFERENCE only.
 * The dispatch clock itself is uncertain against UTC by the adopted round's error bound.
 */
export type TimelineCategory =
  | 'release-deadline' | 'clock-sync' | 'arm' | 'security-preparation' | 'scheduler-fired' | 'worker-invoked' | 'transport-invoked'
  | 'evaluate-entered' | 'renderer-fetch-invoked' | 'browser-request-observed' | 'provider-edge-evidence' | 'response-start' | 'response-complete'
  | 'outcome' | 'availability-observation' | 'publication' | 'inventory-disappearance' | 'booking-observation';
export type ClockDomain = 'dispatch' | 'pc-wall→dispatch' | 'observer→dispatch' | 'provider-embedded' | 'browser-monotonic' | 'none';

export interface TimelineEvent {
  schema: 'release-timeline/v1';
  /** Release-relative ms on the dispatch clock; null when the moment is not observable. */
  tMs: number | null;
  /** For windows (reads, responses): the end of the window. */
  tEndMs?: number | null;
  category: TimelineCategory;
  subject: string;
  evidence: Provenance;
  clockDomain: ClockDomain;
  /** Additional uncertainty relative to the dispatch clock (not including the dispatch clock's own ±UTC bound). */
  uncertaintyMs: number | null;
  source: { file: string; locator: string };
  data: Record<string, unknown>;
  note?: string;
}

export interface ReleaseTimelineInput {
  runnerLines: Line[]; runnerFile: string;
  slotWatchLines?: Line[]; slotWatchFile?: string;
  providerLines?: Line[]; providerFile?: string;
  journals?: Array<{ file: string; record: Line }>;
}
export interface ReleaseTimeline { releaseMs: number; dispatchOffsetMs: number | null; observerOffsetMs: number | null; dispatchUncertaintyMs: number | null; events: TimelineEvent[] }

const num = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const str = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
const epoch = (value: unknown): number | undefined => { const parsed = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(parsed) ? parsed : undefined; };
const tenth = (value: number) => Math.round(value * 10) / 10;

export function buildReleaseTimeline(input: ReleaseTimelineInput): ReleaseTimeline {
  const runner = input.runnerLines;
  const config = runner.find(line => line.stage === 'RUN_CONFIGURATION');
  const releaseMs = num(config?.releaseMs);
  if (releaseMs === undefined) throw Error('TIMELINE_RELEASE_UNKNOWN');
  const events: TimelineEvent[] = [];
  const push = (event: Omit<TimelineEvent, 'schema'>) => events.push({ schema: 'release-timeline/v1', ...event });
  const runnerLocator = (line: Line) => `${str(line.stage)}${str(line.workerId) ? `:${str(line.workerId)}` : ''}@${str(line.eventAt) ?? str(line.at)}`;

  // Clock rounds: the last adopted round before release defines the dispatch clock.
  const clockRounds = runner.filter(line => line.stage === 'NETWORK_CLOCK_REFRESHED' || line.stage === 'NETWORK_CLOCK_CONSENSUS');
  const adopted = clockRounds.filter(line => (epoch(line.at) ?? Infinity) < releaseMs).at(-1);
  const dispatchOffsetMs = num(adopted?.offsetMs) ?? null, dispatchUncertaintyMs = num(adopted?.uncertaintyMs) ?? null;
  const pcToDispatch = (value: unknown) => { const at = epoch(value); return at === undefined || dispatchOffsetMs === null ? null : tenth(at + dispatchOffsetMs - releaseMs); };

  push({ tMs: 0, category: 'release-deadline', subject: 'run', evidence: 'FACT', clockDomain: 'dispatch', uncertaintyMs: 0,
    source: { file: input.runnerFile, locator: 'RUN_CONFIGURATION.releaseMs' }, data: { releaseMs, releaseUtc: new Date(releaseMs).toISOString() },
    note: `Authoritative local deadline. The dispatch clock itself is within ±${dispatchUncertaintyMs ?? '?'} ms of UTC (NTP geometry bound of the adopted round).` });
  for (const round of clockRounds)
    push({ tMs: pcToDispatch(round.at), category: 'clock-sync', subject: `clock:${str(round.checkpoint) ?? 'round'}`, evidence: 'FACT', clockDomain: 'pc-wall→dispatch',
      uncertaintyMs: 1, source: { file: input.runnerFile, locator: runnerLocator(round) },
      data: { offsetMs: num(round.offsetMs), uncertaintyMs: num(round.uncertaintyMs), spreadMs: num(round.spreadMs), roundTripMs: num(round.roundTripMs), sampleCount: num(round.sampleCount), adopted: round === adopted } });

  const workers = [...new Set(runner.filter(line => line.stage === 'CHECKOUT_HTTP_POST_INITIATED').map(line => str(line.workerId)!))].sort();
  const target = (worker: string) => runner.find(line => (line.stage === 'DIAGNOSTIC_ATTEMPT_ARMED' || line.stage === 'DIAGNOSTIC_ATTEMPT_STARTED') && line.workerId === worker);
  for (const line of runner.filter(value => value.stage === 'DIAGNOSTIC_ATTEMPT_ARMED'))
    push({ tMs: pcToDispatch(line.eventAt ?? line.at), category: 'arm', subject: `worker:${str(line.workerId)}`, evidence: 'FACT', clockDomain: 'pc-wall→dispatch', uncertaintyMs: 1,
      source: { file: input.runnerFile, locator: runnerLocator(line) }, data: { court: num(line.court), startTime: str(line.startTime), durationHours: num(line.durationHours), attemptId: str(line.attemptId) } });
  for (const line of runner.filter(value => value.stage === 'SECURITY_PREPARATION_STARTED' || value.stage === 'SECURITY_PREPARATION_COMPLETED'))
    push({ tMs: pcToDispatch(line.eventAt ?? line.at), category: 'security-preparation', subject: `worker:${str(line.workerId)}`, evidence: 'FACT', clockDomain: 'pc-wall→dispatch',
      uncertaintyMs: 1, source: { file: input.runnerFile, locator: runnerLocator(line) },
      data: { phase: line.stage === 'SECURITY_PREPARATION_STARTED' ? 'started' : 'completed', durationMs: num(line.durationMs), securitySource: str(line.securitySource) } });

  const prePosts = runner.filter(line => line.stage === 'CHECKOUT_PRE_POST' && num(line.releaseLatenessMs) !== undefined);
  const earliestPrePost = prePosts.length ? Math.min(...prePosts.map(line => num(line.releaseLatenessMs)!)) : null;
  push({ tMs: earliestPrePost, category: 'scheduler-fired', subject: 'runner', evidence: earliestPrePost === null ? 'UNKNOWN' : 'INFERENCE', clockDomain: 'dispatch', uncertaintyMs: null,
    source: { file: input.runnerFile, locator: 'min(CHECKOUT_PRE_POST.releaseLatenessMs)' }, data: { upperBoundMs: earliestPrePost },
    note: 'The wake itself is not logged in this build; it happened no later than the first pre-POST mark (all workers fire in one synchronous pass).' });

  const requestEvents = new Map<string, number>();
  for (const worker of workers) {
    const armed = target(worker);
    const subject = `worker:${worker}`, targetData = { court: num(armed?.court), startTime: str(armed?.startTime), durationHours: num(armed?.durationHours) };
    const entered = runner.find(line => line.stage === 'CHECKOUT_FUNCTION_ENTERED' && line.workerId === worker);
    const prePost = runner.find(line => line.stage === 'CHECKOUT_PRE_POST' && line.workerId === worker);
    const post = runner.find(line => line.stage === 'CHECKOUT_HTTP_POST_INITIATED' && line.workerId === worker);
    const done = runner.find(line => line.stage === 'CHECKOUT_RESPONSE_COMPLETED' && line.workerId === worker);
    const settled = runner.find(line => line.stage === 'PHASE3_SETTLED' && line.workerId === worker);
    if (entered) push({ tMs: pcToDispatch(entered.eventAt), category: 'worker-invoked', subject, evidence: 'FACT', clockDomain: 'pc-wall→dispatch', uncertaintyMs: 1,
      source: { file: input.runnerFile, locator: runnerLocator(entered) }, data: { ...targetData, preparedContextAgeMs: num(entered.preparedContextAgeMs), securitySource: str(entered.securitySource) },
      note: 'Millisecond wall-clock stamp captured at the event (deferred logging).' });
    if (prePost) push({ tMs: num(prePost.releaseLatenessMs) ?? pcToDispatch(prePost.eventAt), category: 'transport-invoked', subject, evidence: 'FACT', clockDomain: 'dispatch',
      uncertaintyMs: 0.1, source: { file: input.runnerFile, locator: runnerLocator(prePost) }, data: { ...targetData, preparedContextAgeMs: num(prePost.preparedContextAgeMs) },
      note: 'Last Node-side gate before page.evaluate (CHECKOUT_PRE_POST).' });
    push({ tMs: null, category: 'evaluate-entered', subject, evidence: 'UNKNOWN', clockDomain: 'none', uncertaintyMs: null,
      source: { file: input.runnerFile, locator: 'not recorded by the 2026-09-25 build' }, data: {}, note: 'Renderer entry of page.evaluate was not timestamped. Added by critical-path telemetry for future runs.' });
    const sent = num(post?.releaseLatenessMs);
    if (sent !== undefined) requestEvents.set(worker, sent);
    if (post) push({ tMs: sent ?? pcToDispatch(post.eventAt), category: 'browser-request-observed', subject, evidence: 'FACT', clockDomain: 'dispatch', uncertaintyMs: 0.1,
      source: { file: input.runnerFile, locator: runnerLocator(post) }, data: { initiationEvidence: str(post.initiationEvidence), activeCheckouts: num(post.activeCheckouts) },
      note: 'Time Node RECEIVED the Playwright request event; the browser request began earlier by the (unknown) event delivery lag.' });
    const network = num(done?.networkDurationMs), postStart = num(prePost?.releaseLatenessMs) ?? sent;
    if (done) push({ tMs: postStart !== undefined && network !== undefined ? tenth(postStart + network) : pcToDispatch(done.eventAt), category: 'response-complete', subject,
      evidence: 'FACT', clockDomain: 'dispatch', uncertaintyMs: 1, source: { file: input.runnerFile, locator: runnerLocator(done) },
      data: { statusCode: num(done.statusCode), networkDurationMs: network, errorHint: str(done.errorHint), responseSource: str(done.responseSource), dispatchState: str(done.dispatchState) },
      note: 'Runner view: page.evaluate resolved in Node (pre-POST mark + measured network duration, which starts at the pre-POST mark).' });
    if (settled) push({ tMs: pcToDispatch(settled.at), category: 'outcome', subject, evidence: 'FACT', clockDomain: 'pc-wall→dispatch', uncertaintyMs: 1,
      source: { file: input.runnerFile, locator: runnerLocator(settled) }, data: { state: str(settled.state), wave: str(settled.wave) } });
  }

  // Provider trace: Chrome's own timing and response headers.
  for (const line of (input.providerLines ?? []).filter(value => value.type === 'provider-trace')) {
    const worker = str(line.workerId)!, subject = `worker:${worker}`, response = (line.response ?? {}) as Line, browser = (line.browser ?? {}) as Line;
    const nodeObserved = (line.nodeObserved ?? {}) as Line, connection = (line.connection ?? {}) as Line;
    const headersNode = num(nodeObserved.headersOffsetMs), headersBrowser = num(browser.headersStartMs), requestEvent = requestEvents.get(worker);
    const bounds = [requestEvent, headersNode !== undefined && headersBrowser !== undefined ? headersNode - headersBrowser : undefined].filter((value): value is number => value !== undefined);
    const upperBound = bounds.length ? tenth(Math.min(...bounds)) : null;
    push({ tMs: upperBound, category: 'renderer-fetch-invoked', subject, evidence: upperBound === null ? 'UNKNOWN' : 'INFERENCE', clockDomain: 'dispatch', uncertaintyMs: null,
      source: { file: input.providerFile ?? 'provider-trace', locator: `provider-trace:${worker}` }, data: { upperBoundMs: upperBound, basis: 'min(request event receipt, headers receipt − Chrome headersStart)' },
      note: 'Not timestamped directly. Chrome started the network request NO LATER than this (event delivery lags are ≥ 0); fetch() ran before that.' });
    const parsed = parseVercelId(str(response.vercelId));
    push({ tMs: parsed?.embeddedMs !== null && parsed?.embeddedMs !== undefined ? parsed.embeddedMs - releaseMs : null, category: 'provider-edge-evidence', subject,
      evidence: parsed?.embeddedMs ? 'INFERENCE' : 'UNKNOWN', clockDomain: 'provider-embedded', uncertaintyMs: null,
      source: { file: input.providerFile ?? 'provider-trace', locator: `provider-trace:${worker}.response.vercelId` },
      data: { vercelId: str(response.vercelId), edgeRegion: parsed?.edgeRegion, functionRegion: parsed?.functionRegion, embeddedMs: parsed?.embeddedMs,
        minusRequestEventMs: parsed?.embeddedMs && requestEvent !== undefined ? tenth(parsed.embeddedMs - releaseMs - requestEvent) : null },
      note: 'The middle number of x-vercel-id is UNDOCUMENTED. Read as epoch ms it lies ~20–27 ms after our send events, consistent with (not proof of) edge receipt. Provider clock, not ours.' });
    push({ tMs: headersNode ?? null, category: 'response-start', subject, evidence: headersNode === undefined ? 'UNKNOWN' : 'FACT', clockDomain: 'dispatch', uncertaintyMs: 1,
      source: { file: input.providerFile ?? 'provider-trace', locator: `provider-trace:${worker}.nodeObserved.headersOffsetMs` },
      data: { browserSendMs: num(browser.sendMs), browserWaitMs: num(browser.waitMs), browserHeadersStartMs: headersBrowser, protocol: str(connection.protocol),
        connectionReused: connection.reused, dnsMs: browser.dnsMs, connectMs: browser.connectMs, tlsMs: browser.tlsMs, status: num(response.status),
        server: str(response.server), vercelCache: str(response.vercelCache), serverTiming: response.serverTiming ?? null, requestId: response.requestId ?? null },
      note: 'Node receipt of Network.responseReceived (late-enabled passive trace). browserWaitMs = Chrome request sent → first header byte.' });
    push({ tMs: num(nodeObserved.finishedOffsetMs) ?? null, category: 'response-complete', subject, evidence: 'FACT', clockDomain: 'dispatch', uncertaintyMs: 1,
      source: { file: input.providerFile ?? 'provider-trace', locator: `provider-trace:${worker}.nodeObserved.finishedOffsetMs` },
      data: { encodedBytes: num(response.encodedBytes), browserBodyCompleteMs: num(browser.bodyCompleteMs), contentType: str(response.contentType) },
      note: 'Provider-trace view (Chrome loadingFinished). The response body itself was not retained by this build.' });
  }

  // Slot Watch reads, shifted onto the dispatch clock.
  const watch = input.slotWatchLines ?? [];
  const header = watch.find(line => line.type === 'header');
  const observerOffsetMs = num(watch.filter(line => line.type === 'clock').at(-1)?.offsetMs) ?? num(header?.clockOffsetMs) ?? null;
  const shift = dispatchOffsetMs !== null && observerOffsetMs !== null ? tenth(dispatchOffsetMs - observerOffsetMs) : 0;
  const availability: AvailabilityObservation[] = [], bookings: BookingObservation[] = [];
  for (const line of watch) {
    if (line.type === 'availability') {
      const observation: AvailabilityObservation = { seq: num(line.seq)!, scheduledOffsetMs: num(line.scheduledOffsetMs) ?? 0, requestOffsetMs: num(line.requestOffsetMs)! + shift,
        responseOffsetMs: (num(line.responseOffsetMs) ?? NaN) + shift, outcome: (str(line.outcome) as AvailabilityObservation['outcome']) ?? 'failed',
        targetDatePresent: line.targetDatePresent === true, ...(str(line.matrix) ? { matrix: str(line.matrix)! } : {}),
        ...(line.cache ? { cache: line.cache as AvailabilityObservation['cache'] } : {}) };
      availability.push(observation);
      const counts = (line.counts ?? {}) as Record<string, unknown>;
      push({ tMs: tenth(observation.requestOffsetMs), tEndMs: Number.isFinite(observation.responseOffsetMs) ? tenth(observation.responseOffsetMs) : null,
        category: 'availability-observation', subject: `read:availability#${observation.seq}`, evidence: 'FACT', clockDomain: 'observer→dispatch', uncertaintyMs: 1,
        source: { file: input.slotWatchFile ?? 'slot-watch', locator: `availability seq ${observation.seq}` },
        data: { durationMs: num(line.durationMs), outcome: observation.outcome, published: observation.targetDatePresent, open: num(counts.OPEN), taken: num(counts.TAKEN),
          cache: (line.cache as Line | undefined)?.status ?? null, inFlightAtLaunch: num(line.inFlightAtLaunch) },
        note: 'The content reflects Onda at an UNKNOWN moment inside [tMs, tEndMs].' });
    } else if (line.type === 'bookings') {
      const observation: BookingObservation = { seq: num(line.seq)!, scheduledOffsetMs: num(line.scheduledOffsetMs) ?? 0, requestOffsetMs: num(line.requestOffsetMs)! + shift,
        responseOffsetMs: (num(line.responseOffsetMs) ?? NaN) + shift, outcome: (str(line.outcome) as BookingObservation['outcome']) ?? 'failed',
        failedCourts: Array.isArray(line.failedCourts) ? line.failedCourts.filter((value): value is number => typeof value === 'number') : [],
        cells: Array.isArray(line.cells) ? line.cells.filter((value): value is string => typeof value === 'string') : [] };
      bookings.push(observation);
      push({ tMs: tenth(observation.requestOffsetMs), tEndMs: Number.isFinite(observation.responseOffsetMs) ? tenth(observation.responseOffsetMs) : null,
        category: 'booking-observation', subject: `read:bookings#${observation.seq}`, evidence: 'FACT', clockDomain: 'observer→dispatch', uncertaintyMs: 1,
        source: { file: input.slotWatchFile ?? 'slot-watch', locator: `bookings seq ${observation.seq}` },
        data: { records: observation.cells.length, failedCourts: observation.failedCourts, durationMs: num(line.durationMs) },
        note: 'Public booking records (court/hour only). A record shows that a booking exists, not who holds it or when it was created.' });
    }
  }
  const published = availability.filter(value => value.outcome === 'ok' && value.targetDatePresent).sort((a, b) => a.seq - b.seq);
  const firstPublished = published[0];
  const lastUnpublished = firstPublished ? availability.filter(value => value.outcome === 'ok' && !value.targetDatePresent && value.seq < firstPublished.seq).sort((a, b) => a.seq - b.seq).at(-1) : undefined;
  if (firstPublished) push({ tMs: lastUnpublished ? tenth(lastUnpublished.responseOffsetMs) : null, tEndMs: tenth(firstPublished.responseOffsetMs), category: 'publication', subject: 'read-side date publication',
    evidence: 'INFERENCE', clockDomain: 'observer→dispatch', uncertaintyMs: null, source: { file: input.slotWatchFile ?? 'slot-watch', locator: `availability seq ${lastUnpublished?.seq ?? '?'} → ${firstPublished.seq}` },
    data: { lastUnpublishedRequestMs: lastUnpublished ? tenth(lastUnpublished.requestOffsetMs) : null, lastUnpublishedResponseMs: lastUnpublished ? tenth(lastUnpublished.responseOffsetMs) : null,
      firstPublishedRequestMs: tenth(firstPublished.requestOffsetMs), firstPublishedResponseMs: tenth(firstPublished.responseOffsetMs), firstPublishedCache: firstPublished.cache ?? null },
    note: 'Read-side publication happened after the last unpublished read was served and before the first published read was served. The checkout-side gate is not observable from reads.' });

  for (const worker of workers) {
    const armed = target(worker), court = num(armed?.court), startTime = str(armed?.startTime), hours = num(armed?.durationHours);
    if (court === undefined || !startTime || hours === undefined) continue;
    const endTime = `${String(Number(startTime.slice(0, 2)) + hours).padStart(2, '0')}:00`;
    const evidence = targetEvidence(availability, bookings, { court, startTime, endTime });
    const unavailable = evidence.firstUnavailable;
    // Last read (request order) before the first unavailable one that still showed the whole range open.
    const lastOpen = unavailable ? published.filter(value => value.seq < unavailable.observation.seq).filter(value => {
      const row = (value.matrix ?? '').split(',').find(part => part.startsWith(`${court}:`))?.slice(2) ?? '';
      return Array.from({ length: hours }, (_, index) => row[Number(startTime.slice(0, 2)) - 8 + index]).every(code => code === 'O');
    }).at(-1) : undefined;
    push({ tMs: unavailable ? tenth(unavailable.observation.requestOffsetMs) : null, tEndMs: unavailable ? tenth(unavailable.observation.responseOffsetMs) : null,
      category: 'inventory-disappearance', subject: `target:${worker}:C${court} ${startTime}-${endTime}`, evidence: unavailable ? 'INFERENCE' : 'UNKNOWN', clockDomain: 'observer→dispatch',
      uncertaintyMs: null, source: { file: input.slotWatchFile ?? 'slot-watch', locator: unavailable ? `availability seq ${unavailable.observation.seq}` : 'none' },
      data: { worker, court, startTime, endTime, firstUnavailableHours: unavailable?.hours ?? [], firstUnavailableRead: unavailable?.observation ?? null,
        lastFullyOpenRead: lastOpen ? { seq: lastOpen.seq, requestOffsetMs: tenth(lastOpen.requestOffsetMs), responseOffsetMs: tenth(lastOpen.responseOffsetMs) } : null,
        firstPublishedState: evidence.firstPublished?.state ?? null, firstRecord: evidence.firstRecord },
      note: 'The first read (in request order) that showed any target hour unavailable. The provider-side moment lies before its response and is not otherwise observable; overlapping reads can disagree.' });
  }

  for (const entry of input.journals ?? []) {
    const record = entry.record, attempt = (record.attempt ?? {}) as Line;
    push({ tMs: epoch(record.updatedAt) !== undefined ? tenth(epoch(record.updatedAt)! - releaseMs) : null, category: 'outcome', subject: `journal:${String(record.key ?? '').slice(0, 10)}`,
      evidence: 'FACT', clockDomain: 'dispatch', uncertaintyMs: 1, source: { file: entry.file, locator: 'updatedAt' },
      data: { state: record.state, courtIds: attempt.courtIds, hourlyBoundaries: attempt.hourlyBoundaries, diagnostic: record.diagnostic, failureCode: record.failureCode,
        createdOffsetMs: epoch(record.createdAt) !== undefined ? tenth(epoch(record.createdAt)! - releaseMs) : null },
      note: 'Durable journal timestamps use the runner\'s network-corrected clock (1 ms resolution).' });
  }

  const order: Record<TimelineCategory, number> = { 'release-deadline': 0, 'clock-sync': 1, arm: 2, 'security-preparation': 3, 'scheduler-fired': 4, 'worker-invoked': 5,
    'transport-invoked': 6, 'evaluate-entered': 7, 'renderer-fetch-invoked': 8, 'browser-request-observed': 9, 'provider-edge-evidence': 10, 'response-start': 11,
    'response-complete': 12, outcome: 13, 'availability-observation': 14, publication: 15, 'inventory-disappearance': 16, 'booking-observation': 17 };
  events.sort((a, b) => (a.tMs ?? Number.MAX_SAFE_INTEGER) - (b.tMs ?? Number.MAX_SAFE_INTEGER) || order[a.category] - order[b.category] || a.subject.localeCompare(b.subject));
  return { releaseMs, dispatchOffsetMs, observerOffsetMs, dispatchUncertaintyMs, events };
}
