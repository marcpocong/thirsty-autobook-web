import { resolve } from 'node:path';
import type { ApiAutomationLock } from './api-automation-lock.js';
import { armCheckoutRequest } from './armed-request.js';
import { DurableSubmissionJournal, revokeSubmissionPermit, type SubmissionPermit } from './durable-submission-journal.js';
import { THIRSTY_PICKLE_FACILITY_ID } from './live-availability-provider.js';
import { assertPrecisionFreezeIntact, classifyPrecisionDispatchError, raceQuota, type FrozenPrecisionRace, type PrecisionAttempt,
  type PrecisionAttemptState, type PrecisionDispatchResult, type PrecisionTarget } from './precision-race.js';
import { assertDirectDispatchWindow, DIRECT_MAX_DISPATCH_LATENESS_MS, prooflessPlanFingerprint, prooflessRequest,
  recordDirectCheckoutOutcome, type DirectTransport, type ProoflessCheckoutRequest } from './proofless-checkout.js';
import {validatePublicCheckoutResponse,type PublicCheckoutRequest,type VerifiedPublicCheckout} from './public-checkout.js';
import { SubmissionDispatchError } from './submission-errors.js';
import { standardPlanJournalKeys, type CheckoutCustomer } from './two-hour-reservation.js';
import type { BookingPlan } from './types.js';
import { DEFAULT_SPIN_TAIL_MS, waitForMonotonicDeadline, type TrustedReleaseClock } from '../release-clock.js';
import type { WorkerId } from '../workers.js';
import type { CheckoutDispatchOptions,OndaBrowserSessionTransport } from './browser-session-transport.js';
import type { RendererClockCalibration } from './renderer-clock.js';
import { DEFAULT_RENDERER_DISPATCH_OPTIONS, planRendererFire, type RendererDispatchOptions, type RendererFirePlan } from './renderer-dispatch.js';
import { schedulePrewarm, UNBOUNDED_PREWARM, type PrewarmPolicy, type PrewarmSchedule, type TierStatus } from './prewarm-scheduler.js';
import { SHOTGUN_MAX_TRIGGER_LATENESS_MS, shotgunStopReason, shotgunTriggerMs, type ShotgunSuppressionReason } from '../shotgun.js';

/**
 * Durable pre-armed Precision dispatch.
 *
 * Before release (right after the T-2 min freeze) everything durable or costly is done:
 * the exact request is built, deep-frozen and serialized; its journal key and plan
 * fingerprint are computed; the global lock is rewritten to FINAL_ACTION_ARMED; each
 * target's journal is created as 'armed' and its write-once one-shot is claimed, which
 * yields an in-memory permit. At the release instant a worker only checks abort, flips
 * its in-memory one-shot, checks the trusted clock (never before its scheduled trigger,
 * never past the window) and calls the browser transport. Each attempt's trigger is the
 * release instant unless the operator chose a Release Offset for it (release-offset.ts). No file is written, flushed, renamed or read, and
 * nothing is hashed or built, between T-0 and the POST.
 *
 * Crash semantics (see RELEASE_LATENCY_PHASE1.md and tests/api-booking/armed-dispatch.test.ts):
 * - journal absent, or armed without a complete one-shot claim: no permit ever existed -> provably unsent;
 * - armed with a claimed one-shot and no live process: a POST may have left -> blocked, manual reconciliation;
 * - only the live process that holds the permit may disarm (it knows the transport was never invoked).
 */
export type ArmedAttemptState = 'armed' | 'fired' | 'refused' | 'disarmed';
export interface ArmedAttempt {
  readonly attempt: PrecisionAttempt;
  readonly target: PrecisionTarget;
  readonly plan: BookingPlan;
  readonly key: string;
  readonly request: ProoflessCheckoutRequest;
  readonly journal: DurableSubmissionJournal;
  readonly permit: SubmissionPermit;
  /** Scheduled trigger: the release instant plus this attempt's pre-release Shotgun offset (-2000 through 0 ms). */
  readonly triggerMs: number;
  readonly shotDeadlineMs?: number;
  /** 'armed' until the one in-memory transition; 'fired' is set synchronously before the transport call. */
  state: ArmedAttemptState;
}
export interface ArmedPrecisionRace {
  readonly race: FrozenPrecisionRace;
  /** The official release instant; the maximum-lateness window is measured from it. */
  readonly releaseMs: number;
  readonly dispatchDeadlineMs: number;
  readonly attempts: readonly ArmedAttempt[];
  /** One durable logical-target guard for each worker's bounded fan-out group. */
  readonly fanOutGuards: readonly ArmedFanOutGuard[];
  /** Frozen attempts that could not be armed: provably unsent. */
  readonly unarmed: ReadonlyArray<{ attempt: PrecisionAttempt; state: PrecisionAttemptState; code: string }>;
}
export interface ArmedFanOutGuard {
  readonly key: string;
  readonly journal: DurableSubmissionJournal;
  readonly permit: SubmissionPermit;
  readonly attemptIds: readonly string[];
  state: 'armed' | 'settled' | 'disarmed';
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
  /** Trusted epoch milliseconds, used for record timestamps and the "arm strictly before every trigger" check. */
  now: () => number;
  journalFor?: (key: string) => DurableSubmissionJournal;
}

