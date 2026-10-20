import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { Controller, type Dependencies } from '../ui/controller.js';
import { bookingView, defaultSetup, type BookingView } from '../ui/booking.js';
import { BookingSetupSchema, ConfigSchema, ObservationSchema } from '../src/config.js';
import { clockStatus } from '../ui/status.js';
import type { Runner } from '../ui/processes.js';
import type { Command } from '../ui/types.js';
import type { UiEvent } from '../src/ui-events.js';
import { UiEventSchema, UI_EVENT_PROTOCOL_VERSION } from '../src/ui-events.js';
import { preregistered } from './arbitration-manifest-stub.js';

const players = { PLAYER_FULL_NAME: 'Fixture Player', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'fixture@example.invalid' };
const precision = (targets: Array<{ court: number; start: string; durationHours: number }>) =>
  bookingView(ConfigSchema.parse({ ...defaultSetup, BOOKING_METHOD: 'proofless', DURATION_HOURS: 3, RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: targets, ...players }));
const one = [{ court: 7, start: '17:00', durationHours: 3 }], two = [{ court: 7, start: '17:00', durationHours: 3 }, { court: 6, start: '17:00', durationHours: 3 }];
let previous: string | undefined;
beforeEach(() => { previous = process.env.THIRSTY_API_INSTALLATION; process.env.THIRSTY_API_INSTALLATION = '1'; });
afterEach(() => { if (previous === undefined) delete process.env.THIRSTY_API_INSTALLATION; else process.env.THIRSTY_API_INSTALLATION = previous; });

/** A controller over a mutable saved plan, recording every runner command. `script` may emit events and choose the exit code. */
function harness(initial: BookingView, script: (command: Command, emit: (event: UiEvent) => void, line: (text: string) => void) => number = () => 0, extra: Partial<Dependencies> = {}) {
  // One fixed release instant: the controller rejects a release that moves between its own reads (SCHEDULE_CONTEXT_MISMATCH).
  let saved = initial; const calls: Command[] = []; let locked = false; const releaseMs = Date.now() + 3_600_000;
  const runner: Runner = (command, event, onLine) => { calls.push(command); const code = script(command, event, text => onLine(text, true)); return { pid: 1, done: Promise.resolve(code), stop: async () => undefined }; };
  const controller = new Controller({ ensureArbitrationManifest: preregistered, runner, lock: async () => locked, cdp: async () => true,
    browserHealth: async () => ({ A: true, B: true }), playerStatus: () => ({ primary: true, extended: true }),
    clock: () => ({ ...clockStatus(ObservationSchema.parse({}), DateTime.fromISO('2026-09-24T06:00:00+08:00')), releaseMs, targetDate: saved.targetDate, networkSynced: true, clockOffsetMs: 0 }),
    confirm: async () => true, publish: () => undefined, booking: () => saved, saveBooking: (input: unknown) => { saved = bookingView(ConfigSchema.parse({ ...BookingSetupSchema.parse(input), ...players })); return saved; }, ...extra });
  return { controller, calls, setSaved: (view: BookingView) => { saved = view; }, setLock: (value: boolean) => { locked = value; } };
}
const liveRuns = (calls: Command[]) => calls.filter(c => typeof c === 'object' && c.kind === 'apiRun' && c.mode === 'live');

describe('runtime validation before a plan becomes the saved authorization', () => {
  it('validates without saving and reports an exact match or exact differences', () => {
    const { controller } = harness(precision(two));
    const same = controller.validateReleaseSetup(precision(two).setup);
    expect(same).toMatchObject({ ok: true, matchesSaved: true });
    const other = controller.validateReleaseSetup(precision(one).setup);
    expect(other.ok).toBe(true);
    if (other.ok) { expect(other.matchesSaved).toBe(false); expect(other.differences!.total).toBeGreaterThan(0); }
    expect(controller.state.booking).toBeNull();
  });
  it('rejects an invalid runtime representation with readable problems, not a generic error', () => {
    const { controller } = harness(precision(one));
    const result = controller.validateReleaseSetup({ ...precision(one).setup, PRECISION_TARGETS: [] });
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/Precision/);
  });
  it('a saved plan round-trips: save then validate reports matchesSaved', async () => {
    const h = harness(precision(two));
    await h.controller.saveBooking(precision(one).setup);
    expect(h.controller.validateReleaseSetup(precision(one).setup)).toMatchObject({ ok: true, matchesSaved: true });
  });
});

