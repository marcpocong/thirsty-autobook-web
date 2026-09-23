import { describe, expect, it } from 'vitest';
import {
  assertPrecisionFreezeIntact, classifyPrecisionDispatchError, dispatchPrecisionRace, freezePrecisionRace, precisionTargetPlan,
  reducePrecisionOutcome, validatePrecisionTargets, VerifiedHoldQrError, type PrecisionAttempt, type PrecisionAttemptState,
  type PrecisionDispatchDeps, type PrecisionDispatchResult,
} from '../../src/api-booking/precision-race.js';
import { prooflessRequest, DIRECT_ASSUMED_EVENING_RATE } from '../../src/api-booking/proofless-checkout.js';
import { SubmissionDispatchError } from '../../src/api-booking/submission-errors.js';
import { requiredWorkerIds, planWorkerIds } from '../../src/workers.js';
import { standardCheckoutChunks } from '../../src/api-booking/extended-checkout.js';
import { BookingSetupSchema } from '../../src/config.js';

const date = '2026-09-26';
const releaseMs = Date.parse('2026-09-24T00:00:00.000Z');
const abc = [{ court: 7, start: '17:00', durationHours: 3 }, { court: 5, start: '17:00', durationHours: 3 }, { court: 3, start: '17:00', durationHours: 3 }];
const customer = { clientId: 'c', customerId: 'u', customerEmail: 'e@example.invalid', customerPhone: '09123456789', customerFirstName: 'F', customerLastName: 'P' };

function race(count = 3) {
  const targets = validatePrecisionTargets(abc.slice(0, count), date);
  return freezePrecisionRace(date, releaseMs, targets.map(target => ({ target, plan: precisionTargetPlan(target, date) })));
}

/** Virtual clock: waitUntil jumps time forward, so ordering is deterministic without real delays. */
function harness(overrides: Partial<PrecisionDispatchDeps> & { dispatch: PrecisionDispatchDeps['dispatch'] }) {
  let now = releaseMs - 60_000;
  const events: string[] = [];
  const deps: PrecisionDispatchDeps = {
    now: () => now,
    // Yield a macrotask like a real timer, so in-flight prewarm outcomes settle before time jumps.
    waitUntil: async at => { await new Promise(resolve => setTimeout(resolve, 0)); now = Math.max(now, at); },
    prewarm: async () => undefined,
    prewarmLeadMs: 15_000,
    onEvent: event => events.push(`${event.kind}:${event.workerId}${event.state ? `:${event.state}` : ''}`),
    ...overrides,
  };
  return { deps, events, setNow: (value: number) => { now = value; } };
}

