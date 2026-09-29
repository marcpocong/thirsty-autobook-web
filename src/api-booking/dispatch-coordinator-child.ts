/**
 * EXPERIMENTAL per-browser dispatch coordinator: the child process for ONE worker browser.
 *
 * It owns its Chrome/CDP attachment, its child tabs, its prepared security contexts, its frozen serialized requests and
 * its own monotonic trigger queue, on its own event loop. The parent sends everything before the first trigger; at a
 * trigger this process only checks its in-memory state and the trusted clock and calls the transport (exactly
 * fireArmedAttempt, the production release-instant action). Results go back only after each response or refusal.
 *
 * Safety: the parent keeps the durable journal, the lock and the durable one-shot claim. It consumes its own permit
 * before delegating; this process mints the single matching in-memory permit (delegatedSubmissionPermit). A refusal
 * before the transport is reported as provably unsent; anything else is reported with the transport's own
 * dispatched/confirmedRejected evidence, and a coordinator that dies before reporting is UNKNOWN in the parent.
 */
import { constants as osConstants, setPriority } from 'node:os';
import { performance } from 'node:perf_hooks';
import { chromium, type Browser, type Page } from 'playwright';
import { armCheckoutRequest } from './armed-request.js';
import { OndaBrowserSessionTransport, type CheckoutHttpResponse } from './browser-session-transport.js';
import { CriticalPathRecorder } from './critical-path.js';
import { delegatedSubmissionPermit } from './durable-submission-journal.js';
import { fireArmedAttempt, FINAL_APPROACH_MS, type ArmedAttempt } from './armed-dispatch.js';
import { schedulePrewarm, UNBOUNDED_PREWARM, type PrewarmSchedule } from './prewarm-scheduler.js';
import { calibrateRendererClock, sampleRendererClock } from './renderer-clock.js';
import { SubmissionDispatchError } from './submission-errors.js';
import type { ChildMessage, CoordinatorArm, CoordinatorInit, DelegatedAttempt, DelegatedOutcome, ParentMessage } from './dispatch-coordinator-protocol.js';
import { TrustedReleaseClock, waitForMonotonicDeadline } from '../release-clock.js';
import type { ProoflessCheckoutRequest } from './proofless-checkout.js';

const send = (message: ChildMessage) => { try { process.send?.(message); } catch { /* parent gone: results are lost, the parent records UNKNOWN */ } };
const safeCode = (error: unknown, fallback: string) => error instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.message) ? error.message : fallback;
let browser: Browser | undefined;
let pages: Page[] = [];
let transports: OndaBrowserSessionTransport[] = [];
let init: CoordinatorInit | undefined;
let aborted = false;
let recorder: CriticalPathRecorder | undefined;
let nextCapture = 1;
const captureAcks = new Map<number, (ok: boolean) => void>();
const deepFreeze = <T>(value: T): T => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; };

async function findPages(context: import('playwright').BrowserContext, message: CoordinatorInit): Promise<Page[]> {
  if (message.targetIds?.length) {
    const byTarget = new Map<string, Page>();
    for (const page of context.pages()) {
      const session = await context.newCDPSession(page);
      try { const info = await session.send('Target.getTargetInfo') as { targetInfo?: { targetId?: string } }; if (info.targetInfo?.targetId) byTarget.set(info.targetInfo.targetId, page); }
      finally { await session.detach().catch(() => undefined); }
    }
    return message.targetIds.map(id => { const page = byTarget.get(id); if (!page) throw Error('COORDINATOR_TAB_NOT_FOUND'); return page; });
  }
  const matching = context.pages().filter(page => page.url() === message.pageUrl).slice(0, message.pageCount);
  if (matching.length < message.pageCount) throw Error('COORDINATOR_TAB_NOT_FOUND');
  return matching;
}

