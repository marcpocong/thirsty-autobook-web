/**
 * EXPERIMENTAL per-browser dispatch coordinators (parent side). Enabled only with
 * ONDA_EXPERIMENTAL_DISPATCH_COORDINATOR=PER_BROWSER_V1 (or explicitly by the offline benchmark). Not promoted
 * unless the offline benchmark shows a material, safe improvement (see docs/FANOUT_CAPACITY_BENCHMARK.md).
 *
 * One Node child process per worker browser owns that browser's CDP attachment, tabs, prepared security, frozen
 * request bytes and trigger queue (dispatch-coordinator-child.ts). This process keeps everything authoritative:
 * the lock, the durable journals and the durable one-shot claims made by armPrecisionRace, response validation,
 * journal outcomes, verified-hold handling and the UNKNOWN rules.
 *
 * Delegation, per attempt, before the first trigger: the parent consumes its own permit (so this process can never
 * send it) and marks the attempt 'fired' (so it can never be disarmed here as provably unsent). From then on only the
 * coordinator's own report can prove the request unsent; a coordinator that exits or disconnects before reporting
 * leaves the attempt UNKNOWN (its journal stays armed with a claimed one-shot: manual reconciliation), exactly the
 * crash rule of the central dispatcher.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assertPrecisionFreezeIntact, classifyPrecisionDispatchError, type PrecisionDispatchResult } from './precision-race.js';
import { consumeSubmissionPermit, revokeSubmissionPermit } from './durable-submission-journal.js';
import { armedRequestFor } from './armed-request.js';
import { disarmUnfired, settleArmedAttempt, type ArmedAttempt, type ArmedDispatchDeps, type ArmedDispatchOutcome, type ArmedPrecisionRace } from './armed-dispatch.js';
import type { CheckoutHttpResponse } from './browser-session-transport.js';
import type { CriticalPathRecorder, CriticalPathRow } from './critical-path.js';
import type { ChildMessage, CoordinatorArm, DelegatedOutcome, ParentMessage, SecurityMode } from './dispatch-coordinator-protocol.js';
import { SubmissionDispatchError } from './submission-errors.js';
import { DEFAULT_SPIN_TAIL_MS } from '../release-clock.js';
import type { WorkerId } from '../workers.js';

export const DISPATCH_COORDINATOR_FLAG = 'PER_BROWSER_V1';
export const dispatchCoordinatorEnabled = () => process.env.ONDA_EXPERIMENTAL_DISPATCH_COORDINATOR === DISPATCH_COORDINATOR_FLAG;

export interface CoordinatorSession { workerId: WorkerId | string; cdpUrl: string; pageUrl: string; pageCount: number; targetIds?: string[] }
const childEntry = () => {
  const here = fileURLToPath(import.meta.url);
  return join(dirname(here), here.endsWith('.ts') ? 'dispatch-coordinator-child.ts' : 'dispatch-coordinator-child.js');
};
const safeCode = (error: unknown, fallback: string) => error instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.message) ? error.message : fallback;

interface PooledCoordinator {
  session: CoordinatorSession; child: ChildProcess; exited: boolean;
  /** The dispatch currently using this coordinator (at most one). */
  handler?: { message(message: ChildMessage): void; exit(): void };
  waiters: Map<string, (message: ChildMessage) => boolean>;
}
export interface CoordinatorPool { readonly coordinators: ReadonlyMap<string, PooledCoordinator>; close(): Promise<void> }

function until(coordinator: PooledCoordinator, predicate: (message: ChildMessage) => boolean, name: string, timeoutMs: number): Promise<ChildMessage> {
  return new Promise<ChildMessage>((resolve, reject) => {
    if (coordinator.exited) { reject(Error('COORDINATOR_LOST')); return; }
    const timer = setTimeout(() => { coordinator.waiters.delete(name); reject(Error('COORDINATOR_TIMEOUT')); }, Math.max(1, timeoutMs));
    coordinator.waiters.set(name, message => {
      if (message.type === 'fatal') { clearTimeout(timer); reject(Error(message.code)); return true; }
      if (!predicate(message)) return false; clearTimeout(timer); resolve(message); return true;
    });
  });
}