/** Pre-release, durable arming of every frozen attempt. Never sends anything. */
export async function armPrecisionRace(race: FrozenPrecisionRace, deps: ArmDeps): Promise<ArmedPrecisionRace> {
  assertPrecisionFreezeIntact(race);
  if (race.releaseMs !== deps.releaseMs || !Number.isSafeInteger(deps.releaseMs)) throw Error('PRECISION_ARM_RELEASE_MISMATCH');
  if (!race.attempts.length) throw Error('PRECISION_NOTHING_TO_ARM');
  // Validated before anything durable: an out-of-range offset refuses the whole arm.
  const triggers = race.attempts.map(attempt => shotgunTriggerMs(deps.releaseMs, attempt.target.releaseOffsetMs ?? 0));
  if (!(deps.now() < Math.min(...triggers))) throw Error('PRECISION_ARM_TOO_LATE');
  const latestTriggerOffsetMs = Math.max(0, ...triggers.map(triggerMs => triggerMs - deps.releaseMs));
  const dispatchDeadlineMs = deps.releaseMs + Math.max(deps.dispatchWindowMs ?? DIRECT_MAX_DISPATCH_LATENESS_MS,
    latestTriggerOffsetMs + DIRECT_MAX_DISPATCH_LATENESS_MS);
  const prepared = race.attempts.map((attempt, index) => {
    const request = deepFreeze(prooflessRequest(attempt.plan, deps.customerFor(attempt.target.workerId), race.executionMode));
    const keys = standardPlanJournalKeys(attempt.plan, THIRSTY_PICKLE_FACILITY_ID);
    if (keys.length !== 1 || keys[0] !== attempt.target.targetKey) throw Error('PRECISION_TARGET_KEY_MISMATCH');
    // Exact wire-body self-check before anything durable: a malformed request refuses the whole arm, never fails at release.
    if (armCheckoutRequest(request, { plan: attempt.plan, key: keys[0]! }).key !== keys[0]) throw Error('PRECISION_TARGET_KEY_MISMATCH');
    return { attempt, request, key: keys[0]!, fingerprint: prooflessPlanFingerprint(attempt.plan), triggerMs: triggers[index]! };
  });
  // The global lock is armed before any per-target record, so every armed journal is covered by it.
  await deps.lock?.armed(deps.releaseMs, dispatchDeadlineMs, prepared.length);
  const grouped = new Map<string, typeof prepared>();
  for (const value of prepared) { const values = grouped.get(value.key) ?? []; values.push(value); grouped.set(value.key, values); }
  const fanOutGuards: ArmedFanOutGuard[] = [];
  for (const [key, values] of grouped) {
    if (values.length < 2) continue;
    const parent = new DurableSubmissionJournal(resolve(deps.journalRoot, key));
    const first = values[0]!;
    await parent.arm(key, new Date(deps.now()), { attemptId: key, planFingerprint: race.fingerprint,
      ...(race.executionMode ? {executionMode:race.executionMode,wing:first.attempt.plan.wing??'MANGO',spaceIds:first.attempt.plan.courts.map(c=>c.spaceId)} : {}),
      targetDate: first.attempt.plan.targetDate, courtIds: first.attempt.plan.courts.map(court => court.court),
      hourlyBoundaries: first.attempt.plan.courts.flatMap(court => court.slots.map(slot => ({ startTime: slot.startTime, endTime: slot.endTime }))),
      expectedBookingCount: first.request.items.length, maximumAmount: first.attempt.plan.totalPrice, stage: 'armed',
      releaseMs: deps.releaseMs, dispatchDeadlineMs });
    const permit = await parent.claimArmedOneShot(key, new Date(deps.now()));
    fanOutGuards.push({ key, journal: parent, permit, attemptIds: values.map(value => value.attempt.id), state: 'armed' });
  }
  const settled = await Promise.allSettled(prepared.map(async ({ attempt, request, key, fingerprint, triggerMs }): Promise<ArmedAttempt> => {
    const isFanOut = (grouped.get(key)?.length ?? 0) > 1;
    const journal = isFanOut
      ? new DurableSubmissionJournal(resolve(deps.journalRoot, key, 'fan-out', race.fingerprint, attempt.id))
      : deps.journalFor?.(key) ?? new DurableSubmissionJournal(resolve(deps.journalRoot, key));
    await journal.arm(key, new Date(deps.now()), { attemptId: isFanOut ? attempt.id : key, planFingerprint: fingerprint, targetDate: attempt.plan.targetDate,
      ...(race.executionMode ? {executionMode:race.executionMode,wing:attempt.plan.wing??'MANGO',spaceIds:attempt.plan.courts.map(c=>c.spaceId)} : {}),
      courtIds: attempt.plan.courts.map(court => court.court),
      hourlyBoundaries: attempt.plan.courts.flatMap(court => court.slots.map(slot => ({ startTime: slot.startTime, endTime: slot.endTime }))),
      expectedBookingCount: request.items.length, maximumAmount: attempt.plan.totalPrice, stage: 'armed',
      releaseMs: deps.releaseMs, dispatchDeadlineMs,
      ...(attempt.dispatchTimingPolicy==='SHOTGUN_STRICT'?{dispatchTimingPolicy:attempt.dispatchTimingPolicy,triggerMs,shotDeadlineMs:triggerMs+SHOTGUN_MAX_TRIGGER_LATENESS_MS}:{}) });
    let permit: SubmissionPermit;
    try { permit = await journal.claimArmedOneShot(key, new Date(deps.now())); }
    catch (error) {
      // Armed but never claimed: no permit exists; record it as provably unsent.
      await journal.mark(key, 'rejected', new Date(deps.now()), undefined, undefined, 'ARMED_NOT_DISPATCHED').catch(() => undefined);
      throw error;
    }
    return { attempt, target: attempt.target, plan: attempt.plan, key, request, journal, permit, triggerMs, ...(attempt.dispatchTimingPolicy==='SHOTGUN_STRICT'?{shotDeadlineMs:triggerMs+SHOTGUN_MAX_TRIGGER_LATENESS_MS}:{}), state: 'armed' };
  }));
  const attempts: ArmedAttempt[] = [], unarmed: Array<{ attempt: PrecisionAttempt; state: PrecisionAttemptState; code: string }> = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') attempts.push(result.value);
    else {
      const code = safeCode(result.reason, 'PRECISION_ARM_FAILED');
      unarmed.push({ attempt: prepared[index]!.attempt, state: code === 'DUPLICATE_LOGICAL_BOOKING_BLOCKED' ? 'JOURNAL_BLOCKED' : 'NOT_DISPATCHED', code });
    }
  });
  for (const guard of fanOutGuards) if (!attempts.some(attempt => guard.attemptIds.includes(attempt.attempt.id))) {
    if (revokeSubmissionPermit(guard.permit)) await guard.journal.mark(guard.key, 'rejected', new Date(deps.now()), undefined, undefined, 'ARMED_NOT_DISPATCHED').catch(() => undefined);
    guard.state = 'disarmed';
  }
  return Object.freeze({ race, releaseMs: deps.releaseMs, dispatchDeadlineMs, attempts: Object.freeze(attempts),
    fanOutGuards: Object.freeze(fanOutGuards), unarmed: Object.freeze(unarmed) });
}

/**
 * The release-instant action for one armed attempt. Synchronous up to the transport
 * call and in-memory only. Refusals happen before the one-shot flips and before the
 * transport is invoked, so they are provably unsent. Never throws synchronously.
 */
