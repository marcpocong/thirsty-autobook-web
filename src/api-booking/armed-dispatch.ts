import { resolve } from 'node:path';
import type { ApiAutomationLock } from './api-automation-lock.js';
import { armCheckoutRequest } from './browser-session-transport.js';
import { DurableSubmissionJournal, revokeSubmissionPermit, type SubmissionPermit } from './durable-submission-journal.js';
import { THIRSTY_PICKLE_FACILITY_ID } from './live-availability-provider.js';
import { assertPrecisionFreezeIntact, classifyPrecisionDispatchError, type FrozenPrecisionRace, type PrecisionAttempt,
  type PrecisionAttemptState, type PrecisionDispatchResult, type PrecisionTarget } from './precision-race.js';
import { assertDirectDispatchWindow, DIRECT_MAX_DISPATCH_LATENESS_MS, prooflessPlanFingerprint, prooflessRequest,
  recordDirectCheckoutOutcome, type DirectTransport, type ProoflessCheckoutRequest } from './proofless-checkout.js';
import type { VerifiedPublicCheckout } from './public-checkout.js';
import { SubmissionDispatchError } from './submission-errors.js';
import { standardPlanJournalKeys, type CheckoutCustomer } from './two-hour-reservation.js';
import type { BookingPlan } from './types.js';
import { DEFAULT_SPIN_TAIL_MS, waitForMonotonicDeadline, type TrustedReleaseClock } from '../release-clock.js';
import type { WorkerId } from '../workers.js';

/**
 * Durable pre-armed Precision dispatch.
 *
 * Before release (right after the T-2 min freeze) everything durable or costly is done:
 * the exact request is built, deep-frozen and serialized; its journal key and plan
 * fingerprint are computed; the global lock is rewritten to FINAL_ACTION_ARMED; each
 * target's journal is created as 'armed' and its write-once one-shot is claimed, which
 * yields an in-memory permit. At the release instant a worker only checks abort, flips
 * its in-memory one-shot, checks the trusted clock (never early, never past the window)
 * and calls the browser transport. No file is written, flushed, renamed or read, and
 * nothing is hashed or built, between T-0 and the POST.
 *
 * Crash semantics (see RELEASE_LATENCY_PHASE1.md and tests/api-booking/armed-dispatch.test.ts):
 * - journal absent, or armed without a complete one-shot claim: no permit ever existed -> provably unsent;
 * - armed with a claimed one-shot and no live process: a POST may have left -> blocked, manual reconciliation;
 * - only the live process that holds the permit may disarm (it knows the transport was never invoked).
 */
export type ArmedAttemptState = 'armed' | 'fired' | 'refused' | 'disarmed';
export interface ArmedAttempt {
  readonly target: PrecisionTarget;
  readonly plan: BookingPlan;
  readonly key: string;
  readonly request: ProoflessCheckoutRequest;
  readonly journal: DurableSubmissionJournal;
  readonly permit: SubmissionPermit;
  /** 'armed' until the one in-memory transition; 'fired' is set synchronously before the transport call. */
  state: ArmedAttemptState;
}
export interface ArmedPrecisionRace {
  readonly race: FrozenPrecisionRace;
  readonly releaseMs: number;
  readonly dispatchDeadlineMs: number;
  readonly attempts: readonly ArmedAttempt[];
  /** Frozen attempts that could not be armed: provably unsent. */
  readonly unarmed: ReadonlyArray<{ attempt: PrecisionAttempt; state: PrecisionAttemptState; code: string }>;
}

const safeCode = (error: unknown, fallback: string) => error instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.message) ? error.message : fallback;
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); }
  return value;
}

export interface ArmDeps {
  lock?: Pick<ApiAutomationLock, 'armed'>;
  customerFor: (worker: WorkerId) => CheckoutCustomer;
  journalRoot: string;
  releaseMs: number;
  dispatchWindowMs?: number;
  /** Trusted epoch milliseconds, used for record timestamps and the "arm strictly before release" check. */
  now: () => number;
  journalFor?: (key: string) => DurableSubmissionJournal;
}