describe('replacing the saved release plan needs an explicit review', () => {
  it('shows the exact differences, keeps the saved plan when declined and saves only when accepted', async () => {
    const reviews: Array<{ total: number; labels: string[]; savedFingerprint: string }> = [];
    let answer = false;
    const original = precision(two);
    const h = harness(original, () => 0, { confirmPlanReplace: async review => { reviews.push({ total: review.differences.total, labels: review.differences.summary.map(d => d.label), savedFingerprint: review.savedFingerprint }); return answer; } });
    await h.controller.saveBooking(precision(one).setup);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ savedFingerprint: original.fingerprint });
    expect(reviews[0]!.total).toBeGreaterThan(0);
    expect(h.controller.validateReleaseSetup(precision(two).setup)).toMatchObject({ ok: true, matchesSaved: true });
    expect(h.controller.state.headline).toBe('Saved plan unchanged');
    answer = true;
    await h.controller.saveBooking(precision(one).setup);
    expect(h.controller.validateReleaseSetup(precision(one).setup)).toMatchObject({ ok: true, matchesSaved: true });
    // Saving the identical plan again is not a replacement and asks nothing.
    await h.controller.saveBooking(precision(one).setup);
    expect(reviews).toHaveLength(2);
  });
  it('a Prepare that carries a different setup asks the same question and prepares nothing when declined', async () => {
    const original = precision(two);
    const h = harness(original, () => 0, { confirmPlanReplace: async () => false });
    await h.controller.resetPrepare({ workflow: 'release', strategy: 'standard', setup: precision(one).setup });
    expect(h.calls).toEqual([]);
    expect(h.controller.validateReleaseSetup(precision(two).setup)).toMatchObject({ ok: true, matchesSaved: true });
    expect(h.controller.state.preparedPlanFingerprint ?? null).toBeNull();
  });
});
describe('preparation is bound to the exact saved plan', () => {
  it('records the prepared fingerprint, clears it when a different plan is saved, and refuses to arm a changed plan', async () => {
    const h = harness(precision(two));
    await h.controller.resetPrepare({ workflow: 'release', strategy: 'standard' });
    expect(h.controller.state.preparedPlanFingerprint).toBe(precision(two).fingerprint);
    expect(h.controller.state.apiFirstReady).toBe(true);
    // Saving a different plan afterwards: the controller clears the old preparation and says why.
    await h.controller.saveBooking(precision(one).setup);
    expect(h.controller.state.apiFirstReady).toBe(false);
    expect(h.controller.state.headline).toBe('SAVED PLAN CHANGED');
    expect(h.controller.state.attention).toMatchObject({ category: 'PLAN_FINGERPRINT_MISMATCH', recovery: { action: 'REVIEW_CHANGES' } });
    await h.controller.armFullBooking();
    expect(liveRuns(h.calls)).toEqual([]);
  });
  it('arming refuses a plan swapped after preparation even before the next refresh', async () => {
    const h = harness(precision(two));
    await h.controller.resetPrepare({ workflow: 'release', strategy: 'standard' });
    await h.controller.authorizeTerms(true);
    h.setSaved(precision(one));
    await h.controller.armFullBooking();
    expect(liveRuns(h.calls)).toEqual([]);
    expect(h.controller.state.attention).toMatchObject({ category: 'PLAN_FINGERPRINT_MISMATCH', code: 'PREPARED_PLAN_CHANGED', operation: 'arm' });
    expect(h.controller.state.logs.some(l => l.text.startsWith('FAILURE_RECORD category=PLAN_FINGERPRINT_MISMATCH'))).toBe(true);
  });
  it('an unbound preparation (no recorded fingerprint) is never armable', async () => {
    const h = harness(precision(one));
    h.controller.state.apiFirstReady = true; h.controller.state.ready = true; h.controller.state.termsAuthorized = true;
    await h.controller.armFullBooking();
    expect(liveRuns(h.calls)).toEqual([]);
    expect(h.controller.state.attention?.category).toBe('STALE_PREPARATION');
  });
  it('the exact prepared plan arms normally', async () => {
    const h = harness(precision(one));
    await h.controller.resetPrepare({ workflow: 'release', strategy: 'standard' });
    await h.controller.authorizeTerms(true); await h.controller.armFullBooking();
    expect(liveRuns(h.calls)).toHaveLength(1);
    expect(liveRuns(h.calls)[0]).toMatchObject({ fingerprint: precision(one).fingerprint });
  });
});

