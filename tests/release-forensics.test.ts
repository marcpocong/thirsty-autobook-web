import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MATRIX_COURTS, MATRIX_HOURS } from '../src/api-booking/court-hour-matrix.js';
import { buildReleaseForensics, findObserverLog, forensicInputsFor, readReleaseForensicsHistory } from '../src/release-forensics.js';

const runId = '8bcc1790-2475-4fcf-ba60-96551f7b7fe3';
const releaseMs = Date.parse('2026-09-24T00:00:00.000Z');
const date = '2026-09-26';
const at = (offset: number) => new Date(releaseMs + offset).toISOString();
const matrix = (cells: Record<string, string> = {}, fill = 'O') => MATRIX_COURTS.map(court => `${court}:${MATRIX_HOURS.map(hour => cells[`${court}/${hour}`] ?? fill).join('')}`).join(',');
const ndjson = (lines: unknown[]) => `${lines.map(line => JSON.stringify(line)).join('\n')}\n`;
const base = { runId, mode: 'live', targetDate: date };

/** Runner trace for a 3-target Precision race: A sent, B sent, C never sent (identity failure). */
function runTrace() {
  return ndjson([
    { ...base, stage: 'RUN_STARTED', at: at(-1_500_000) },
    { ...base, stage: 'RUN_CONFIGURATION', bookingMethod: 'proofless', workerCount: 3, releaseMs },
    { ...base, stage: 'PRECISION_RACE_CONFIGURED', date, targetCount: 3, releaseMs },
    { ...base, stage: 'PRECISION_TARGET', workerId: 'A', court: 3, startTime: '15:00', endTime: '18:00', durationHours: 3 },
    { ...base, stage: 'PRECISION_TARGET', workerId: 'B', court: 6, startTime: '15:00', endTime: '17:00', durationHours: 2 },
    { ...base, stage: 'PRECISION_TARGET', workerId: 'C', court: 5, startTime: '19:00', endTime: '20:00', durationHours: 1 },
    { ...base, stage: 'PRECISION_ATTEMPT_STATE', workerId: 'C', attemptState: 'IDENTITY_FAILED', code: 'DUPLICATE_ONDA_CUSTOMER_ID' },
    { ...base, stage: 'NETWORK_CLOCK_REFRESHED', checkpoint: 'T-10M', offsetMs: 52, roundTripMs: 44, deltaMs: 9 },
    { ...base, stage: 'NETWORK_CLOCK_CONSENSUS', checkpoint: 'T-60S', offsetMs: 51.2, roundTripMs: 31.5, sampleCount: 10, spreadMs: 1.2, uncertaintyMs: 16.1, deltaMs: -0.8 },
    { ...base, stage: 'NETWORK_CLOCK_CONSENSUS_REJECTED', checkpoint: 'T-30S', code: 'CLOCK_CONSENSUS_DEGRADED', sampleCount: 2 },
    { ...base, stage: 'DIAGNOSTIC_ATTEMPT_ARMED', workerId: 'A', attemptId: 'core-A-official-1', court: 3, startTime: '15:00', durationHours: 3 },
    { ...base, stage: 'CHECKOUT_HTTP_POST_INITIATED', workerId: 'B', attemptId: 'core-B-official-2', eventAt: at(4), releaseLatenessMs: 5.1 },
    { ...base, stage: 'CHECKOUT_HTTP_POST_INITIATED', workerId: 'A', attemptId: 'core-A-official-1', eventAt: at(2), releaseLatenessMs: 3.4 },
    { ...base, stage: 'CHECKOUT_RESPONSE_COMPLETED', workerId: 'A', attemptId: 'core-A-official-1', eventAt: at(17_502), networkDurationMs: 17_500, statusCode: 409, errorHint: 'availability', responseSource: 'application' },
    { ...base, stage: 'CHECKOUT_RESPONSE_COMPLETED', workerId: 'B', attemptId: 'core-B-official-2', eventAt: at(23_004), networkDurationMs: 23_000, statusCode: 409, errorHint: 'availability', responseSource: 'application' },
    { ...base, stage: 'PRECISION_ATTEMPT_STATE', workerId: 'A', attemptState: 'REJECTED', code: 'ONDA_HTTP_STATUS_INVALID' },
    { ...base, stage: 'PRECISION_ATTEMPT_STATE', workerId: 'B', attemptState: 'REJECTED', code: 'ONDA_HTTP_STATUS_INVALID' },
    { ...base, stage: 'PRECISION_OUTCOME', outcome: 'OBJECTIVE_NOT_ACHIEVED_ALL_REJECTED' },
    { ...base, stage: 'PROCESS_EXIT', exitCode: 1 },
  ]);
}
const availability = (seq: number, request: number, response: number, cells?: Record<string, string>, published = true) => ({ type: 'availability', seq, scheduledOffsetMs: request,
  requestOffsetMs: request, responseOffsetMs: response, outcome: 'ok', targetDatePresent: published, matrix: published ? matrix(cells) : matrix({}, '?') });