/** Pre-release, durable arming of every frozen attempt. Never sends anything. */
export async function armPrecisionRace(race: FrozenPrecisionRace, deps: ArmDeps): Promise<ArmedPrecisionRace> {
  assertPrecisionFreezeIntact(race);
  if (race.releaseMs !== deps.releaseMs || !Number.isSafeInteger(deps.releaseMs)) throw Error('PRECISION_ARM_RELEASE_MISMATCH');
  if (!race.attempts.length) throw Error('PRECISION_NOTHING_TO_ARM');
  if (!(deps.now() < deps.releaseMs)) throw Error('PRECISION_ARM_TOO_LATE');
  const dispatchDeadlineMs = deps.releaseMs + (deps.dispatchWindowMs ?? DIRECT_MAX_DISPATCH_LATENESS_MS);
  const prepared = race.attempts.map(attempt => {
    const request = deepFreeze(prooflessRequest(attempt.plan, deps.customerFor(attempt.target.workerId)));
    const keys = standardPlanJournalKeys(attempt.plan, THIRSTY_PICKLE_FACILITY_ID);
    if (keys.length !== 1 || keys[0] !== attempt.target.targetKey || armCheckoutRequest(request).key !== keys[0])
      throw Error('PRECISION_TARGET_KEY_MISMATCH');
    return { attempt, request, key: keys[0]!, fingerprint: prooflessPlanFingerprint(attempt.plan) };
  });
  // The global lock is armed before any per-target record, so every armed journal is covered by it.
  await deps.lock?.armed(deps.releaseMs, dispatchDeadlineMs, prepared.length);
  const settled = await Promise.allSettled(prepared.map(async ({ attempt, request, key, fingerprint }): Promise<ArmedAttempt> => {
    const journal = deps.journalFor?.(key) ?? new DurableSubmissionJournal(resolve(deps.journalRoot, key));
    await journal.arm(key, new Date(deps.now()), { attemptId: key, planFingerprint: fingerprint, targetDate: attempt.plan.targetDate,
      courtIds: attempt.plan.courts.map(court => court.court),
      hourlyBoundaries: attempt.plan.courts.flatMap(court => court.slots.map(slot => ({ startTime: slot.startTime, endTime: slot.endTime }))),
      expectedBookingCount: request.items.length, maximumAmount: attempt.plan.totalPrice, stage: 'armed',
      releaseMs: deps.releaseMs, dispatchDeadlineMs });
    let permit: SubmissionPermit;
    try { permit = await journal.claimArmedOneShot(key, new Date(deps.now())); }
    catch (error) {
      // Armed but never claimed: no permit exists; record it as provably unsent.
      await journal.mark(key, 'rejected', new Date(deps.now()), undefined, undefined, 'ARMED_NOT_DISPATCHED').catch(() => undefined);
      throw error;
    }
    return { target: attempt.target, plan: attempt.plan, key, request, journal, permit, state: 'armed' };
  }));
  const attempts: ArmedAttempt[] = [], unarmed: Array<{ attempt: PrecisionAttempt; state: PrecisionAttemptState; code: string }> = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') attempts.push(result.value);
    else {
      const code = safeCode(result.reason, 'PRECISION_ARM_FAILED');
      unarmed.push({ attempt: prepared[index]!.attempt, state: code === 'DUPLICATE_LOGICAL_BOOKING_BLOCKED' ? 'JOURNAL_BLOCKED' : 'NOT_DISPATCHED', code });
    }
  });
  return Object.freeze({ race, releaseMs: deps.releaseMs, dispatchDeadlineMs, attempts: Object.freeze(attempts), unarmed: Object.freeze(unarmed) });
}

/**
 * The release-instant action for one armed attempt. Synchronous up to the transport
 * call and in-memory only. Refusals happen before the one-shot flips and before the
 * transport is invoked, so they are provably unsent. Never throws synchronously.
 */
