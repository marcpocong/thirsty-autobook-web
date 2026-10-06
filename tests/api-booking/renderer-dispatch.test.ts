import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import vm from 'node:vm';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { armPrecisionRace, dispatchArmedPrecisionRace, fireArmedAttemptRenderer, settleArmedAttempt, type RendererTransport } from '../../src/api-booking/armed-dispatch.js';
import { armCheckoutRequest, BrowserSessionTransportError, OndaBrowserSessionTransport } from '../../src/api-booking/browser-session-transport.js';
import { consumeSubmissionPermit, DurableSubmissionJournal } from '../../src/api-booking/durable-submission-journal.js';
import { freezePrecisionRace, precisionTargetPlan, validatePrecisionTargets } from '../../src/api-booking/precision-race.js';
import { prooflessRequest, type DirectTransport, type ProoflessCheckoutRequest } from '../../src/api-booking/proofless-checkout.js';
import { calibrateRendererClock, calibrateRendererClockAdaptive, type RendererClockCalibration } from '../../src/api-booking/renderer-clock.js';
import { planRendererFire, RENDERER_ARMED_CHECKOUT_SOURCE, RENDERER_DISARM_SOURCE, rendererDispatchEnabled, type RendererArmedArgs,
  type RendererFirePlan } from '../../src/api-booking/renderer-dispatch.js';
import { SubmissionDispatchError } from '../../src/api-booking/submission-errors.js';
import { seededRandom } from '../../src/arbitration/stats.js';
import { TrustedReleaseClock } from '../../src/release-clock.js';

const ONDA_URL = 'https://app.onda.fit/book/thirsty-pickle';
const date = '2026-09-26';
const customer = { clientId: '00000000-0000-4000-8000-00000000c11e', customerId: '00000000-0000-4000-8000-000000000b00',
  customerEmail: 'fixture@example.invalid', customerPhone: '09123456789', customerFirstName: 'Fixture', customerLastName: 'Player' };

/**
 * A page realm running the EXACT static source with a virtual renderer clock. Every performance.now()
 * advances time by `step`; MessageChannel yields through the host event loop; fetch only records.
 */
function pageRealm(options: { start?: number; step?: number | (() => number); wall?: (renderer: number) => number; href?: string } = {}) {
  let now = options.start ?? 1_000;
  const step = typeof options.step === 'function' ? options.step : () => (options.step as number | undefined) ?? 0.05;
  const fetches: Array<{ at: number; url: string; body: string }> = [];
  const context: Record<string, unknown> = {
    performance: { now: () => (now += step()), timeOrigin: 1_700_000_000_000 },
    Date: { now: () => (options.wall ?? (value => 1_790_294_400_000 + value))(now) },
    fetch: async (url: string, init: { body: string }) => { fetches.push({ at: now, url, body: init.body });
      return { status: 409, headers: { get: (name: string) => name === 'content-type' ? 'application/json' : null }, text: async () => '{"success":false,"error":"x"}' }; },
    MessageChannel: class { port1: { onmessage: null | (() => void); close(): void } = { onmessage: null, close() {} };
      port2 = { postMessage: () => setImmediate(() => this.port1.onmessage?.()) }; },
    location: { href: options.href ?? ONDA_URL },
  };
  context.globalThis = context;
  vm.createContext(context);
  return { fetches, context, now: () => now, advance: (ms: number) => { now += ms; },
    armed: vm.runInContext(`(${RENDERER_ARMED_CHECKOUT_SOURCE})`, context) as (args: RendererArmedArgs) => Promise<Record<string, unknown>>,
    disarm: vm.runInContext(`(${RENDERER_DISARM_SOURCE})`, context) as (key: string) => string };
}
const args = (fireAt: number, extra: Partial<RendererArmedArgs> = {}): RendererArmedArgs => ({ key: 'k1', pageUrl: ONDA_URL, fireAtRendererMs: fireAt,
  notAfterRendererMs: fireAt + 1_000, releaseWallMs: 1_790_294_400_000 + fireAt, wallGuardToleranceMs: 5, syncSpinMs: 1, maxArmAheadMs: 250,
  calibrationUncertaintyMs: 0.2, url: 'https://app.onda.fit/api/bookings/public-checkout', text: '{"exact":"body"}', headers: { 'X-Test': '1' }, ...extra });

