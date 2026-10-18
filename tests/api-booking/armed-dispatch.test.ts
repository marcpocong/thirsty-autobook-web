import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { armedNothingFired, armedWindow, armPrecisionRace, disarmAttempt, disarmUnfired, dispatchArmedPrecisionRace, fireArmedAttempt, settleArmedAttempt,
  type ArmedAttempt, type ArmedPrecisionRace } from '../../src/api-booking/armed-dispatch.js';
import { BrowserSessionTransportError } from '../../src/api-booking/browser-session-transport.js';
import { consumeSubmissionPermit, DurableSubmissionJournal, isSubmissionPermitUnspent } from '../../src/api-booking/durable-submission-journal.js';
import { classifyPrecisionDispatchError, freezePrecisionRace, precisionAttemptSet, precisionTargetPlan, reducePrecisionOutcome, validatePrecisionTargets,
  type FrozenPrecisionRace, type PrecisionAttemptState } from '../../src/api-booking/precision-race.js';
import type { DirectTransport, ProoflessCheckoutRequest } from '../../src/api-booking/proofless-checkout.js';
import { TrustedReleaseClock } from '../../src/release-clock.js';
import type { BookingPlan } from '../../src/api-booking/types.js';


const hotPathAudit=vi.hoisted(()=>({deny:false,calls:[] as string[]}));
vi.mock('node:fs/promises',async importOriginal=>{
  const original=await importOriginal<typeof import('node:fs/promises')>();
  return Object.fromEntries(Object.entries(original).map(([name,value])=>[name,typeof value==='function'?((...args:unknown[])=>{if(hotPathAudit.deny){hotPathAudit.calls.push(name);throw Error('HOT_PATH_FILESYSTEM_ACCESS');}return (value as (...args:unknown[])=>unknown)(...args);}):value]));
});
vi.mock('node:crypto',async importOriginal=>{
  const original=await importOriginal<typeof import('node:crypto')>();
  return {...original,createHash:(...args:Parameters<typeof original.createHash>)=>{if(hotPathAudit.deny){hotPathAudit.calls.push('createHash');throw Error('HOT_PATH_HASHING');}return original.createHash(...args);}};
});

const date = '2026-09-26';
const customer = { clientId: '00000000-0000-4000-8000-00000000c11e', customerId: '00000000-0000-4000-8000-000000000b00',
  customerEmail: 'fixture@example.invalid', customerPhone: '09123456789', customerFirstName: 'Fixture', customerLastName: 'Player' };
let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'armed-dispatch-')); });
afterEach(async () => { if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw Error('UNSAFE_TEST_PATH'); await rm(root, { recursive: true, force: true }); });

/** `offsets[i]` is attempt i's operator Release Offset (absent or 0: normal). */
function frozenRace(count: number, releaseMs: number, offsets: readonly number[] = []): FrozenPrecisionRace {
  const targets = validatePrecisionTargets([1, 2, 3, 4, 5, 6, 7].slice(0, count).map((court, index) =>
    ({ court, start: '17:00', durationHours: 3, ...(offsets[index] ? { releaseOffsetMs: offsets[index] } : {}) })), date);
  return freezePrecisionRace(date, releaseMs, targets.map(target => ({ target, plan: precisionTargetPlan(target, date) })));
}
function fakeLock() {
  const calls: string[] = [];
  return { calls, armed: async (releaseMs: number, deadlineMs: number, count: number) => { calls.push(`armed:${deadlineMs - releaseMs}:${count}`); },
    dispatching: async () => { calls.push('dispatching'); } };
}
/** Arms `count` targets for a release `leadMs` from now on the real journal, optionally with per-attempt Release Offsets. */
async function arm(count: number, leadMs = 400, offsets: readonly number[] = []) {
  const releaseMs = Date.now() + leadMs, race = frozenRace(count, releaseMs, offsets), lock = fakeLock();
  const clock = TrustedReleaseClock.fromOffset(0, { method: 'test', sampleCount: 5 });
  const armed = await armPrecisionRace(race, { lock, customerFor: () => customer, journalRoot: root, releaseMs, now: () => clock.nowMs() });
  return { armed, race, lock, clock, releaseMs };
}
async function armFanOut(count = 2, leadMs = 60_000) {
  const releaseMs = Date.now() + leadMs;
  const inputs = Array.from({ length: count }, (_, index) =>
    ({ court: 7 - index, start: '17:00', durationHours: 3, fanOutReleaseOffsetsMs: [0, -10, -20, -30] }));
  const targets = validatePrecisionTargets(inputs, date, true);
  const race = freezePrecisionRace(date, releaseMs, precisionAttemptSet(targets, date, true));
  const lock = fakeLock(), clock = TrustedReleaseClock.fromOffset(0, { method: 'test', sampleCount: 5 });
  const armed = await armPrecisionRace(race, { lock, customerFor: () => customer, journalRoot: root, releaseMs, now: () => clock.nowMs() });
  return { armed, race, lock, clock, releaseMs };
}
const journalAt = (key: string) => new DurableSubmissionJournal(join(root, key));
const requestKey = (request: ProoflessCheckoutRequest) => DurableSubmissionJournal.key(request.facilityId, request.items[0]!.spaceId,
  request.items[0]!.date, request.items[0]!.startTime, request.items.at(-1)!.endTime);
/** Honors the real transport contract: consume the permit, run the final gate, then "send". */
function fakeTransport(respond: (request: ProoflessCheckoutRequest) => Promise<unknown>) {
  const calls: Array<{ at: number; key: string }> = [];
  const transport: DirectTransport = { publicCheckoutProofless: async (request, permit, options) => {
    consumeSubmissionPermit(permit, requestKey(request));
    options?.beforePost?.();
    calls.push({ at: performance.now(), key: requestKey(request) });
    return respond(request);
  } };
  return { transport, calls };
}
const conflict = () => Promise.reject(new BrowserSessionTransportError('ONDA_HTTP_STATUS_INVALID', true,
  { status: 409, category: 'http-rejection', contentKind: 'json', responseSource: 'application', errorHint: 'availability' }, true));