describe('Precision v1 target model', () => {
  it('turns A/B/C into three separate one-court, one-range targets bound to workers A, B, C', () => {
    const targets = validatePrecisionTargets(abc, date);
    expect(targets.map(target => [target.workerId, target.court, target.start, target.end])).toEqual([
      ['A', 7, '17:00', '20:00'], ['B', 5, '17:00', '20:00'], ['C', 3, '17:00', '20:00']]);
    expect(new Set(targets.map(target => target.targetKey)).size).toBe(3);
    expect(targets.every(target => target.assumedAmount === 3 * DIRECT_ASSUMED_EVENING_RATE)).toBe(true);
    for (const target of targets) {
      const plan = precisionTargetPlan(target, date);
      expect(plan.courts.map(court => court.court)).toEqual([target.court]);
      expect(prooflessRequest(plan, customer).items).toHaveLength(3);
      expect(prooflessRequest(plan, customer).items.every(item => item.availabilityProof === null)).toBe(true);
    }
  });
  it('is not COURT_COUNT: General Standard 3 courts stays two workers with a 2+1 checkout split', () => {
    expect(requiredWorkerIds('standard', 3)).toEqual(['A', 'B']);
    const general = precisionTargetPlan(validatePrecisionTargets([abc[0]!], date)[0]!, date);
    expect(standardCheckoutChunks(general)).toHaveLength(1);
    expect(planWorkerIds({ RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: abc, BOOKING_TYPE: 'standard', COURT_COUNT: 1 })).toEqual(['A', 'B', 'C']);
    expect(planWorkerIds({ RELEASE_STRATEGY: 'general', PRECISION_TARGETS: abc, BOOKING_TYPE: 'standard', COURT_COUNT: 3 })).toEqual(['A', 'B']);
    expect(planWorkerIds({ BOOKING_TYPE: 'extended', COURT_COUNT: 7 })).toEqual(requiredWorkerIds('extended', 7));
  });
  it('rejects duplicates, same-court overlaps, bad counts and invalid targets', () => {
    expect(() => validatePrecisionTargets([abc[0]!, abc[0]!], date)).toThrow('PRECISION_TARGET_DUPLICATE');
    expect(() => validatePrecisionTargets([abc[0]!, { court: 7, start: '18:00', durationHours: 3 }], date)).toThrow('PRECISION_TARGET_OVERLAP');
    expect(() => validatePrecisionTargets([abc[0]!, { court: 7, start: '20:00', durationHours: 3 }], date)).not.toThrow();
    expect(() => validatePrecisionTargets([], date)).toThrow('PRECISION_TARGET_COUNT_INVALID');
    expect(() => validatePrecisionTargets([...abc, { court: 1, start: '08:00', durationHours: 1 }], date)).toThrow('PRECISION_TARGET_COUNT_INVALID');
    expect(() => validatePrecisionTargets([{ court: 8, start: '17:00', durationHours: 3 }], date)).toThrow('PRECISION_TARGET_INVALID');
    expect(() => validatePrecisionTargets([{ court: 7, start: '22:00', durationHours: 3 }], date)).toThrow('PRECISION_TARGET_INVALID');
    expect(() => validatePrecisionTargets([{ court: 7, start: '17:00', durationHours: 4 }], date)).toThrow('PRECISION_TARGET_INVALID');
  });
  it('saved-plan schema enforces Proofless Standard and no same-court overlap', () => {
    const base = { BOOKING_METHOD: 'proofless', BOOKING_TYPE: 'standard', COURT_COUNT: 1, START_TIME: '17:00', DURATION_HOURS: 3,
      PREFERRED_COURTS: [7, 6, 5, 4, 3, 2, 1], FALLBACK_TIMES: [], RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: abc };
    expect(BookingSetupSchema.safeParse(base).success).toBe(true);
    expect(BookingSetupSchema.safeParse({ ...base, BOOKING_METHOD: 'api-first' }).success).toBe(false);
    expect(BookingSetupSchema.safeParse({ ...base, PRECISION_TARGETS: [abc[0], { court: 7, start: '19:00', durationHours: 2 }] }).success).toBe(false);
    expect(BookingSetupSchema.safeParse({ ...base, PRECISION_TARGETS: [] }).success).toBe(false);
    const general = BookingSetupSchema.parse({ ...base, RELEASE_STRATEGY: undefined, PRECISION_TARGETS: undefined, BOOKING_METHOD: 'api-first' });
    expect(general.RELEASE_STRATEGY).toBe('general');
  });
});

