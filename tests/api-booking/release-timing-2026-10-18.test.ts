import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { armPrecisionRace, dispatchArmedPrecisionRace, CLOCK_REFRESH_DEADLINE_LEAD_MS, type ArmedDispatchDeps } from '../../src/api-booking/armed-dispatch.js';
import { BrowserSessionTransportError } from '../../src/api-booking/browser-session-transport.js';
import { consumeSubmissionPermit, DurableSubmissionJournal, isSubmissionPermitUnspent } from '../../src/api-booking/durable-submission-journal.js';
import { freezePrecisionRace, precisionTargetPlan, validatePrecisionTargets } from '../../src/api-booking/precision-race.js';
import type { DirectTransport, ProoflessCheckoutRequest } from '../../src/api-booking/proofless-checkout.js';
import { TrustedReleaseClock } from '../../src/release-clock.js';
import { summarizeRunOutcome } from '../../src/run-outcome.js';

/**
 * Deterministic reproductions of the October 18, 2026 release (Mango Court 7, three strict Shotgun attempts at −1000,
 * −80 and 0 ms on one browser) on the real freeze/arm/dispatch modules. Every request is intercepted locally; nothing
 * leaves the machine. Timelines are compressed (seconds instead of minutes) while the production constants stay.
 */
const date = '2026-10-20', OFFSETS = [-1000, -80, 0];
const customer = { clientId: '00000000-0000-4000-8000-00000000c11e', customerId: '00000000-0000-4000-8000-000000000b00',
  customerEmail: 'fixture@example.invalid', customerPhone: '09123456789', customerFirstName: 'Fixture', customerLastName: 'Player' };
let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'release-1018-')); });
afterEach(async () => { if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw Error('UNSAFE_TEST_PATH'); await rm(root, { recursive: true, force: true }); });

async function armIncident(leadMs: number) {
  const releaseMs = Date.now() + leadMs, target = validatePrecisionTargets([{ court: 7, start: '19:00', durationHours: 3 }], date)[0]!;
  const race = freezePrecisionRace(date, releaseMs, OFFSETS.map(releaseOffsetMs => { const child = { ...target, releaseOffsetMs };
    return { target: child, plan: precisionTargetPlan(child, date), dispatchTimingPolicy: 'SHOTGUN_STRICT' as const }; }));
  const armed = await armPrecisionRace(race, { customerFor: () => customer, journalRoot: root, releaseMs, now: Date.now });
  return { armed, releaseMs, firstTriggerMs: releaseMs - 1000, clock: TrustedReleaseClock.fromOffset(0, { method: 'test', sampleCount: 5 }) };
}
const requestKey = (request: ProoflessCheckoutRequest) => DurableSubmissionJournal.key(request.facilityId, request.items[0]!.spaceId,
  request.items[0]!.date, request.items[0]!.startTime, request.items.at(-1)!.endTime);
/** Honors the real transport contract and answers every POST with an intercepted HTTP 409. */
function interceptedTransport() {
  const posts: number[] = [];
  const transport: DirectTransport = { publicCheckoutProofless: async (request, permit, options) => {
    consumeSubmissionPermit(permit, requestKey(request)); options?.beforePost?.(); posts.push(Date.now());
    throw new BrowserSessionTransportError('ONDA_HTTP_STATUS_INVALID', true, { status: 409, category: 'http-rejection', contentKind: 'json', responseSource: 'application', errorHint: 'availability' }, true);
  } };
  return { transport, posts };
}
/** One browser group, one preparation at a time, tier by tier: the production fan-out prewarm policy. */
const tieredPolicy: Pick<ArmedDispatchDeps, 'prewarmPolicy'> = { prewarmPolicy: { concurrency: 1, perGroupConcurrency: 1, tierBarrierTimeoutMs: 4_000 } };
const states = (outcome: Awaited<ReturnType<typeof dispatchArmedPrecisionRace>>) => outcome.results.map(r => ({ state: r.state, ...(r.code ? { code: r.code } : {}) }));