describe('page-side armed checkout (static source, virtual clock)', () => {
  it('never calls fetch before its fire time and fires within the final spin (500 random schedules)', async () => {
    const random = seededRandom(9);
    for (let run = 0; run < 500; run++) {
      const realm = pageRealm({ start: 1_000, step: () => 0.001 + random() * 0.3 });
      const fireAt = 1_000 + 1 + random() * 60;
      const outcome = await realm.armed(args(fireAt));
      expect(outcome.fired).toBe(true);
      expect(realm.fetches).toHaveLength(1);
      expect(realm.fetches[0]!.at).toBeGreaterThanOrEqual(fireAt);
      expect(realm.fetches[0]!.at - fireAt).toBeLessThan(1.5);
      expect(realm.fetches[0]!.body).toBe('{"exact":"body"}');
    }
  });

  it('holds fire while the wall clock disagrees, and fires only once it agrees within tolerance', async () => {
    // Wall clock 50 ms behind the monotonic plan: the page keeps waiting until Date.now() ≥ releaseWall − tolerance.
    const behind = pageRealm({ wall: renderer => 1_790_294_400_000 + renderer - 50 });
    expect(await behind.armed(args(1_010))).toMatchObject({ fired: true });
    expect(behind.fetches).toHaveLength(1);
    expect(behind.fetches[0]!.at).toBeGreaterThanOrEqual(1_010 + 50 - 5);
  });

  it('refuses — without any fetch — on a lagging wall clock, a missed window, a changed page or an arm that is too early', async () => {
    // Wall clock further behind than the whole not-after window: never agrees in time, so the page refuses.
    const lagging = pageRealm({ wall: renderer => 1_790_294_400_000 + renderer - 5_000 });
    expect(await lagging.armed(args(1_010))).toMatchObject({ refused: 'RENDERER_WALL_GUARD' });
    const late = pageRealm({ start: 5_000 });
    expect(await late.armed(args(1_010))).toMatchObject({ refused: 'RENDERER_WINDOW_MISSED' });
    const moved = pageRealm({ href: 'https://app.onda.fit/checkout' });
    expect(await moved.armed(args(1_010))).toMatchObject({ refused: 'RENDERER_PAGE_INVALID' });
    const early = pageRealm();
    expect(await early.armed(args(2_000))).toMatchObject({ refused: 'RENDERER_ARM_WINDOW_INVALID' });
    const inverted = pageRealm();
    expect(await inverted.armed(args(1_010, { notAfterRendererMs: 1_005 }))).toMatchObject({ refused: 'RENDERER_ARM_WINDOW_INVALID' });
    for (const realm of [lagging, late, moved, early, inverted]) expect(realm.fetches).toEqual([]);
  });

  it('arms a key once per page and honours a disarm that arrives before the final spin', async () => {
    const realm = pageRealm({ step: 0.01 });
    const first = realm.armed(args(1_030));
    expect(await realm.armed(args(1_030))).toMatchObject({ refused: 'RENDERER_ALREADY_ARMED' });
    expect(await first).toMatchObject({ fired: true });
    expect(realm.fetches).toHaveLength(1);
    expect(realm.disarm('k1')).toBe('ALREADY_FIRED');
    // A fired key stays taken for the page's lifetime, even for a later, otherwise valid arm.
    expect(await realm.armed(args(realm.now() + 10))).toMatchObject({ refused: 'RENDERER_ALREADY_ARMED' });
    expect(realm.fetches).toHaveLength(1);

    const other = pageRealm({ step: 0.01 });
    const pending = other.armed(args(1_040, { key: 'k2' }));
    await new Promise(done => setImmediate(done));
    expect(other.disarm('k2')).toBe('DISARMED');
    expect(await pending).toMatchObject({ refused: 'RENDERER_DISARMED' });
    expect(other.disarm('missing')).toBe('NOT_ARMED');
    expect(other.fetches).toEqual([]);
    // A refusal is provably unsent and releases the key: a later arm (with a fresh permit on the Node side) may fire.
    expect(other.disarm('k2')).toBe('NOT_ARMED');
    expect(await other.armed(args(other.now() + 10, { key: 'k2' }))).toMatchObject({ fired: true });
    expect(other.fetches).toHaveLength(1);
  });
});