/** Observer: unpublished at +0.25, first published at +0.5 (answered +4.0), court 3 16:00 unavailable from #4; public record on 3/16 from b2. */
function observerLog() {
  return ndjson([
    { type: 'header', version: 2, date, releaseMs, schedule: { availability: [-2_000, 0, 250, 500, 1_000], maxInFlight: 6 } },
    { type: 'clock', at: at(-600_000), offsetMs: 52 },
    availability(1, -2_000, -1_800, undefined, false),
    availability(3, 250, 350, undefined, false),
    { type: 'not-launched', kind: 'availability', scheduledOffsetMs: 750, reason: 'CAP_REACHED' },
    availability(4, 1_000, 1_900, { '3/16:00': 'X', '6/16:00': 'X', '5/19:00': '?' }),
    availability(2, 0, 3_900, { '6/16:00': 'X', '5/19:00': '?' }),
    availability(5, 500, 4_000, { '6/16:00': 'X', '5/19:00': '?' }),
    { type: 'bookings', seq: 1, scheduledOffsetMs: -60_000, requestOffsetMs: -60_000, responseOffsetMs: -59_900, outcome: 'ok', failedCourts: [], cells: [] },
    { type: 'bookings', seq: 2, scheduledOffsetMs: 2_000, requestOffsetMs: 2_000, responseOffsetMs: 2_300, outcome: 'ok', failedCourts: [7], cells: ['3/16:00'] },
  ]);
}
/** Provider trace: A complete (h2 reused, headers +17.48 s after its POST), B attach failed. */
function providerTrace() {
  return ndjson([
    { type: 'header', version: 1, runId, reference: 'release', referenceMs: releaseMs, traces: [{ workerId: 'A', status: 'detached' }, { workerId: 'B', status: 'unavailable', code: 'PROVIDER_TRACE_ATTACH_TIMEOUT' }] },
    { type: 'provider-trace', workerId: 'A', attemptId: 'core-A-official-1', target: { court: 3, startTime: '15:00', endTime: '18:00' }, method: 'POST', path: '/api/bookings/public-checkout',
      nodeObserved: { enabledOffsetMs: 12.1, headersOffsetMs: 17_484.2, finishedOffsetMs: 17_545 },
      browser: { dnsMs: null, connectMs: null, tlsMs: null, sendMs: 0.1, waitMs: 17_479.2, headersStartMs: 17_480, headersEndMs: 17_480.3, bodyCompleteMs: 17_540.6, failedMs: null },
      connection: { protocol: 'h2', reused: true },
      response: { status: 409, contentType: 'application/json', server: 'Vercel', cfRay: null, cfMitigated: null, vercelId: 'sin1::sin1::xz9xx-1790208017480-48ab0f0d95c1',
        requestId: '0f8fad5b-d9cb-469f-a165-70867728950e', vercelCache: 'MISS', ageS: 0, serverTiming: null, encodedBytes: 812 }, failure: null, complete: true },
  ]);
}