describe('preparation failures settle with a typed, durable record', () => {
  it('a generic failure at the final step records its step, class and retry safety (October 18 07:50:35 shape)', async () => {
    const h = harness(precision(one), (command, emit) => {
      if (typeof command === 'object' && command.kind === 'apiRun' && command.mode === 'prepare') {
        emit({ type: 'apiStage', stage: 'PREPARATION_STEP_FAILED', elapsedMs: 0, checkpoint: 'FINAL', reason: 'TYPEERROR', message: 'Preparation failed at step final with TypeError' });
        emit({ type: 'error', code: 'BOOKING_OPERATION_FAILED' }); return 1;
      }
      return 0;
    });
    await expect(h.controller.resetPrepare({ workflow: 'release', strategy: 'standard' })).resolves.toBeUndefined();
    expect(h.controller.state.operation).toBe('idle');
    expect(h.controller.state.attention).toMatchObject({ category: 'INTERNAL_ERROR', code: 'BOOKING_OPERATION_FAILED', step: 'final', retrySafe: true, recovery: { action: 'PREPARE' } });
    expect(h.controller.state.logs.some(l => /FAILURE_RECORD category=INTERNAL_ERROR code=BOOKING_OPERATION_FAILED operation=prepare step=final/.test(l.text))).toBe(true);
    expect(h.controller.state.preparedPlanFingerprint).toBeNull();
  });
  it('a failure that leaves a lock behind is review-first, never offered as a retry', async () => {
    const h = harness(precision(one), (command, emit) => { if (typeof command === 'object' && command.kind === 'apiRun') { emit({ type: 'error', code: 'BOOKING_OPERATION_FAILED' }); h.setLock(true); return 1; } return 0; });
    await h.controller.resetPrepare({ workflow: 'release', strategy: 'standard' });
    expect(h.controller.state.attention).toMatchObject({ category: 'INTERNAL_ERROR', retrySafe: false });
  });
  it.each([['ONDA_SECURITY_VERIFICATION_FAILED', 'SECURITY_VERIFICATION_FAILED'], ['CHROME_DISCONNECTED', 'BROWSER_DISCONNECTED'], ['PREPARATION_RESULT_INVALID', 'INVALID_PREPARATION_EVIDENCE']])
  ('%s is categorized as %s with the failing browser', async (code, category) => {
    const h = harness(precision(one), (command, emit) => { if (typeof command === 'object' && command.kind === 'apiRun') {
      emit({ type: 'apiStage', stage: 'SECURITY_PREWARM_FAILED', elapsedMs: 1, workerId: 'A', code }); emit({ type: 'apiStage', stage: 'FAILED', elapsedMs: 2, code }); return 1; } return 0; });
    await h.controller.resetPrepare({ workflow: 'release', strategy: 'standard' });
    expect(h.controller.state.attention).toMatchObject({ category, code, workerId: 'A' });
  });
  it('a Terms refusal explains itself instead of silently unticking', async () => {
    const h = harness(precision(one));
    await expect(h.controller.authorizeTerms(true)).rejects.toThrow('TERMS_AUTHORIZATION_NOT_ALLOWED');
    expect(h.controller.state.detail).toContain('Prepare the saved plan first');
  });
});

describe('run outcome and protocol diagnostics', () => {
  it('October 18: three unsent attempts end promptly as NOTHING DISPATCHED with an accurate record, not a stale ARMED state', async () => {
    const h = harness(precision(one), (command, emit) => {
      if (typeof command === 'object' && command.kind === 'apiRun' && command.mode === 'live') {
        const stage = (name: string, extra: Record<string, unknown> = {}) => emit({ type: 'apiStage', stage: name, elapsedMs: 1, ...extra } as UiEvent);
        stage('RUN_STARTED');
        for (const index of [0, 1, 2]) stage('PHASE3_FAN_OUT_CHILD', { workerId: 'A', attemptId: `a-${index}`, workerGroupIndex: 0, fanOutIndex: index, fanOutCount: 3, releaseOffsetMs: [-1000, -80, 0][index] });
        stage('PREWARM_WINDOW', { prewarmLeadMs: 105_000, leadBeforeTriggerMs: 29_000, lateByMs: 76_000, releaseOffsetMs: -1000, code: 'PREWARM_LATE_START', message: 'Preparation started 29 s before the earliest trigger (planned 105 s); 76 s late.' });
        for (const index of [0, 1, 2]) stage('PHASE3_SETTLED', { workerId: 'A', attemptId: `a-${index}`, workerGroupIndex: 0, wave: 'WAVE_1', state: 'NOT_DISPATCHED', code: 'SHOTGUN_TRIGGER_MISSED' });
        stage('FAILED', { code: 'NOTHING_DISPATCHED' });
        return 1;
      }
      return 0;
    });
    await h.controller.resetPrepare({ workflow: 'release', strategy: 'standard' });
    await h.controller.authorizeTerms(true); await h.controller.armFullBooking();
    expect(h.controller.state.operation).toBe('idle');
    expect(h.controller.state.activeApiRelease).toBeNull();
    expect(h.controller.state.runSummary).toMatchObject({ planned: 3, initiated: 0, unsent: 3, unknown: 0, rejected: 0, settled: true, headline: 'NOTHING DISPATCHED' });
    expect(h.controller.state.attention).toMatchObject({ category: 'RUN_NOT_ACHIEVED', operation: 'run' });
    expect(h.controller.state.attention?.detail).toContain('0 requests initiated');
    expect(h.controller.state.live?.prewarm).toMatchObject({ leadMs: 105_000, actualLeadMs: 29_000, lateByMs: 76_000 });
  });
  it('keeps rejected runtime events visible by stage and field path only', async () => {
    const h = harness(precision(one), (command, _emit, line) => { if (typeof command === 'object' && command.kind === 'apiRun' && command.mode === 'prepare') line('UI_EVENT_SCHEMA_REJECTED stage=PHASE3_SETTLED issues=unrecognized_keys:event:futureField'); return 0; });
    await h.controller.resetPrepare({ workflow: 'release', strategy: 'standard' });
    expect(h.controller.state.protocolIssues).toEqual([expect.objectContaining({ text: 'UI_EVENT_SCHEMA_REJECTED stage=PHASE3_SETTLED issues=unrecognized_keys:event:futureField' })]);
  });
  it('the versioned contract accepts the stages the typed runner contract found were being dropped', () => {
    expect(UI_EVENT_PROTOCOL_VERSION).toBe(2);
    for (const extra of [{ stage: 'PHASE3_SETTLED', lockdownDeferredMs: 412 }, { stage: 'PRECISION_ARMED', fanOut: true, parentGoalCount: 2, frozenCount: 4 }, { stage: 'PHASE3_EVIDENCE', seq: 3, operational: true },
      { stage: 'PREWARM_WINDOW', prewarmLeadMs: 105000, leadBeforeTriggerMs: 29000, lateByMs: 76000, releaseOffsetMs: -1000, code: 'PREWARM_LATE_START' },
      { stage: 'PREPARATION_STEP_FAILED', checkpoint: 'PREVIOUS-SESSION', reason: 'TYPEERROR', message: 'Preparation failed at step previous-session with TypeError' }])
      expect(UiEventSchema.safeParse({ type: 'apiStage', elapsedMs: 0, ...extra }).success, extra.stage).toBe(true);
  });
});