describe('October 18 release timing (offline, intercepted)', () => {
  it('preparation starts at its planned lead while the final clock consensus rounds run concurrently, and the run settles', async () => {
    const { armed, clock, firstTriggerMs } = await armIncident(6_000), { transport, posts } = interceptedTransport();
    const prewarmStarts: number[] = [], windows: Array<{ lateByMs: number; actualLeadMs: number }> = [];
    let refreshedAt = 0;
    const outcome = await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 4_000, spinTailMs: 0, isAborted: () => false, ...tieredPolicy, transportFor: () => transport,
      // The T-60 s / T-30 s rounds, compressed: consensus settles 2.5 s before the earliest trigger.
      refreshClock: () => new Promise(done => setTimeout(() => { refreshedAt = Date.now(); done(clock); }, Math.max(0, firstTriggerMs - 2_500 - Date.now()))),
      prewarm: async () => { prewarmStarts.push(Date.now()); await new Promise(done => setTimeout(done, 150)); },
      onPrewarmWindow: window => { windows.push(window); } });
    expect(prewarmStarts[0]!).toBeLessThan(refreshedAt);
    expect(windows).toHaveLength(1);
    expect(windows[0]!.lateByMs).toBeLessThan(250);
    expect(windows[0]!.actualLeadMs).toBeGreaterThan(3_700);
    expect(posts).toHaveLength(3);
    const summary = summarizeRunOutcome(states(outcome), 3);
    expect(summary).toMatchObject({ initiated: 3, rejected: 3, unsent: 0, unknown: 0, settled: true, headline: 'ALL SENT ATTEMPTS REJECTED' });
  }, 20_000);

  it('reproduces the original ordering defect: a late coordinator start is reported, and nothing is ever sent late', async () => {
    const { armed, clock, releaseMs } = await armIncident(3_000), { transport, posts } = interceptedTransport();
    const windows: Array<{ lateByMs: number; actualLeadMs: number; plannedLeadMs: number }> = [];
    // Planned lead 10 s, but the coordinator only starts 3 s before release (like 105 s planned vs about 30 s on October 18);
    // every security preparation takes longer than the strict allowance.
    const outcome = await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 10_000, spinTailMs: 0, isAborted: () => false, ...tieredPolicy, transportFor: () => transport,
      prewarm: () => new Promise(done => setTimeout(done, 2_500)), onPrewarmWindow: window => { windows.push(window); } });
    expect(windows[0]!.plannedLeadMs).toBe(10_000);
    expect(windows[0]!.lateByMs).toBeGreaterThan(1_000);
    expect(posts).toEqual([]);
    for (const result of outcome.results) expect(result.state).toBe('NOT_DISPATCHED');
    expect(outcome.results[0]!.code).toBe('SHOTGUN_TRIGGER_MISSED');
    const summary = summarizeRunOutcome(states(outcome), 3);
    expect(summary).toMatchObject({ initiated: 0, unsent: 3, unknown: 0, headline: 'NOTHING DISPATCHED', settled: true });
    expect(Date.now() - releaseMs).toBeLessThan(2_500);
  }, 20_000);

  it('a hung clock refresh fails closed before the first trigger: no request, every attempt recorded unsent, no indefinite wait', async () => {
    const { armed, clock, firstTriggerMs } = await armIncident(5_000), { transport, posts } = interceptedTransport();
    const error = await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 3_000, spinTailMs: 0, isAborted: () => false, transportFor: () => transport,
      refreshClock: () => new Promise(() => undefined), prewarm: async () => undefined }).catch(e => e as Error);
    expect((error as Error).message).toBe('RELEASE_CLOCK_REFRESH_TIMEOUT');
    expect(Date.now()).toBeLessThan(firstTriggerMs - CLOCK_REFRESH_DEADLINE_LEAD_MS + 600);
    expect(posts).toEqual([]);
    for (const attempt of armed.attempts) {
      expect(attempt.state).toBe('disarmed');
      expect(await attempt.journal.read(attempt.key)).toMatchObject({ state: 'rejected', failureCode: 'RELEASE_CLOCK_REFRESH_TIMEOUT' });
    }
  }, 20_000);

  it('a refresh completed after its cutoff is refused even when prewarm starts later', async () => {
    const { armed, clock, firstTriggerMs } = await armIncident(5_000), { transport, posts } = interceptedTransport();
    let reanchored = false;
    // Consensus completes after T-2 s; prewarm begins at T-1 s. Both promises were
    // fulfilled by the old Promise.race, which incorrectly preferred the late refresh.
    await expect(dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 1_000, spinTailMs: 0, isAborted: () => false,
      refreshClock: () => new Promise(done => setTimeout(() => done(clock), Math.max(0, firstTriggerMs - 1_500 - clock.nowMs()))),
      onClockRefreshed: () => { reanchored = true; }, prewarm: async () => undefined, transportFor: () => transport,
    })).rejects.toThrow('RELEASE_CLOCK_REFRESH_TIMEOUT');
    expect(reanchored).toBe(false);
    expect(posts).toEqual([]);
    expect(armed.attempts.every(a => a.state === 'disarmed')).toBe(true);
  }, 20_000);

  it('a refresh that completes after timeout cannot mutate the shared clock or timing evidence', async () => {
    const { armed, clock, releaseMs } = await armIncident(5_000), { transport, posts } = interceptedTransport();
    const deadline = clock.monotonicDeadline(releaseMs);
    let finish!: (clock: TrustedReleaseClock) => void, reanchored = false;
    await expect(dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 3_000, spinTailMs: 0, isAborted: () => false,
      refreshClock: () => new Promise(done => { finish = done; }),
      onClockRefreshed: () => { reanchored = true; }, prewarm: async () => undefined, transportFor: () => transport,
    })).rejects.toThrow('RELEASE_CLOCK_REFRESH_TIMEOUT');
    finish(TrustedReleaseClock.fromOffset(-50, { method: 'late', sampleCount: 5 }));
    await new Promise<void>(done => setImmediate(done));
    expect(clock.monotonicDeadline(releaseMs)).toBe(deadline);
    expect(clock.evidence.method).toBe('test');
    expect(reanchored).toBe(false);
    expect(posts).toEqual([]);
  }, 20_000);

  it('Stop before the prewarm wait notices abort prevents a completed refresh from being adopted', async () => {
    const { armed, clock, releaseMs } = await armIncident(5_000), { transport, posts } = interceptedTransport();
    const deadline = clock.monotonicDeadline(releaseMs);
    let finish!: (clock: TrustedReleaseClock) => void, aborted = false, reanchored = false;
    const outcome = dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 3_000, spinTailMs: 0, isAborted: () => aborted,
      refreshClock: () => new Promise(done => { finish = done; }),
      onClockRefreshed: () => { reanchored = true; }, prewarm: async () => undefined, transportFor: () => transport,
    }).catch(error => error as Error);
    aborted = true;
    finish(TrustedReleaseClock.fromOffset(-50, { method: 'after-stop', sampleCount: 5 }));
    await new Promise<void>(done => setImmediate(done));
    expect(clock.monotonicDeadline(releaseMs)).toBe(deadline);
    expect(reanchored).toBe(false);
    expect(await outcome).toMatchObject({ message: 'USER_ABORT' });
    expect(posts).toEqual([]);
    expect(armed.attempts.every(a => a.state === 'disarmed')).toBe(true);
  }, 20_000);

  it('a stale or failed clock consensus never permits dispatch on untrusted timing', async () => {
    const { armed, clock } = await armIncident(4_000), { transport, posts } = interceptedTransport();
    await expect(dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 3_000, isAborted: () => false, transportFor: () => transport,
      refreshClock: async () => { throw Error('NETWORK_CLOCK_STALE'); }, prewarm: async () => undefined })).rejects.toThrow('NETWORK_CLOCK_STALE');
    expect(posts).toEqual([]);
    expect(armed.attempts.every(a => a.state === 'disarmed')).toBe(true);
  }, 20_000);

  it('zero ready children: every security preparation fails, nothing is sent, and each attempt is recorded as a failed preparation', async () => {
    const { armed, clock, releaseMs } = await armIncident(3_000), { transport, posts } = interceptedTransport();
    const outcome = await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 2_500, spinTailMs: 0, isAborted: () => false, transportFor: () => transport,
      prewarm: async () => { throw Error('ONDA_SECURITY_VERIFICATION_FAILED'); } });
    expect(posts).toEqual([]);
    expect(states(outcome)).toEqual(OFFSETS.map(() => ({ state: 'PREWARM_FAILED', code: 'SECURITY_PREWARM_FAILED' })));
    const summary = summarizeRunOutcome(states(outcome), 3);
    expect(summary).toMatchObject({ initiated: 0, unsent: 3, internalFailures: 3, headline: 'NOTHING DISPATCHED' });
    expect(Date.now() - releaseMs).toBeLessThan(1_500);
  }, 20_000);

  it('a browser closed after preparation fails closed for its attempts (no transport, nothing sent)', async () => {
    const { armed, clock } = await armIncident(3_000), { posts } = interceptedTransport();
    const outcome = await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 2_500, spinTailMs: 0, isAborted: () => false, transportFor: () => undefined, prewarm: async () => undefined });
    expect(posts).toEqual([]);
    expect(states(outcome)).toEqual(OFFSETS.map(() => ({ state: 'NOT_DISPATCHED', code: 'API_CHECKOUT_WORKER_MISSING' })));
  }, 20_000);

  it('Emergency Stop during preparation cancels every unsent attempt and nothing is sent', async () => {
    const { armed, clock } = await armIncident(4_000), { transport, posts } = interceptedTransport();
    let aborted = false; setTimeout(() => { aborted = true; }, 800);
    await expect(dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 3_500, spinTailMs: 0, isAborted: () => aborted, transportFor: () => transport,
      prewarm: () => new Promise(done => setTimeout(done, 200)) })).rejects.toThrow();
    expect(posts).toEqual([]);
    expect(armed.attempts.every(a => a.state === 'disarmed')).toBe(true);
  }, 20_000);

  it('slow diagnostics observers cannot delay the strict triggers', async () => {
    const { armed, clock, releaseMs } = await armIncident(4_000), { transport, posts } = interceptedTransport();
    const busy = (ms: number) => { const end = performance.now() + ms; while (performance.now() < end) { /* a slow observer */ } };
    await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 3_000, spinTailMs: 0, isAborted: () => false, transportFor: () => transport, prewarm: async () => undefined,
      onEvent: () => busy(40), onPrewarmWindow: () => busy(40), onPrewarmStatus: () => busy(40) });
    expect(posts).toHaveLength(3);
    posts.forEach((at, index) => { const late = at - (releaseMs + OFFSETS[index]!); expect(late).toBeGreaterThanOrEqual(0); expect(late).toBeLessThanOrEqual(50); });
  }, 20_000);
});