describe('planning the fire time', () => {
  const calibration = (overrides: Partial<RendererClockCalibration> = {}): RendererClockCalibration => ({ version: 1, samples: 8, offsetLowMs: -5_000.2,
    offsetHighMs: -4_999.8, offsetMs: -5_000, uncertaintyMs: 0.2, minRoundTripMs: 0.4, calibratedAtNodeMs: 1_000, consistent: true, ...overrides });
  const clock = { monotonicDeadline: (epoch: number) => 2_000 + (epoch - 1_790_294_400_000), offsetMs: 23.3, wallDisagreementMs: () => 0.4 };

  it('maps release and deadline conservatively into renderer time and the wall-clock guard', () => {
    const plan = planRendererFire({ key: 'k', pageUrl: ONDA_URL, calibration: calibration(), clock, releaseMs: 1_790_294_400_000,
      dispatchDeadlineMs: 1_790_294_401_000, nodeNowMs: 1_500 });
    // node = renderer + offset → earliest renderer time where node ≥ 2000 for EVERY offset in [low, high]:
    expect(plan.fireAtRendererMs).toBeCloseTo(7_000.2, 6);
    expect(plan.notAfterRendererMs).toBeCloseTo(7_999.8, 6);
    expect(plan.releaseWallMs).toBeCloseTo(1_790_294_400_000 - 23.3 + 0.4, 6);
  });

  it('fails closed on a missing, inconsistent, stale or loose calibration', () => {
    const base = { key: 'k', pageUrl: ONDA_URL, clock, releaseMs: 1_790_294_400_000, dispatchDeadlineMs: 1_790_294_401_000, nodeNowMs: 1_500 };
    expect(() => planRendererFire({ ...base, calibration: undefined })).toThrow('RENDERER_CLOCK_NO_SAMPLES');
    expect(() => planRendererFire({ ...base, calibration: calibration({ consistent: false }) })).toThrow('RENDERER_CLOCK_INCONSISTENT');
    expect(() => planRendererFire({ ...base, calibration: calibration(), nodeNowMs: 1_000 + 15_001 })).toThrow('RENDERER_CLOCK_STALE');
    expect(() => planRendererFire({ ...base, calibration: calibration({ uncertaintyMs: 2.5 }) })).toThrow('RENDERER_CLOCK_UNCERTAIN');
  });

  it('is off unless the exact experimental value is set', () => {
    expect(rendererDispatchEnabled({})).toBe(false);
    expect(rendererDispatchEnabled({ ONDA_EXPERIMENTAL_RENDERER_DISPATCH: 'true' })).toBe(false);
    expect(rendererDispatchEnabled({ ONDA_EXPERIMENTAL_RENDERER_DISPATCH: 'RENDERER_RESIDENT_V1' })).toBe(true);
  });
});