export function fireArmedAttempt(attempt: ArmedAttempt, transport: DirectTransport, clock: Pick<TrustedReleaseClock, 'nowMs'> & Partial<Pick<TrustedReleaseClock,'monotonicDeadline'>>,
  window: { releaseMs: number; triggerMs?: number; dispatchDeadlineMs: number }, isAborted: () => boolean, lifecycle:Pick<CheckoutDispatchOptions,'onResponseSafety'|'beforeResponseBookkeeping'>={},beforeSubmit?:()=>void): Promise<unknown> {
  const triggerMs = window.triggerMs ?? window.releaseMs;
  const refuse = (code: string) => {
    if (attempt.state === 'armed') { attempt.state = 'refused'; revokeSubmissionPermit(attempt.permit); }
    return Promise.reject(new SubmissionDispatchError(code, false));
  };
  try {
    if (attempt.state !== 'armed') return Promise.reject(new SubmissionDispatchError('SUPERVISED_ONE_SHOT_ALREADY_USED', false));
    if (isAborted()) return refuse('USER_ABORT');
    try{beforeSubmit?.();}catch(error){return refuse(safeCode(error,'OBJECTIVE_SUBMISSION_STOPPED'));}
    const now = clock.nowMs();
    // Final trusted no-early / maximum-lateness gate (same anchored clock as the wait).
    if (now < triggerMs) return refuse('DIRECT_RELEASE_NOT_REACHED');
    if (attempt.shotDeadlineMs!==undefined && now>attempt.shotDeadlineMs) return refuse('SHOTGUN_TRIGGER_MISSED');
    if (now > window.dispatchDeadlineMs) return refuse('DIRECT_RELEASE_WINDOW_MISSED');
    attempt.state = 'fired';
    // Checked once more as the transport's last step before the network.
    const beforePost = () => {
      try { beforeSubmit?.();const at=clock.nowMs();
        if(attempt.shotDeadlineMs!==undefined && at>attempt.shotDeadlineMs) throw new SubmissionDispatchError('SHOTGUN_TRIGGER_MISSED',false);
        assertDirectDispatchWindow(window.releaseMs, at, triggerMs,true);
        if(at>window.dispatchDeadlineMs)throw Error('DIRECT_RELEASE_WINDOW_MISSED'); }
      catch(error) { if(error instanceof SubmissionDispatchError)throw error; throw new SubmissionDispatchError('DIRECT_RELEASE_WINDOW_MISSED', false); }
    };
    return transport.publicCheckoutProofless(attempt.request, attempt.permit, { ...lifecycle,requirePreparedContext: true, beforePost, ...(attempt.shotDeadlineMs!==undefined ? {strictTiming: {
      notBeforeNodeMs: clock.monotonicDeadline?.(triggerMs) ?? NaN,
      notAfterNodeMs: clock.monotonicDeadline?.(Math.min(attempt.shotDeadlineMs,window.dispatchDeadlineMs)) ?? NaN}} : {}) });
  } catch (error) {
    // Only reachable if the transport threw synchronously; it may already have been invoked.
    return Promise.reject(error);
  }
}

/** Slack allowed between the scheduled arm instant and the actual arm call. */
export const RENDERER_ARM_SLACK_MS = 25;
export type RendererTransport = Pick<OndaBrowserSessionTransport, 'publicCheckoutProoflessRendererArmed' | 'disarmRendererCheckout'>;
/**
 * EXPERIMENTAL counterpart of fireArmedAttempt: hands the armed attempt to its page `armLeadMs` before
 * release (renderer-dispatch.ts). Refusals before the transport call are provably unsent. The trusted
 * clock must read BEFORE the trigger and inside the arm lead, both here and as the transport's last step.
 */