async function installation(options: { observer?: boolean; trace?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'thirsty-forensics-'));
  await mkdir(join(root, '.local/api-booking/run-progress'), { recursive: true });
  await writeFile(join(root, '.local/api-booking/run-progress', `${runId}.ndjson`), runTrace());
  if (options.observer !== false) {
    await mkdir(join(root, '.local/slot-watch'), { recursive: true });
    await writeFile(join(root, '.local/slot-watch', `${date}_watch.ndjson`), observerLog());
    // An earlier watch for the same release that was replaced after one read.
    await writeFile(join(root, '.local/slot-watch', `${date}_replaced.ndjson`), ndjson([{ type: 'header', version: 2, date, releaseMs }, availability(1, -900_000, -899_800, undefined, false)]));
  }
  if (options.trace !== false) {
    await mkdir(join(root, '.local/release-forensics', runId), { recursive: true });
    await writeFile(join(root, '.local/release-forensics', runId, 'provider-trace.ndjson'), providerTrace());
  }
  return root;
}
async function cleanup(root: string) { if (resolve(root).startsWith(resolve(tmpdir()) + sep)) await rm(root, { recursive: true, force: true }); }

describe('post-run release forensics', () => {
  it('correlates each exact target with the first published grid, its POST and the provider trace', async () => {
    const root = await installation();
    try {
      const inputs = forensicInputsFor(root, runId)!;
      expect(inputs.observerLogPath).toBe(join(root, '.local/slot-watch', `${date}_watch.ndjson`));
      const summary = buildReleaseForensics({ ...inputs, status: 'final', now: () => releaseMs + 900_000 });
      expect(summary.dispatch).toEqual({ posts: 2, firstPostOffsetMs: 3.4, lastPostOffsetMs: 5.1, spreadMs: 1.7 });
      expect(summary.clock).toMatchObject({ dispatchOffsetMs: 51.2, observerOffsetMs: 52, observerMinusDispatchMs: 0.8 });
      expect(summary.clock.rounds.map(round => [round.checkpoint, round.adopted])).toEqual([['T-10M', true], ['T-60S', true], ['T-30S', false]]);
      // First published = earliest REQUEST with the date (#2 at T+0, answered +3.9 s), not the earliest answer (#4 at +1.9 s).
      expect(summary.observer!.publication).toMatchObject({ lastUnpublished: { seq: 1 }, firstPublished: { seq: 2, requestOffsetMs: 0, responseOffsetMs: 3_900 },
        firstPublishedResponse: { seq: 4, requestOffsetMs: 1_000, responseOffsetMs: 1_900 } });
      expect(summary.observer!.reads).toMatchObject({ answered: 5, notLaunched: 1, maxInFlight: 6 });
      const [a, b, c] = summary.targets;
      // Exact range → exact cells; a multi-hour target needs every hour open.
      expect(a).toMatchObject({ workerId: 'A', court: 3, startTime: '15:00', endTime: '18:00', attemptId: 'core-A-official-1', finalState: 'REJECTED',
        post: { offsetMs: 3.4, source: 'run-trace' }, response: { statusCode: 409, errorHint: 'availability', completedOffsetMs: 17_503.4 } });
      expect(a!.grid!.hours).toEqual(['15:00', '16:00', '17:00']);
      expect(a!.grid!.firstPublished).toMatchObject({ state: 'FULLY_OPEN', observation: { seq: 2 } });
      expect(a!.grid!.firstUnavailable).toEqual({ observation: { seq: 4, requestOffsetMs: 1_000, responseOffsetMs: 1_900 }, hours: ['16:00'] });
      expect(a!.grid!.firstRecord).toEqual({ observation: { seq: 2, requestOffsetMs: 2_000, responseOffsetMs: 2_300 }, hours: ['16:00'] });
      // Headers/body = POST instant + browser-measured intervals.
      expect(a!.provider).toMatchObject({ protocol: 'h2', reused: true, headersOffsetMs: 17_483.4, bodyOffsetMs: 17_544, timingSource: 'browser',
        vercelId: 'sin1::sin1::xz9xx-1790208017480-48ab0f0d95c1', requestId: '0f8fad5b-d9cb-469f-a165-70867728950e' });
      expect(b).toMatchObject({ workerId: 'B', court: 6, post: { offsetMs: 5.1 }, provider: null });
      expect(b!.grid!.firstPublished).toMatchObject({ state: 'PARTIALLY_UNAVAILABLE' });
      // An unknown hour makes the target UNKNOWN, never open; C was never sent.
      expect(c).toMatchObject({ workerId: 'C', post: { offsetMs: null }, finalState: 'IDENTITY_FAILED', response: { statusCode: null } });
      expect(c!.grid!.firstPublished).toMatchObject({ state: 'UNKNOWN_INCOMPLETE', hours: [{ hour: '19:00', state: 'UNKNOWN' }] });
      expect(summary.trace).toEqual({ available: true, records: 1, complete: 1, unavailableWorkers: ['B'] });

      const report = await readFile(summary.reportPath, 'utf8');
      expect(report).toContain('Worker A · Court 3 · 15:00–18:00 · core-A-official-1');
      expect(report).toContain('First published state:       FULLY OPEN (15:00 open, 16:00 open, 17:00 open)');
      expect(report).toContain('#2 request +0.000 s → response +3.900 s');
      expect(report).toContain('Response headers:            +17.483 s');
      expect(report).toContain('Body complete:               +17.544 s');
      expect(report).toContain('Public booking record:       #b2 request +2.000 s → response +2.300 s (16:00)');
      expect(report).toContain('Checkout:                    HTTP 409 · hint availability · REJECTED (ONDA_HTTP_STATUS_INVALID)');
      expect(report).toContain('Provider trace:              unavailable');
      expect(report).not.toContain('version-1');
      expect(report).toContain('It does not show who made it, whether it belongs to this bot, or why.');
      // Evidence only: no ownership or causal claims.
      expect(report).not.toMatch(/venue block|admin block|bot hold|competitor|likely|because|caused by|took the slot|stole/i);
      expect(readReleaseForensicsHistory(join(root, '.local/release-forensics'))).toMatchObject([{ runId, status: 'final', firstPostOffsetMs: 3.4, lastPostOffsetMs: 5.1,
        firstPublished: { seq: 2 }, traceAvailable: true, targets: [{ workerId: 'A', firstPublishedState: 'FULLY OPEN', headersOffsetMs: 17_483.4 }, { workerId: 'B' }, { workerId: 'C', postOffsetMs: null }] }]);
    } finally { await cleanup(root); }
  });

  it('states when the grid at POST time was not observed and marks a preliminary report', async () => {
    const root = await installation({ trace: false });
    try {
      const summary = buildReleaseForensics({ ...forensicInputsFor(root, runId)!, status: 'preliminary' });
      const report = await readFile(summary.reportPath, 'utf8');
      // The first published read was requested at T+0, before A's POST at +3.4 ms: no "after this POST" note for it.
      expect(report).not.toContain('requested 0.');
      expect(report).toContain('PRELIMINARY: the Slot Watch was still running');
      expect(report).toContain('No provider trace was captured for this run');
      expect(summary.trace.available).toBe(false);
    } finally { await cleanup(root); }
  });

  it('without a Slot Watch log it reports no grid evidence instead of guessing', async () => {
    const root = await installation({ observer: false, trace: false });
    try {
      const summary = buildReleaseForensics({ ...forensicInputsFor(root, runId)!, status: 'final' });
      expect(summary.observer).toBeNull();
      expect(summary.targets.every(target => target.grid === null)).toBe(true);
      const report = await readFile(summary.reportPath, 'utf8');
      expect(report).toContain('No Slot Watch evidence for this run.');
      expect(report).toContain('Grid evidence:               none (no Slot Watch log)');
    } finally { await cleanup(root); }
  });

  it('picks the watch with the most reads for the release and ignores other releases', async () => {
    const root = await installation();
    try {
      const directory = join(root, '.local/slot-watch');
      expect(findObserverLog(directory, date, releaseMs)).toBe(join(directory, `${date}_watch.ndjson`));
      expect(findObserverLog(directory, date, releaseMs + 86_400_000)).toBeUndefined();
      expect(forensicInputsFor(root, 'not-a-run-id')).toBeUndefined();
    } finally { await cleanup(root); }
  });
});