describe('transport and dispatcher (offline)', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'renderer-dispatch-')); process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT'; });
  afterEach(async () => {
    delete process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT;
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw Error('UNSAFE_TEST_PATH');
    await rm(root, { recursive: true, force: true });
  });
  const race = (count: number, releaseMs: number) => {
    const targets = validatePrecisionTargets([1, 2, 3, 4, 5, 6, 7].slice(0, count).map(court => ({ court, start: '17:00', durationHours: 3 })), date);
    return freezePrecisionRace(date, releaseMs, targets.map(target => ({ target, plan: precisionTargetPlan(target, date) })));
  };
  const plan = (key: string, fireAt = 1_010): RendererFirePlan => ({ key, pageUrl: ONDA_URL, fireAtRendererMs: fireAt, notAfterRendererMs: fireAt + 1_000,
    releaseWallMs: 1_790_294_400_000 + fireAt, wallGuardToleranceMs: 5, syncSpinMs: 1, maxArmAheadMs: 250, calibrationUncertaintyMs: 0.2 });
  /** A page stand-in that evaluates the function's SOURCE inside a vm realm, exactly as it would cross into Chrome. */
  const vmPage = (realm: ReturnType<typeof pageRealm>, fail = false) => ({ isClosed: () => false, url: () => ONDA_URL, on: () => undefined, off: () => undefined,
    mainFrame: () => undefined, locator: () => ({ count: async () => 0 }),
    evaluate: async (fn: (arg: unknown) => unknown, arg: unknown) => { if (fail) throw Error('Execution context was destroyed');
      return (vm.runInContext(`(${fn.toString()})`, realm.context) as (value: unknown) => unknown)(arg); } }) as unknown as Page;

  it('sends the exact armed body once, keeps refusals provably unsent and page failures UNKNOWN', async () => {
    const releaseMs = Date.now() + 5_000;
    const clock = TrustedReleaseClock.fromOffset(0, { method: 'test', sampleCount: 5 });
    const armed = await armPrecisionRace(race(3, releaseMs), { customerFor: () => customer, journalRoot: root, releaseMs, now: () => clock.nowMs() });
    const [ok, refused, broken] = armed.attempts;
    const headers = async () => ({ turnstileToken: 'synthetic-token', publicFingerprint: 'synthetic-fingerprint' });
    const realm = pageRealm({ start: 1_000, step: 0.05 });
    const transport = new OndaBrowserSessionTransport(vmPage(realm), headers);
    await transport.prepareCheckoutContext();
    await expect(transport.publicCheckoutProoflessRendererArmed(ok!.request, ok!.permit, plan(ok!.key))).rejects.toMatchObject({
      code: 'ONDA_HTTP_STATUS_INVALID', dispatched: true, confirmedRejected: true });
    expect(realm.fetches.map(value => value.body)).toEqual([armCheckoutRequest(ok!.request).body]);
    // Exactly once: the permit is spent.
    await transport.prepareCheckoutContext(true);
    await expect(transport.publicCheckoutProoflessRendererArmed(ok!.request, ok!.permit, plan(ok!.key))).rejects.toThrow('SUBMISSION_PERMIT_INVALID_OR_USED');
    expect(realm.fetches).toHaveLength(1);

    const refusing = new OndaBrowserSessionTransport(vmPage(pageRealm({ start: 9_000 })), headers);
    await refusing.prepareCheckoutContext();
    const refusal = refusing.publicCheckoutProoflessRendererArmed(refused!.request, refused!.permit, plan(refused!.key));
    await expect(refusal).rejects.toMatchObject({ code: 'RENDERER_WINDOW_MISSED', dispatched: false });
    await expect(settleArmedAttempt(refused!, refusal, Date.now)).rejects.toBeInstanceOf(SubmissionDispatchError);
    expect((await refused!.journal.read(refused!.key)).state).toBe('rejected');

    const failing = new OndaBrowserSessionTransport(vmPage(pageRealm(), true), headers);
    await failing.prepareCheckoutContext();
    const lost = failing.publicCheckoutProoflessRendererArmed(broken!.request, broken!.permit, plan(broken!.key));
    await expect(lost).rejects.toMatchObject({ code: 'ONDA_TRANSPORT_FAILED', dispatched: true });
    await expect(settleArmedAttempt(broken!, lost, Date.now)).rejects.toThrow('SUBMISSION_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED');
    expect((await broken!.journal.read(broken!.key)).state).toBe('unknown');
  });

  it('refuses unarmed requests, missing security and arms outside the window before anything reaches the page', async () => {
    const releaseMs = Date.now() + 60_000;
    const clock = TrustedReleaseClock.fromOffset(0, { method: 'test', sampleCount: 5 });
    const armed = await armPrecisionRace(race(1, releaseMs), { customerFor: () => customer, journalRoot: root, releaseMs, now: () => clock.nowMs() });
    const attempt = armed.attempts[0]!, realm = pageRealm();
    const transport = new OndaBrowserSessionTransport(vmPage(realm), async () => ({ turnstileToken: 'synthetic-token', publicFingerprint: 'synthetic-fingerprint' }));
    const unarmed = prooflessRequest(attempt.plan, customer);
    await expect(transport.publicCheckoutProoflessRendererArmed(unarmed, attempt.permit, plan(attempt.key))).rejects.toThrow('RENDERER_DISPATCH_REQUIRES_ARMED_REQUEST');
    await expect(transport.publicCheckoutProoflessRendererArmed(attempt.request, attempt.permit, plan(attempt.key))).rejects.toMatchObject({ code: 'PREPARED_SECURITY_CONTEXT_REQUIRED', dispatched: false });
    // The dispatcher-level gate: 60 s before release is far outside a 40 ms arm lead.
    const renderer: RendererTransport = { publicCheckoutProoflessRendererArmed: async () => { throw Error('must not be called'); }, disarmRendererCheckout: async () => 'NOT_ARMED' };
    await expect(fireArmedAttemptRenderer(attempt, renderer, clock, armed, plan(attempt.key), () => false, 40)).rejects.toMatchObject({ code: 'RENDERER_ARM_WINDOW_MISSED', dispatched: false });
    expect(attempt.state).toBe('refused');
    expect(realm.fetches).toEqual([]);
  });

  it('dispatches calibrated attempts from the page, falls back to the Node path otherwise, and never fires early', async () => {
    const releaseMs = Date.now() + 1_600;
    const clock = TrustedReleaseClock.fromOffset(0, { method: 'test', sampleCount: 5 });
    const armed = await armPrecisionRace(race(3, releaseMs), { customerFor: () => customer, journalRoot: root, releaseMs, now: () => clock.nowMs() });
    const trueOffset = -12_345.6; // node = renderer + trueOffset
    const fired: Array<{ worker: string; nodeAt: number; path: string }> = [];
    const node: DirectTransport = { publicCheckoutProofless: async (request, permit, options) => {
      consumeSubmissionPermit(permit, armCheckoutRequest(request as ProoflessCheckoutRequest).key); options?.beforePost?.();
      fired.push({ worker: 'node', nodeAt: performance.now(), path: 'node' });
      return Promise.reject(new BrowserSessionTransportError('ONDA_HTTP_STATUS_INVALID', true, { status: 409, category: 'http-rejection', contentKind: 'json', responseSource: 'application', errorHint: 'availability' }, true));
    } };
    const renderer = (worker: string): RendererTransport => ({ disarmRendererCheckout: async () => 'NOT_ARMED',
      publicCheckoutProoflessRendererArmed: async (request, permit, firePlan, options) => {
        consumeSubmissionPermit(permit, firePlan.key); options?.beforeArm?.();
        // The simulated page fires exactly at its planned renderer time, i.e. at node time fireAt + trueOffset.
        const nodeAt = firePlan.fireAtRendererMs + trueOffset;
        await new Promise(done => setTimeout(done, Math.max(0, nodeAt - performance.now())));
        while (performance.now() < nodeAt) { /* the page's final spin */ }
        fired.push({ worker, nodeAt: performance.now(), path: 'renderer' });
        return Promise.reject(new BrowserSessionTransportError('ONDA_HTTP_STATUS_INVALID', true, { status: 409, category: 'http-rejection', contentKind: 'json', responseSource: 'application', errorHint: 'availability' }, true));
      } });
    const calibrationFor = (): RendererClockCalibration => {
      const at = performance.now();
      return calibrateRendererClock([{ nodeBefore: at - 0.3, renderer: at - trueOffset, nodeAfter: at + 0.3 }]);
    };
    const plans: string[] = [];
    const outcome = await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 1_400, prewarm: async () => undefined, isAborted: () => false,
      transportFor: () => node,
      rendererDispatch: { pageUrl: ONDA_URL, calibrate: async attempt => {
        if (attempt.target.workerId === 'B') return new Promise<RendererClockCalibration>(() => undefined); // a stuck page never answers
        if (attempt.target.workerId === 'C') throw Error('RENDERER_CLOCK_SAMPLING_FAILED');
        return calibrationFor(); },
        transportFor: worker => renderer(worker), onPlan: event => plans.push(`${event.workerId}:${event.mode}${event.code ? `:${event.code}` : ''}`) } });
    expect(outcome.results.map(result => result.state)).toEqual(['REJECTED', 'REJECTED', 'REJECTED']);
    expect(plans.sort()).toEqual(['A:renderer', 'B:node-fallback:RENDERER_CALIBRATION_TIMEOUT', 'C:node-fallback:RENDERER_CLOCK_SAMPLING_FAILED']);
    expect(fired.map(value => value.path).sort()).toEqual(['node', 'node', 'renderer']);
    const releaseMono = clock.monotonicDeadline(releaseMs);
    for (const shot of fired) expect(shot.nodeAt).toBeGreaterThanOrEqual(releaseMono);
    for (const attempt of armed.attempts) expect((await attempt.journal.read(attempt.key)).state).toBe('rejected');
  });
});