function pendingResponse(request: ProoflessCheckoutRequest, plan: BookingPlan) {
  // One expiry for the whole checkout, as the provider returns it; per-item Date.now() differed under load.
  const ids = request.items.map((_, index) => `booking-${index}`), holdExpiresAt = new Date(Date.now() + 600_000).toISOString();
  return { success: true, bookings: request.items.map((item, index) => ({ id: ids[index], booking_no: `number-${index}`, customer_id: request.customerId,
    space_id: item.spaceId, facility_id: item.facilityId, date: item.date, start_time: `${item.startTime}:00`, end_time: `${item.endTime}:00`,
    duration: 60, rate: item.rate, guest_count: 1, booking_status: 'pending', payment_status: 'pending', booking_session_id: 'session',
    hold_expires_at: holdExpiresAt })),
    bookingSessions: [{ requestSessionRef: 'session_1', bookingSessionId: 'session', facilityId: request.facilityId, spaceId: request.items[0]!.spaceId,
      date, startTime: '17:00:00', endTime: '20:00:00', durationHours: 3, bookingIds: ids }],
    transaction: { id: 'transaction', reference: 'number-0', amount: plan.totalPrice, status: 'pending' }, trustedTotalAmount: plan.totalPrice };
}
/** A clock that reads exactly `offsetFromRelease` ms relative to release. */
const clockAt = (releaseMs: number, offsetFromRelease: number) => ({ nowMs: () => releaseMs + offsetFromRelease });
const window = (armed: ArmedPrecisionRace) => ({ releaseMs: armed.releaseMs, dispatchDeadlineMs: armed.dispatchDeadlineMs });
const classify = (attempt: ArmedAttempt, error: unknown) => classifyPrecisionDispatchError(error, async () => {
  try { return (await attempt.journal.read(attempt.key)).state; } catch { return undefined; } });

