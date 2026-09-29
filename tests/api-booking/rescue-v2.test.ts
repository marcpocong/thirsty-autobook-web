import type { Page } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { predictionError, predictReopenings, rescuePrewarmDue, RESCUE_CONTEXT_REUSE_MS, RESCUE_PREWARM_LEAD_MS, type CandidateRange } from '../../src/api-booking/reopen-prediction.js';
import { adaptiveFitness, authorizePrecision, precisionCandidateId, PrecisionSession, type CandidateInput } from '../../src/api-booking/precision-phase3.js';
import { OndaBrowserSessionTransport } from '../../src/api-booking/browser-session-transport.js';
import { MATRIX_COURTS, MATRIX_HOURS } from '../../src/api-booking/court-hour-matrix.js';
import type { AvailabilityObservation } from '../../src/slot-evidence.js';

const date = '2026-10-01', releaseMs = Date.parse('2026-09-29T00:00:00.000Z');
/** One availability read: every cell open unless listed; MISS/age 0 (origin-fresh) unless a cache is given. */
function read(seq: number, requestOffsetMs: number, unavailable: string[] = [], options: { responseOffsetMs?: number; cache?: { status: string; ageS: number } } = {}): AvailabilityObservation {
  const matrix = MATRIX_COURTS.map(court => `${court}:${MATRIX_HOURS.map(hour => unavailable.includes(`${court}/${hour}`) ? 'X' : 'O').join('')}`).join(',');
  return { seq, scheduledOffsetMs: requestOffsetMs, requestOffsetMs, responseOffsetMs: options.responseOffsetMs ?? requestOffsetMs + 300, outcome: 'ok',
    targetDatePresent: requestOffsetMs >= 0, matrix, prices: MATRIX_COURTS.map(() => MATRIX_HOURS.map(hour => Number(hour.slice(0, 2)) >= 16 ? 700 : 600)),
    cache: options.cache ?? { status: 'MISS', ageS: 0 } };
}
const c7: CandidateRange = { id: 'c7-19', court: 7, start: '19:00', durationHours: 3 };
const HOLD = 600_000;

describe('reopen prediction (hold-expiry pattern)', () => {
  it('predicts a window ten minutes after the latest open → unavailable bracket, never before release', () => {
    const reads = [read(1, -2_000), read(2, 2_000), read(3, 5_000, ['7/20:00'])];
    const [prediction] = predictReopenings([c7], reads);
    expect(prediction).toMatchObject({ candidateId: 'c7-19', confidence: 'HOLD_EXPIRY_PATTERN', epochSeq: 3,
      windowStartMs: 2_300 + HOLD - 2_000, windowEndMs: 5_300 + HOLD + 2_000 });
    expect(predictionError(prediction!, 604_000)).toEqual({ errorMs: 604_000 - prediction!.centerMs, insideWindow: true });
  });
  it('a multi-hour candidate reopens only when every hour expired (the latest window wins)', () => {
    const reads = [read(1, 2_000), read(2, 5_000, ['7/20:00']), read(3, 40_000, ['7/20:00', '7/21:00'])];
    const [prediction] = predictReopenings([c7], reads);
    expect(prediction!.windowStartMs).toBe(5_300 + HOLD - 2_000);
    expect(prediction!.windowEndMs).toBe(40_300 + HOLD + 2_000);
  });
  it('after a reopening and a new hold, the NEW hold dates the next window', () => {
    const reads = [read(1, 2_000), read(2, 5_000, ['7/20:00']), read(3, 606_000), read(4, 630_000, ['7/20:00'])];
    const [prediction] = predictReopenings([c7], reads);
    expect(prediction).toMatchObject({ windowStartMs: 606_300 + HOLD - 2_000, epochSeq: 4 });
  });
  it('an hour unavailable from its first published read gives only a LOW-confidence window', () => {
    const [prediction] = predictReopenings([c7], [read(1, 2_000, ['7/19:00']), read(2, 9_000, ['7/19:00'])]);
    expect(prediction).toMatchObject({ confidence: 'LOW', windowStartMs: HOLD - 2_000, windowEndMs: 9_300 + HOLD + 2_000 });
  });
  it('a staler cached read never creates or moves a transition', () => {
    // #3 answers later but represents an older state (STALE, Age 10 s): it must not look like an open → unavailable change.
    const reads = [read(1, 2_000), read(2, 5_000), read(3, 5_500, ['7/19:00'], { responseOffsetMs: 6_000, cache: { status: 'STALE', ageS: 10 } })];
    expect(predictReopenings([c7], reads)).toEqual([]);
  });
  it('predicts nothing for an open candidate or before release', () => {
    expect(predictReopenings([c7], [read(1, 2_000), read(2, 5_000)])).toEqual([]);
    expect(predictReopenings([c7], [read(1, -5_000, ['7/19:00'])])).toEqual([]);
  });
  it('prewarm timing: from the lead before the window until shortly after it, refreshing only a stale context', () => {
    const prediction = { candidateId: 'x', windowStartMs: 600_000, windowEndMs: 610_000, centerMs: 605_000, confidence: 'HOLD_EXPIRY_PATTERN' as const, epochSeq: 1 };
    expect(rescuePrewarmDue(prediction, 600_000 - RESCUE_PREWARM_LEAD_MS - 1, undefined)).toBe(false);
    expect(rescuePrewarmDue(prediction, 600_000 - RESCUE_PREWARM_LEAD_MS, undefined)).toBe(true);
    expect(rescuePrewarmDue(prediction, 590_000, 10_000)).toBe(false);
    expect(rescuePrewarmDue(prediction, 590_000, 55_000)).toBe(true);
    expect(rescuePrewarmDue(prediction, 640_001, undefined)).toBe(false);
  });
});