describe('real Chromium: renderer-armed checkout never leaves the page before release (no network)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] }); });
  afterAll(async () => { await browser?.close(); });

  it('fires from the page, after the trusted release, exactly once on every run', async () => {
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    const root = await mkdtemp(join(tmpdir(), 'renderer-real-'));
    // Fallbacks a busy machine can cause (slow CDP round trips, a starved event loop). They are safe by design (the
    // Node path sends instead), but this test is about the page path, so such a run is retried; any other reason fails.
    const loadCodes = new Set(['RENDERER_CALIBRATION_TIMEOUT', 'RENDERER_CLOCK_UNCERTAIN', 'RENDERER_ARM_TOO_LATE']);
    try {
      const page = await browser.newPage();
      const seen: number[] = [];
      await page.route('https://app.onda.fit/**', async route => {
        const request = route.request();
        if (request.method() === 'POST') { seen.push(performance.now()); await route.fulfill({ status: 409, contentType: 'application/json', body: '{"success":false,"error":"offline"}' }); return; }
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>offline</title>' });
      });
      await page.goto(ONDA_URL);
      const clock = TrustedReleaseClock.fromOffset(0, { method: 'test', sampleCount: 5 });
      const lateness: number[] = [];
      for (let run = 0; run < 5; run++) {
        let modes: string[] = [];
        for (let attempt = 0; attempt < 3; attempt++) {
          // Enough lead for calibration (T-3 s … T-1 s) even on a loaded CI runner.
          const releaseMs = Date.now() + 3_000;
          const targets = validatePrecisionTargets([{ court: run + 1, start: '17:00', durationHours: 3 }], date);
          const frozen = freezePrecisionRace(date, releaseMs, targets.map(target => ({ target, plan: precisionTargetPlan(target, date) })));
          const armed = await armPrecisionRace(frozen, { customerFor: () => customer, journalRoot: join(root, `${run}-${attempt}`), releaseMs, now: () => clock.nowMs() });
          const transport = new OndaBrowserSessionTransport(page, async () => ({ turnstileToken: 'synthetic-token', publicFingerprint: 'synthetic-fingerprint' }));
          const before = seen.length;
          modes = [];
          // How tight a page clock calibrates depends on machine load (CDP round trips). Production refuses anything looser
          // than 2 ms and falls back to the Node path; this test allows up to 20 ms so the page path is exercised on busy CI
          // runners too. A looser bound only makes the page fire later (up to 2 x uncertainty), never earlier.
          const outcome = await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 2_600, prewarm: async () => transport.prepareCheckoutContext(), isAborted: () => false,
            transportFor: () => transport, rendererDispatch: { pageUrl: ONDA_URL, transportFor: () => transport, options: { maxCalibrationUncertaintyMs: 20 },
              calibrate: async () => calibrateRendererClockAdaptive(page, { targetUncertaintyMs: 1.5, maxSamples: 32 }),
              onPlan: event => modes.push(event.mode === 'renderer' ? 'renderer' : `${event.code ?? '?'}`) } });
          // Whatever path sent it: exactly one POST, answered, never before the trusted release.
          expect(outcome.results[0]!.state).toBe('REJECTED');
          expect(seen.length).toBe(before + 1);
          const arrival = seen.at(-1)! - clock.monotonicDeadline(releaseMs);
          expect(arrival).toBeGreaterThanOrEqual(0);
          if (modes[0] === 'renderer') { lateness.push(arrival); break; }
          expect(loadCodes.has(modes[0] ?? ''), `unexpected fallback ${modes.join(',')}`).toBe(true);
        }
        expect(modes).toEqual(['renderer']); // the page fired it, not the Node fallback
      }
      // Sanity bound only: never early is the property; how late depends on the machine.
      expect(Math.max(...lateness)).toBeLessThan(250);
    } finally { delete process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT; await rm(root, { recursive: true, force: true }); }
  }, 120_000);
});

it('strict Shotgun renderer refuses an 80 ms stalled wake without calling fetch',async()=>{
  const realm=pageRealm({start:1090,step:0.1});
  const outcome=await realm.armed(args(1010,{notAfterRendererMs:1060,missedCode:'SHOTGUN_TRIGGER_MISSED'}));
  expect(outcome.refused).toBe('SHOTGUN_TRIGGER_MISSED');expect(realm.fetches).toHaveLength(0);
});