describe('pre-release security check (genuine verification minutes before release, value discarded)', () => {
  const record = (view: BookingView, outcome: 'READY' | 'FAILED') => ({ schema: 'security-check/v1' as const, checkedAt: new Date().toISOString(), targetDate: view.targetDate,
    fingerprint: view.fingerprint, workers: { A: { outcome, durationMs: 4100, ...(outcome === 'FAILED' ? { code: 'ONDA_SECURITY_VERIFICATION_FAILED', challengeFrame: 'none' as const } : {}) },
      B: { outcome: 'READY' as const, durationMs: 3900 } } });
  it('runs after the release dry run; a failed check is evidence, never a failed preparation', async () => {
    const view = precision(two); let written: ReturnType<typeof record> | null = null;
    const h = harness(view, command => { if (typeof command === 'object' && command.kind === 'apiRun' && command.mode === 'security-check') { written = record(view, 'FAILED'); return 1; } return 0; },
      { securityCheck: () => written });
    await h.controller.resetPrepare({ workflow: 'release', strategy: 'standard' });
    expect(h.calls.map(c => typeof c === 'object' && c.kind === 'apiRun' ? c.mode : c)).toEqual(['prepare', 'dry', 'security-check']);
    expect(h.calls[2]).toMatchObject({ kind: 'apiRun', mode: 'security-check', fingerprint: view.fingerprint, date: view.targetDate });
    expect(h.controller.state).toMatchObject({ apiFirstReady: true, ready: true, preparedPlanFingerprint: view.fingerprint, securityCheck: { status: 'FAILED' } });
    expect(h.controller.state.securityCheck!.detail).toMatch(/A failed \(ONDA_SECURITY_VERIFICATION_FAILED\)/);
    expect(h.controller.state.releaseReadiness?.checks.find(c => c.id === 'security-check')).toMatchObject({ level: 'UNAVAILABLE', hardBlock: false });
  });
  it('one-click re-check runs only for the prepared saved plan and keeps the preparation', async () => {
    const view = precision(two); let written: ReturnType<typeof record> | null = null;
    const h = harness(view, command => { if (typeof command === 'object' && command.kind === 'apiRun' && command.mode === 'security-check') written = record(view, 'READY'); return 0; },
      { securityCheck: () => written });
    await h.controller.checkSecurity();
    expect(h.calls).toEqual([]);
    expect(h.controller.state.detail).toMatch(/Prepare the saved release plan first/);
    await h.controller.resetPrepare({ workflow: 'release', strategy: 'standard' });
    written = null; h.calls.length = 0;
    await h.controller.checkSecurity();
    expect(h.calls).toEqual([expect.objectContaining({ kind: 'apiRun', mode: 'security-check', fingerprint: view.fingerprint })]);
    expect(h.controller.state).toMatchObject({ ready: true, apiFirstReady: true, preparedPlanFingerprint: view.fingerprint, headline: 'SECURITY CHECK PASSED', securityCheck: { status: 'PASSED' } });
  });
});