describe('Precision race-group outcome', () => {
  const reduce = (...states: PrecisionAttemptState[]) => reducePrecisionOutcome(states);
  it('1 attempt success -> objective achieved', () => expect(reduce('QR_READY').outcome).toBe('OBJECTIVE_ACHIEVED'));
  it('verified + rejected + rejected -> objective achieved, not a failed run', () => {
    const summary = reduce('REJECTED', 'REJECTED', 'QR_READY');
    expect(summary).toMatchObject({ outcome: 'OBJECTIVE_ACHIEVED', achieved: true, verifiedCount: 1, rejectedCount: 2, lockReleasable: false });
  });
  it('two verified holds -> extra hold, both counted', () => {
    expect(reduce('QR_READY', 'QR_READY', 'REJECTED')).toMatchObject({ outcome: 'OBJECTIVE_ACHIEVED_EXTRA_HOLD', verifiedCount: 2 });
  });
  it('verified + unknown -> achieved with an unresolved extra attempt; lock retained', () => {
    expect(reduce('QR_READY', 'UNKNOWN')).toMatchObject({ outcome: 'OBJECTIVE_ACHIEVED_UNRESOLVED_EXTRA_ATTEMPT', lockReleasable: false });
  });
  it('no verified hold + one unknown -> not confirmed, manual reconciliation, outranks rejection', () => {
    expect(reduce('REJECTED', 'UNKNOWN', 'REJECTED')).toMatchObject({ outcome: 'OBJECTIVE_NOT_CONFIRMED_MANUAL_RECONCILIATION', achieved: false, lockReleasable: false });
  });
  it('all rejected -> not achieved; lock releasable because nothing can be held', () => {
    expect(reduce('REJECTED', 'REJECTED', 'REJECTED')).toMatchObject({ outcome: 'OBJECTIVE_NOT_ACHIEVED_ALL_REJECTED', lockReleasable: true });
    expect(reduce('REJECTED', 'PREWARM_FAILED')).toMatchObject({ outcome: 'OBJECTIVE_NOT_ACHIEVED_ALL_REJECTED', lockReleasable: true });
  });
  it('nothing dispatched -> not achieved; lock releasable', () => {
    expect(reduce('PREWARM_FAILED', 'WINDOW_MISSED', 'EXCLUDED_BEFORE_FREEZE')).toMatchObject({ outcome: 'OBJECTIVE_NOT_ACHIEVED_NOTHING_DISPATCHED', lockReleasable: true });
  });
  it('one browser/identity/journal failure does not stop the other attempts from achieving the objective', () => {
    expect(reduce('BROWSER_FAILED', 'QR_READY')).toMatchObject({ outcome: 'OBJECTIVE_ACHIEVED', lockReleasable: false });
    expect(reduce('IDENTITY_FAILED', 'JOURNAL_BLOCKED', 'QR_READY')).toMatchObject({ outcome: 'OBJECTIVE_ACHIEVED', unsentCount: 2 });
    expect(reduce('JOURNAL_BLOCKED', 'REJECTED')).toMatchObject({ outcome: 'OBJECTIVE_NOT_ACHIEVED_ALL_REJECTED', lockReleasable: true });
  });
  it('verified hold whose QR page failed still achieves the objective and flags QR attention', () => {
    expect(reduce('HOLD_VERIFIED_QR_ATTENTION', 'REJECTED')).toMatchObject({ outcome: 'OBJECTIVE_ACHIEVED', qrAttention: true, lockReleasable: false });
  });
});

describe('Precision dispatch classification (journal evidence, never worker order)', () => {
  it('maps each failure to the safest supported state', async () => {
    const state = (value?: 'rejected' | 'unknown' | 'verified' | 'dispatching') => async () => value;
    await expect(classifyPrecisionDispatchError(new VerifiedHoldQrError('OFFICIAL_CHECKOUT_ACCESS_FAILED', { bookingId: 'b', holdExpiresAt: 'x', amount: 1 }), state()))
      .resolves.toEqual({ state: 'HOLD_VERIFIED_QR_ATTENTION', code: 'OFFICIAL_CHECKOUT_ACCESS_FAILED' });
    await expect(classifyPrecisionDispatchError(new SubmissionDispatchError('DIRECT_RELEASE_WINDOW_MISSED', false), state('rejected')))
      .resolves.toMatchObject({ state: 'WINDOW_MISSED' });
    await expect(classifyPrecisionDispatchError(new SubmissionDispatchError('PREPARED_SECURITY_CONTEXT_REQUIRED', false), state('rejected')))
      .resolves.toMatchObject({ state: 'NOT_DISPATCHED' });
    await expect(classifyPrecisionDispatchError(Error('SUBMISSION_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED'), state('unknown'))).resolves.toMatchObject({ state: 'UNKNOWN' });
    await expect(classifyPrecisionDispatchError(new SubmissionDispatchError('ONDA_HTTP_STATUS_INVALID', true, undefined, true), state('rejected')))
      .resolves.toMatchObject({ state: 'REJECTED' });
    await expect(classifyPrecisionDispatchError(Error('SOMETHING_AFTER_POST'), state('dispatching'))).resolves.toMatchObject({ state: 'UNKNOWN' });
    await expect(classifyPrecisionDispatchError(Error('SOMETHING_AFTER_POST'), state('verified'))).resolves.toMatchObject({ state: 'HOLD_VERIFIED_QR_ATTENTION' });
    await expect(classifyPrecisionDispatchError(Error('SOMETHING'), async () => { throw Error('EIO'); })).resolves.toMatchObject({ state: 'UNKNOWN' });
    await expect(classifyPrecisionDispatchError(Error('DUPLICATE_LOGICAL_BOOKING_BLOCKED'), state('unknown'))).resolves.toMatchObject({ state: 'NOT_DISPATCHED' });
    await expect(classifyPrecisionDispatchError(Error('BEFORE_JOURNAL'), state(undefined))).resolves.toMatchObject({ state: 'NOT_DISPATCHED' });
  });
});