/**
 * Starts one coordinator per session and waits until each has attached to its browser, found its tabs and warmed its
 * dispatch path. A coordinator that fails to start is simply absent from the pool (its attempts will be disarmed as unsent).
 */
export async function startCoordinatorPool(sessions: readonly CoordinatorSession[], options: { security: SecurityMode; captureResponses: boolean; initTimeoutMs?: number;
  /** Tests only: a stand-in child script speaking the same protocol. */
  childEntry?: string }): Promise<CoordinatorPool> {
  const coordinators = new Map<string, PooledCoordinator>();
  await Promise.all(sessions.map(async session => {
    const child = fork(options.childEntry ?? childEntry(), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env },
      ...(options.childEntry ? { execArgv: [] } : {}) });
    const coordinator: PooledCoordinator = { session, child, exited: false, waiters: new Map() };
    child.on('message', (raw: unknown) => {
      const message = raw as ChildMessage;
      for (const [name, waiter] of coordinator.waiters) if (waiter(message)) coordinator.waiters.delete(name);
      coordinator.handler?.message(message);
    });
    child.on('exit', () => {
      coordinator.exited = true;
      for (const [name, waiter] of coordinator.waiters) { waiter({ type: 'fatal', code: 'COORDINATOR_LOST' }); coordinator.waiters.delete(name); }
      coordinator.handler?.exit();
    });
    child.send({ type: 'init', workerId: String(session.workerId), cdpUrl: session.cdpUrl, pageUrl: session.pageUrl, pageCount: session.pageCount,
      ...(session.targetIds ? { targetIds: session.targetIds } : {}), security: options.security, captureResponses: options.captureResponses } satisfies ParentMessage);
    try { await until(coordinator, message => message.type === 'ready', 'ready', options.initTimeoutMs ?? 30_000); coordinators.set(String(session.workerId), coordinator); }
    catch { child.kill(); }
  }));
  return {
    coordinators,
    async close() {
      await Promise.all([...coordinators.values()].map(coordinator => new Promise<void>(done => {
        if (coordinator.exited) { done(); return; }
        const timer = setTimeout(() => { coordinator.child.kill(); done(); }, 3_000);
        coordinator.child.once('exit', () => { clearTimeout(timer); done(); });
        coordinator.child.send({ type: 'shutdown' } satisfies ParentMessage);
      })));
    },
  };
}

export interface CoordinatorDispatchDeps extends Pick<ArmedDispatchDeps, 'clock' | 'prewarmLeadMs' | 'prewarmRetryCutoffMs' | 'spinTailMs' | 'isAborted' | 'onEvent' |
  'onVerifiedHold' | 'afterFire' | 'prewarmPolicy' | 'prewarmStopStartingLeadMs' | 'onPrewarmStatus'> {
  /** An already started pool (kept open afterwards), or sessions to start a temporary one for this dispatch. */
  pool?: CoordinatorPool;
  sessions?: CoordinatorSession[];
  security?: SecurityMode;
  /** Benchmark: synthetic security instead of genuine page-bound preparation. */
  securityPreparation?: { cpuMs: number; waitMs: number };
  /** Receives the private checkout response for the caller's journal capture; absent = responses are not captured. */
  captureResponse?: (attemptId: string, response: CheckoutHttpResponse) => Promise<void>;
  onHumanVerification?: (workerId: string, pageIndex: number, state: 'required' | 'completed') => void;
  /** Preparation start/ready of each child, release-relative on the trusted clock (telemetry). */
  onPrewarmTiming?: (timing: { attemptId: string; ok: boolean; startedMs: number; readyMs: number | null }) => void;
  /** Critical-path rows measured inside the coordinators are adopted here after every attempt settled. */
  recorder?: Pick<CriticalPathRecorder, 'adopt'>;
}