describe('October 18 follow-up: release-critical bounds (offline, intercepted)', () => {
  it('Stop pressed as a late-ready strict POST leaves still settles that POST and only cancels later unsent attempts', async () => {
    const { armed, clock, firstTriggerMs } = await armIncident(4_000), posts: number[] = [];
    let aborted = false;
    // The −1000 ms child becomes ready 20 ms after its trigger (inside its 50 ms allowance) and is fired from the
    // readiness callback while the trigger loop is already waiting; Stop arrives the instant that POST leaves.
    const transport: DirectTransport = { publicCheckoutProofless: async (request, permit, options) => {
      consumeSubmissionPermit(permit, requestKey(request)); options?.beforePost?.(); posts.push(Date.now()); aborted = true;
      throw new BrowserSessionTransportError('ONDA_HTTP_STATUS_INVALID', true, { status: 409, category: 'http-rejection', contentKind: 'json', responseSource: 'application', errorHint: 'availability' }, true);
    } };
    const outcome = await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 3_000, spinTailMs: 0, isAborted: () => aborted, transportFor: () => transport,
      prewarm: attempt => attempt.attempt.fanOutIndex === 0 ? new Promise(done => setTimeout(done, Math.max(0, firstTriggerMs + 20 - Date.now()))) : Promise.resolve() });
    expect(posts).toHaveLength(1);
    expect(posts[0]! - firstTriggerMs).toBeGreaterThanOrEqual(0);
    expect(posts[0]! - firstTriggerMs).toBeLessThanOrEqual(50);
    expect(outcome.results[0]).toMatchObject({ state: 'REJECTED' });
    for (const result of outcome.results.slice(1)) expect(result.state).toBe('NOT_DISPATCHED');
    expect(armed.attempts[0]!.state).toBe('fired');
    expect(summarizeRunOutcome(states(outcome), 3)).toMatchObject({ initiated: 1, rejected: 1, unsent: 2, unknown: 0, settled: true });
  }, 20_000);

  it('a throwing trigger-path telemetry callback (onWake/onMark) never cancels or abandons a POST', async () => {
    const { armed, clock, releaseMs } = await armIncident(3_000), { transport, posts } = interceptedTransport();
    const outcome = await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 2_500, spinTailMs: 0, isAborted: () => false, transportFor: () => transport,
      prewarm: async () => undefined, onWake: () => { throw Error('RECORDER_BROKEN'); }, onMark: () => { throw Error('RECORDER_BROKEN'); } });
    expect(posts).toHaveLength(3);
    posts.forEach((at, index) => { const late = at - (releaseMs + OFFSETS[index]!); expect(late).toBeGreaterThanOrEqual(0); expect(late).toBeLessThanOrEqual(50); });
    expect(outcome.results.map(r => r.state)).toEqual(['REJECTED', 'REJECTED', 'REJECTED']);
  }, 20_000);

  it('Emergency Stop while a clock refresh is outstanding settles promptly as USER_ABORT, not at the refresh cutoff', async () => {
    const { armed, clock, firstTriggerMs } = await armIncident(5_000), { transport, posts } = interceptedTransport();
    let aborted = false; setTimeout(() => { aborted = true; }, Math.max(0, firstTriggerMs - 3_800 - Date.now()));
    const error = await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 4_000, spinTailMs: 0, isAborted: () => aborted, transportFor: () => transport,
      refreshClock: () => new Promise(() => undefined), prewarm: async () => undefined }).catch(e => e as Error);
    expect((error as Error).message).toBe('USER_ABORT');
    expect(Date.now()).toBeLessThan(firstTriggerMs - 3_000);
    expect(posts).toEqual([]);
    for (const attempt of armed.attempts) expect(await attempt.journal.read(attempt.key)).toMatchObject({ state: 'rejected', failureCode: 'USER_ABORT' });
  }, 20_000);

  it('Stop after an earlier shot expired unsent journals that shot as unsent too (never left armed for manual reconciliation)', async () => {
    const { armed, clock, firstTriggerMs } = await armIncident(3_000), { transport, posts } = interceptedTransport();
    let aborted = false; setTimeout(() => { aborted = true; }, Math.max(0, firstTriggerMs + 400 - Date.now()));
    // The −1000 ms shot never becomes ready and expires at −950 ms; Stop arrives at −600 ms, before the −80 ms trigger.
    await expect(dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 2_500, spinTailMs: 0, isAborted: () => aborted, transportFor: () => transport,
      prewarm: attempt => attempt.attempt.fanOutIndex === 0 ? new Promise(() => undefined) : Promise.resolve() })).rejects.toThrow('USER_ABORT');
    expect(posts).toEqual([]);
    expect(armed.attempts.map(attempt => attempt.state)).toEqual(['refused', 'disarmed', 'disarmed']);
    expect(await armed.attempts[0]!.journal.read(armed.attempts[0]!.key)).toMatchObject({ state: 'rejected', failureCode: 'SHOTGUN_TRIGGER_MISSED' });
    for (const attempt of armed.attempts.slice(1)) expect(await attempt.journal.read(attempt.key)).toMatchObject({ state: 'rejected', failureCode: 'USER_ABORT' });
  }, 20_000);

  it('telemetry deferred through the final second is still delivered when the run fails closed inside it', async () => {
    const { armed, clock, firstTriggerMs } = await armIncident(3_000), { transport, posts } = interceptedTransport();
    const events: string[] = [];
    let aborted = false; setTimeout(() => { aborted = true; }, Math.max(0, firstTriggerMs - 300 - Date.now()));
    // The −80 ms child's preparation fails 700 ms before the first trigger (inside the deferral window); Stop follows.
    await expect(dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 2_500, spinTailMs: 0, isAborted: () => aborted, transportFor: () => transport,
      prewarm: attempt => attempt.attempt.fanOutIndex === 1 ? new Promise((_, fail) => setTimeout(() => fail(Error('ONDA_SECURITY_VERIFICATION_FAILED')), Math.max(0, firstTriggerMs - 700 - Date.now()))) : Promise.resolve(),
      onEvent: event => { events.push(`${event.kind}:${event.code ?? ''}`); } })).rejects.toThrow('USER_ABORT');
    expect(posts).toEqual([]);
    expect(events).toContain('prewarm-failed:ONDA_SECURITY_VERIFICATION_FAILED');
  }, 20_000);

  it('a delayed refresh that settles before its cutoff re-anchors dispatch: every POST follows the refreshed trusted clock', async () => {
    const { armed, clock, firstTriggerMs, releaseMs } = await armIncident(5_000), trusted: number[] = [], wall: number[] = [];
    const transport: DirectTransport = { publicCheckoutProofless: async (request, permit, options) => {
      consumeSubmissionPermit(permit, requestKey(request)); options?.beforePost?.(); trusted.push(clock.nowMs()); wall.push(Date.now());
      throw new BrowserSessionTransportError('ONDA_HTTP_STATUS_INVALID', true, { status: 409, category: 'http-rejection', contentKind: 'json', responseSource: 'application', errorHint: 'availability' }, true);
    } };
    let reanchored = 0;
    // Consensus answers 2.4 s before the earliest trigger: network time is 40 ms ahead of the local clock.
    await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 4_000, spinTailMs: 0, isAborted: () => false, transportFor: () => transport, prewarm: async () => undefined,
      refreshClock: () => new Promise(done => setTimeout(() => done(TrustedReleaseClock.fromOffset(40, { method: 'refreshed', sampleCount: 6 })), Math.max(0, firstTriggerMs - 2_400 - Date.now()))),
      onClockRefreshed: () => { reanchored++; } });
    expect(reanchored).toBe(1);
    expect(clock.evidence.method).toBe('refreshed');
    expect(trusted).toHaveLength(3);
    trusted.forEach((at, index) => { const late = at - (releaseMs + OFFSETS[index]!); expect(late).toBeGreaterThanOrEqual(0); expect(late).toBeLessThanOrEqual(50); });
    // On the local wall clock every POST therefore left about 40 ms before its nominal instant.
    wall.forEach((at, index) => expect(at - (releaseMs + OFFSETS[index]!)).toBeLessThan(20));
  }, 20_000);

  it('a refresh that would move release more than 100 ms EARLIER is not adopted; dispatch stays on the previous clock', async () => {
    const { armed, clock, firstTriggerMs, releaseMs } = await armIncident(5_000), { transport, posts } = interceptedTransport();
    await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 4_000, spinTailMs: 0, isAborted: () => false, transportFor: () => transport, prewarm: async () => undefined,
      refreshClock: () => new Promise(done => setTimeout(() => done(TrustedReleaseClock.fromOffset(500, { method: 'jump', sampleCount: 6 })), Math.max(0, firstTriggerMs - 3_500 - Date.now()))) });
    expect(clock.evidence.method).toBe('test');
    expect(posts).toHaveLength(3);
    posts.forEach((at, index) => { const late = at - (releaseMs + OFFSETS[index]!); expect(late).toBeGreaterThanOrEqual(0); expect(late).toBeLessThanOrEqual(50); });
  }, 20_000);

  it('one tier ready, the next still preparing at its trigger, the last omitted: only the ready shot is sent and each reason is exact', async () => {
    const { armed, clock, releaseMs } = await armIncident(4_500), { transport, posts } = interceptedTransport();
    // Tier 1 prepares in 100 ms; tier 2 never finishes (a challenge that never resolves); tier 3 cannot start before stop-starting.
    const outcome = await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 3_500, spinTailMs: 0, isAborted: () => false, ...tieredPolicy, transportFor: () => transport,
      prewarm: attempt => attempt.attempt.fanOutIndex === 0 ? new Promise(done => setTimeout(done, 100)) : new Promise(() => undefined) });
    expect(posts).toHaveLength(1);
    expect(states(outcome)).toEqual([{ state: 'REJECTED', code: 'ONDA_HTTP_STATUS_INVALID' }, { state: 'NOT_DISPATCHED', code: 'SHOTGUN_TRIGGER_MISSED' },
      { state: 'NOT_DISPATCHED', code: 'PREWARM_TIER_OMITTED' }]);
    for (const attempt of armed.attempts.slice(1)) expect(isSubmissionPermitUnspent(attempt.permit)).toBe(false);
    expect(await armed.attempts[1]!.journal.read(armed.attempts[1]!.key)).toMatchObject({ state: 'rejected', failureCode: 'SHOTGUN_TRIGGER_MISSED' });
    expect(await armed.attempts[2]!.journal.read(armed.attempts[2]!.key)).toMatchObject({ state: 'rejected', failureCode: 'PREWARM_TIER_OMITTED' });
    expect(Date.now() - releaseMs).toBeLessThan(2_000);
  }, 20_000);

  it('a browser that disconnects during one preparation fails only that shot; the prepared shots dispatch on time', async () => {
    const { armed, clock, releaseMs } = await armIncident(3_000), { transport, posts } = interceptedTransport();
    const outcome = await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 2_500, spinTailMs: 0, isAborted: () => false, transportFor: () => transport,
      prewarm: attempt => attempt.attempt.fanOutIndex === 1 ? new Promise((_, fail) => setTimeout(() => fail(Error('BROWSER_DISCONNECTED')), 100)) : Promise.resolve() });
    expect(states(outcome)).toEqual([{ state: 'REJECTED', code: 'ONDA_HTTP_STATUS_INVALID' }, { state: 'PREWARM_FAILED', code: 'SECURITY_PREWARM_FAILED' },
      { state: 'REJECTED', code: 'ONDA_HTTP_STATUS_INVALID' }]);
    expect(posts.map((at, index) => at - (releaseMs + [OFFSETS[0]!, OFFSETS[2]!][index]!)).every(late => late >= 0 && late <= 50)).toBe(true);
  }, 20_000);

  it('a process stall across the first trigger misses only that shot (permit revoked) and later shots still leave on time', async () => {
    const { armed, clock, releaseMs } = await armIncident(3_000), { transport, posts } = interceptedTransport();
    // The event loop is blocked from T-1000 ms until T-920 ms: the −1000 ms shot is past its 50 ms allowance when the loop resumes.
    const outcome = await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 2_500, spinTailMs: 0, isAborted: () => false, transportFor: () => transport, prewarm: async () => undefined,
      onFinalApproach: () => { const end = releaseMs - 920; while (Date.now() < end) { /* stalled */ } } });
    expect(states(outcome)).toEqual([{ state: 'NOT_DISPATCHED', code: 'SHOTGUN_TRIGGER_MISSED' }, { state: 'REJECTED', code: 'ONDA_HTTP_STATUS_INVALID' },
      { state: 'REJECTED', code: 'ONDA_HTTP_STATUS_INVALID' }]);
    expect(isSubmissionPermitUnspent(armed.attempts[0]!.permit)).toBe(false);
    expect(posts).toHaveLength(2);
    posts.forEach((at, index) => { const late = at - (releaseMs + OFFSETS[index + 1]!); expect(late).toBeGreaterThanOrEqual(0); expect(late).toBeLessThanOrEqual(50); });
  }, 20_000);

  it('a stall past every strict deadline sends nothing and settles with every shot unsent', async () => {
    const { armed, clock, releaseMs } = await armIncident(3_000), { transport, posts } = interceptedTransport();
    const outcome = await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 2_500, spinTailMs: 0, isAborted: () => false, transportFor: () => transport, prewarm: async () => undefined,
      onFinalApproach: () => { const end = releaseMs + 200; while (Date.now() < end) { /* stalled */ } } });
    expect(posts).toEqual([]);
    expect(states(outcome)).toEqual(OFFSETS.map(() => ({ state: 'NOT_DISPATCHED', code: 'SHOTGUN_TRIGGER_MISSED' })));
    expect(armed.attempts.every(attempt => !isSubmissionPermitUnspent(attempt.permit))).toBe(true);
    expect(summarizeRunOutcome(states(outcome), 3)).toMatchObject({ initiated: 0, unsent: 3, settled: true, headline: 'NOTHING DISPATCHED' });
  }, 20_000);
});