export function fireArmedAttemptRenderer(attempt: ArmedAttempt, transport: RendererTransport, clock: Pick<TrustedReleaseClock, 'nowMs'>,
  window: { releaseMs: number; triggerMs?: number;dispatchDeadlineMs?:number }, plan: RendererFirePlan, isAborted: () => boolean, armLeadMs: number, lifecycle:Pick<CheckoutDispatchOptions,'onResponseSafety'|'beforeResponseBookkeeping'>={}): Promise<unknown> {
  const triggerMs = window.triggerMs ?? window.releaseMs;
  const refuse = (code: string) => {
    if (attempt.state === 'armed') { attempt.state = 'refused'; revokeSubmissionPermit(attempt.permit); }
    return Promise.reject(new SubmissionDispatchError(code, false));
  };
  const inArmWindow = (at: number) => at < triggerMs && triggerMs - at <= armLeadMs + RENDERER_ARM_SLACK_MS;
  try {
    if (attempt.state !== 'armed') return Promise.reject(new SubmissionDispatchError('SUPERVISED_ONE_SHOT_ALREADY_USED', false));
    if (isAborted()) return refuse('USER_ABORT');
    if(attempt.shotDeadlineMs!==undefined && (plan.trustedTriggerMs!==triggerMs || plan.trustedDeadlineMs!==Math.min(attempt.shotDeadlineMs,window.dispatchDeadlineMs??Infinity) || plan.notAfterRendererMs-plan.fireAtRendererMs>SHOTGUN_MAX_TRIGGER_LATENESS_MS)) return refuse('SHOTGUN_TIMING_POLICY_MISMATCH');
    if (!inArmWindow(clock.nowMs())) return refuse('RENDERER_ARM_WINDOW_MISSED');
    attempt.state = 'fired';
    const beforeArm = () => { if (!inArmWindow(clock.nowMs())) throw new SubmissionDispatchError('RENDERER_ARM_WINDOW_MISSED', false); };
    return transport.publicCheckoutProoflessRendererArmed(attempt.request, attempt.permit,
      {...plan,...(attempt.shotDeadlineMs!==undefined?{missedCode:'SHOTGUN_TRIGGER_MISSED' as const}:{})}, { ...lifecycle,beforeArm });
  } catch (error) {
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
  for (const guard of armed.fanOutGuards) if (guard.state === 'armed' && armed.attempts
    .filter(attempt => guard.attemptIds.includes(attempt.attempt.id)).every(attempt => attempt.state !== 'fired')) {
    if (revokeSubmissionPermit(guard.permit)) await guard.journal.mark(guard.key, 'rejected', new Date(now()), undefined, undefined,
      /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : 'ARMED_NOT_DISPATCHED').catch(() => undefined);
    guard.state = 'disarmed';
  }
  return armed.attempts.flatMap((attempt, index) => results[index]!.status === 'fulfilled' && (results[index] as PromiseFulfilledResult<boolean>).value ? [attempt.target.workerId] : []);
}
/** True when no armed attempt ever reached the transport (every one refused or disarmed). */
export const armedNothingFired = (armed: ArmedPrecisionRace) => armed.attempts.every(attempt => attempt.state !== 'fired');
/** Effective dispatch window: strict Shotgun deadline bounded by the outer race deadline. */
export const armedWindow = (armed: ArmedPrecisionRace, attempt: ArmedAttempt) =>
  ({ releaseMs: armed.releaseMs, triggerMs: attempt.triggerMs, dispatchDeadlineMs: Math.min(armed.dispatchDeadlineMs,attempt.shotDeadlineMs??Infinity) });
/** The earliest trigger of an armed race (the release instant when nothing was armed). */
export const firstArmedTrigger = (armed: ArmedPrecisionRace) =>
  armed.attempts.length ? Math.min(...armed.attempts.map(attempt => attempt.triggerMs)) : armed.releaseMs;

export interface ArmedDispatchDeps {
  clock: TrustedReleaseClock;
  /** Runs alongside prewarm; must complete before renderer calibration or dispatch. */
  refreshClock?: () => Promise<TrustedReleaseClock>;
  prewarmLeadMs: number;
  /** A failed prewarm is retried once only if it failed at least this long before release. */
  prewarmRetryCutoffMs?: number;
  spinTailMs?: number;
  /** Timer sleep for the waits; the runner passes its abort-aware pause so Stop is honoured within milliseconds. */
  sleep?: (ms: number) => Promise<void>;
  prewarm: (attempt: ArmedAttempt) => Promise<void>;
  transportFor: (worker: WorkerId, attempt: ArmedAttempt) => DirectTransport | undefined;
  isAborted: () => boolean;
  /** A validated pending hold: record it and hand off to the official QR page. Returns the final state or throws VerifiedHoldQrError. */
  onObjectiveStop?:(reason:ShotgunSuppressionReason)=>void;
  onVerifiedHold?: (attempt: ArmedAttempt, verified: VerifiedPublicCheckout) => Promise<PrecisionDispatchResult>;
  onEvent?: (event: { kind: 'prewarm-ready' | 'prewarm-failed' | 'prewarm-retry' | 'dispatch-start' | 'settled'; workerId: WorkerId; attemptId: string; state?: PrecisionAttemptState; code?: string;
    predictedReadyOffsetMs?:number;actualReadyOffsetMs?:number;predictionErrorMs?:number;queueDelayMs?:number;prepDurationMs?:number }) => void;
  onWake?: (triggerMs:number) => void;
  /**
   * Priority-aware prewarm (prewarm-scheduler.ts): children are prepared tier by tier (fan-out index 0 first) with bounded
   * concurrency. Absent means the previous behavior (every attempt prepares at once). With a policy, a lower-tier child
   * (fan-out index > 0) that is not ready at its trigger is omitted as provably unsent instead of firing late, and no new
   * preparation starts after `prewarmStopStartingLeadMs` before the first trigger.
   */
  prewarmPolicy?: PrewarmPolicy;
  /** Duration substituted by the feasibility forecast; telemetry only. */
  prewarmExpectedDurationMs?:number;
  prewarmStopStartingLeadMs?: number;
  onPrewarmStatus?: (status: TierStatus[]) => void;
  /** Benchmark instrumentation only. */
  onMark?: (worker: WorkerId, name: string, attempt: ArmedAttempt) => void;
  /** Runs after every ready attempt has been fired (never before a POST), e.g. the lock's FINAL_ACTION_DISPATCHING record. */
  afterFire?: () => Promise<void>;
  /**
   * Release window: onFinalApproach runs FINAL_APPROACH_MS before release (after prewarm normally
   * finished) and onReleaseWindowEnd once the POSTs have left or the attempt ended. Used for the
   * runner's HIGH process priority; never REALTIME.
   */
  onFinalApproach?: () => void;
  onReleaseWindowEnd?: () => void;
  /**
   * EXPERIMENTAL renderer-resident dispatch (renderer-dispatch.ts). When absent — the default — dispatch is
   * exactly the Node-triggered path. When present, each ready attempt whose page clock calibrates is handed to
   * its page `armLeadMs` before release and fires from there; every other attempt uses the Node path at T-0.
   */
  rendererDispatch?: {
    pageUrl: string;
    options?: Partial<RendererDispatchOptions>;
    /** Samples and calibrates the attempt's page clock (a few CDP round trips), called once ~3 s before release. */
    calibrate: (attempt: ArmedAttempt) => Promise<RendererClockCalibration>;
    transportFor: (worker: WorkerId, attempt: ArmedAttempt) => RendererTransport | undefined;
    onPlan?: (event: { workerId: WorkerId; attemptId:string; mode: 'renderer' | 'node-fallback'; code?: string; calibration?: RendererClockCalibration; plan?: RendererFirePlan }) => void;
  };
}
export const FINAL_APPROACH_MS = 1_000;
/** When the experimental renderer path calibrates page clocks. */
export const RENDERER_CALIBRATION_LEAD_MS = 3_000;
export interface ArmedDispatchOutcome {
  results: Array<{ attempt: PrecisionAttempt } & PrecisionDispatchResult>;
  disarmed: WorkerId[];
  afterFireError?: string;
}

/**
 * Per-attempt readiness and independent dispatch for an armed race. Prewarm runs
 * prewarmLeadMs before the earliest trigger; each wait is on the monotonic deadline of the
 * trusted clock. Attempts that share a trigger fire in one synchronous pass at it; attempts
 * with different Release Offsets fire at their own triggers, earliest first. An attempt
 * that is not ready by the dispatch deadline is disarmed as unsent. Without offsets every
 * attempt shares the release instant, exactly as before.
 */
export async function dispatchArmedPrecisionRace(armed: ArmedPrecisionRace, deps: ArmedDispatchDeps): Promise<ArmedDispatchOutcome> {
  const { clock } = deps, { dispatchDeadlineMs } = armed;
  const firstTriggerMs = firstArmedTrigger(armed);
  const now = () => clock.nowMs();
  const retryCutoff = firstTriggerMs - (deps.prewarmRetryCutoffMs ?? 7_000);
  const spinTailMs = deps.spinTailMs ?? DEFAULT_SPIN_TAIL_MS;
  const deferredEvents:Array<()=>void>=[];
  const strictDispatch=armed.attempts.some(a=>a.shotDeadlineMs!==undefined);
  const observe=(callback:()=>void)=>{if(strictDispatch && now()>=firstTriggerMs-FINAL_APPROACH_MS && now()<=armed.releaseMs+FINAL_APPROACH_MS)deferredEvents.push(callback);else {try{callback();}catch{}}};
  // Observers must never change an outcome (a failed trace write is not a failed prewarm or an unknown POST).
  const emit = (event: Parameters<NonNullable<ArmedDispatchDeps['onEvent']>>[0]) => {observe(()=>deps.onEvent?.(event));};
  const waitFor = (epochMs: number, isAborted = deps.isAborted, sleep = deps.sleep) =>
    waitForMonotonicDeadline(() => clock.monotonicDeadline(epochMs), { spinTailMs, isAborted, ...(sleep ? { sleep } : {}) });
  // A plain timer: after something was sent, a wait must never throw (the runner's abort-aware sleep does).
  const timerSleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
  type Readiness = { settled: boolean; ok: boolean; omitted?: boolean; promise: Promise<boolean> };
  let readiness: Readiness[];
  let prewarmSchedule: PrewarmSchedule | undefined;
  const tiered = !!deps.prewarmPolicy;
  const sends: Array<Promise<unknown> | undefined> = new Array(armed.attempts.length);
  const outcomes:Array<Promise<PrecisionDispatchResult>|undefined>=new Array(armed.attempts.length);
  const suppressed:Array<ShotgunSuppressionReason|undefined>=new Array(armed.attempts.length);
  const targetStops=new Map<string,ShotgunSuppressionReason>();
  // Without an objective a Precision race authorizes one successful court: every alternative shares it.
  // With a quota, verified holds are counted as DISTINCT courts per wing (or across wings); a wing stops at its
  // ideal while other incomplete wings continue. The achieved court itself never needs another hold.
  let objectiveStop:ShotgunSuppressionReason|undefined;
  const wingStops = new Map<string,ShotgunSuppressionReason>(), courtStops = new Map<string,ShotgunSuppressionReason>();
  const quota = raceQuota(armed.race.objective), achieved = new Map<string,Set<string>>();
  const wingOf = (attempt:ArmedAttempt) => attempt.plan.wing ?? 'MANGO';
  const courtsOf = (attempt:ArmedAttempt) => attempt.plan.courts.map(court=>`${wingOf(attempt)}:${court.spaceId}`);
  const recordStop = (attempt:ArmedAttempt, reason:ShotgunSuppressionReason) => {
    if (reason === 'SHOTGUN_TARGET_ALREADY_ACHIEVED' && quota) {
      const wing = wingOf(attempt), own = achieved.get(wing) ?? new Set<string>();
      for (const court of courtsOf(attempt)) { own.add(court); courtStops.set(court,reason); }
      achieved.set(wing,own);
      if (quota.scope === 'PER_WING') { if (own.size >= (quota.wings[wing] ?? 1)) wingStops.set(wing,reason); }
      else if ([...achieved.values()].reduce((sum,set)=>sum+set.size,0) >= (quota.overall ?? 1)) objectiveStop=reason;
    } else objectiveStop=reason;
    deps.onObjectiveStop?.(reason); targetStops.set(attempt.target.targetKey,reason);
  };
  const stopFor=(attempt:ArmedAttempt)=>objectiveStop??wingStops.get(wingOf(attempt))??courtsOf(attempt).map(court=>courtStops.get(court)).find(Boolean)??targetStops.get(attempt.target.targetKey);
  const strictRace=strictDispatch;
  // Preserve cheap safety signals immediately; defer journals, diagnostics and QR navigation until T+1 s.
  const criticalEndMs=armed.releaseMs+FINAL_APPROACH_MS;
  const afterCritical=()=>strictRace?waitFor(criticalEndMs,()=>false,timerSleep):Promise.resolve();
  const safety=(attempt:ArmedAttempt,raw:unknown,error?:SubmissionDispatchError)=>{
    let reason:ShotgunSuppressionReason|undefined;
    if(error){if(!error.dispatched)return;reason=error.diagnostic?.errorHint==='payment-in-progress'?'SHOTGUN_PAYMENT_IN_PROGRESS_STOP':error.diagnostic?.status===429?'SHOTGUN_PROVIDER_THROTTLE_STOP':error.confirmedRejected?undefined:'SHOTGUN_TARGET_OUTCOME_UNKNOWN';}
    else {try{validatePublicCheckoutResponse(raw,attempt.request as unknown as PublicCheckoutRequest,attempt.plan,new Date(now()),attempt.plan.totalPrice);reason='SHOTGUN_TARGET_ALREADY_ACHIEVED';}
      catch{reason='SHOTGUN_TARGET_OUTCOME_UNKNOWN';}}
    if(reason){recordStop(attempt,reason);
      for(const otherIndex of rendererArmed){const other=armed.attempts[otherIndex]!;if(other.triggerMs>now() && stopFor(other)){suppressed[otherIndex]=reason;void renderer?.transportFor(other.target.workerId,other)?.disarmRendererCheckout(other.key).catch(()=>undefined);}}}
  };
  const lifecycle=(attempt:ArmedAttempt):Pick<CheckoutDispatchOptions,'onResponseSafety'|'beforeResponseBookkeeping'>=>attempt.shotDeadlineMs===undefined?{}:{onResponseSafety:(raw,error)=>safety(attempt,raw,error),beforeResponseBookkeeping:afterCritical};
  const renderer = deps.rendererDispatch;
  const rendererOptions = { ...DEFAULT_RENDERER_DISPATCH_OPTIONS, ...(renderer?.options ?? {}) };
  const rendererArmed: number[] = [];
  const emitPlan = (event: Parameters<NonNullable<NonNullable<ArmedDispatchDeps['rendererDispatch']>['onPlan']>>[0]) => {observe(()=>renderer?.onPlan?.(event));};
  // One step per distinct trigger (plus its renderer arm step), in time order; at a tie a fire goes first.
  // With nothing armed it still waits for the release instant, as before.
  const triggers = [...new Set([firstTriggerMs, ...armed.attempts.map(attempt => attempt.triggerMs)])].sort((a, b) => a - b);
  const steps = triggers.flatMap(triggerMs => [{ at: triggerMs, kind: 'fire' as const, triggerMs },
    ...(renderer ? [{ at: triggerMs - rendererOptions.armLeadMs, kind: 'arm' as const, triggerMs }] : []),
    ...(armed.attempts.some(a=>a.triggerMs===triggerMs && a.shotDeadlineMs!==undefined)?[{at:triggerMs+SHOTGUN_MAX_TRIGGER_LATENESS_MS+0.01,kind:'expire' as const,triggerMs}]:[])])
    .sort((a, b) => a.at - b.at || (a.kind === b.kind ? 0 : a.kind === 'fire' ? -1 : 1));
  const groupOf = (triggerMs: number) => armed.attempts.flatMap((attempt, index) => attempt.triggerMs === triggerMs ? [index] : []);
  let calibrations = new Map<number, RendererClockCalibration>();
  const settleSent=(index:number,sent:Promise<unknown>)=>{
    const attempt=armed.attempts[index]!;
    const outcome=(async():Promise<PrecisionDispatchResult>=>{
      try { const gated=attempt.shotDeadlineMs===undefined?sent:sent.then(async raw=>{safety(attempt,raw);await afterCritical();return raw;},async error=>{if(error instanceof SubmissionDispatchError)safety(attempt,undefined,error);await afterCritical();throw error;});
        const verified=await settleArmedAttempt(attempt,gated,now);return deps.onVerifiedHold?await deps.onVerifiedHold(attempt,verified):{state:'QR_READY'}; }
      catch(error){return classifyPrecisionDispatchError(error,async()=>{try{return (await attempt.journal.read(attempt.key)).state;}catch(readError){if((readError as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw readError;}});}
    })().catch(():PrecisionDispatchResult=>({state:'UNKNOWN',code:'PRECISION_DISPATCH_UNCLASSIFIED'})).then(async result=>{
      const reason=shotgunStopReason({state:result.state,throttle:!!result.code&&/(?:429|THROTTL|RATE_LIMIT)/.test(result.code)});
      if(reason){recordStop(attempt,reason);
        // A renderer child can already be armed for a later trigger. Disarm it as soon as this
        // one-court objective becomes conclusive/unknown/throttled, and retain the exact reason.
        await Promise.all(rendererArmed.flatMap(otherIndex=>{const other=armed.attempts[otherIndex]!;
          if(otherIndex===index||other.triggerMs<=now()||!stopFor(other))return[];
          suppressed[otherIndex]=reason;
          return [renderer?.transportFor(other.target.workerId,other)?.disarmRendererCheckout(other.key).catch(()=>undefined)??Promise.resolve()];}));}
      return result;
    });
    outcomes[index]=outcome;return outcome;
  };
  /** EXPERIMENTAL: one synchronous pass handing each calibrated, ready attempt of this trigger to its page. */
  const armRendererGroup = (triggerMs: number) => {
    for (const index of groupOf(triggerMs)) {
      const attempt = armed.attempts[index]!, ready = readiness[index]!, calibration = calibrations.get(index);
      if (!ready.settled || !ready.ok || !calibration) continue;
      const stop=stopFor(attempt);if(stop){suppressed[index]=stop;continue;}
      const transport = renderer!.transportFor(attempt.target.workerId,attempt);
      if (!transport) { emitPlan({ workerId: attempt.target.workerId, attemptId:attempt.attempt.id, mode: 'node-fallback', code: 'RENDERER_TRANSPORT_MISSING' }); continue; }
      let plan: RendererFirePlan;
      // The page fires at the trigger, so the trigger is the "release" it plans for.
      try { plan = planRendererFire({ key: attempt.key, pageUrl: renderer!.pageUrl, calibration, clock, releaseMs: triggerMs, dispatchDeadlineMs:armedWindow(armed,attempt).dispatchDeadlineMs, nodeNowMs: performance.now(), options: rendererOptions }); }
      catch (error) { emitPlan({ workerId: attempt.target.workerId, attemptId:attempt.attempt.id, mode: 'node-fallback', code: safeCode(error, 'RENDERER_PLAN_FAILED'), calibration }); continue; }
      // Too close to (or past) the trigger to arm safely: leave it to the Node path at its trigger.
      if (!(now() < triggerMs - 1)) { emitPlan({ workerId: attempt.target.workerId, attemptId:attempt.attempt.id, mode: 'node-fallback', code: 'RENDERER_ARM_TOO_LATE', calibration }); continue; }
      deps.onMark?.(attempt.target.workerId,'rendererArm',attempt);
      const sent = fireArmedAttemptRenderer(attempt, transport, clock, armedWindow(armed, attempt), {...plan,...(attempt.shotDeadlineMs!==undefined?{missedCode:'SHOTGUN_TRIGGER_MISSED' as const}:{})}, deps.isAborted, rendererOptions.armLeadMs,lifecycle(attempt));
      sent.catch(() => undefined);
      sends[index] = sent;
      settleSent(index,sent);
      rendererArmed.push(index);
      emitPlan({ workerId: attempt.target.workerId, attemptId:attempt.attempt.id, mode: 'renderer', calibration, plan });
    }
  };
  /** ---- Trigger: one synchronous, in-memory pass. No I/O, hashing or request building here. ---- */
  const strictMissed=new Set<number>();
  const fireGroup = (triggerMs: number, retry=false) => {
    for (const index of groupOf(triggerMs)) {
      const attempt = armed.attempts[index]!, ready = readiness[index]!;
      if(sends[index] || strictMissed.has(index) || attempt.state!=='armed')continue;
      if(attempt.shotDeadlineMs!==undefined && now()>attempt.shotDeadlineMs){strictMissed.add(index);continue;}
      if(!ready.settled || !ready.ok){
        if(attempt.shotDeadlineMs!==undefined && !retry){
          void ready.promise.then(()=>{if(now()<=attempt.shotDeadlineMs! && !sends[index])fireGroup(triggerMs,true);else if(!sends[index])strictMissed.add(index);});
        }
        continue;
      }
      const stop=stopFor(attempt);if(stop){suppressed[index]=stop;continue;}
      const transport = deps.transportFor(attempt.target.workerId,attempt);
      if (!transport) continue;
      deps.onMark?.(attempt.target.workerId,'transportCall',attempt);
      const sent = fireArmedAttempt(attempt, transport, clock, armedWindow(armed, attempt), deps.isAborted,lifecycle(attempt),()=>{const reason=stopFor(attempt);if(reason)throw new SubmissionDispatchError(reason,false);});
      sent.catch(() => undefined); // observed below; marked handled so a refusal is never an unhandled rejection meanwhile
      sends[index] = sent;
      settleSent(index,sent);
    }
  };
  // Once anything has been sent (or a page armed) a wait can no longer throw: a Stop disarms the armed pages (best
  // effort) and every later Node-path attempt still refuses at its trigger through isAborted, so every outcome is
  // settled and recorded below.
  let disarmRequested = false;
  const committedAbort = () => {
    if (!disarmRequested && deps.isAborted()) {
      disarmRequested = true;
      for (const index of rendererArmed) {const attempt=armed.attempts[index]!;void renderer!.transportFor(attempt.target.workerId,attempt)?.disarmRendererCheckout(attempt.key);}
    }
    return false;
  };
  try {
    assertPrecisionFreezeIntact(armed.race);
    const clockRefresh = deps.refreshClock?.().then(next => {
      clock.adopt(next, armed.releaseMs); return undefined;
    }, error => ({ error }));
    await waitFor(firstTriggerMs - deps.prewarmLeadMs);
    const prepare = async (attempt: ArmedAttempt): Promise<boolean> => {
      const startedAt=now(),queueDelayMs=startedAt-(firstTriggerMs-deps.prewarmLeadMs);
      for (let round = 1; round <= 2; round++) {
        try {
          if(attempt.shotDeadlineMs!==undefined){
            if(now()>=firstTriggerMs-FINAL_APPROACH_MS)throw Error('SHOTGUN_TRIGGER_MISSED');
            await deps.transportFor(attempt.target.workerId,attempt)?.prepareStrictTiming?.();
          }
          // Sampling is already finished. A pending security preparation may become ready inside
          // the shot's allowance without starting new clock/CDP work at its trigger.
          await deps.prewarm(attempt); }
        catch (error) {
          emit({ kind: 'prewarm-failed', workerId: attempt.target.workerId, attemptId: attempt.attempt.id, code: safeCode(error, 'SECURITY_PREWARM_FAILED') });
          if (round === 1 && now() < retryCutoff) { emit({ kind: 'prewarm-retry', workerId: attempt.target.workerId, attemptId: attempt.attempt.id }); continue; }
          return false;
        }
        const readyAt=now(),actualReadyOffsetMs=readyAt-armed.releaseMs;
        const prediction=deps.prewarmExpectedDurationMs===undefined?{}:(()=>{const predictedReadyOffsetMs=startedAt-armed.releaseMs+deps.prewarmExpectedDurationMs!;
          return {predictedReadyOffsetMs,predictionErrorMs:actualReadyOffsetMs-predictedReadyOffsetMs};})();
        emit({ kind: 'prewarm-ready', workerId: attempt.target.workerId, attemptId: attempt.attempt.id,...prediction,actualReadyOffsetMs,queueDelayMs,prepDurationMs:readyAt-startedAt });
        return true;
      }
      return false;
    };
    // Tier = fan-out index (A0…G0 first), order = strategy order of the frozen set, group = the worker's browser.
    const byId = new Map(armed.attempts.map(attempt => [attempt.attempt.id, attempt] as const));
    prewarmSchedule = schedulePrewarm(armed.attempts.map((attempt, index) => ({ id: attempt.attempt.id, tier: attempt.attempt.fanOutIndex, order: index,
      group: attempt.target.workerId })), task => prepare(byId.get(task.id)!), deps.prewarmPolicy ?? UNBOUNDED_PREWARM, undefined,
    status => {observe(()=>deps.onPrewarmStatus?.(status));});
    readiness = armed.attempts.map(attempt => prewarmSchedule!.readiness.get(attempt.attempt.id)!);
    if (tiered || strictRace) {
      // No new preparation starts late in the countdown; anything not started by then is omitted (never sent).
      const stopAt = firstTriggerMs - Math.max(FINAL_APPROACH_MS, deps.prewarmStopStartingLeadMs ?? 3_000);
      void waitFor(stopAt, () => false, timerSleep).then(() => prewarmSchedule?.stopStarting(), () => prewarmSchedule?.stopStarting());
    }
    // Integrity of the frozen set is verified before the final wait, never after the first trigger.
    assertPrecisionFreezeIntact(armed.race);
    const clockFailure = await clockRefresh;
    if (clockFailure) throw clockFailure.error;
    if (renderer) {
      // EXPERIMENTAL: calibrate every page clock a few seconds out; an attempt that cannot calibrate uses the Node path.
      // Bounded: whatever has not finished by the final approach is abandoned, so a stuck page can never hold the
      // Node path (or the other pages) past its trigger.
      await waitFor(firstTriggerMs - RENDERER_CALIBRATION_LEAD_MS);
      const finished = new Set<number>(), collected = new Map<number, RendererClockCalibration>();
      let open = true, timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.all(armed.attempts.map(async (attempt, index) => {
          try { const calibration = await renderer.calibrate(attempt); if (open) collected.set(index, calibration); }
          catch (error) { if (open) emitPlan({ workerId: attempt.target.workerId, attemptId:attempt.attempt.id, mode: 'node-fallback', code: safeCode(error, 'RENDERER_CLOCK_SAMPLING_FAILED') }); }
          finally { if (open) finished.add(index); }
        })),
        new Promise<void>(done => { timer = setTimeout(done, Math.max(0, clock.monotonicDeadline(firstTriggerMs - FINAL_APPROACH_MS) - performance.now())); }),
      ]);
      open = false;
      clearTimeout(timer);
      calibrations = collected;
      armed.attempts.forEach((attempt, index) => {
        if (!finished.has(index)) emitPlan({ workerId: attempt.target.workerId, attemptId:attempt.attempt.id, mode: 'node-fallback', code: 'RENDERER_CALIBRATION_TIMEOUT' });
      });
    }
    if (deps.onFinalApproach) { await waitFor(firstTriggerMs - FINAL_APPROACH_MS); try { deps.onFinalApproach(); } catch { /* optional tuning */ } }
    for (const step of steps) {
      if (sends.some(Boolean)) await waitFor(step.at, committedAbort, timerSleep);
      else await waitFor(step.at);
      if(step.kind==='expire'){for(const index of groupOf(step.triggerMs)){const attempt=armed.attempts[index]!;
        if(!sends[index] && attempt.shotDeadlineMs!==undefined && now()>attempt.shotDeadlineMs && attempt.state==='armed'){
          revokeSubmissionPermit(attempt.permit);attempt.state='refused';strictMissed.add(index);
        }}
      }else if (step.kind === 'arm') armRendererGroup(step.triggerMs);
      else { deps.onWake?.(step.triggerMs); fireGroup(step.triggerMs); }
    }
  } catch (error) {
    prewarmSchedule?.stopStarting();
    try { deps.onReleaseWindowEnd?.(); } catch { /* optional tuning */ }
    // Aborted (or failed) before anything was sent: nothing was fired; record every attempt as provably unsent.
    await disarmUnfired(armed, safeCode(error, 'ARMED_NOT_DISPATCHED'), now);
    throw error;
  }
  // The CDP messages leave in the microtasks after the last pass; run no bookkeeping on this thread until they have.
  await new Promise<void>(done => setImmediate(done));
  // Every trigger has passed: nothing else may start preparing.
  prewarmSchedule?.stopStarting();
  if(strictRace)await afterCritical();
  for(const callback of deferredEvents){try{callback();}catch{}}
  deferredEvents.length=0;
  try { deps.onReleaseWindowEnd?.(); } catch { /* optional tuning */ }
  // ---- Everything below runs after every ready POST has been started. ----
  const afterFire = deps.afterFire && sends.some(Boolean)
    ? deps.afterFire().then(() => undefined, (error: unknown) => safeCode(error, 'AFTER_FIRE_FAILED'))
    : Promise.resolve(undefined);
  const settleInner = async (index: number): Promise<PrecisionDispatchResult> => {
    const attempt = armed.attempts[index]!, ready = readiness[index]!;
    if(!sends[index]&&stopFor(attempt))suppressed[index]=stopFor(attempt);
    if(suppressed[index]){await disarmAttempt(attempt,suppressed[index]!,now).catch(()=>undefined);return {state:'NOT_DISPATCHED',code:suppressed[index]};}
    if(outcomes[index]){emit({kind:'dispatch-start',workerId:attempt.target.workerId,attemptId:attempt.attempt.id});return outcomes[index]!;}
    if(attempt.shotDeadlineMs!==undefined && !sends[index]){
      if(!ready.settled && now()<=attempt.shotDeadlineMs)await Promise.race([ready.promise,waitFor(attempt.shotDeadlineMs,()=>false,timerSleep)]);
      if(outcomes[index])return outcomes[index]!;
      if(attempt.state==='refused')await attempt.journal.mark(attempt.key,'rejected',new Date(now()),undefined,undefined,'SHOTGUN_TRIGGER_MISSED').catch(()=>undefined);
      else await disarmAttempt(attempt,'SHOTGUN_TRIGGER_MISSED',now).catch(()=>undefined);
      return {state:'NOT_DISPATCHED',code:'SHOTGUN_TRIGGER_MISSED'};
    }
    let sent = sends[index];
    if (!sent) {
      // A lower-tier fan-out child that was not ready (or never started) at its trigger is omitted, never sent late.
      if (tiered && attempt.attempt.fanOutIndex > 0 && (!ready.settled || ready.omitted)) {
        await disarmAttempt(attempt, 'PREWARM_TIER_OMITTED', now).catch(() => undefined); return { state: 'NOT_DISPATCHED', code: 'PREWARM_TIER_OMITTED' };
      }
      if (ready.omitted) { await disarmAttempt(attempt, 'PREWARM_TIER_OMITTED', now).catch(() => undefined); return { state: 'NOT_DISPATCHED', code: 'PREWARM_TIER_OMITTED' }; }
      if (!ready.settled) {
        // Not ready at its trigger: it may still dispatch inside the window, exactly like a late prewarm before.
        const timedOut = Symbol('timeout');
        // A late prewarm keeps its window even if Stop arrives now (fireArmedAttempt still refuses once aborted).
        const outcome = await Promise.race([ready.promise, waitFor(dispatchDeadlineMs, () => false, undefined).then(() => timedOut)]);
        if (outcome === timedOut) { await disarmAttempt(attempt, 'PREWARM_NOT_READY_IN_WINDOW', now).catch(() => undefined); return { state: 'WINDOW_MISSED', code: 'PREWARM_NOT_READY_IN_WINDOW' }; }
      }
      if (!ready.ok) { await disarmAttempt(attempt, 'SECURITY_PREWARM_FAILED', now).catch(() => undefined); return { state: 'PREWARM_FAILED', code: 'SECURITY_PREWARM_FAILED' }; }
      const stop=stopFor(attempt);
      if(stop){await disarmAttempt(attempt,stop,now).catch(()=>undefined);return {state:'NOT_DISPATCHED',code:stop};}
      const transport = deps.transportFor(attempt.target.workerId,attempt);
      if (!transport) { await disarmAttempt(attempt, 'API_CHECKOUT_WORKER_MISSING', now).catch(() => undefined); return { state: 'NOT_DISPATCHED', code: 'API_CHECKOUT_WORKER_MISSING' }; }
      sent = fireArmedAttempt(attempt, transport, clock, armedWindow(armed, attempt), deps.isAborted,lifecycle(attempt),()=>{const reason=stopFor(attempt);if(reason)throw new SubmissionDispatchError(reason,false);});
      sends[index]=sent;
    }
    emit({ kind: 'dispatch-start', workerId: attempt.target.workerId, attemptId: attempt.attempt.id });
    return settleSent(index,sent);
  };
  const settleOne = async (index: number): Promise<PrecisionDispatchResult> => {
    // settleInner classifies its own failures; an unexpected throw may have happened after the POST.
    const result = await settleInner(index).catch((): PrecisionDispatchResult => ({ state: 'UNKNOWN', code: 'PRECISION_DISPATCH_UNCLASSIFIED' }));
    const attempt = armed.attempts[index]!;
    emit({ kind: 'settled', workerId: attempt.target.workerId, attemptId: attempt.attempt.id, state: result.state, ...(result.code ? { code: result.code } : {}) });
    return result;
  };
  const settled = await Promise.all(armed.attempts.map((_, index) => settleOne(index)));
  for (const guard of armed.fanOutGuards) if (guard.state === 'armed') {
    const states = armed.attempts.flatMap((attempt, index) => guard.attemptIds.includes(attempt.attempt.id) ? [settled[index]!.state] : []);
    const state = states.some(value => value === 'QR_READY' || value === 'HOLD_VERIFIED_QR_ATTENTION') ? 'verified'
      : states.some(value => value === 'UNKNOWN') ? 'unknown' : 'rejected';
    await guard.journal.mark(guard.key, state, new Date(now()), undefined, undefined,
      state === 'rejected' ? 'FAN_OUT_ALL_CHILDREN_CONCLUSIVE' : undefined).catch(() => undefined);
    revokeSubmissionPermit(guard.permit); guard.state = 'settled';
  }
  const disarmed = await disarmUnfired(armed, 'ARMED_NOT_DISPATCHED', now);
  const afterFireError = await afterFire;
  const byAttempt = new Map(armed.attempts.map((attempt, index) => [attempt.attempt.id, settled[index]!] as const));
  for (const value of armed.unarmed) byAttempt.set(value.attempt.id, { state: value.state, code: value.code });
  return { results: armed.race.attempts.map(attempt => ({ attempt, ...(byAttempt.get(attempt.id) ?? { state: 'NOT_DISPATCHED' as const, code: 'PRECISION_NOT_ARMED' }) })),
    disarmed, ...(afterFireError ? { afterFireError } : {}) };
}