function securityProvider(page: Page, message: CoordinatorInit) {
  const security = message.security;
  if (security.kind === 'synthetic') return async () => {
    if (security.cpuMs > 0 || security.waitMs > 0) await page.evaluate(async ({ cpu, wait }) => {
      const end = performance.now() + cpu; while (performance.now() < end) { /* busy */ } await new Promise(done => setTimeout(done, wait)); }, { cpu: security.cpuMs, wait: security.waitMs });
    else await new Promise(done => setTimeout(done, 5));
    return { turnstileToken: 'offline-bench-token', publicFingerprint: 'offline-bench-print' };
  };
  return async () => (await import('./calendar-free-security-context.js')).calendarFreeSecurityContext(page)();
}

async function onInit(message: CoordinatorInit) {
  init = message;
  browser = await chromium.connectOverCDP(message.cdpUrl);
  const context = browser.contexts()[0];
  if (!context) throw Error('COORDINATOR_CONTEXT_MISSING');
  pages = await findPages(context, message);
  transports = pages.map((page, pageIndex) => new OndaBrowserSessionTransport(page, securityProvider(page, message),
    async (response: CheckoutHttpResponse) => {
      if (!message.captureResponses) return;
      const id = nextCapture++;
      const acknowledged = new Promise<boolean>(done => captureAcks.set(id, done));
      send({ type: 'capture', id, attemptId: currentAttemptOfPage.get(pageIndex) ?? 'unknown', response });
      if (!await acknowledged) throw Error('CHECKOUT_RESPONSE_CAPTURE_FAILED');
    },
    { onHumanVerificationRequired: async () => send({ type: 'human-verification', pageIndex, state: 'required' }),
      onHumanVerificationCompleted: async () => send({ type: 'human-verification', pageIndex, state: 'completed' }) },
    observation => { const attemptId = currentAttemptOfPage.get(pageIndex); if (attemptId) recorder?.observeTransport(attemptId, observation); }));
  // Warm this process's dispatch path before any release (V8 tiers up Playwright's evaluate/serialization and the
  // JSON path): a fresh coordinator would otherwise pay first-call compilation at the trigger. No request is sent.
  const sample = JSON.stringify({ warmup: 'x'.repeat(1200) });
  for (let round = 0; round < 25; round++) for (const page of pages)
    await page.evaluate(({ text }) => { const started = performance.now(); return JSON.parse(text).warmup.length + started; }, { text: sample });
  send({ type: 'ready', pageCount: pages.length });
}
const currentAttemptOfPage = new Map<number, string>();