describe('durable pre-release arm', () => {
  it('persists the exact frozen target, arms the lock first, and freezes every request', async () => {
    const { armed, lock, releaseMs } = await arm(3);
    expect(lock.calls).toEqual(['armed:1000:3']);
    expect(armed.attempts.map(attempt => attempt.target.workerId)).toEqual(['A', 'B', 'C']);
    for (const attempt of armed.attempts) {
      expect(attempt.key).toBe(attempt.target.targetKey);
      const record = await journalAt(attempt.key).read(attempt.key);
      expect(record).toMatchObject({ state: 'armed', attempt: { stage: 'armed', targetDate: date, courtIds: [attempt.target.court], expectedBookingCount: 3,
        maximumAmount: attempt.target.assumedAmount, releaseMs, dispatchDeadlineMs: releaseMs + 1000,
        hourlyBoundaries: [{ startTime: '17:00', endTime: '18:00' }, { startTime: '18:00', endTime: '19:00' }, { startTime: '19:00', endTime: '20:00' }] } });
      expect(await journalAt(attempt.key).oneShotClaimed()).toBe(true);
      expect(isSubmissionPermitUnspent(attempt.permit)).toBe(true);
      expect(Object.isFrozen(attempt.request) && Object.isFrozen(attempt.request.items) && Object.isFrozen(attempt.request.items[0])).toBe(true);
      expect(() => { (attempt.request.items[0] as { rate: number }).rate = 1; }).toThrow();
      expect(JSON.stringify(record)).not.toContain(customer.customerId); // journals never store customer data
    }
    expect(() => { (armed.attempts as ArmedAttempt[]).push(armed.attempts[0]!); }).toThrow();
  });

  it('uses one crash-safe parent guard plus four distinct child journals for each worker goal', async () => {
    const { armed, race } = await armFanOut();
    expect(armed.attempts).toHaveLength(8);
    expect(armed.fanOutGuards).toHaveLength(2);
    for (const guard of armed.fanOutGuards) {
      expect(guard).toMatchObject({ state: 'armed' });
      expect(guard.attemptIds).toHaveLength(4);
      expect(await journalAt(guard.key).read(guard.key)).toMatchObject({ state: 'armed', attempt: { attemptId: guard.key, planFingerprint: race.fingerprint } });
      expect(await journalAt(guard.key).oneShotClaimed()).toBe(true);
    }
    for (const attempt of armed.attempts) {
      const key = attempt.target.targetKey;
      const child = new DurableSubmissionJournal(join(root, key, 'fan-out', race.fingerprint, attempt.attempt.id));
      expect(await child.read(key)).toMatchObject({ state: 'armed', attempt: { attemptId: attempt.attempt.id } });
      expect(await child.oneShotClaimed()).toBe(true);
    }
    await expect(armPrecisionRace(race, { customerFor: () => customer, journalRoot: root, releaseMs: race.releaseMs, now: Date.now }))
      .rejects.toThrow('DUPLICATE_LOGICAL_BOOKING_BLOCKED');
    expect(await disarmUnfired(armed, 'USER_ABORT', Date.now)).toEqual(['A', 'A', 'A', 'A', 'B', 'B', 'B', 'B']);
    for (const guard of armed.fanOutGuards) {
      expect(await journalAt(guard.key).read(guard.key)).toMatchObject({ state: 'rejected', failureCode: 'USER_ABORT' });
      expect(await journalAt(guard.key).recycleReusable(guard.key)).toBe('reused');
    }
  });

  it('no alternative target can replace an armed target', async () => {
    const { armed } = await arm(2);
    const [a, b] = armed.attempts;
    // A's permit cannot authorize B's (or any other) request.
    expect(() => consumeSubmissionPermit(a!.permit, b!.key)).toThrow('SUBMISSION_PERMIT_INVALID_OR_USED');
    expect(isSubmissionPermitUnspent(a!.permit)).toBe(true);
    // A tampered frozen set is refused before anything durable is written.
    const race = frozenRace(2, Date.now() + 5_000), lock = fakeLock();
    const forged = { ...race, attempts: [race.attempts[1]!, race.attempts[1]!] };
    const other = await mkdtemp(join(tmpdir(), 'armed-forged-'));
    try {
      await expect(armPrecisionRace(forged, { lock, customerFor: () => customer, journalRoot: other, releaseMs: race.releaseMs, now: Date.now }))
        .rejects.toThrow('PRECISION_FROZEN_SET_CHANGED');
      expect(lock.calls).toEqual([]);
      expect(await readdir(other)).toEqual([]);
    } finally { await rm(other, { recursive: true, force: true }); }
  });

  it('arming is strictly pre-release', async () => {
    const race = frozenRace(1, Date.now() - 1), lock = fakeLock();
    await expect(armPrecisionRace(race, { lock, customerFor: () => customer, journalRoot: root, releaseMs: race.releaseMs, now: Date.now }))
      .rejects.toThrow('PRECISION_ARM_TOO_LATE');
    expect(lock.calls).toEqual([]);
  });

  it('two processes cannot arm or claim the same logical target', async () => {
    const race = frozenRace(1, Date.now() + 60_000), key = race.attempts[0]!.target.targetKey;
    const attempt = { attemptId: key, planFingerprint: key, targetDate: date, courtIds: [1], hourlyBoundaries: [], expectedBookingCount: 3,
      maximumAmount: 2100, stage: 'armed' as const, releaseMs: race.releaseMs, dispatchDeadlineMs: race.releaseMs + 1000 };
    const one = journalAt(key), two = journalAt(key);
    const results = await Promise.allSettled([one.arm(key, new Date(), attempt), two.arm(key, new Date(), attempt)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.message).toBe('DUPLICATE_LOGICAL_BOOKING_BLOCKED');
    await one.claimArmedOneShot(key);
    await expect(two.claimArmedOneShot(key)).rejects.toThrow('SUPERVISED_ONE_SHOT_ALREADY_USED');
    // A second arming run for the same frozen target gets no permit at all.
    const again = await armPrecisionRace(race, { customerFor: () => customer, journalRoot: root, releaseMs: race.releaseMs, now: Date.now });
    expect(again.attempts).toEqual([]);
    expect(again.unarmed).toMatchObject([{ state: 'JOURNAL_BLOCKED', code: 'DUPLICATE_LOGICAL_BOOKING_BLOCKED' }]);
  });
});

describe('crash semantics (every critical point)', () => {
  const armedRecord = (key: string, releaseMs = Date.now() + 60_000) => ({ attemptId: key, planFingerprint: key, targetDate: date, courtIds: [1],
    hourlyBoundaries: [], expectedBookingCount: 3, maximumAmount: 2100, stage: 'armed' as const, releaseMs, dispatchDeadlineMs: releaseMs + 1000 });

  it('A. crash before the durable arm completes is provably unsent', async () => {
    const key = frozenRace(1, Date.now() + 60_000).attempts[0]!.target.targetKey;
    // A1: nothing written yet.
    expect(await journalAt(key).peekDisposition(key)).toBe('unused');
    // A2: crashed after writing the temporary file, before it was linked into place.
    await mkdir(join(root, key), { recursive: true });
    await writeFile(join(root, key, '.crashed.arming'), '{"key":"partial');
    expect(await journalAt(key).recycleReusable(key)).toBe('unused');
    // A3: journal armed, one-shot never claimed: no permit ever existed.
    await journalAt(key).arm(key, new Date(), armedRecord(key));
    expect(await journalAt(key).peekDisposition(key)).toBe('reusable');
    expect(await journalAt(key).recycleReusable(key)).toBe('reused');
    expect(await readdir(join(root, 'unsent-attempts'))).toHaveLength(1);
    // A4: one-shot interrupted mid-write (fallback file systems): incomplete means never issued.
    await journalAt(key).arm(key, new Date(), armedRecord(key));
    await writeFile(join(root, key, 'supervised-one-shot.json'), '');
    expect(await journalAt(key).recycleReusable(key)).toBe('reused');
    // After recovery the target can be armed and claimed again.
    await journalAt(key).arm(key, new Date(), armedRecord(key));
    await expect(journalAt(key).claimArmedOneShot(key)).resolves.toMatchObject({ key });
  });

  it('B/C. crash after the arm, before or around release, is never reusable automatically', async () => {
    const { armed } = await arm(1, 60_000);
    const attempt = armed.attempts[0]!;
    // The process dies here (nothing more is written). A restart only sees the durable state:
    const restart = journalAt(attempt.key);
    expect(await restart.peekDisposition(attempt.key)).toBe('blocked');
    expect(await restart.recycleReusable(attempt.key)).toBe('blocked');
    await expect(classifyPrecisionDispatchError(Error('CRASH_RECOVERY'), async () => (await restart.read(attempt.key)).state))
      .resolves.toMatchObject({ state: 'UNKNOWN' });
    await expect(restart.claimArmedOneShot(attempt.key)).rejects.toThrow('SUPERVISED_ONE_SHOT_ALREADY_USED');
  });

  it('B. only the live process holding the unspent permit may record an armed attempt as unsent', async () => {
    const { armed } = await arm(1, 60_000);
    const attempt = armed.attempts[0]!;
    await expect(disarmAttempt(attempt, 'USER_ABORT', Date.now)).resolves.toBe(true);
    expect(isSubmissionPermitUnspent(attempt.permit)).toBe(false);
    expect(await journalAt(attempt.key).read(attempt.key)).toMatchObject({ state: 'rejected', failureCode: 'USER_ABORT' });
    expect(await journalAt(attempt.key).recycleReusable(attempt.key)).toBe('reused');
    await expect(disarmAttempt(attempt, 'USER_ABORT', Date.now)).resolves.toBe(false);
  });

  it('D. crash after the transport was invoked (before any request event) is potentially dispatched: never retried', async () => {
    const { armed } = await arm(1, 60_000);
    const attempt = armed.attempts[0]!, { transport, calls } = fakeTransport(() => new Promise(() => undefined));
    void fireArmedAttempt(attempt, transport, clockAt(armed.releaseMs, 5), window(armed), () => false);
    expect(attempt.state).toBe('fired');
    expect(calls).toHaveLength(1);
    await expect(disarmAttempt(attempt, 'USER_ABORT', Date.now)).resolves.toBe(false);
    expect(await journalAt(attempt.key).recycleReusable(attempt.key)).toBe('blocked');
    await expect(fireArmedAttempt(attempt, transport, clockAt(armed.releaseMs, 6), window(armed), () => false)).rejects.toThrow('SUPERVISED_ONE_SHOT_ALREADY_USED');
    expect(calls).toHaveLength(1);
  });

  it('E. a POST that may have left without a response is UNKNOWN and never retried', async () => {
    const { armed } = await arm(1, 60_000);
    const attempt = armed.attempts[0]!;
    const { transport, calls } = fakeTransport(() => Promise.reject(new BrowserSessionTransportError('ONDA_TRANSPORT_FAILED', true)));
    const error = await settleArmedAttempt(attempt, fireArmedAttempt(attempt, transport, clockAt(armed.releaseMs, 3), window(armed), () => false), Date.now).catch(value => value);
    expect((error as Error).message).toBe('SUBMISSION_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED');
    expect((await journalAt(attempt.key).read(attempt.key)).state).toBe('unknown');
    expect(await classify(attempt, error)).toMatchObject({ state: 'UNKNOWN' });
    expect(await journalAt(attempt.key).recycleReusable(attempt.key)).toBe('blocked');
    expect(reducePrecisionOutcome(['UNKNOWN'])).toMatchObject({ lockReleasable: false });
    await expect(fireArmedAttempt(attempt, transport, clockAt(armed.releaseMs, 4), window(armed), () => false)).rejects.toThrow('SUPERVISED_ONE_SHOT_ALREADY_USED');
    expect(calls).toHaveLength(1);
  });

  it('F. a confirmed HTTP/application rejection is REJECTED and reusable only through the existing recycle logic', async () => {
    const { armed } = await arm(1, 60_000);
    const attempt = armed.attempts[0]!, { transport } = fakeTransport(conflict);
    const error = await settleArmedAttempt(attempt, fireArmedAttempt(attempt, transport, clockAt(armed.releaseMs, 3), window(armed), () => false), Date.now).catch(value => value);
    expect(await classify(attempt, error)).toMatchObject({ state: 'REJECTED' });
    expect(await journalAt(attempt.key).read(attempt.key)).toMatchObject({ state: 'rejected', failureCode: 'ONDA_HTTP_STATUS_INVALID', diagnostic: { status: 409 } });
    expect(await journalAt(attempt.key).recycleReusable(attempt.key)).toBe('reused');
    expect(await readdir(join(root, 'rejected-attempts'))).toHaveLength(1);
  });

  it('G. a verified hold is VERIFIED; its journal and the lock stay retained', async () => {
    const { armed } = await arm(1, 60_000);
    const attempt = armed.attempts[0]!, { transport } = fakeTransport(async request => pendingResponse(request, attempt.plan));
    const verified = await settleArmedAttempt(attempt, fireArmedAttempt(attempt, transport, clockAt(armed.releaseMs, 3), window(armed), () => false), Date.now);
    expect(verified.bookingIds).toHaveLength(3);
    expect((await journalAt(attempt.key).read(attempt.key)).state).toBe('verified');
    expect(await journalAt(attempt.key).recycleReusable(attempt.key)).toBe('blocked');
    expect(reducePrecisionOutcome(['QR_READY'])).toMatchObject({ lockReleasable: false });
  });

  it('critical invariant: a request that left before a crash is never sent again after restart', async () => {
    const { armed, race } = await arm(1, 60_000);
    const attempt = armed.attempts[0]!, { transport, calls } = fakeTransport(() => new Promise(() => undefined));
    void fireArmedAttempt(attempt, transport, clockAt(armed.releaseMs, 2), window(armed), () => false);
    expect(calls).toHaveLength(1); // the request left
    // Crash before any later disk write. The restarted run finds the durable arm and must not re-send:
    expect(await journalAt(attempt.key).recycleReusable(attempt.key)).toBe('blocked');
    const restarted = await armPrecisionRace(race, { customerFor: () => customer, journalRoot: root, releaseMs: race.releaseMs, now: () => race.releaseMs - 10_000 });
    expect(restarted.attempts).toHaveLength(0);
    expect(restarted.unarmed[0]).toMatchObject({ state: 'JOURNAL_BLOCKED' });
    expect(calls).toHaveLength(1);
  });
});

describe('release instant', () => {
  it('never sends before release or past the dispatch window; refusals are provably unsent', async () => {
    const { armed } = await arm(2, 60_000);
    const [early, late] = armed.attempts, { transport, calls } = fakeTransport(conflict);
    const earlyError = await settleArmedAttempt(early!, fireArmedAttempt(early!, transport, clockAt(armed.releaseMs, -1), window(armed), () => false), Date.now).catch(value => value);
    expect((earlyError as Error).message).toBe('DIRECT_RELEASE_NOT_REACHED');
    expect(await classify(early!, earlyError)).toMatchObject({ state: 'NOT_DISPATCHED' });
    const lateError = await settleArmedAttempt(late!, fireArmedAttempt(late!, transport, clockAt(armed.releaseMs, 1001), window(armed), () => false), Date.now).catch(value => value);
    expect(await classify(late!, lateError)).toMatchObject({ state: 'WINDOW_MISSED' });
    expect(calls).toHaveLength(0);
    for (const attempt of [early!, late!]) expect(await journalAt(attempt.key).recycleReusable(attempt.key)).toBe('reused');
  });

  it('the final gate inside the transport still refuses a POST that has become late', async () => {
    const { armed } = await arm(1, 60_000);
    const attempt = armed.attempts[0]!;
    let now = armed.releaseMs + 5;
    const transport: DirectTransport = { publicCheckoutProofless: async (request, permit, options) => {
      consumeSubmissionPermit(permit, requestKey(request)); now = armed.releaseMs + 1500; options?.beforePost?.(); throw Error('POST_MUST_NOT_HAPPEN'); } };
    const error = await settleArmedAttempt(attempt, fireArmedAttempt(attempt, transport, { nowMs: () => now }, window(armed), () => false), Date.now).catch(value => value);
    expect(await classify(attempt, error)).toMatchObject({ state: 'WINDOW_MISSED' });
  });

  it('the in-memory one-shot cannot be consumed twice', async () => {
    const { armed } = await arm(1, 60_000);
    const attempt = armed.attempts[0]!, { transport, calls } = fakeTransport(conflict);
    const first = fireArmedAttempt(attempt, transport, clockAt(armed.releaseMs, 1), window(armed), () => false);
    await expect(fireArmedAttempt(attempt, transport, clockAt(armed.releaseMs, 1), window(armed), () => false)).rejects.toThrow('SUPERVISED_ONE_SHOT_ALREADY_USED');
    await first.catch(() => undefined);
    expect(calls).toHaveLength(1);
  });

  it.each([1, 3, 7])('%i armed workers fire in one synchronous pass at the deadline, never early', async count => {
    const { armed, clock, lock, releaseMs } = await arm(count, 1_500);
    const order: string[] = [];
    let nextTick = false, wakeAt = 0;
    const transports = new Map(armed.attempts.map(attempt => [attempt.target.workerId, fakeTransport(async () => { order.push(`sent:${attempt.target.workerId}`); return conflict(); })]));
    const fireTimes: number[] = [], sameTick: boolean[] = [];
    const outcome = await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 200, spinTailMs: 30, isAborted: () => false,
      prewarm: async () => undefined,
      transportFor: worker => ({ publicCheckoutProofless: (request, permit, options) => { fireTimes.push(clock.nowMs()); sameTick.push(!nextTick);
        return transports.get(worker)!.transport.publicCheckoutProofless(request, permit, options); } }),
      onWake: () => { wakeAt = clock.nowMs(); setImmediate(() => { nextTick = true; }); },
      afterFire: async () => { order.push('afterFire'); await lock.dispatching(); } });
    expect(fireTimes).toHaveLength(count);
    expect(sameTick.every(Boolean)).toBe(true);
    expect(Math.min(...fireTimes)).toBeGreaterThanOrEqual(releaseMs);
    expect(Math.max(...fireTimes) - wakeAt).toBeLessThan(25);
    expect(order.indexOf('afterFire')).toBeGreaterThanOrEqual(count); // the DISPATCHING record follows every send
    expect(lock.calls).toEqual([`armed:1000:${count}`, 'dispatching']);
    expect(outcome.results.map(result => result.state)).toEqual(Array(count).fill('REJECTED'));
  });

  it('abort before release fires nothing and records every attempt as provably unsent', async () => {
    const { armed, clock } = await arm(3, 1_500);
    let aborted = false;
    const { transport, calls } = fakeTransport(conflict);
    await expect(dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 200, spinTailMs: 20, isAborted: () => aborted,
      prewarm: async () => { aborted = true; }, transportFor: () => transport })).rejects.toThrow('USER_ABORT');
    expect(calls).toHaveLength(0);
    expect(armedNothingFired(armed)).toBe(true);
    for (const attempt of armed.attempts) {
      expect(await journalAt(attempt.key).read(attempt.key)).toMatchObject({ state: 'rejected', failureCode: 'USER_ABORT' });
      expect(isSubmissionPermitUnspent(attempt.permit)).toBe(false);
    }
    expect(reducePrecisionOutcome(armed.attempts.map(() => 'NOT_DISPATCHED' as PrecisionAttemptState))).toMatchObject({ lockReleasable: true });
  });

  it('Stop during the pre-release wait is honoured within milliseconds (the UI kills the runner after 350 ms)', async () => {
    const { armed, clock } = await arm(2, 3_000);
    const controller = new AbortController();
    const pause = (ms: number) => new Promise<void>((done, fail) => {
      const timer = setTimeout(done, ms);
      controller.signal.addEventListener('abort', () => { clearTimeout(timer); fail(Error('USER_ABORT')); }, { once: true });
    });
    const { transport, calls } = fakeTransport(conflict);
    const running = dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 1_000, isAborted: () => controller.signal.aborted, sleep: pause,
      prewarm: async () => undefined, transportFor: () => transport });
    await new Promise(resolve => setTimeout(resolve, 60));
    const stoppedAt = performance.now();
    controller.abort();
    await expect(running).rejects.toThrow('USER_ABORT');
    expect(performance.now() - stoppedAt).toBeLessThan(200); // includes the durable disarm writes
    expect(calls).toHaveLength(0);
    for (const attempt of armed.attempts) expect((await journalAt(attempt.key).read(attempt.key)).state).toBe('rejected');
  });

  it('the release window (HIGH priority in the runner) opens before the POSTs and always closes, also on abort', async () => {
    const order: string[] = [];
    const { armed, clock } = await arm(2, 1_500);
    const { transport } = fakeTransport(async () => { order.push('sent'); return conflict(); });
    await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 1_200, spinTailMs: 20, isAborted: () => false, prewarm: async () => undefined,
      transportFor: () => transport, onFinalApproach: () => order.push('open'), onReleaseWindowEnd: () => order.push('close') });
    expect(order).toEqual(['open', 'sent', 'sent', 'close']);
    const aborted: string[] = [];
    const second = await arm(1, 1_500);
    let stop = false;
    await expect(dispatchArmedPrecisionRace(second.armed, { clock: second.clock, prewarmLeadMs: 1_200, spinTailMs: 20, isAborted: () => stop,
      prewarm: async () => undefined, transportFor: () => transport,
      onFinalApproach: () => { aborted.push('open'); stop = true; }, onReleaseWindowEnd: () => aborted.push('close') })).rejects.toThrow('USER_ABORT');
    expect(aborted).toEqual(['open', 'close']);
  });

  it('one failed prewarm disarms only that attempt; the others fire independently', async () => {
    const { armed, clock } = await arm(3, 1_500);
    const { transport, calls } = fakeTransport(conflict);
    const outcome = await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 250, prewarmRetryCutoffMs: 0, spinTailMs: 20, isAborted: () => false,
      prewarm: async attempt => { if (attempt.target.workerId === 'B') throw Error('SECURITY_CONTEXT_EMPTY'); }, transportFor: () => transport });
    expect(outcome.results.map(result => [result.attempt.target.workerId, result.state])).toEqual([['A', 'REJECTED'], ['B', 'PREWARM_FAILED'], ['C', 'REJECTED']]);
    expect(calls).toHaveLength(2);
    const b = armed.attempts.find(attempt => attempt.target.workerId === 'B')!;
    expect(await journalAt(b.key).read(b.key)).toMatchObject({ state: 'rejected', failureCode: 'SECURITY_PREWARM_FAILED' });
    expect(reducePrecisionOutcome(outcome.results.map(result => result.state))).toMatchObject({ outcome: 'OBJECTIVE_NOT_ACHIEVED_ALL_REJECTED', lockReleasable: true });
  });

  it('a verified hold is handed to the QR step; a lock-record failure after the sends never changes outcomes', async () => {
    const { armed, clock } = await arm(2, 1_500);
    // This checks hold/lock semantics, not timer precision (covered by real-clock tests above).
    let at=armed.releaseMs-1500;
    vi.spyOn(clock,'nowMs').mockImplementation(()=>at);
    vi.spyOn(clock,'monotonicDeadline').mockImplementation(epoch=>performance.now()+(epoch-at));
    const sleep=async(ms:number)=>{at+=Math.ceil(Math.max(1,ms));await new Promise<void>(done=>setImmediate(done));};
    const holds: string[] = [];
    const outcome = await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 200, spinTailMs: 0, sleep, isAborted: () => false, prewarm: async () => undefined,
      transportFor: worker => fakeTransport(async request => worker === 'A' ? pendingResponse(request, armed.attempts[0]!.plan) : conflict()).transport,
      onVerifiedHold: async attempt => { holds.push(attempt.target.workerId); return { state: 'QR_READY' }; },
      afterFire: async () => { throw Error('LOCK_REPLACED'); } });
    expect(holds,JSON.stringify(outcome.results.map(result=>({state:result.state,code:result.code})))).toEqual(['A']);
    expect(outcome.results.map(result => result.state)).toEqual(['QR_READY', 'REJECTED']);
    expect(outcome.afterFireError).toBe('LOCK_REPLACED');
  });
});

