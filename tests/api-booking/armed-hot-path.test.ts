import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Every file-system, hashing and request-building call made while `active` is recorded.
const recorder = vi.hoisted(() => ({ active: false, events: [] as string[] }));
const record = (event: string) => { if (recorder.active) recorder.events.push(event); };
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const wrapped: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(actual))
    wrapped[name] = typeof value === 'function' ? (...args: unknown[]) => { record(`fs:${name}`); return (value as (...a: unknown[]) => unknown)(...args); } : value;
  wrapped.open = async (...args: Parameters<typeof actual.open>) => {
    record('fs:open');
    const handle = await actual.open(...args);
    return new Proxy(handle, { get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? (...inner: unknown[]) => { record(`fs:handle.${String(property)}`); return value.apply(target, inner); } : value;
    } });
  };
  return { ...wrapped, default: wrapped };
});
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const wrapped: Record<string, unknown> = { ...actual };
  for (const name of ['writeSync', 'writeFileSync', 'appendFileSync', 'openSync', 'fsyncSync', 'renameSync', 'mkdirSync', 'linkSync', 'readFileSync'] as const)
    wrapped[name] = (...args: unknown[]) => { record(`fs:${name}`); return (actual[name] as (...a: unknown[]) => unknown)(...args); };
  return { ...wrapped, default: wrapped };
});
vi.mock('node:crypto', async importOriginal => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  const createHash = (...args: Parameters<typeof actual.createHash>) => { record('crypto:createHash'); return actual.createHash(...args); };
  return { ...actual, createHash, default: { ...actual, createHash } };
});
vi.mock('../../src/api-booking/proofless-checkout.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/api-booking/proofless-checkout.js')>();
  return { ...actual,
    prooflessRequest: (...args: Parameters<typeof actual.prooflessRequest>) => { record('build:prooflessRequest'); return actual.prooflessRequest(...args); },
    prooflessPlanFingerprint: (...args: Parameters<typeof actual.prooflessPlanFingerprint>) => { record('build:fingerprint'); return actual.prooflessPlanFingerprint(...args); } };
});

const { armPrecisionRace, dispatchArmedPrecisionRace } = await import('../../src/api-booking/armed-dispatch.js');
const { OndaBrowserSessionTransport, armCheckoutRequest } = await import('../../src/api-booking/browser-session-transport.js');
const { freezePrecisionRace, precisionTargetPlan, validatePrecisionTargets } = await import('../../src/api-booking/precision-race.js');
const { prooflessRequest } = await import('../../src/api-booking/proofless-checkout.js');
const { TrustedReleaseClock } = await import('../../src/release-clock.js');
const { ProviderTraceSet, CHECKOUT_TRACE_URL } = await import('../../src/api-booking/checkout-provider-trace.js');

const date = '2026-09-26';
const customer = { clientId: '00000000-0000-4000-8000-00000000c11e', customerId: '00000000-0000-4000-8000-000000000b00',
  customerEmail: 'fixture@example.invalid', customerPhone: '09123456789', customerFirstName: 'Fixture', customerLastName: 'Player' };
let root: string, previous: string | undefined;
beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'armed-hot-path-')); previous = process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT; process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT'; });
afterAll(async () => {
  if (previous === undefined) delete process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT; else process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw Error('UNSAFE_TEST_PATH');
  await rm(root, { recursive: true, force: true });
});

/** A Playwright page stand-in: records each checkout evaluate() and answers with a confirmed 409. */
function fakePage(worker: string, sent: Array<{ worker: string; args: { payload: unknown; text?: string } }>, expected: number, onPost?: () => void) {
  return { isClosed: () => false, url: () => 'https://app.onda.fit/book/thirsty-pickle', on: () => undefined, off: () => undefined,
    mainFrame: () => undefined, locator: () => ({ count: async () => 0 }),
    evaluate: async (_fn: unknown, args: { payload: unknown; text?: string }) => {
      onPost?.();
      record(`POST:${worker}`);
      sent.push({ worker, args });
      if (sent.length === expected) recorder.active = false;
      return { status: 409, contentType: 'application/json', server: '', cloudflareRay: '', cfMitigated: '', body: JSON.stringify({ success: false, error: 'Synthetic conflict' }) };
    } } as unknown as Page;
}