async function onArm(message: CoordinatorArm) {
  // One arm per dispatch; a pooled coordinator starts every dispatch clean.
  aborted = false; currentAttemptOfPage.clear();
  // Trusted clock of this process, anchored to the parent's on the system-wide monotonic clock.
  const hr = process.hrtime.bigint(), wallAtAnchor = Date.now();
  const trustedAtAnchor = message.anchor.trustedMs + Number(hr - BigInt(message.anchor.hrNs)) / 1e6;
  let first = true;
  const clock = TrustedReleaseClock.fromOffset(trustedAtAnchor - wallAtAnchor, { method: 'coordinator-anchor', sampleCount: 0 },
    () => performance.now(), () => { if (first) { first = false; return wallAtAnchor; } return Date.now(); });
  const releaseMs = message.attempts[0]?.releaseMs ?? 0;
  recorder = new CriticalPathRecorder(releaseMs, clock.monotonicDeadline(releaseMs), clock.offsetMs - clock.wallDisagreementMs(), message.attempts.map(value => value.attemptId));
  const prepared: Array<{ delegated: DelegatedAttempt; armed?: ArmedAttempt; transport: OndaBrowserSessionTransport; unsent?: string }> = message.attempts.map(delegated => {
    const transport = transports[delegated.pageIndex];
    if (!transport) return { delegated, transport: transports[0]!, unsent: 'COORDINATOR_TAB_NOT_FOUND' };
    try {
      const request = deepFreeze(JSON.parse(delegated.body) as ProoflessCheckoutRequest);
      const registered = armCheckoutRequest(request);
      // The bytes this process will send must be exactly the bytes the parent validated and armed.
      if (registered.body !== delegated.body || registered.key !== delegated.key) return { delegated, transport, unsent: 'DELEGATED_BODY_MISMATCH' };
      const armed = { attempt: { id: delegated.attemptId }, target: { workerId: init!.workerId }, key: delegated.key, request, permit: delegatedSubmissionPermit(delegated.key),
        triggerMs: delegated.triggerMs, state: 'armed' } as unknown as ArmedAttempt;
      return { delegated, armed, transport };
    } catch (error) { return { delegated, transport, unsent: safeCode(error, 'DELEGATION_FAILED') }; }
  });
  send({ type: 'armed', count: prepared.filter(value => value.armed).length });
  const report = (attemptId: string, outcome: DelegatedOutcome) => send({ type: 'result', attemptId, outcome });
  for (const value of prepared) if (value.unsent) report(value.delegated.attemptId, { kind: 'unsent', code: value.unsent });
  const live = prepared.filter(value => value.armed);
  const waitFor = (epochMs: number, isAborted = () => aborted) => waitForMonotonicDeadline(() => clock.monotonicDeadline(epochMs), { spinTailMs: message.spinTailMs, isAborted });
  const firstTrigger = Math.min(...live.map(value => value.delegated.triggerMs));
  const deadline = Math.max(...live.map(value => value.delegated.dispatchDeadlineMs));
  const sends = new Map<string, Promise<unknown>>();
  let schedule: PrewarmSchedule | undefined;
  try {
    await waitFor(message.prewarmAtMs);
    schedule = schedulePrewarm(live.map(value => ({ id: value.delegated.attemptId, tier: value.delegated.tier, order: value.delegated.order, group: init!.workerId })),
      async task => {
        const value = live.find(entry => entry.delegated.attemptId === task.id)!, started = clock.nowMs() - releaseMs;
        for (let round = 1; round <= 2; round++) {
          try { await value.transport.prepareCheckoutContext(); send({ type: 'prewarm', attemptId: task.id, ok: true, startedMs: started, readyMs: clock.nowMs() - releaseMs }); return true; }
          catch (error) { if (round === 1 && clock.nowMs() < message.retryCutoffMs) continue;
            send({ type: 'prewarm', attemptId: task.id, ok: false, startedMs: started, readyMs: null, code: safeCode(error, 'SECURITY_PREWARM_FAILED') }); return false; }
        }
        return false;
      }, message.prewarmPolicy ?? UNBOUNDED_PREWARM, undefined, status => send({ type: 'prewarm-status', status }));
    if (message.prewarmStopStartingAtMs !== null) void waitFor(message.prewarmStopStartingAtMs, () => false).then(() => schedule?.stopStarting());
    await waitFor(firstTrigger - FINAL_APPROACH_MS);
    try { setPriority(0, osConstants.priority.PRIORITY_HIGH); } catch { /* optional tuning */ }
    for (const trigger of [...new Set(live.map(value => value.delegated.triggerMs))].sort((a, b) => a - b)) {
      await waitFor(trigger, sends.size ? () => false : () => aborted);
      // ---- One synchronous, in-memory pass: no IPC, no I/O, no serialization. ----
      recorder.mark('*', 'schedulerFired');
      for (const value of live) {
        if (value.delegated.triggerMs !== trigger) continue;
        const ready = schedule.readiness.get(value.delegated.attemptId)!;
        if (!ready.settled || !ready.ok) continue;
        currentAttemptOfPage.set(value.delegated.pageIndex, value.delegated.attemptId);
        recorder.mark(value.delegated.attemptId, 'workerInvoked');
        const sent = fireArmedAttempt(value.armed!, value.transport, clock, { releaseMs, triggerMs: trigger, dispatchDeadlineMs: value.delegated.dispatchDeadlineMs }, () => aborted);
        sent.catch(() => undefined);
        sends.set(value.delegated.attemptId, sent);
      }
    }
  } catch (error) {
    // Aborted (or failed) before this attempt was fired: nothing unfired can ever be sent by this process.
    schedule?.stopStarting();
    for (const value of live) if (!sends.has(value.delegated.attemptId)) report(value.delegated.attemptId, { kind: 'unsent', code: safeCode(error, 'ARMED_NOT_DISPATCHED') });
    try { setPriority(0, osConstants.priority.PRIORITY_NORMAL); } catch { /* optional */ }
    if (!sends.size) return finishTelemetry();
  }
  await new Promise<void>(done => setImmediate(done));
  schedule?.stopStarting();
  try { setPriority(0, osConstants.priority.PRIORITY_NORMAL); } catch { /* optional */ }
  await Promise.all(live.map(async value => {
    const id = value.delegated.attemptId;
    let sent = sends.get(id);
    if (!sent) {
      const ready = schedule?.readiness.get(id);
      if (!ready) return; // already reported unsent above
      if (message.prewarmPolicy && value.delegated.tier > 0 && (!ready.settled || ready.omitted)) { report(id, { kind: 'unsent', code: 'PREWARM_TIER_OMITTED' }); return; }
      if (ready.omitted) { report(id, { kind: 'unsent', code: 'PREWARM_TIER_OMITTED' }); return; }
      if (!ready.settled) {
        const timedOut = Symbol('timeout');
        const outcome = await Promise.race([ready.promise, waitFor(deadline, () => false).then(() => timedOut)]);
        if (outcome === timedOut) { report(id, { kind: 'unsent', code: 'PREWARM_NOT_READY_IN_WINDOW' }); return; }
      }
      if (!ready.ok) { report(id, { kind: 'unsent', code: 'SECURITY_PREWARM_FAILED' }); return; }
      currentAttemptOfPage.set(value.delegated.pageIndex, id);
      sent = fireArmedAttempt(value.armed!, value.transport, clock, { releaseMs, triggerMs: value.delegated.triggerMs, dispatchDeadlineMs: value.delegated.dispatchDeadlineMs }, () => aborted);
    }
    try { report(id, { kind: 'response', body: await sent }); }
    catch (error) {
      if (error instanceof SubmissionDispatchError && !error.dispatched) report(id, { kind: 'unsent', code: error.code });
      else if (error instanceof SubmissionDispatchError) report(id, { kind: 'error', code: error.code, dispatched: true, confirmedRejected: error.confirmedRejected,
        ...(error.diagnostic ? { diagnostic: error.diagnostic } : {}) });
      else report(id, { kind: 'error', code: safeCode(error, 'COORDINATOR_TRANSPORT_FAILED'), dispatched: true, confirmedRejected: false });
    }
  }));
  await finishTelemetry();
}

