import { describe, expect, it } from 'vitest';
import {
  assertPrecisionFreezeIntact, classifyPrecisionDispatchError, dispatchPrecisionRace, freezePrecisionRace, precisionAttemptSet, precisionTargetPlan,
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
    expect(() => validatePrecisionTargets([...abc, { court: 1, start: '08:00', durationHours: 1 }], date)).not.toThrow();
    expect(() => validatePrecisionTargets(Array.from({ length: 8 }, (_, i) => ({ court: (i % 7) + 1, start: i < 7 ? '17:00' : '08:00', durationHours: 1 })), date)).toThrow('PRECISION_TARGET_COUNT_INVALID');
    expect(() => validatePrecisionTargets([{ court: 8, start: '17:00', durationHours: 3 }], date)).toThrow('PRECISION_TARGET_INVALID');
    expect(() => validatePrecisionTargets([{ court: 7, start: '22:00', durationHours: 3 }], date)).toThrow('PRECISION_TARGET_INVALID');
    expect(() => validatePrecisionTargets([{ court: 7, start: '17:00', durationHours: 4 }], date)).toThrow('PRECISION_TARGET_INVALID');
  });
  it('fans each worker goal out to four independently identified attempts in that worker browser', () => {
    const inputs = [
      { ...abc[0]!, fanOutReleaseOffsetsMs: [-25, -10, 0, -100] },
      { ...abc[1]!, fanOutReleaseOffsetsMs: [-20, 0, -250, -500] },
    ];
    const targets = validatePrecisionTargets(inputs, date, true);
    const frozen = freezePrecisionRace(date, releaseMs, precisionAttemptSet(targets, date, true));
    expect(frozen.fanOut).toBe(true);
    expect(frozen.attempts.map(attempt => attempt.target.workerId)).toEqual(['A', 'A', 'A', 'A', 'B', 'B', 'B', 'B']);
    expect(new Set(frozen.attempts.map(attempt => attempt.id)).size).toBe(8);
    expect(new Set(frozen.attempts.map(attempt => attempt.target.targetKey)).size).toBe(2);
    expect(frozen.attempts.map(attempt => [attempt.fanOutIndex, attempt.fanOutCount])).toEqual(
      [[0, 4], [1, 4], [2, 4], [3, 4], [0, 4], [1, 4], [2, 4], [3, 4]]);
    expect(frozen.attempts.map(attempt => attempt.target.releaseOffsetMs ?? 0)).toEqual([-25, -10, 0, -100, -20, 0, -250, -500]);
  });
  it('requires four offsets for every fan-out worker while allowing different worker goals', () => {
    expect(() => validatePrecisionTargets([{ ...abc[0]!, fanOutReleaseOffsetsMs: [0, -10, -20, -30] }], date, true)).not.toThrow();
    expect(() => validatePrecisionTargets([
      { ...abc[0]!, fanOutReleaseOffsetsMs: [0, -10, -20, -30] },
      { ...abc[1]!, fanOutReleaseOffsetsMs: [0, -5, -15, -25] },
    ], date, true)).not.toThrow();
    expect(() => validatePrecisionTargets([{ ...abc[0]!, fanOutReleaseOffsetsMs: [0, -10, -20] }], date, true))
      .toThrow('PRECISION_FAN_OUT_OFFSETS_INVALID');
    expect(() => validatePrecisionTargets([abc[0]!], date, true)).toThrow('PRECISION_FAN_OUT_OFFSETS_INVALID');
  });
  it('saved-plan schema enforces Proofless Standard and no same-court overlap', () => {
    const base = { BOOKING_METHOD: 'proofless', BOOKING_TYPE: 'standard', COURT_COUNT: 1, START_TIME: '17:00', DURATION_HOURS: 3,
      PREFERRED_COURTS: [7, 6, 5, 4, 3, 2, 1], FALLBACK_TIMES: [], RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: abc };
    expect(BookingSetupSchema.safeParse(base).success).toBe(true);
    expect(BookingSetupSchema.safeParse({ ...base, BOOKING_METHOD: 'api-first' }).success).toBe(false);
    expect(BookingSetupSchema.safeParse({ ...base, PRECISION_TARGETS: [abc[0], { court: 7, start: '19:00', durationHours: 2 }] }).success).toBe(false);
    expect(BookingSetupSchema.safeParse({ ...base, PRECISION_TARGETS: [] }).success).toBe(false);
    const fanOutTargets = [
      { ...abc[0]!, fanOutReleaseOffsetsMs: [0, -10, -20, -30] },
      { ...abc[1]!, fanOutReleaseOffsetsMs: [0, -5, -15, -25] },
    ];
    expect(BookingSetupSchema.safeParse({ ...base, PRECISION_FAN_OUT: true, PRECISION_TARGETS: fanOutTargets }).success).toBe(true);
    expect(BookingSetupSchema.safeParse({ ...base, PRECISION_FAN_OUT: true, PRECISION_TARGETS: [{ ...abc[0]!, fanOutReleaseOffsetsMs: [0, -10, -20] }] }).success).toBe(false);
    expect(BookingSetupSchema.safeParse({ ...base, PRECISION_FAN_OUT: true, PRECISION_TARGETS: [abc[0]] }).success).toBe(false);
    expect(BookingSetupSchema.safeParse({ ...base, RELEASE_STRATEGY: 'general', PRECISION_FAN_OUT: true }).success).toBe(false);
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

describe('Precision A-G: up to seven independent one-court attempts', () => {
  const seven = [1, 2, 3, 4, 5, 6, 7].map(court => ({ court, start: '17:00', durationHours: 3 }));
  const freezeSeven = (inputs = seven) => {
    const targets = validatePrecisionTargets(inputs, date);
    return freezePrecisionRace(date, releaseMs, targets.map(target => ({ target, plan: precisionTargetPlan(target, date) })));
  };
  const plan = (count: number) => planWorkerIds({ RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: seven.slice(0, count), BOOKING_TYPE: 'standard', COURT_COUNT: 1 });

  it('maps target rows directly to workers: 1->A, 3->A-C, 4->A-D, 7->A-G; never H', () => {
    expect(plan(1)).toEqual(['A']);
    expect(plan(3)).toEqual(['A', 'B', 'C']);
    expect(plan(4)).toEqual(['A', 'B', 'C', 'D']);
    expect(plan(7)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    expect(validatePrecisionTargets(seven, date).map(target => target.workerId)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    expect(plan(7)).not.toContain('H');
  });

  it('rejects an 8th attempt in both the race model and the saved-plan schema', () => {
    const eight = [...seven, { court: 1, start: '08:00', durationHours: 1 }];
    expect(() => validatePrecisionTargets(eight, date)).toThrow('PRECISION_TARGET_COUNT_INVALID');
    const base = { BOOKING_METHOD: 'proofless', BOOKING_TYPE: 'standard', COURT_COUNT: 1, START_TIME: '17:00', DURATION_HOURS: 3,
      PREFERRED_COURTS: [7, 6, 5, 4, 3, 2, 1], FALLBACK_TIMES: [], RELEASE_STRATEGY: 'precision' };
    expect(BookingSetupSchema.safeParse({ ...base, PRECISION_TARGETS: seven }).success).toBe(true);
    expect(BookingSetupSchema.safeParse({ ...base, PRECISION_TARGETS: eight }).success).toBe(false);
    expect(BookingSetupSchema.safeParse({ ...base, PRECISION_TARGETS: [...seven.slice(0, 6), { court: 1, start: '18:00', durationHours: 2 }] }).success).toBe(false);
    expect(BookingSetupSchema.safeParse({ ...base, PRECISION_TARGETS: [...seven.slice(0, 6), seven[0]!] }).success).toBe(false);
  });

  it('seven targets become seven one-court plans and seven one-court requests (no 2-court chunks)', () => {
    const targets = validatePrecisionTargets(seven, date);
    const plans = targets.map(target => precisionTargetPlan(target, date));
    expect(plans).toHaveLength(7);
    for (const [index, value] of plans.entries()) {
      expect(value.courts.map(court => court.court)).toEqual([index + 1]);
      expect(value.chunks).toHaveLength(1);
      expect(value.chunks[0]!.courts).toHaveLength(1);
      const request = prooflessRequest(value, customer);
      expect(new Set(request.items.map(item => item.spaceId)).size).toBe(1);
      expect(request.items).toHaveLength(3);
    }
    expect(new Set(targets.map(target => target.targetKey)).size).toBe(7);
    // General Release is unchanged: 7 Standard courts still means four grouped checkouts on A-D.
    expect(requiredWorkerIds('standard', 7)).toEqual(['A', 'B', 'C', 'D']);
    expect(requiredWorkerIds('extended', 7)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  });

  it('all seven ready attempts enter dispatch concurrently (seven independent single-target calls)', async () => {
    const started: string[] = [];
    let release!: () => void;
    const allStarted = new Promise<void>(resolve => { release = resolve; });
    const { deps } = harness({ dispatch: async attempt => {
      expect(attempt.plan.courts).toHaveLength(1);
      started.push(attempt.target.workerId);
      if (started.length === 7) release();
      await allStarted;
      return { state: attempt.target.workerId === 'A' ? 'QR_READY' : 'REJECTED' };
    } });
    const results = await dispatchPrecisionRace(freezeSeven(), deps);
    expect(started.sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    expect(reducePrecisionOutcome(results.map(result => result.state)).outcome).toBe('OBJECTIVE_ACHIEVED');
  });

  it('one prewarm failure out of seven (C) does not veto the other six', async () => {
    const dispatched: string[] = [];
    const { deps } = harness({
      prewarm: async attempt => { if (attempt.target.workerId === 'C') throw Error('SECURITY_CONTEXT_EMPTY'); },
      dispatch: async attempt => { dispatched.push(attempt.target.workerId); return { state: 'REJECTED' }; },
    });
    const results = await dispatchPrecisionRace(freezeSeven(), deps);
    expect(dispatched.sort()).toEqual(['A', 'B', 'D', 'E', 'F', 'G']);
    expect(results.find(result => result.attempt.target.workerId === 'C')).toMatchObject({ state: 'PREWARM_FAILED' });
  });

  it('D and G identity failures only disable those two attempts; the other five still dispatch', async () => {
    // The runner records IDENTITY_FAILED before freeze and freezes only the remaining eligible targets.
    const targets = validatePrecisionTargets(seven, date).filter(target => !['D', 'G'].includes(target.workerId));
    expect(targets.map(target => target.workerId)).toEqual(['A', 'B', 'C', 'E', 'F']);
    const frozen = freezePrecisionRace(date, releaseMs, targets.map(target => ({ target, plan: precisionTargetPlan(target, date) })));
    const dispatched: string[] = [];
    const { deps } = harness({ dispatch: async attempt => { dispatched.push(attempt.target.workerId); return { state: attempt.target.workerId === 'E' ? 'QR_READY' : 'REJECTED' }; } });
    const results = await dispatchPrecisionRace(frozen, deps);
    expect(dispatched.sort()).toEqual(['A', 'B', 'C', 'E', 'F']);
    const summary = reducePrecisionOutcome([...results.map(result => result.state), 'IDENTITY_FAILED', 'IDENTITY_FAILED']);
    expect(summary).toMatchObject({ outcome: 'OBJECTIVE_ACHIEVED', verifiedCount: 1, rejectedCount: 4, unsentCount: 2, lockReleasable: false });
  });

  it('reduces mixed seven-worker results correctly', () => {
    const reduce = (states: PrecisionAttemptState[]) => reducePrecisionOutcome(states);
    expect(reduce(['QR_READY', 'REJECTED', 'REJECTED', 'REJECTED', 'REJECTED', 'REJECTED', 'REJECTED']).outcome).toBe('OBJECTIVE_ACHIEVED');
    expect(reduce(['QR_READY', 'REJECTED', 'REJECTED', 'QR_READY', 'REJECTED', 'REJECTED', 'REJECTED'])).toMatchObject({ outcome: 'OBJECTIVE_ACHIEVED_EXTRA_HOLD', verifiedCount: 2 });
    expect(reduce(['QR_READY', 'REJECTED', 'REJECTED', 'REJECTED', 'REJECTED', 'UNKNOWN', 'REJECTED'])).toMatchObject({ outcome: 'OBJECTIVE_ACHIEVED_UNRESOLVED_EXTRA_ATTEMPT', lockReleasable: false });
    expect(reduce(Array(7).fill('REJECTED'))).toMatchObject({ outcome: 'OBJECTIVE_NOT_ACHIEVED_ALL_REJECTED', lockReleasable: true });
    expect(reduce(['PREWARM_FAILED', 'WINDOW_MISSED', 'BROWSER_FAILED', 'IDENTITY_FAILED', 'JOURNAL_BLOCKED', 'EXCLUDED_BEFORE_FREEZE', 'NOT_DISPATCHED']))
      .toMatchObject({ outcome: 'OBJECTIVE_NOT_ACHIEVED_NOTHING_DISPATCHED', lockReleasable: true, unsentCount: 7 });
    expect(reduce(['QR_READY', 'QR_READY', 'HOLD_VERIFIED_QR_ATTENTION', 'QR_READY', 'QR_READY', 'QR_READY', 'QR_READY']))
      .toMatchObject({ outcome: 'OBJECTIVE_ACHIEVED_EXTRA_HOLD', verifiedCount: 7, qrAttention: true });
    expect(reduce(['REJECTED', 'UNKNOWN', 'REJECTED', 'REJECTED', 'REJECTED', 'REJECTED', 'REJECTED']).outcome).toBe('OBJECTIVE_NOT_CONFIRMED_MANUAL_RECONCILIATION');
  });

  it('a seven-attempt frozen set cannot silently mutate', () => {
    const frozen = freezeSeven();
    expect(frozen.attempts).toHaveLength(7);
    expect(() => { (frozen.attempts as PrecisionAttempt[]).push(frozen.attempts[0]!); }).toThrow();
    expect(() => assertPrecisionFreezeIntact({ ...frozen, attempts: frozen.attempts.slice(0, 6) })).toThrow('PRECISION_FROZEN_SET_CHANGED');
  });
});