describe('Release Offset (per attempt)', () => {
  it('attempts without an offset keep the trigger on the release instant', async () => {
    const { armed, releaseMs } = await arm(2);
    expect(armed.attempts.map(attempt => attempt.triggerMs)).toEqual([releaseMs, releaseMs]);
  });

  it.each([1,25,100])('rejects a +%i ms post-release Shotgun trigger before arming',async positive=>{
    const releaseMs=Date.now()+60_000;expect(()=>frozenRace(1,releaseMs,[positive])).toThrow('PRECISION_TARGET_INVALID');
    const race=frozenRace(1,releaseMs),lock=fakeLock(),forged=freezePrecisionRace(date,releaseMs,[{...race.attempts[0]!,target:{...race.attempts[0]!.target,releaseOffsetMs:positive}}]);
    await expect(armPrecisionRace(forged,{lock,customerFor:()=>customer,journalRoot:root,releaseMs,now:Date.now})).rejects.toThrow('SHOTGUN_OFFSET_INVALID');
    expect(lock.calls).toEqual([]);expect(await readdir(root)).toEqual([]);
  });

  it('each attempt arms for its own trigger; the lock, journals and lateness bound keep the official release', async () => {
    const { armed, lock, releaseMs } = await arm(3, 2_500, [-1733, 0, -407]);
    expect(armed.attempts.map(attempt => attempt.triggerMs)).toEqual([releaseMs - 1733, releaseMs, releaseMs - 407]);
    expect(armed.dispatchDeadlineMs).toBe(releaseMs + 1000);
    expect(lock.calls).toEqual(['armed:1000:3']);
    for (const attempt of armed.attempts)
      expect(await journalAt(attempt.key).read(attempt.key)).toMatchObject({ state: 'armed', attempt: { releaseMs, dispatchDeadlineMs: releaseMs + 1000 } });
  });

  it('an offset is part of the frozen set, and an out-of-range one is refused before anything is written', async () => {
    const releaseMs = Date.now() + 60_000;
    expect(frozenRace(2, releaseMs, [-50]).fingerprint).not.toBe(frozenRace(2, releaseMs).fingerprint);
    expect(frozenRace(2, releaseMs, [0, 0]).fingerprint).toBe(frozenRace(2, releaseMs).fingerprint);
    expect(() => frozenRace(1, releaseMs, [-2001])).toThrow('PRECISION_TARGET_INVALID');
    const race = frozenRace(1, releaseMs), lock = fakeLock();
    const forged = freezePrecisionRace(date, releaseMs, [{ ...race.attempts[0]!, target: { ...race.attempts[0]!.target, releaseOffsetMs: -2001 } }]);
    await expect(armPrecisionRace(forged, { lock, customerFor: () => customer, journalRoot: root, releaseMs, now: Date.now })).rejects.toThrow('SHOTGUN_OFFSET_INVALID');
    expect(lock.calls).toEqual([]);
    expect(await readdir(root)).toEqual([]);
  });

  it('arming must precede the earliest trigger', async () => {
    const race = frozenRace(2, Date.now() + 60_000, [0, -50]), lock = fakeLock();
    await expect(armPrecisionRace(race, { lock, customerFor: () => customer, journalRoot: root, releaseMs: race.releaseMs,
      now: () => race.releaseMs - 20 })).rejects.toThrow('PRECISION_ARM_TOO_LATE');
    expect(lock.calls).toEqual([]);
  });

  it('an attempt fires from its own trigger, never before it, and never past release + window', async () => {
    const { armed } = await arm(3, 60_000, [-50, -50, -50]);
    const [early, onTime, late] = armed.attempts, { transport, calls } = fakeTransport(conflict);
    const window = (attempt: ArmedAttempt) => armedWindow(armed, attempt);
    const earlyError = await settleArmedAttempt(early!, fireArmedAttempt(early!, transport, clockAt(armed.releaseMs, -51), window(early!), () => false), Date.now).catch(value => value);
    expect((earlyError as Error).message).toBe('DIRECT_RELEASE_NOT_REACHED');
    expect(await classify(early!, earlyError)).toMatchObject({ state: 'NOT_DISPATCHED' });
    expect(calls).toHaveLength(0);
    await settleArmedAttempt(onTime!, fireArmedAttempt(onTime!, transport, clockAt(armed.releaseMs, -50), window(onTime!), () => false), Date.now).catch(() => undefined);
    expect(calls).toHaveLength(1);
    const lateError = await settleArmedAttempt(late!, fireArmedAttempt(late!, transport, clockAt(armed.releaseMs, 1001), window(late!), () => false), Date.now).catch(value => value);
    expect(await classify(late!, lateError)).toMatchObject({ state: 'WINDOW_MISSED' });
    expect(calls).toHaveLength(1);
  });

  it('mixed offsets: each attempt fires at its own trigger, earliest first, and normal ones at the release', async () => {
    const { armed, clock, releaseMs } = await arm(4, 1_500, [-100, 0, -25, 0]);
    const fired = new Map<string, number>();
    const { transport } = fakeTransport(conflict);
    const outcome = await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 200, spinTailMs: 30, isAborted: () => false, prewarm: async () => undefined,
      transportFor: worker => ({ publicCheckoutProofless: (request, permit, options) => { fired.set(worker, clock.nowMs()); return transport.publicCheckoutProofless(request, permit, options); } }) });
    expect([...fired.keys()]).toEqual(['A', 'C', 'B', 'D']);
    expect(fired.get('A')!).toBeGreaterThanOrEqual(releaseMs - 100);
    expect(fired.get('A')!).toBeLessThan(releaseMs - 25);
    expect(fired.get('C')!).toBeGreaterThanOrEqual(releaseMs - 25);
    expect(fired.get('C')!).toBeLessThan(releaseMs);
    expect(Math.min(fired.get('B')!, fired.get('D')!)).toBeGreaterThanOrEqual(releaseMs);
    expect(outcome.results.map(result => result.state)).toEqual(['REJECTED', 'REJECTED', 'REJECTED', 'REJECTED']);
  });

  it('a Stop after an early attempt was sent never abandons it: later attempts refuse and every outcome is recorded', async () => {
    const { armed, clock, releaseMs } = await arm(2, 1_500, [-100, 0]);
    let stop = false;
    const controller = new AbortController();
    // The runner's abort-aware sleep rejects on Stop; the waits after a send must not use it.
    const pause = (ms: number) => new Promise<void>((done, fail) => {
      const timer = setTimeout(done, ms);
      controller.signal.addEventListener('abort', () => { clearTimeout(timer); fail(Error('USER_ABORT')); }, { once: true });
    });
    const { transport, calls } = fakeTransport(async () => { stop = true; controller.abort(); return conflict(); });
    const outcome = await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 200, spinTailMs: 30, isAborted: () => stop, sleep: pause,
      prewarm: async () => undefined, transportFor: () => transport });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.at).toBeLessThan(clock.monotonicDeadline(releaseMs));
    expect(outcome.results.map(result => [result.attempt.target.workerId, result.state, result.code])).toEqual([['A', 'REJECTED', 'ONDA_HTTP_STATUS_INVALID'], ['B', 'NOT_DISPATCHED', 'USER_ABORT']]);
    const b = armed.attempts[1]!;
    expect(await journalAt(b.key).read(b.key)).toMatchObject({ state: 'rejected' });
  });
});