const rate = (hours: number) => ({ source: 'venue schedule', capturedAt: '2026-09-28T00:00:00.000Z', status: 'VENUE_SCHEDULE' as const, date,
  perHour: Array(hours).fill(700), actionable: true });
const candidate = (court: number, start: string, priority: number): CandidateInput => ({ court, start, durationHours: 3, priority,
  permissions: { wave1: priority === 1, wave2: priority !== 1, rescue: true }, rateEvidence: rate(3) });
function session() {
  const candidates = [candidate(7, '19:00', 1), candidate(6, '20:00', 2)];
  const authorization = authorizePrecision({ date, releaseMs, candidates, standby: ['E'], concurrentWave2: false, rescueEnabled: true, authorizedAt: '2026-09-28T00:00:00.000Z',
    wave1: [{ workerId: 'A', candidateId: precisionCandidateId(date, candidates[0]!) }],
    budgets: { wave2: 1, rescue: 2, total: 4 } });
  return new PrecisionSession(authorization);
}
const observe = (value: PrecisionSession, observation: AvailabilityObservation, atMs = observation.responseOffsetMs + 50) =>
  value.observe(adaptiveFitness(observation, observation.seq, releaseMs, releaseMs + atMs, 2_500));

describe('Rescue V2 selection rules', () => {
  it('reaching a predicted expiry never selects Rescue without a fresh unavailable → open observation', () => {
    const value = session();
    value.record({ id: 'wave1-A', candidateId: value.authorization.candidates[0]!.id, workerId: 'A', wave: 'WAVE_1', state: 'REJECTED' });
    observe(value, read(1, 2_000));
    observe(value, read(2, 5_000, ['7/20:00', '6/21:00']));
    // The predicted window has arrived, but every fresh read still shows the slots unavailable: nothing is selected.
    observe(value, read(3, 604_000, ['7/20:00', '6/21:00']));
    expect(value.select('RESCUE', releaseMs + 604_400, 6_000)).toEqual([]);
    // A genuinely fresh reopening is required.
    observe(value, read(4, 606_000, ['6/21:00']));
    const [choice] = value.select('RESCUE', releaseMs + 606_400, 6_000);
    expect(choice).toMatchObject({ candidate: { court: 7, start: '19:00' }, reopenEpoch: 2 });
  });
  it('reuses a worker after a conclusive rejection and prefers a worker with a prepared context', () => {
    const value = session();
    value.record({ id: 'wave1-A', candidateId: value.authorization.candidates[0]!.id, workerId: 'A', wave: 'WAVE_1', state: 'REJECTED' });
    expect(value.adaptiveWorkers('RESCUE')).toEqual(['E', 'A']);
    expect(value.adaptiveWorkers('RESCUE', worker => worker === 'A' ? 0 : 1)).toEqual(['A', 'E']);
    observe(value, read(1, 2_000)); observe(value, read(2, 5_000, ['7/20:00'])); observe(value, read(3, 606_000));
    expect(value.select('RESCUE', releaseMs + 606_400, 6_000, { workerRank: worker => worker === 'A' ? 0 : 1 })[0]!.workerId).toBe('A');
  });
  it('never reuses anything after an UNKNOWN, and never races an in-flight attempt', () => {
    const unknown = session();
    unknown.record({ id: 'wave1-A', candidateId: unknown.authorization.candidates[0]!.id, workerId: 'A', wave: 'WAVE_1', state: 'UNKNOWN' });
    observe(unknown, read(1, 2_000)); observe(unknown, read(2, 5_000, ['7/20:00'])); observe(unknown, read(3, 606_000));
    expect(unknown.select('RESCUE', releaseMs + 606_400, 6_000)).toEqual([]);
    expect(unknown.adaptiveBlocker('RESCUE')).toBe('UNKNOWN_ATTEMPT_EXISTS');
    const inFlight = session();
    inFlight.record({ id: 'wave1-A', candidateId: inFlight.authorization.candidates[0]!.id, workerId: 'A', wave: 'WAVE_1', state: 'IN_FLIGHT' });
    expect(inFlight.adaptiveWorkers('RESCUE')).toEqual(['E']);
    expect(inFlight.adaptiveBlocker('RESCUE')).toBe('CONCURRENT_ATTEMPT_IN_FLIGHT');
  });
});

describe('prepared-context reuse for adaptive attempts', () => {
  afterEach(() => { vi.useRealTimers(); delete process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT; });
  it('reuses an unused context up to the adaptive limit and re-acquires beyond it; the default stays 20 s', async () => {
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-29T00:10:00.000Z'));
    let acquisitions = 0;
    const page = { isClosed: () => false, url: () => 'https://app.onda.fit/book/thirsty-pickle', on: () => undefined, off: () => undefined,
      locator: () => ({ count: async () => 0 }) } as unknown as Page;
    const transport = new OndaBrowserSessionTransport(page, async () => { acquisitions++; return { turnstileToken: `token-${acquisitions}`, publicFingerprint: 'print' }; });
    await transport.prepareCheckoutContext(true);
    vi.setSystemTime(Date.now() + 40_000);
    await transport.prepareCheckoutContext(false);
    expect(acquisitions).toBe(2);
    vi.setSystemTime(Date.now() + 40_000);
    await transport.prepareCheckoutContext(false, RESCUE_CONTEXT_REUSE_MS);
    expect(acquisitions).toBe(2);
    vi.setSystemTime(Date.now() + RESCUE_CONTEXT_REUSE_MS + 1);
    await transport.prepareCheckoutContext(false, RESCUE_CONTEXT_REUSE_MS);
    expect(acquisitions).toBe(3);
  });
});
