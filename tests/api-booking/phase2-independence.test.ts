import { closeSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { armPrecisionRace, dispatchArmedPrecisionRace } from '../../src/api-booking/armed-dispatch.js';
import { OndaBrowserSessionTransport } from '../../src/api-booking/browser-session-transport.js';
import { CHECKOUT_TRACE_URL, ProviderTraceSet, type CdpSessionLike } from '../../src/api-booking/checkout-provider-trace.js';
import { freezePrecisionRace, precisionTargetPlan, validatePrecisionTargets } from '../../src/api-booking/precision-race.js';
import { TrustedReleaseClock } from '../../src/release-clock.js';
import { SlotWatch } from '../../src/slot-watch.js';
import type { AvailabilitySnapshot } from '../../src/api-booking/types.js';

/**
 * Phase 2 must never affect checkout. Each case runs a real armed Precision dispatch (Phase 1 code,
 * page stand-ins that answer HTTP 409) next to a misbehaving observer or trace and compares it with
 * a baseline run: same attempts sent, same outcomes, POSTs still at the release instant.
 */
const date = '2026-09-26';
const customer = { clientId: '00000000-0000-4000-8000-00000000c11e', customerId: '00000000-0000-4000-8000-000000000b00',
  customerEmail: 'fixture@example.invalid', customerPhone: '09123456789', customerFirstName: 'Fixture', customerLastName: 'Player' };
let root: string, previous: string | undefined, runNumber = 0;
beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'phase2-independence-')); previous = process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT; process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT'; });
afterAll(async () => {
  if (previous === undefined) delete process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT; else process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = previous;
  if (resolve(root).startsWith(resolve(tmpdir()) + sep)) await rm(root, { recursive: true, force: true });
});

type Listener = (params: unknown) => void;
/** Page stand-in; `onPost` lets a test's fake DevTools session see the POST like Chrome would report it. */
function fakePage(onPost?: () => void) {
  return { isClosed: () => false, url: () => 'https://app.onda.fit/book/thirsty-pickle', on: () => undefined, off: () => undefined, mainFrame: () => undefined,
    locator: () => ({ count: async () => 0 }),
    evaluate: async () => { onPost?.(); return { status: 409, contentType: 'application/json', server: '', cloudflareRay: '', cfMitigated: '',
      body: JSON.stringify({ success: false, error: 'Synthetic conflict' }) }; } } as unknown as Page;
}

interface RaceResult { states: string[]; postLatenessMs: number[]; releaseMs: number }
/** Arms and dispatches `count` independent attempts; `during` runs alongside (it gets the release instant). */
async function race(count: number, during?: (releaseMs: number, pages: { onPost: Array<() => void> }) => Promise<void> | void): Promise<RaceResult> {
  const releaseMs = Date.now() + 1_200;
  const targets = validatePrecisionTargets([1, 2, 3, 4, 5, 6, 7].slice(0, count).map(court => ({ court, start: '17:00', durationHours: 3 })), date);
  const frozen = freezePrecisionRace(date, releaseMs, targets.map(target => ({ target, plan: precisionTargetPlan(target, date) })));
  const clock = TrustedReleaseClock.fromOffset(0, { method: 'test', sampleCount: 5 });
  const armed = await armPrecisionRace(frozen, { customerFor: () => customer, journalRoot: join(root, `run-${++runNumber}`), releaseMs, now: () => clock.nowMs() });
  const postLatenessMs: number[] = [], hooks: Array<() => void> = targets.map(() => () => undefined);
  const transports = new Map(targets.map((target, index) => [target.workerId, new OndaBrowserSessionTransport(fakePage(() => { postLatenessMs.push(clock.nowMs() - releaseMs); hooks[index]!(); }),
    async () => ({ turnstileToken: 'synthetic-token', publicFingerprint: 'synthetic-print' }))] as const));
  const side = during?.(releaseMs, { onPost: hooks });
  const outcome = await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 500, isAborted: () => false,
    prewarm: async attempt => transports.get(attempt.target.workerId)!.prepareCheckoutContext(), transportFor: worker => transports.get(worker) });
  await side;
  return { states: outcome.results.map(result => result.state), postLatenessMs, releaseMs };
}
const published = (): AvailabilitySnapshot => ({ capturedAt: new Date().toISOString(), fixtureKind: 'live', label: 'test', requestedDates: [date],
  returnedDates: { [date]: true }, incompleteDates: [], slots: [] });