describe('strict Shotgun deadlines',()=>{
  it('starts prewarm while final clock refresh is waiting, instead of losing its preparation lead', async () => {
    const { armed, clock, releaseMs } = await arm(1, 1000);
    const order: string[] = [], { transport, calls } = fakeTransport(conflict);
    let preparedAt = 0;
    const outcome = await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 700, isAborted: () => false,
      refreshClock: async () => { order.push('clock-start'); await new Promise(r => setTimeout(r, Math.max(0, releaseMs - 200 - clock.nowMs()))); order.push('clock-finished'); return clock; },
      prewarm: async () => { preparedAt = clock.nowMs(); order.push('prewarm'); }, transportFor: () => transport });
    expect(order).toEqual(['clock-start', 'prewarm', 'clock-finished']);
    expect(preparedAt).toBeLessThan(releaseMs - 400);
    expect(calls).toHaveLength(1);
    expect(outcome.results[0]!.state).toBe('REJECTED');
  });
  it('a final clock failure cannot send an already-prewarmed attempt', async () => {
    const { armed, clock } = await arm(1, 1000);
    const { transport, calls } = fakeTransport(conflict);
    await expect(dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 700, isAborted: () => false,
      refreshClock: async () => { throw Error('NETWORK_CLOCK_STALE'); }, prewarm: async () => undefined,
      transportFor: () => transport })).rejects.toThrow('NETWORK_CLOCK_STALE');
    expect(calls).toHaveLength(0);
    expect(armed.attempts[0]!.state).toBe('disarmed');
  });
  async function strict(offsets:number[]=[-500],lead=60000){
    const releaseMs=Date.now()+lead,target=validatePrecisionTargets([{court:7,start:'17:00',durationHours:3}],date)[0]!;
    const race=freezePrecisionRace(date,releaseMs,offsets.map(releaseOffsetMs=>{const child={...target,releaseOffsetMs};return {target:child,plan:precisionTargetPlan(child,date),dispatchTimingPolicy:'SHOTGUN_STRICT' as const};}));
    const armed=await armPrecisionRace(race,{customerFor:()=>customer,journalRoot:root,releaseMs,now:Date.now});
    return {armed,releaseMs,clock:TrustedReleaseClock.fromOffset(0,{method:'test',sampleCount:5})};
  }
  it('freezes explicit policy and per-shot deadline; negative Precision offsets stay generic',async()=>{
    const {armed,releaseMs}=await strict();expect(armed.attempts[0]!.attempt.dispatchTimingPolicy).toBe('SHOTGUN_STRICT');
    expect(armed.attempts[0]!.shotDeadlineMs).toBe(releaseMs-450);expect(armedWindow(armed,armed.attempts[0]!).dispatchDeadlineMs).toBe(releaseMs-450);
    expect(Object.isFrozen(armed.attempts[0]!.attempt)).toBe(true);
    expect((await armed.attempts[0]!.journal.read(armed.attempts[0]!.key)).attempt).toMatchObject({dispatchTimingPolicy:'SHOTGUN_STRICT',triggerMs:releaseMs-500,shotDeadlineMs:releaseMs-450});
    const generic=await arm(1,60000,[-500]);expect(generic.armed.attempts[0]!.shotDeadlineMs).toBeUndefined();
  });
  it.each([-500,0])('sends at trigger %s within 50 ms, retaining exact prebuilt request',async offset=>{
    const {armed,releaseMs}=await strict([offset]),attempt=armed.attempts[0]!,{transport,calls}=fakeTransport(conflict);
    await expect(fireArmedAttempt(attempt,transport,clockAt(releaseMs,offset+20),armedWindow(armed,attempt),()=>false)).rejects.toThrow('ONDA_HTTP_STATUS_INVALID');expect(calls).toHaveLength(1);
  });
  it.each([[-500,-420],[0,80]])('refuses trigger %s at %s as provably unsent',async(offset,wake)=>{
    const {armed,releaseMs}=await strict([offset!]),attempt=armed.attempts[0]!,{transport,calls}=fakeTransport(conflict);
    const error=await fireArmedAttempt(attempt,transport,clockAt(releaseMs,wake!),armedWindow(armed,attempt),()=>false).catch(e=>e);
    expect(await classify(attempt,error)).toEqual({state:'NOT_DISPATCHED',code:'SHOTGUN_TRIGGER_MISSED'});expect(calls).toHaveLength(0);expect(isSubmissionPermitUnspent(attempt.permit)).toBe(false);
  });
  it('the armed trigger-to-POST pass performs no filesystem access, hashing or request serialization',async()=>{
    const {armed,releaseMs}=await strict(),attempt=armed.attempts[0]!;let posts=0;
    const transport:DirectTransport={publicCheckoutProofless:async(request,permit,options)=>{expect(request).toBe(attempt.request);consumeSubmissionPermit(permit,attempt.key);options?.beforePost?.();posts++;return {};}};
    const stringify=vi.spyOn(JSON,'stringify').mockImplementation(()=>{throw Error('HOT_PATH_SERIALIZATION');});hotPathAudit.calls=[];hotPathAudit.deny=true;
    try{await fireArmedAttempt(attempt,transport,clockAt(releaseMs,-490),armedWindow(armed,attempt),()=>false);expect(posts).toBe(1);expect(hotPathAudit.calls).toEqual([]);expect(stringify).not.toHaveBeenCalled();}
    finally{hotPathAudit.deny=false;stringify.mockRestore();}
  });
  it('rechecks trusted time immediately before POST after a transport delay',async()=>{
    const {armed,releaseMs}=await strict(),attempt=armed.attempts[0]!;let now=releaseMs-490,posts=0;
    const transport:DirectTransport={publicCheckoutProofless:async(request,permit,options)=>{consumeSubmissionPermit(permit,requestKey(request));now=releaseMs-420;options?.beforePost?.();posts++;return {};}};
    const error=await fireArmedAttempt(attempt,transport,{nowMs:()=>now},armedWindow(armed,attempt),()=>false).catch(e=>e);
    expect(await classify(attempt,error)).toEqual({state:'NOT_DISPATCHED',code:'SHOTGUN_TRIGGER_MISSED'});expect(posts).toBe(0);
  });
  it('can become ready inside its own allowance without clock sampling on the trigger-to-POST path',async()=>{
    const {armed,clock,releaseMs}=await strict([-500],1800),{transport,calls}=fakeTransport(conflict);const samples:number[]=[];
    transport.prepareStrictTiming=async()=>{samples.push(clock.nowMs());};
    const outcome=await dispatchArmedPrecisionRace(armed,{clock,prewarmLeadMs:1500,spinTailMs:0,isAborted:()=>false,transportFor:()=>transport,prewarm:()=>new Promise(done=>setTimeout(done,Math.max(0,releaseMs-480-clock.nowMs())))});
    expect(calls).toHaveLength(1);expect(outcome.results[0]!.state).toBe('REJECTED');expect(samples).toHaveLength(1);expect(samples[0]!).toBeLessThan(releaseMs-1500);
  });
  it('late tier 0 and tier 1 never use generic readiness recovery',async()=>{
    const {armed,clock}=await strict([-500,0],1400),{transport,calls}=fakeTransport(conflict);
    const outcome=await dispatchArmedPrecisionRace(armed,{clock,prewarmLeadMs:1300,spinTailMs:0,isAborted:()=>false,prewarm:()=>new Promise(done=>setTimeout(done,1500)),transportFor:()=>transport,onWake:trigger=>{if(trigger===armed.releaseMs)expect(isSubmissionPermitUnspent(armed.attempts[0]!.permit)).toBe(false);}});
    expect(calls).toHaveLength(0);expect(outcome.results.map(r=>[r.attempt.fanOutIndex,r.state,r.code])).toEqual([[0,'NOT_DISPATCHED','SHOTGUN_TRIGGER_MISSED'],[1,'NOT_DISPATCHED','SHOTGUN_TRIGGER_MISSED']]);
    for(const a of armed.attempts)expect((await a.journal.read(a.key)).failureCode).toBe('SHOTGUN_TRIGGER_MISSED');
  });
  it('independent ready shots dispatch separately; journals and QR callbacks wait until T+1000',async()=>{
    const {armed,clock,releaseMs}=await strict([-500,0],1800);const stamps:number[]=[],writeTimes:number[]=[];
    for(const a of armed.attempts){const original=a.journal.mark.bind(a.journal);a.journal.mark=async(...args)=>{writeTimes.push(clock.nowMs());return original(...args);};}
    const {transport}=fakeTransport(conflict);
    await dispatchArmedPrecisionRace(armed,{clock,prewarmLeadMs:1500,spinTailMs:0,isAborted:()=>false,prewarm:async()=>{},transportFor:()=>({publicCheckoutProofless:(...args)=>{stamps.push(clock.nowMs());return transport.publicCheckoutProofless(...args);}})});
    expect(stamps).toHaveLength(2);expect(stamps[0]!-releaseMs).toBeGreaterThanOrEqual(-500);expect(stamps[0]!-releaseMs).toBeLessThanOrEqual(-450);expect(stamps[1]!-releaseMs).toBeGreaterThanOrEqual(0);expect(stamps[1]!-releaseMs).toBeLessThanOrEqual(50);
    expect(writeTimes.length).toBeGreaterThan(0);expect(writeTimes.every(t=>t>=releaseMs+1000)).toBe(true);
  });
});


