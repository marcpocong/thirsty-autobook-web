import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { armPrecisionRace, dispatchArmedPrecisionRace, CLOCK_REFRESH_DEADLINE_LEAD_MS, type ArmedDispatchDeps } from '../../src/api-booking/armed-dispatch.js';
import { BrowserSessionTransportError } from '../../src/api-booking/browser-session-transport.js';
import { consumeSubmissionPermit, DurableSubmissionJournal } from '../../src/api-booking/durable-submission-journal.js';
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