describe('armed release hot path (T-0 to POST)', () => {
  it.each([1, 3, 7])('%i worker(s): no file I/O, fsync, rename, readback, hashing or request building between release and the POSTs', async count => {
    const releaseMs = Date.now() + 1_500;
    const targets = validatePrecisionTargets([1, 2, 3, 4, 5, 6, 7].slice(0, count).map(court => ({ court, start: '17:00', durationHours: 3 })), date);
    const race = freezePrecisionRace(date, releaseMs, targets.map(target => ({ target, plan: precisionTargetPlan(target, date) })));
    const clock = TrustedReleaseClock.fromOffset(0, { method: 'test', sampleCount: 5 });
    const journalRoot = join(root, `run-${count}`);
    const armed = await armPrecisionRace(race, { customerFor: () => customer, journalRoot, releaseMs, now: () => clock.nowMs() });
    const sent: Array<{ worker: string; args: { payload: unknown; text?: string } }> = [];
    const transports = new Map(targets.map(target => [target.workerId, new OndaBrowserSessionTransport(fakePage(target.workerId, sent, count),
      async () => ({ turnstileToken: 'synthetic-token', publicFingerprint: 'synthetic-print' }), async () => undefined)]));
    recorder.events = [];
    const outcome = await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 250, spinTailMs: 20, isAborted: () => false,
      prewarm: attempt => transports.get(attempt.target.workerId)!.prepareCheckoutContext(),
      transportFor: worker => transports.get(worker),
      onWake: () => { recorder.active = true; recorder.events.push('WAKE'); } });
    recorder.active = false;
    const window = recorder.events.slice(recorder.events.indexOf('WAKE'));
    expect(window.filter(event => event.startsWith('POST:'))).toHaveLength(count);
    expect(window.filter(event => event !== 'WAKE' && !event.startsWith('POST:'))).toEqual([]);
    // Each POST carries the body serialized before release for exactly its frozen request.
    for (const value of sent) {
      const attempt = armed.attempts.find(item => item.target.workerId === value.worker)!;
      expect(value.args.payload).toBeNull();
      expect(value.args.text).toBe(JSON.stringify(attempt.request));
    }
    expect(outcome.results.map(result => result.state)).toEqual(Array(count).fill('REJECTED'));
  });

  it('with the passive provider trace attached (Phase 2), still nothing but the POSTs between release and the last POST', async () => {
    const count = 7, releaseMs = Date.now() + 1_500;
    const targets = validatePrecisionTargets([1, 2, 3, 4, 5, 6, 7].map(court => ({ court, start: '17:00', durationHours: 3 })), date);
    const race = freezePrecisionRace(date, releaseMs, targets.map(target => ({ target, plan: precisionTargetPlan(target, date) })));
    const clock = TrustedReleaseClock.fromOffset(0, { method: 'test', sampleCount: 5 });
    const armed = await armPrecisionRace(race, { customerFor: () => customer, journalRoot: join(root, 'run-traced'), releaseMs, now: () => clock.nowMs() });
    // Sessions attach before release with nothing enabled; each POST signals its worker's trace (as the runner's
    // request-event hook does), and the enable itself runs on a later macrotask.
    const traces = new ProviderTraceSet('hot-path', 'release', releaseMs, () => clock.nowMs() - releaseMs);
    const emitters = new Map<string, (event: string, params: unknown) => void>(), order: string[] = [];
    for (const target of targets) traces.start({ workerId: target.workerId, court: target.court, startTime: target.start, endTime: target.end }, async () => {
      const listeners = new Map<string, (params: unknown) => void>();
      emitters.set(target.workerId, (event, params) => listeners.get(event)?.(params));
      return { on: (event: string, listener: (params: unknown) => void) => { listeners.set(event, listener); },
        send: async (method: string) => { order.push(`${method}:${target.workerId}`); return {}; } };
    });
    await traces.ready(1_000);
    const sent: Array<{ worker: string; args: { payload: unknown; text?: string } }> = [];
    const transports = new Map(targets.map(target => [target.workerId, new OndaBrowserSessionTransport(fakePage(target.workerId, sent, count, () => {
      order.push(`POST:${target.workerId}`);
      traces.postInitiated(target.workerId);
      // A response arriving before the enable is ignored (Chrome would not send it to a disabled session).
      emitters.get(target.workerId)!('Network.responseReceived', { requestId: 'early', response: { url: CHECKOUT_TRACE_URL, status: 409, headers: {} } });
    }), async () => ({ turnstileToken: 'synthetic-token', publicFingerprint: 'synthetic-print' }), async () => undefined)]));
    recorder.events = [];
    const outcome = await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 250, spinTailMs: 20, isAborted: () => false,
      prewarm: attempt => transports.get(attempt.target.workerId)!.prepareCheckoutContext(), transportFor: worker => transports.get(worker),
      onWake: () => { recorder.active = true; recorder.events.push('WAKE'); } });
    recorder.active = false;
    const window = recorder.events.slice(recorder.events.indexOf('WAKE'));
    expect(window.filter(event => event.startsWith('POST:'))).toHaveLength(count);
    expect(window.filter(event => event !== 'WAKE' && !event.startsWith('POST:'))).toEqual([]);
    expect(outcome.results.map(result => result.state)).toEqual(Array(count).fill('REJECTED'));
    // Every worker's Network.enable came after its own POST.
    for (const target of targets) expect(order.indexOf(`Network.enable:${target.workerId}`)).toBeGreaterThan(order.indexOf(`POST:${target.workerId}`));
    expect(order.filter(entry => entry.startsWith('Network.enable'))).toHaveLength(count);
    // Responses that arrive after enabling are traced.
    for (const target of targets) {
      const emit = emitters.get(target.workerId)!;
      emit('Network.responseReceived', { requestId: `r-${target.workerId}`, response: { url: CHECKOUT_TRACE_URL, status: 409, protocol: 'h2', connectionReused: true, headers: { server: 'Vercel' }, timing: { requestTime: 1, receiveHeadersStart: 17_000 } } });
      emit('Network.loadingFinished', { requestId: `r-${target.workerId}`, timestamp: 18.1 });
    }
    // Written only now, after every attempt settled.
    const path = await traces.persist(join(root, 'traced-forensics'));
    expect(path).toBeTypeOf('string');
    expect(traces.records().filter(value => value.complete)).toHaveLength(count);
  });

  it('arming refuses a mutable request; an unarmed request still serializes in the page (General path unchanged)', async () => {
    const target = validatePrecisionTargets([{ court: 1, start: '17:00', durationHours: 3 }], date)[0]!;
    const request = prooflessRequest(precisionTargetPlan(target, date), customer);
    expect(() => armCheckoutRequest(request)).toThrow('ARMED_REQUEST_NOT_FROZEN');
    const sent: Array<{ worker: string; args: { payload: unknown; text?: string } }> = [];
    const transport = new OndaBrowserSessionTransport(fakePage('A', sent, 1), async () => ({ turnstileToken: 'synthetic-token', publicFingerprint: 'synthetic-print' }));
    const { DurableSubmissionJournal } = await import('../../src/api-booking/durable-submission-journal.js');
    const journal = new DurableSubmissionJournal(join(root, 'unarmed', target.targetKey));
    await journal.begin(target.targetKey, new Date(), { attemptId: target.targetKey, planFingerprint: target.targetKey, targetDate: date, courtIds: [1],
      hourlyBoundaries: [], expectedBookingCount: 3, maximumAmount: 2100, stage: 'dispatching' });
    const permit = await journal.claimSupervisedOneShot(target.targetKey);
    await expect(transport.publicCheckoutProofless(request, permit)).rejects.toThrow('ONDA_HTTP_STATUS_INVALID');
    expect(sent[0]!.args.payload).toEqual(request);
    expect(sent[0]!.args.text).toBeUndefined();
  });
});