export function fireArmedAttempt(attempt: ArmedAttempt, transport: DirectTransport, clock: Pick<TrustedReleaseClock, 'nowMs'>,
  window: { releaseMs: number; dispatchDeadlineMs: number }, isAborted: () => boolean): Promise<unknown> {
  const refuse = (code: string) => {
    if (attempt.state === 'armed') { attempt.state = 'refused'; revokeSubmissionPermit(attempt.permit); }
    return Promise.reject(new SubmissionDispatchError(code, false));
  };
  try {
    if (attempt.state !== 'armed') return Promise.reject(new SubmissionDispatchError('SUPERVISED_ONE_SHOT_ALREADY_USED', false));
    if (isAborted()) return refuse('USER_ABORT');
    const now = clock.nowMs();
    // Final trusted no-early / maximum-lateness gate (same anchored clock as the wait).
    if (now < window.releaseMs) return refuse('DIRECT_RELEASE_NOT_REACHED');
    if (now > window.dispatchDeadlineMs) return refuse('DIRECT_RELEASE_WINDOW_MISSED');
    attempt.state = 'fired';
    // Checked once more as the transport's last step before the network.
    const beforePost = () => {
      try { assertDirectDispatchWindow(window.releaseMs, clock.nowMs()); }
      catch { throw new SubmissionDispatchError('DIRECT_RELEASE_WINDOW_MISSED', false); }
    };
    return transport.publicCheckoutProofless(attempt.request, attempt.permit, { requirePreparedContext: true, beforePost });
  } catch (error) {
    // Only reachable if the transport threw synchronously; it may already have been invoked.
    return Promise.reject(error);
  }
}

/** Awaits one fired attempt's response and records it durably (post-response, off the hot path). */
export function settleArmedAttempt(attempt: ArmedAttempt, sent: Promise<unknown>, now: () => number): Promise<VerifiedPublicCheckout> {
  return recordDirectCheckoutOutcome(() => sent, attempt.request, attempt.plan, [{ journal: attempt.journal, key: attempt.key }], now);
}

/**
 * Durably records an attempt that was never fired as provably unsent. Only the live
 * process can do this: the permit must still be unspent in this process, which proves
 * the transport was never invoked for it.
 */
export async function disarmAttempt(attempt: ArmedAttempt, code: string, now: () => number): Promise<boolean> {
  if (attempt.state !== 'armed' || !revokeSubmissionPermit(attempt.permit)) return false;
  attempt.state = 'disarmed';
  await attempt.journal.mark(attempt.key, 'rejected', new Date(now()), undefined, undefined, /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : 'ARMED_NOT_DISPATCHED');
  return true;
}
export async function disarmUnfired(armed: ArmedPrecisionRace, code: string, now: () => number): Promise<WorkerId[]> {
  const results = await Promise.allSettled(armed.attempts.map(attempt => disarmAttempt(attempt, code, now)));
  return armed.attempts.flatMap((attempt, index) => results[index]!.status === 'fulfilled' && (results[index] as PromiseFulfilledResult<boolean>).value ? [attempt.target.workerId] : []);
}
/** True when no armed attempt ever reached the transport (every one refused or disarmed). */
export const armedNothingFired = (armed: ArmedPrecisionRace) => armed.attempts.every(attempt => attempt.state !== 'fired');

export interface ArmedDispatchDeps {
  clock: TrustedReleaseClock;
  prewarmLeadMs: number;
  /** A failed prewarm is retried once only if it failed at least this long before release. */
  prewarmRetryCutoffMs?: number;
  spinTailMs?: number;
  /** Timer sleep for the waits; the runner passes its abort-aware pause so Stop is honoured within milliseconds. */
  sleep?: (ms: number) => Promise<void>;
  prewarm: (attempt: ArmedAttempt) => Promise<void>;
  transportFor: (worker: WorkerId) => DirectTransport | undefined;
  isAborted: () => boolean;
  /** A validated pending hold: record it and hand off to the official QR page. Returns the final state or throws VerifiedHoldQrError. */
  onVerifiedHold?: (attempt: ArmedAttempt, verified: VerifiedPublicCheckout) => Promise<PrecisionDispatchResult>;
  onEvent?: (event: { kind: 'prewarm-ready' | 'prewarm-failed' | 'prewarm-retry' | 'dispatch-start' | 'settled'; workerId: WorkerId; state?: PrecisionAttemptState; code?: string }) => void;
  onWake?: () => void;
  /** Benchmark instrumentation only. */
  onMark?: (worker: WorkerId, name: string) => void;
  /** Runs after every ready attempt has been fired (never before a POST), e.g. the lock's FINAL_ACTION_DISPATCHING record. */
  afterFire?: () => Promise<void>;
  /**
   * Release window: onFinalApproach runs FINAL_APPROACH_MS before release (after prewarm normally
   * finished) and onReleaseWindowEnd once the POSTs have left or the attempt ended. Used for the
   * runner's HIGH process priority; never REALTIME.
   */
  onFinalApproach?: () => void;
  onReleaseWindowEnd?: () => void;
}
export const FINAL_APPROACH_MS = 1_000;
export interface ArmedDispatchOutcome {
  results: Array<{ attempt: PrecisionAttempt } & PrecisionDispatchResult>;
  disarmed: WorkerId[];
  afterFireError?: string;
}