/** `workers` targets (courts 7, 6, …), each with one strict child per offset (fan-out index = offset order). */
async function armTopology(workers: number, offsets: readonly number[], leadMs: number) {
  const releaseMs = Date.now() + leadMs;
  const targets = validatePrecisionTargets(Array.from({ length: workers }, (_, index) => ({ court: 7 - index, start: '19:00', durationHours: 3 })), date);
  const race = freezePrecisionRace(date, releaseMs, targets.flatMap(target => offsets.map(releaseOffsetMs => { const child = { ...target, releaseOffsetMs };
    return { target: child, plan: precisionTargetPlan(child, date), dispatchTimingPolicy: 'SHOTGUN_STRICT' as const }; })));
  const armed = await armPrecisionRace(race, { customerFor: () => customer, journalRoot: root, releaseMs, now: Date.now });
  return { armed, releaseMs, clock: TrustedReleaseClock.fromOffset(0, { method: 'test', sampleCount: 5 }) };
}
/** Records each POST against its attempt's own trigger; every POST is an intercepted 409. */
function topologyTransport(armed: Awaited<ReturnType<typeof armTopology>>['armed']) {
  const triggerOf = new Map(armed.attempts.map(attempt => [attempt.permit, attempt.triggerMs] as const)), lateness: number[] = [];
  const transport: DirectTransport = { publicCheckoutProofless: async (request, permit, options) => {
    consumeSubmissionPermit(permit, requestKey(request)); options?.beforePost?.(); lateness.push(Date.now() - triggerOf.get(permit)!);
    throw new BrowserSessionTransportError('ONDA_HTTP_STATUS_INVALID', true, { status: 409, category: 'http-rejection', contentKind: 'json', responseSource: 'application', errorHint: 'availability' }, true);
  } };
  return { transport, lateness };
}