describe('Precision freeze and independent dispatch', () => {
  it('frozen target set cannot silently mutate', async () => {
    const frozen = race();
    expect(() => { (frozen.attempts as PrecisionAttempt[]).push(frozen.attempts[0]!); }).toThrow();
    expect(() => { (frozen.attempts[0]!.target as { court: number }).court = 1; }).toThrow();
    const forged = { ...frozen, attempts: [...frozen.attempts, frozen.attempts[0]!] };
    expect(() => assertPrecisionFreezeIntact(forged)).toThrow('PRECISION_FROZEN_SET_CHANGED');
    const { deps } = harness({ dispatch: async () => ({ state: 'QR_READY' }) });
    await expect(dispatchPrecisionRace(forged, deps)).rejects.toThrow('PRECISION_FROZEN_SET_CHANGED');
  });

  it('dispatches ready attempts concurrently (no A-then-B chaining)', async () => {
    const started: string[] = [];
    let release!: () => void;
    const allStarted = new Promise<void>(resolve => { release = resolve; });
    const { deps } = harness({ dispatch: async attempt => {
      started.push(attempt.target.workerId);
      if (started.length === 3) release();
      await allStarted; // resolves only if all three are in flight at the same time
      return { state: attempt.target.workerId === 'C' ? 'QR_READY' : 'REJECTED' };
    } });
    const results = await dispatchPrecisionRace(race(), deps);
    expect(started.sort()).toEqual(['A', 'B', 'C']);
    expect(reducePrecisionOutcome(results.map(result => result.state)).outcome).toBe('OBJECTIVE_ACHIEVED');
  });

  it('one prewarm failure does not veto the others (A ready, B failed, C ready)', async () => {
    const dispatched: string[] = [];
    const { deps, events } = harness({
      prewarm: async attempt => { if (attempt.target.workerId === 'B') throw Error('SECURITY_CONTEXT_EMPTY'); },
      dispatch: async attempt => { dispatched.push(attempt.target.workerId); return { state: attempt.target.workerId === 'A' ? 'QR_READY' : 'REJECTED' }; },
    });
    const results = await dispatchPrecisionRace(race(), deps);
    expect(dispatched.sort()).toEqual(['A', 'C']);
    expect(results.find(result => result.attempt.target.workerId === 'B')).toMatchObject({ state: 'PREWARM_FAILED' });
    expect(events.filter(event => event.startsWith('prewarm-retry'))).toEqual(['prewarm-retry:B']);
    expect(reducePrecisionOutcome(results.map(result => result.state)).outcome).toBe('OBJECTIVE_ACHIEVED');
  });

  it('a prewarm that never finishes becomes WINDOW_MISSED for that worker only, without delaying the others', async () => {
    const dispatched: string[] = [];
    const { deps, events } = harness({
      prewarm: attempt => attempt.target.workerId === 'B' ? new Promise(() => undefined) : Promise.resolve(),
      dispatch: async attempt => { dispatched.push(attempt.target.workerId); return { state: 'REJECTED' }; },
    });
    const results = await dispatchPrecisionRace(race(), deps);
    expect(dispatched.sort()).toEqual(['A', 'C']);
    expect(results.find(result => result.attempt.target.workerId === 'B')).toMatchObject({ state: 'WINDOW_MISSED', code: 'PREWARM_NOT_READY_IN_WINDOW' });
    expect(events.indexOf('dispatch-start:A')).toBeLessThan(events.indexOf('settled:B:WINDOW_MISSED'));
  });

  it('retries a failed prewarm only when there is time before release', async () => {
    let calls = 0;
    const h = harness({ prewarm: async () => { calls++; h.setNow(releaseMs - 2_000); throw Error('SECURITY_CONTEXT_EMPTY'); },
      dispatch: async () => ({ state: 'QR_READY' }) });
    const results = await dispatchPrecisionRace(race(1), h.deps);
    expect(calls).toBe(1);
    expect(results[0]).toMatchObject({ state: 'PREWARM_FAILED' });
  });

  it('verified hold + QR restoration failure stays a verified hold (two holds shown independently)', async () => {
    const { deps } = harness({ dispatch: async attempt => attempt.target.workerId === 'A'
      ? classifyPrecisionDispatchError(new VerifiedHoldQrError('OFFICIAL_CHECKOUT_STATE_MISMATCH', { bookingId: 'b1', holdExpiresAt: 'x', amount: 2100 }), async () => 'verified')
      : { state: attempt.target.workerId === 'B' ? 'QR_READY' : 'REJECTED' } as PrecisionDispatchResult });
    const results = await dispatchPrecisionRace(race(), deps);
    expect(results.map(result => [result.attempt.target.workerId, result.state])).toEqual([
      ['A', 'HOLD_VERIFIED_QR_ATTENTION'], ['B', 'QR_READY'], ['C', 'REJECTED']]);
    expect(reducePrecisionOutcome(results.map(result => result.state))).toMatchObject({ outcome: 'OBJECTIVE_ACHIEVED_EXTRA_HOLD', qrAttention: true, verifiedCount: 2 });
  });

  it('an unexpected throw after dispatch is UNKNOWN, never silently rejected', async () => {
    const { deps } = harness({ dispatch: async attempt => { if (attempt.target.workerId === 'B') throw Error('boom'); return { state: 'REJECTED' }; } });
    const results = await dispatchPrecisionRace(race(2), deps);
    expect(results[1]).toMatchObject({ state: 'UNKNOWN' });
    expect(reducePrecisionOutcome(results.map(result => result.state))).toMatchObject({ outcome: 'OBJECTIVE_NOT_CONFIRMED_MANUAL_RECONCILIATION', lockReleasable: false });
  });

  it('nothing dispatched when every prewarm fails', async () => {
    const { deps } = harness({ prewarm: async () => { throw Error('X'); }, dispatch: async () => ({ state: 'QR_READY' }) });
    const results = await dispatchPrecisionRace(race(2), deps);
    expect(reducePrecisionOutcome(results.map(result => result.state))).toMatchObject({ outcome: 'OBJECTIVE_NOT_ACHIEVED_NOTHING_DISPATCHED', lockReleasable: true });
  });

  it('waits for the release instant before any dispatch and prewarms 15 s ahead', async () => {
    const times: Array<[string, number]> = [];
    const h = harness({
      prewarm: async attempt => { times.push([`prewarm:${attempt.target.workerId}`, h.deps.now()]); },
      dispatch: async attempt => { times.push([`dispatch:${attempt.target.workerId}`, h.deps.now()]); return { state: 'REJECTED' }; },
    });
    await dispatchPrecisionRace(race(2), h.deps);
    expect(times.filter(([name]) => name.startsWith('prewarm')).every(([, at]) => at === releaseMs - 15_000)).toBe(true);
    expect(times.filter(([name]) => name.startsWith('dispatch')).every(([, at]) => at >= releaseMs)).toBe(true);
  });
});