async function finishTelemetry() {
  if (!recorder) return;
  for (const [pageIndex, attemptId] of currentAttemptOfPage) {
    try { recorder.calibration(attemptId, calibrateRendererClock(await sampleRendererClock(pages[pageIndex]!, 8))); } catch { /* Node-side marks only */ }
  }
  send({ type: 'telemetry', rows: recorder.rows().filter(row => row.workerId !== '*') });
}

process.on('message', (raw: unknown) => {
  const message = raw as ParentMessage;
  if (message?.type === 'abort') { aborted = true; return; }
  if (message?.type === 'capture-ack') { captureAcks.get(message.id)?.(message.ok); captureAcks.delete(message.id); return; }
  if (message?.type === 'shutdown') { void (async () => { await browser?.close().catch(() => undefined); process.exit(0); })(); return; }
  if (message?.type === 'init') { void onInit(message).catch(error => send({ type: 'fatal', code: safeCode(error, 'COORDINATOR_INIT_FAILED') })); return; }
  if (message?.type === 'arm') void onArm(message).catch(error => send({ type: 'fatal', code: safeCode(error, 'COORDINATOR_ARM_FAILED') }));
});
// Parent gone (runner stopped or crashed): refuse everything not yet fired and exit; nothing new can be sent.
process.on('disconnect', () => { aborted = true; setTimeout(() => process.exit(0), 100).unref(); });