describe('larger supported topologies (offline, intercepted)', () => {
  for (const [workers, offsets] of [[7, [-1000, -80, -40, 0]], [7, [-1000, -500, -200, -80, -40, 0]], [3, [-300, -100, 0]]] as const) {
    it(`${workers} browsers × ${offsets.length} strict shots: every ready shot leaves inside its own [trigger, trigger + 50 ms] exactly once`, async () => {
      const { armed, clock } = await armTopology(workers, offsets, 5_500), { transport, lateness } = topologyTransport(armed);
      const outcome = await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 3_800, spinTailMs: 0, isAborted: () => false, transportFor: () => transport,
        prewarmPolicy: { concurrency: workers, perGroupConcurrency: 1, tierBarrierTimeoutMs: 4_000 }, prewarm: () => new Promise(done => setTimeout(done, 40)) });
      expect(lateness).toHaveLength(workers * offsets.length);
      for (const late of lateness) { expect(late).toBeGreaterThanOrEqual(0); expect(late).toBeLessThanOrEqual(50); }
      expect(armed.attempts.every(attempt => attempt.state === 'fired' && !isSubmissionPermitUnspent(attempt.permit))).toBe(true);
      expect(summarizeRunOutcome(states(outcome), workers * offsets.length)).toMatchObject({ initiated: workers * offsets.length, rejected: workers * offsets.length, unsent: 0, settled: true });
    }, 30_000);
  }

  it('7 browsers × 4 shots with capacity for two tiers: tiers 1–2 dispatch, tiers 3–4 are omitted (never sent late)', async () => {
    const { armed, clock } = await armTopology(7, [-1000, -80, -40, 0], 5_000), { transport, lateness } = topologyTransport(armed);
    // One preparation per browser, 700 ms each, from T-5 s: tier 2 starts about 3.3 s before the first trigger, tier 3 would start after stop-starting (T-3 s).
    const outcome = await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 4_000, spinTailMs: 0, isAborted: () => false, transportFor: () => transport,
      prewarmPolicy: { concurrency: 7, perGroupConcurrency: 1, tierBarrierTimeoutMs: Infinity }, prewarm: () => new Promise(done => setTimeout(done, 700)) });
    const byTier = (tier: number) => outcome.results.filter(result => result.attempt.fanOutIndex === tier).map(result => result.state);
    expect(byTier(0)).toEqual(Array(7).fill('REJECTED'));
    expect(byTier(1)).toEqual(Array(7).fill('REJECTED'));
    for (const tier of [2, 3]) expect(outcome.results.filter(result => result.attempt.fanOutIndex === tier).map(result => result.code)).toEqual(Array(7).fill('PREWARM_TIER_OMITTED'));
    expect(lateness).toHaveLength(14);
    for (const late of lateness) { expect(late).toBeGreaterThanOrEqual(0); expect(late).toBeLessThanOrEqual(50); }
    expect(summarizeRunOutcome(states(outcome), 28)).toMatchObject({ initiated: 14, unsent: 14, unknown: 0, settled: true, unsentReasons: { PREWARM_TIER_OMITTED: 14 } });
  }, 30_000);
});