describe('diversified one-court objective coordination',()=>{
  it.each(['hold','unknown','throttle','payment','rejection'] as const)('coordinates different courts on %s',async kind=>{
    const releaseMs=Date.now()+1700;
    const targets=validatePrecisionTargets([{court:7,start:'17:00',durationHours:3,releaseOffsetMs:-500},{court:6,start:'17:00',durationHours:3,releaseOffsetMs:0}],date);
    const race=freezePrecisionRace(date,releaseMs,targets.map(target=>({target,plan:precisionTargetPlan(target,date),dispatchTimingPolicy:'SHOTGUN_STRICT' as const})));
    const clock=TrustedReleaseClock.fromOffset(0,{method:'test',sampleCount:5});
    const armed=await armPrecisionRace(race,{customerFor:()=>customer,journalRoot:root,releaseMs,now:()=>clock.nowMs()});
    const {transport,calls}=fakeTransport(async request=>{
      if(kind==='hold')return pendingResponse(request,armed.attempts[0]!.plan);
      if(kind==='unknown')throw new BrowserSessionTransportError('OUTCOME_UNKNOWN',true);
      if(kind==='throttle')throw new BrowserSessionTransportError('ONDA_HTTP_STATUS_INVALID',true,{status:429,category:'http-rejection',contentKind:'json',responseSource:'application',errorHint:'rate-limit'},true);
      if(kind==='payment')throw new BrowserSessionTransportError('ONDA_HTTP_STATUS_INVALID',true,{status:409,category:'http-rejection',contentKind:'json',responseSource:'application',errorHint:'payment-in-progress'},true);
      return conflict();
    });
    const outcome=await dispatchArmedPrecisionRace(armed,{clock,prewarmLeadMs:1300,spinTailMs:0,isAborted:()=>false,prewarm:async()=>{},transportFor:()=>transport});
    expect(calls).toHaveLength(kind==='rejection'?2:1);
    if(kind!=='rejection'){
      expect(outcome.results[1]!.state).toBe('NOT_DISPATCHED');
      expect(outcome.results[1]!.code).toBe({hold:'SHOTGUN_TARGET_ALREADY_ACHIEVED',unknown:'SHOTGUN_TARGET_OUTCOME_UNKNOWN',throttle:'SHOTGUN_PROVIDER_THROTTLE_STOP',payment:'SHOTGUN_PAYMENT_IN_PROGRESS_STOP'}[kind]);
      expect(isSubmissionPermitUnspent(armed.attempts[1]!.permit)).toBe(false);
    }
  });
});