/**
 * Per-attempt readiness and independent dispatch for an armed race. Prewarm runs
 * prewarmLeadMs before release; the final wait is on the monotonic deadline of the
 * trusted clock; at the deadline every ready attempt is fired in one synchronous pass.
 * An attempt that is not ready by the dispatch deadline is disarmed as unsent.
 */
export async function dispatchArmedPrecisionRace(armed: ArmedPrecisionRace, deps: ArmedDispatchDeps): Promise<ArmedDispatchOutcome> {
  const { clock } = deps, { releaseMs, dispatchDeadlineMs } = armed;
  const now = () => clock.nowMs();
  const retryCutoff = releaseMs - (deps.prewarmRetryCutoffMs ?? 7_000);
  const spinTailMs = deps.spinTailMs ?? DEFAULT_SPIN_TAIL_MS;
  // Observers must never change an outcome (a failed trace write is not a failed prewarm or an unknown POST).
  const emit = (event: Parameters<NonNullable<ArmedDispatchDeps['onEvent']>>[0]) => { try { deps.onEvent?.(event); } catch { /* observability only */ } };
  const waitFor = (epochMs: number, isAborted = deps.isAborted, sleep = deps.sleep) =>
    waitForMonotonicDeadline(() => clock.monotonicDeadline(epochMs), { spinTailMs, isAborted, ...(sleep ? { sleep } : {}) });
  type Readiness = { settled: boolean; ok: boolean; promise: Promise<boolean> };
  let readiness: Readiness[];
  try {
    assertPrecisionFreezeIntact(armed.race);
    await waitFor(releaseMs - deps.prewarmLeadMs);
    readiness = armed.attempts.map(attempt => {
      const entry: Readiness = { settled: false, ok: false, promise: Promise.resolve(false) };
      entry.promise = (async () => {
        for (let round = 1; round <= 2; round++) {
          try { await deps.prewarm(attempt); }
          catch (error) {
            emit({ kind: 'prewarm-failed', workerId: attempt.target.workerId, code: safeCode(error, 'SECURITY_PREWARM_FAILED') });
            if (round === 1 && now() < retryCutoff) { emit({ kind: 'prewarm-retry', workerId: attempt.target.workerId }); continue; }
            return false;
          }
          emit({ kind: 'prewarm-ready', workerId: attempt.target.workerId });
          return true;
        }
        return false;
      })().then(ok => { entry.settled = true; entry.ok = ok; return ok; });
      return entry;
    });
    // Integrity of the frozen set is verified before the final wait, never after T-0.
    assertPrecisionFreezeIntact(armed.race);
    if (deps.onFinalApproach) { await waitFor(releaseMs - FINAL_APPROACH_MS); try { deps.onFinalApproach(); } catch { /* optional tuning */ } }
    await waitFor(releaseMs);
  } catch (error) {
    try { deps.onReleaseWindowEnd?.(); } catch { /* optional tuning */ }
    // Aborted (or failed) before release: nothing was fired; record every attempt as provably unsent.
    await disarmUnfired(armed, safeCode(error, 'ARMED_NOT_DISPATCHED'), now);
    throw error;
  }
  deps.onWake?.();
  // ---- T-0: one synchronous, in-memory pass. No I/O, hashing or request building here. ----
  const sends: Array<Promise<unknown> | undefined> = new Array(armed.attempts.length);
  for (let index = 0; index < armed.attempts.length; index++) {
    const attempt = armed.attempts[index]!, ready = readiness[index]!;
    if (!ready.settled || !ready.ok) continue;
    const transport = deps.transportFor(attempt.target.workerId);
    if (!transport) continue;
    deps.onMark?.(attempt.target.workerId, 'transportCall');
    const sent = fireArmedAttempt(attempt, transport, clock, armed, deps.isAborted);
    sent.catch(() => undefined); // observed below; marked handled so a refusal is never an unhandled rejection meanwhile
    sends[index] = sent;
  }
  // The CDP messages leave in the microtasks after this pass; run no bookkeeping on this thread until they have.
  await new Promise<void>(done => setImmediate(done));
  try { deps.onReleaseWindowEnd?.(); } catch { /* optional tuning */ }
  // ---- Everything below runs after every ready POST has been started. ----
  const afterFire = deps.afterFire && sends.some(Boolean)
    ? deps.afterFire().then(() => undefined, (error: unknown) => safeCode(error, 'AFTER_FIRE_FAILED'))
    : Promise.resolve(undefined);
  const settleInner = async (index: number): Promise<PrecisionDispatchResult> => {
    const attempt = armed.attempts[index]!, ready = readiness[index]!;
    let sent = sends[index];
    if (!sent) {
      if (!ready.settled) {
        // Not ready at T-0: it may still dispatch inside the window, exactly like a late prewarm before.
        const timedOut = Symbol('timeout');
        // A late prewarm keeps its window even if Stop arrives now (fireArmedAttempt still refuses once aborted).
        const outcome = await Promise.race([ready.promise, waitFor(dispatchDeadlineMs, () => false, undefined).then(() => timedOut)]);
        if (outcome === timedOut) { await disarmAttempt(attempt, 'PREWARM_NOT_READY_IN_WINDOW', now).catch(() => undefined); return { state: 'WINDOW_MISSED', code: 'PREWARM_NOT_READY_IN_WINDOW' }; }
      }
      if (!ready.ok) { await disarmAttempt(attempt, 'SECURITY_PREWARM_FAILED', now).catch(() => undefined); return { state: 'PREWARM_FAILED', code: 'SECURITY_PREWARM_FAILED' }; }
      const transport = deps.transportFor(attempt.target.workerId);
      if (!transport) { await disarmAttempt(attempt, 'API_CHECKOUT_WORKER_MISSING', now).catch(() => undefined); return { state: 'NOT_DISPATCHED', code: 'API_CHECKOUT_WORKER_MISSING' }; }
      sent = fireArmedAttempt(attempt, transport, clock, armed, deps.isAborted);
    }
    emit({ kind: 'dispatch-start', workerId: attempt.target.workerId });
    try {
      const verified = await settleArmedAttempt(attempt, sent, now);
      return deps.onVerifiedHold ? await deps.onVerifiedHold(attempt, verified) : { state: 'QR_READY' };
    } catch (error) {
      return classifyPrecisionDispatchError(error, async () => {
        try { return (await attempt.journal.read(attempt.key)).state; }
        catch (readError) { if ((readError as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw readError; }
      });
    }
  };
  const settleOne = async (index: number): Promise<PrecisionDispatchResult> => {
    // settleInner classifies its own failures; an unexpected throw may have happened after the POST.
    const result = await settleInner(index).catch((): PrecisionDispatchResult => ({ state: 'UNKNOWN', code: 'PRECISION_DISPATCH_UNCLASSIFIED' }));
    const attempt = armed.attempts[index]!;
    emit({ kind: 'settled', workerId: attempt.target.workerId, state: result.state, ...(result.code ? { code: result.code } : {}) });
    return result;
  };
  const settled = await Promise.all(armed.attempts.map((_, index) => settleOne(index)));
  const disarmed = await disarmUnfired(armed, 'ARMED_NOT_DISPATCHED', now);
  const afterFireError = await afterFire;
  const byWorker = new Map(armed.attempts.map((attempt, index) => [attempt.target.workerId, settled[index]!] as const));
  for (const value of armed.unarmed) byWorker.set(value.attempt.target.workerId, { state: value.state, code: value.code });
  return { results: armed.race.attempts.map(attempt => ({ attempt, ...(byWorker.get(attempt.target.workerId) ?? { state: 'NOT_DISPATCHED' as const, code: 'PRECISION_NOT_ARMED' }) })),
    disarmed, ...(afterFireError ? { afterFireError } : {}) };
}