/**
 * Same contract as dispatchArmedPrecisionRace: every armed attempt settles to one PrecisionDispatchResult, and
 * nothing unfired survives. Attempts of workers without a live coordinator are disarmed as provably unsent.
 */
export async function dispatchWithCoordinators(armed: ArmedPrecisionRace, deps: CoordinatorDispatchDeps): Promise<ArmedDispatchOutcome & { rows: CriticalPathRow[] }> {
  assertPrecisionFreezeIntact(armed.race);
  const now = () => deps.clock.nowMs();
  const emit = (event: Parameters<NonNullable<ArmedDispatchDeps['onEvent']>>[0]) => { try { deps.onEvent?.(event); } catch { /* observability only */ } };
  const security: SecurityMode = deps.security ?? (deps.securityPreparation ? { kind: 'synthetic', ...deps.securityPreparation } : { kind: 'genuine' });
  const byWorker = new Map<string, ArmedAttempt[]>();
  for (const attempt of armed.attempts) { const list = byWorker.get(attempt.target.workerId) ?? []; list.push(attempt); byWorker.set(attempt.target.workerId, list); }
  const firstTriggerMs = armed.attempts.length ? Math.min(...armed.attempts.map(attempt => attempt.triggerMs)) : armed.releaseMs;
  let ownPool: CoordinatorPool | undefined;
  if (!deps.isAborted() && !deps.pool) ownPool = await startCoordinatorPool((deps.sessions ?? []).filter(session => byWorker.has(String(session.workerId))).map(session =>
    ({ ...session, pageCount: Math.max(session.pageCount, ...(byWorker.get(String(session.workerId)) ?? []).map(attempt => attempt.attempt.fanOutIndex + 1)) })),
  { security, captureResponses: !!deps.captureResponse, initTimeoutMs: Math.max(1_000, firstTriggerMs - 1_500 - now()) });
  const pool = deps.pool ?? ownPool;
  const results = new Map<string, (outcome: DelegatedOutcome) => void>();
  const pendingOutcomes = new Map<string, Promise<DelegatedOutcome>>();
  for (const attempt of armed.attempts) pendingOutcomes.set(attempt.attempt.id, new Promise(done => results.set(attempt.attempt.id, done)));
  const resolveOutcome = (attemptId: string, outcome: DelegatedOutcome) => { const done = results.get(attemptId); if (done) { results.delete(attemptId); done(outcome); } };
  const rows: CriticalPathRow[] = [];
  const telemetry: Promise<void>[] = [];
  const delegated = new Set<string>();
  const used: PooledCoordinator[] = [];
  let abortTimer: ReturnType<typeof setInterval> | undefined;
  try {
    if (deps.isAborted()) throw Error('USER_ABORT');
    const hrNs = process.hrtime.bigint(), trustedMs = deps.clock.nowMs();
    const retryCutoffMs = firstTriggerMs - (deps.prewarmRetryCutoffMs ?? 7_000);
    for (const [workerId, workerAttempts] of byWorker) {
      const coordinator = pool?.coordinators.get(workerId);
      if (!coordinator || coordinator.exited) { for (const attempt of workerAttempts) resolveOutcome(attempt.attempt.id, { kind: 'unsent', code: 'COORDINATOR_UNAVAILABLE' }); continue; }
      let armedAck = false, telemetryDone!: () => void;
      telemetry.push(new Promise<void>(done => { telemetryDone = done; }));
      coordinator.handler = {
        message: message => {
          if (message.type === 'result') resolveOutcome(message.attemptId, message.outcome);
          else if (message.type === 'armed') armedAck = true;
          else if (message.type === 'prewarm') {
            try { deps.onPrewarmTiming?.(message); } catch { /* telemetry */ }
            emit({ kind: message.ok ? 'prewarm-ready' : 'prewarm-failed', workerId: workerId as WorkerId, attemptId: message.attemptId, ...(message.code ? { code: message.code } : {}) });
          } else if (message.type === 'prewarm-status') { try { deps.onPrewarmStatus?.(message.status); } catch { /* observability */ } }
          else if (message.type === 'human-verification') { try { deps.onHumanVerification?.(workerId, message.pageIndex, message.state); } catch { /* observability */ } }
          else if (message.type === 'capture') void (async () => {
            let ok = true;
            try { await deps.captureResponse?.(message.attemptId, message.response); } catch { ok = false; }
            if (!coordinator.exited) coordinator.child.send({ type: 'capture-ack', id: message.id, ok } satisfies ParentMessage);
          })();
          else if (message.type === 'telemetry') { rows.push(...message.rows); telemetryDone(); }
          else if (message.type === 'fatal') {
            // Before 'armed' nothing was fired by that coordinator; afterwards anything unreported stays UNKNOWN.
            for (const attempt of workerAttempts) resolveOutcome(attempt.attempt.id, armedAck
              ? { kind: 'error', code: message.code, dispatched: true, confirmedRejected: false } : { kind: 'unsent', code: message.code });
            telemetryDone();
          }
        },
        exit: () => {
          for (const attempt of workerAttempts) resolveOutcome(attempt.attempt.id, delegated.has(attempt.attempt.id)
            ? { kind: 'error', code: 'COORDINATOR_LOST', dispatched: true, confirmedRejected: false } : { kind: 'unsent', code: 'COORDINATOR_LOST_BEFORE_DELEGATION' });
          telemetryDone();
        },
      };
      used.push(coordinator);
      // ---- Delegate: consume this process's permit, then hand over the exact armed bytes. Nothing crosses IPC at a trigger. ----
      const delegations = workerAttempts.flatMap(attempt => {
        const registered = armedRequestFor(attempt.request);
        if (attempt.state !== 'armed' || !registered || registered.key !== attempt.key) return [];
        consumeSubmissionPermit(attempt.permit, attempt.key);
        attempt.state = 'fired';
        delegated.add(attempt.attempt.id);
        return [{ attemptId: attempt.attempt.id, key: attempt.key, body: registered.body, pageIndex: attempt.attempt.fanOutIndex, tier: attempt.attempt.fanOutIndex,
          order: armed.attempts.indexOf(attempt), releaseMs: armed.releaseMs, triggerMs: attempt.triggerMs, dispatchDeadlineMs: armed.dispatchDeadlineMs }];
      });
      coordinator.child.send({ type: 'arm', attempts: delegations, anchor: { hrNs: hrNs.toString(), trustedMs }, prewarmAtMs: firstTriggerMs - deps.prewarmLeadMs,
        prewarmPolicy: deps.prewarmPolicy ?? null, prewarmStopStartingAtMs: deps.prewarmPolicy ? firstTriggerMs - Math.max(1_000, deps.prewarmStopStartingLeadMs ?? 3_000) : null,
        retryCutoffMs, spinTailMs: deps.spinTailMs ?? DEFAULT_SPIN_TAIL_MS } satisfies CoordinatorArm);
    }
    // A Stop reaches every coordinator within a few ms; each refuses anything not yet fired (reported as unsent).
    abortTimer = setInterval(() => { if (deps.isAborted()) for (const coordinator of used) if (!coordinator.exited) coordinator.child.send({ type: 'abort' } satisfies ParentMessage); }, 5);
  } catch (error) {
    if (!delegated.size) {
      // Nothing was delegated: every attempt is still armed here and provably unsent.
      for (const coordinator of used) coordinator.handler = undefined;
      await disarmUnfired(armed, safeCode(error, 'ARMED_NOT_DISPATCHED'), now);
      await ownPool?.close();
      throw error;
    }
    for (const coordinator of used) if (!coordinator.exited) coordinator.child.send({ type: 'abort' } satisfies ParentMessage);
  }
  // ---- Settle every attempt from its coordinator's report, with the production journal/validation rules. ----
  let fired = false;
  const settled = await Promise.all(armed.attempts.map(async (attempt): Promise<PrecisionDispatchResult> => {
    if (!delegated.has(attempt.attempt.id)) {
      const outcome = await pendingOutcomes.get(attempt.attempt.id)!;
      return { state: 'NOT_DISPATCHED', code: outcome.kind === 'unsent' ? outcome.code : 'COORDINATOR_NOT_DELEGATED' };
    }
    emit({ kind: 'dispatch-start', workerId: attempt.target.workerId, attemptId: attempt.attempt.id });
    const sent = pendingOutcomes.get(attempt.attempt.id)!.then(outcome => {
      if (outcome.kind === 'response') { fired = true; return outcome.body; }
      if (outcome.kind === 'unsent') throw new SubmissionDispatchError(outcome.code, false);
      fired = true;
      throw new SubmissionDispatchError(outcome.code, outcome.dispatched, outcome.diagnostic, outcome.confirmedRejected);
    });
    let result: PrecisionDispatchResult;
    try {
      const verified = await settleArmedAttempt(attempt, sent, now);
      result = deps.onVerifiedHold ? await deps.onVerifiedHold(attempt, verified) : { state: 'QR_READY' };
    } catch (error) {
      result = await classifyPrecisionDispatchError(error, async () => {
        try { return (await attempt.journal.read(attempt.key)).state; }
        catch (readError) { if ((readError as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw readError; }
      }).catch((): PrecisionDispatchResult => ({ state: 'UNKNOWN', code: 'PRECISION_DISPATCH_UNCLASSIFIED' }));
    }
    emit({ kind: 'settled', workerId: attempt.target.workerId, attemptId: attempt.attempt.id, state: result.state, ...(result.code ? { code: result.code } : {}) });
    return result;
  }));
  clearInterval(abortTimer);
  const afterFireError = fired && deps.afterFire ? await deps.afterFire().then(() => undefined, (error: unknown) => safeCode(error, 'AFTER_FIRE_FAILED')) : undefined;
  // Fan-out logical guards: the same reduction as the central dispatcher.
  for (const guard of armed.fanOutGuards) if (guard.state === 'armed') {
    const states = armed.attempts.flatMap((attempt, index) => guard.attemptIds.includes(attempt.attempt.id) ? [settled[index]!.state] : []);
    const state = states.some(value => value === 'QR_READY' || value === 'HOLD_VERIFIED_QR_ATTENTION') ? 'verified' : states.some(value => value === 'UNKNOWN') ? 'unknown' : 'rejected';
    await guard.journal.mark(guard.key, state, new Date(now()), undefined, undefined, state === 'rejected' ? 'FAN_OUT_ALL_CHILDREN_CONCLUSIVE' : undefined).catch(() => undefined);
    revokeSubmissionPermit(guard.permit); guard.state = 'settled';
  }
  const disarmed = await disarmUnfired(armed, 'ARMED_NOT_DISPATCHED', now);
  await Promise.race([Promise.all(telemetry), new Promise(done => setTimeout(done, 5_000))]);
  for (const coordinator of used) coordinator.handler = undefined;
  await ownPool?.close();
  if (deps.recorder) for (const row of rows) deps.recorder.adopt(row);
  const byAttempt = new Map(armed.attempts.map((attempt, index) => [attempt.attempt.id, settled[index]!] as const));
  for (const value of armed.unarmed) byAttempt.set(value.attempt.id, { state: value.state, code: value.code });
  return { results: armed.race.attempts.map(attempt => ({ attempt, ...(byAttempt.get(attempt.id) ?? { state: 'NOT_DISPATCHED' as const, code: 'PRECISION_NOT_ARMED' }) })),
    disarmed, rows, ...(afterFireError ? { afterFireError } : {}) };
}