const wait = (ms: number) => new Promise(done => setTimeout(done, Math.max(0, ms)));

describe('Phase 2 observer and telemetry cannot affect checkout', () => {
  let baseline: RaceResult;
  beforeAll(async () => { baseline = await race(3); });

  it('baseline: all three attempts are sent at the release instant', () => {
    expect(baseline.states).toEqual(['REJECTED', 'REJECTED', 'REJECTED']);
    expect(baseline.postLatenessMs).toHaveLength(3);
    for (const lateness of baseline.postLatenessMs) { expect(lateness).toBeGreaterThanOrEqual(0); expect(lateness).toBeLessThan(50); }
  });

  it('an observer GET that hangs does not stop the later early reads, and dispatch is unchanged', async () => {
    let watch: SlotWatch | undefined, call = 0;
    const result = await race(3, async releaseMs => {
      watch = new SlotWatch({ date, releaseMs, directory: join(root, 'watch-hang'), schedule: { availability: [-300, 0, 100, 200, 300], bookings: [] },
        // The T+0 read hangs for 3 s (Onda's release-time reads took 3-6 s); the rest answer in 10 ms.
        readAvailability: (_date, signal) => new Promise((done, fail) => {
          const timer = setTimeout(() => done(published()), ++call === 2 ? 3_000 : 10);
          signal.addEventListener('abort', () => { clearTimeout(timer); fail(Error('ABORTED')); }, { once: true });
        }) });
    });
    // Let the +100/+200/+300 launches happen while the T+0 read is still hanging.
    await wait(result.releaseMs + 450 - Date.now());
    const view = watch!.view();
    expect(view.inFlight).toBe(1);
    const summary = await watch!.stop('test complete');
    const reads = (await readFile(watch!.path, 'utf8')).trim().split('\n').map(line => JSON.parse(line)).filter(line => line.type === 'availability');
    const launched = reads.map(line => [line.seq, line.scheduledOffsetMs, line.requestOffsetMs] as [number, number, number]).sort((a, b) => a[0] - b[0]);
    expect(launched.map(([seq, scheduled]) => [seq, scheduled])).toEqual([[1, -300], [2, 0], [3, 100], [4, 200], [5, 300]]);
    for (const [, scheduled, requested] of launched) { expect(requested).toBeGreaterThanOrEqual(scheduled - 1); expect(requested - scheduled).toBeLessThan(60); }
    expect(reads.find(line => line.seq === 2)).toMatchObject({ outcome: 'aborted' });
    expect(summary.availability).toMatchObject({ launched: 5, answered: 4, aborted: 1, notLaunched: 0, maxInFlight: 2 });
    expect(result.states).toEqual(baseline.states);
    expect(result.postLatenessMs).toHaveLength(3);
    for (const lateness of result.postLatenessMs) expect(lateness).toBeLessThan(50);
  });

  it('an observer that crashes (throwing reader, throwing UI callback, unwritable log) does not cancel checkout', async () => {
    const unhandled: unknown[] = [], onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      let watch: SlotWatch | undefined;
      const result = await race(3, async releaseMs => {
        watch = new SlotWatch({ date, releaseMs, directory: join(root, 'watch-crash'), schedule: { availability: [-200, 0, 50], bookings: [-200, 0] },
          readAvailability: () => { throw Error('OBSERVER_EXPLODED'); }, readBookings: () => Promise.reject(Error('BOOKINGS_EXPLODED')),
          onUpdate: () => { throw Error('UI_EXPLODED'); } });
        // The log handle breaks under the watch: every later write fails.
        closeSync((watch as unknown as { handle: number }).handle);
      });
      await wait(result.releaseMs + 150 - Date.now());
      const summary = await watch!.stop('test complete');
      expect(summary.availability).toMatchObject({ launched: 3, failed: 3, answered: 0 });
      expect(result.states).toEqual(baseline.states);
      for (const lateness of result.postLatenessMs) expect(lateness).toBeLessThan(50);
      await wait(20);
      expect(unhandled).toEqual([]);
    } finally { process.off('unhandledRejection', onUnhandled); }
  });

  it('stopping the observer at the release instant does not cancel checkout', async () => {
    let watch: SlotWatch | undefined, stopped: Promise<unknown> | undefined;
    const result = await race(3, async releaseMs => {
      watch = new SlotWatch({ date, releaseMs, directory: join(root, 'watch-stop'), schedule: { availability: [-200, 0, 100], bookings: [] },
        readAvailability: (_date, signal) => new Promise((done, fail) => { const timer = setTimeout(() => done(published()), 2_000);
          signal.addEventListener('abort', () => { clearTimeout(timer); fail(Error('ABORTED')); }, { once: true }); }) });
      setTimeout(() => { stopped = watch!.stop('release aborted'); }, Math.max(0, releaseMs - Date.now()));
    });
    await wait(result.releaseMs + 50 - Date.now());
    await expect(stopped).resolves.toMatchObject({ status: 'stopped', reason: 'release aborted' });
    expect(result.states).toEqual(baseline.states);
    for (const lateness of result.postLatenessMs) expect(lateness).toBeLessThan(50);
  });

  it('provider-trace failures (attach refused, throwing listeners, failing commands, hostile events) do not fail checkout', async () => {
    const sets: ProviderTraceSet[] = [];
    const result = await race(3, (releaseMs, pages) => {
      const set = new ProviderTraceSet('independence', 'release', releaseMs, () => Date.now() - releaseMs);
      sets.push(set);
      set.start({ workerId: 'A' }, async () => { throw Error('CDP_ATTACH_REFUSED'); });
      set.start({ workerId: 'B' }, async () => ({ on: () => { throw Error('LISTENER_REFUSED'); }, send: async () => ({}) }) as CdpSessionLike);
      // C: a session whose commands fail and whose events explode on every property access.
      const listeners = new Map<string, Listener>();
      set.start({ workerId: 'C' }, async () => ({ on: (event: string, listener: Listener) => { listeners.set(event, listener); }, send: async () => { throw Error('CDP_GONE'); } }) as CdpSessionLike);
      const hostile = new Proxy({}, { get: () => { throw Error('HOSTILE_EVENT'); } });
      // Enabled from inside the dispatch pass (harsher than the runner, which defers it), then hostile events arrive.
      pages.onPost[2] = () => { set.enableAll(); for (const listener of listeners.values()) listener(hostile);
        listeners.get('Network.responseReceived')?.({ requestId: 'x', response: { url: CHECKOUT_TRACE_URL, status: 409, headers: hostile } }); };
    });
    expect(result.states).toEqual(baseline.states);
    for (const lateness of result.postLatenessMs) expect(lateness).toBeLessThan(50);
    const set = sets[0]!;
    await expect(set.persist(join(root, 'trace-failures'))).resolves.toBeTypeOf('string');
    expect(set.statuses().map(value => value.status)).toEqual(['unavailable', 'unavailable', 'unavailable']);
  });

  it('the booking runner does not import the observer or the report builder; the report is built from files after the run', async () => {
    const runner = await readFile('src/api-booking/desktop-runner.ts', 'utf8');
    expect(runner).not.toMatch(/^import[^\n]*(slot-watch|slot-evidence|release-forensics)/m);
    expect(runner).not.toMatch(/\bSlotWatch\b|buildReleaseForensics/);
    // The trace is written only after the Precision dispatch has settled (and again, idempotently, at exit).
    const dispatch = runner.indexOf('await dispatchArmedPrecisionRace('), persist = runner.indexOf('await persistProviderTraces()', dispatch);
    expect(dispatch).toBeGreaterThan(0);
    expect(persist).toBeGreaterThan(dispatch);
    const trace = await readFile('src/api-booking/checkout-provider-trace.ts', 'utf8');
    expect(trace).not.toMatch(/Fetch\.|setRequestInterception|setExtraHTTPHeaders|setCacheDisabled|continueRequest|fulfillRequest|Runtime\./);
  });
});
