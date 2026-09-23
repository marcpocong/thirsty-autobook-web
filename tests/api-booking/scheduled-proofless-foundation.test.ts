import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAvailability } from '../../src/api-booking/availability-parser.js';
import { courtHourStates, targetDateState, UNRELEASED_OBSERVATION_MARGIN_MS } from '../../src/api-booking/court-hour-matrix.js';
import { prooflessCourtHourStatuses, prooflessReleasePlan, prooflessRequest, resolveProoflessReleasePlan, submitDirectCheckout } from '../../src/api-booking/proofless-checkout.js';
import { classifyTargetEvidence, mergeBookingReads, readPreReleaseEvidence } from '../../src/api-booking/pre-release-evidence.js';
import { OndaBrowserSessionTransport } from '../../src/api-booking/browser-session-transport.js';
import { DurableSubmissionJournal } from '../../src/api-booking/durable-submission-journal.js';
import { SubmissionDispatchError } from '../../src/api-booking/submission-errors.js';
import { isOndaUnreleasedEmptyResponse } from '../../src/onda-unreleased.js';
import { availabilityFixture } from '../availability-fixture.js';
import { UiEventSchema } from '../../src/ui-events.js';
import { releaseMsForTargetDate } from '../../src/config.js';
import { networkClockFresh, NETWORK_CLOCK_MAX_AGE_MS } from '../../src/network-clock.js';

const date = '2026-09-26';
const releaseMs = Date.parse('2026-09-24T00:00:00.000Z'); // 08:00 Manila, two days before the target
/** Onda's actual not-yet-published response: the date is absent, not flagged false. */
const UNRELEASED_RAW = { success: true, data: { dates: {}, slotsBySpace: {} } };
const parse = (raw: unknown, capturedAt = '2026-09-23T23:30:00.000Z') => parseAvailability(raw, { startDate: date, endDate: date,
  capturedAt, fixtureKind: 'live', label: 'test', now: new Date(capturedAt), maximumAgeMs: 15_000, requireCompleteRange: false });
const before = releaseMs - 30 * 60_000, after = releaseMs + 5_000;
const preferences = (courtCount: 1 | 2 | 3 = 1) => ({ mode: 'standard' as const, targetDate: date, durationHours: 3, preferredStartTimes: ['17:00'],
  fallbackStartTimes: [], courtPriority: [7, 5, 3], fallbackCourts: [], courtCount, maximumTotalPrice: Infinity, currency: 'PHP' as const });

describe('scheduled Proofless: unreleased-date classification', () => {
  it('recognizes only the exact empty unreleased shape, shared with the browser path', () => {
    expect(isOndaUnreleasedEmptyResponse(UNRELEASED_RAW)).toBe(true);
    expect(isOndaUnreleasedEmptyResponse({ success: true, data: { dates: {}, slotsBySpace: { x: [] } } })).toBe(false);
    expect(isOndaUnreleasedEmptyResponse({ success: false, data: { dates: {}, slotsBySpace: {} } })).toBe(false);
    expect(isOndaUnreleasedEmptyResponse(null)).toBe(false);
    const snapshot = parse(UNRELEASED_RAW);
    expect(snapshot.returnedDates[date]).toBeUndefined();
    expect(snapshot.emptyUnreleasedResponse).toBe(true);
  });

  it('dates:{} before release -> UNRELEASED with no booking record -> target stays eligible', () => {
    const snapshot = parse(UNRELEASED_RAW);
    expect(targetDateState(snapshot, date, { releaseMs, observedAtMs: before })).toBe('UNRELEASED');
    const cells = prooflessCourtHourStatuses(snapshot, date, [], [], { releaseMs, observedAtMs: before });
    expect(new Set(cells.map(cell => `${cell.status}/${cell.source}`))).toEqual(new Set(['UNRELEASED/DATE_UNRELEASED']));
    const plan = resolveProoflessReleasePlan(preferences(), snapshot, [], [], { releaseMs, observedAtMs: before });
    expect(plan.courts.map(court => court.court)).toEqual([7]);
    expect(courtHourStates(snapshot, date, { releaseMs, observedAtMs: before })[7]!['17:00']).toBe('UNRELEASED');
  });

  it('same unreleased response + a public booking record -> BLOCKED, and the resolver skips that court', () => {
    const snapshot = parse(UNRELEASED_RAW), blocks = [{ court: 7, startTime: '18:00', endTime: '19:00' }];
    const cells = prooflessCourtHourStatuses(snapshot, date, blocks, [], { releaseMs, observedAtMs: before });
    expect(cells.find(cell => cell.court === 7 && cell.hour === '18:00')).toMatchObject({ status: 'BLOCKED', source: 'PUBLIC_BOOKING' });
    expect(resolveProoflessReleasePlan(preferences(), snapshot, blocks, [], { releaseMs, observedAtMs: before }).courts[0]!.court).toBe(5);
  });

  it('public-booking query failure -> UNKNOWN and that target is rejected', () => {
    const snapshot = parse(UNRELEASED_RAW);
    const cells = prooflessCourtHourStatuses(snapshot, date, [], [7], { releaseMs, observedAtMs: before });
    expect(cells.find(cell => cell.court === 7)).toMatchObject({ status: 'UNKNOWN', source: 'PUBLIC_BOOKING_QUERY_FAILED' });
    expect(resolveProoflessReleasePlan(preferences(), snapshot, [], [7], { releaseMs, observedAtMs: before }).courts[0]!.court).toBe(5);
    expect(() => resolveProoflessReleasePlan({ ...preferences(), courtPriority: [7] }, snapshot, [], [7], { releaseMs, observedAtMs: before }))
      .toThrow('DIRECT_NO_UNBLOCKED_CONFIGURATION');
  });

  it('availability request failure -> UNKNOWN (never unreleased) and every target is rejected', () => {
    const cells = prooflessCourtHourStatuses(undefined, date, [], [], { releaseMs, observedAtMs: before });
    expect(new Set(cells.map(cell => `${cell.status}/${cell.source}`))).toEqual(new Set(['UNKNOWN/AVAILABILITY_READ_FAILED']));
    expect(() => resolveProoflessReleasePlan(preferences(), undefined, [], [], { releaseMs, observedAtMs: before }))
      .toThrow('DIRECT_NO_UNBLOCKED_CONFIGURATION');
  });

  it('target date absent unexpectedly after release -> UNKNOWN, not unreleased', () => {
    const snapshot = parse(UNRELEASED_RAW, '2026-09-24T00:00:05.000Z');
    expect(targetDateState(snapshot, date, { releaseMs, observedAtMs: after })).toBe('UNKNOWN');
    expect(targetDateState(snapshot, date, { releaseMs, observedAtMs: releaseMs - UNRELEASED_OBSERVATION_MARGIN_MS + 1 })).toBe('UNKNOWN');
    expect(() => resolveProoflessReleasePlan(preferences(), snapshot, [], [], { releaseMs, observedAtMs: after })).toThrow('DIRECT_NO_UNBLOCKED_CONFIGURATION');
  });

  it('without a known release instant a missing date stays UNKNOWN (fail closed)', () => {
    const snapshot = parse(UNRELEASED_RAW);
    expect(targetDateState(snapshot, date)).toBe('UNKNOWN');
    expect(targetDateState(snapshot, date, { releaseMs })).toBe('UNKNOWN');
    expect(prooflessCourtHourStatuses(snapshot, date).every(cell => cell.status === 'UNKNOWN')).toBe(true);
  });

  it('a malformed response is rejected by the parser rather than read as unreleased', () => {
    expect(() => parse({ success: true, data: { dates: [], slotsBySpace: {} } })).toThrow();
    expect(() => parse({ success: false })).toThrow();
  });

  it('a published date is still classified from real slots, unchanged', () => {
    const snapshot = parse(availabilityFixture(date));
    expect(targetDateState(snapshot, date, { releaseMs, observedAtMs: after })).toBe('RELEASED');
    expect(prooflessCourtHourStatuses(snapshot, date, [], [], { releaseMs, observedAtMs: after }).every(cell => cell.source === 'AVAILABILITY')).toBe(true);
  });

  it('computes the release instant that publishes a target date (horizon 2 days, 08:00 Manila)', () => {
    expect(releaseMsForTargetDate({ TIMEZONE: 'Asia/Manila', RELEASE_TIME: '08:00:00', BOOKING_HORIZON_DAYS: 2 }, date)).toBe(releaseMs);
  });

  it('carries the new evidence and timing fields through the UI event schema', () => {
    expect(UiEventSchema.safeParse({ type: 'apiStage', stage: 'PRECISION_TARGET_EVIDENCE', elapsedMs: 1, checkpoint: 'T-30M', workerId: 'A',
      court: 7, startTime: '17:00', endTime: '20:00', evidence: 'NO_PUBLIC_BOOKING_DATE_UNRELEASED', eligible: true }).success).toBe(true);
    expect(UiEventSchema.safeParse({ type: 'blockAudit', date, cells: prooflessCourtHourStatuses(undefined, date) }).success).toBe(true);
  });
});

describe('scheduled Proofless: bounded pre-release reads', () => {
  const base = { date, releaseMs, now: () => before };
  it('retries a failed availability read at most twice with bounded delays, then fails closed', async () => {
    const sleeps: number[] = [];
    const readAvailability = vi.fn(async () => undefined);
    const evidence = await readPreReleaseEvidence({ ...base, readAvailability, readBookings: async () => ({ blocks: [], failedCourts: [] }),
      sleep: async ms => { sleeps.push(ms); } });
    expect(readAvailability).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([5_000, 15_000]);
    expect(evidence.snapshot).toBeUndefined();
    expect(evidence.dateState).toBe('UNKNOWN');
  });
  it('stops retrying at the first success', async () => {
    let calls = 0;
    const evidence = await readPreReleaseEvidence({ ...base, sleep: async () => undefined, readBookings: async () => ({ blocks: [], failedCourts: [] }),
      readAvailability: async () => (++calls === 2 ? parse(UNRELEASED_RAW) : undefined) });
    expect(calls).toBe(2);
    expect(evidence.dateState).toBe('UNRELEASED');
  });
  it('re-reads only while public-booking courts fail and keeps a never-recovered court failed', async () => {
    const reads = [{ blocks: [{ court: 1, startTime: '17:00', endTime: '18:00' }], failedCourts: [3, 5] },
      { blocks: [{ court: 3, startTime: '09:00', endTime: '10:00' }], failedCourts: [5] },
      { blocks: [], failedCourts: [5] }];
    let index = 0;
    const evidence = await readPreReleaseEvidence({ ...base, sleep: async () => undefined, readAvailability: async () => parse(UNRELEASED_RAW),
      readBookings: async () => reads[index++]! });
    expect(index).toBe(3);
    expect(evidence.failedCourts).toEqual([5]);
    expect(evidence.blocks).toEqual([{ court: 1, startTime: '17:00', endTime: '18:00' }, { court: 3, startTime: '09:00', endTime: '10:00' }]);
    expect(mergeBookingReads({ blocks: [], failedCourts: [2] }, { blocks: [], failedCourts: [] }).failedCourts).toEqual([]);
  });
  it('can read once without retries (Test Now display)', async () => {
    const readAvailability = vi.fn(async () => undefined);
    await readPreReleaseEvidence({ ...base, retryDelaysMs: [], sleep: async () => undefined, readAvailability,
      readBookings: async () => ({ blocks: [], failedCourts: [] }) });
    expect(readAvailability).toHaveBeenCalledOnce();
  });
  it('classifies target evidence factually, never as a venue block', () => {
    const unreleased = { snapshot: parse(UNRELEASED_RAW), blocks: [], failedCourts: [], dateState: 'UNRELEASED' as const };
    expect(classifyTargetEvidence({ court: 7, start: '17:00', durationHours: 3 }, unreleased, date)).toMatchObject({ evidence: 'NO_PUBLIC_BOOKING_DATE_UNRELEASED', eligible: true });
    expect(classifyTargetEvidence({ court: 7, start: '17:00', durationHours: 3 }, { ...unreleased, blocks: [{ court: 7, startTime: '19:00', endTime: '20:00' }] }, date))
      .toMatchObject({ evidence: 'PUBLIC_BOOKING_PRESENT', eligible: false });
    expect(classifyTargetEvidence({ court: 7, start: '17:00', durationHours: 3 }, { ...unreleased, failedCourts: [7] }, date)).toMatchObject({ evidence: 'UNKNOWN', eligible: false });
    const released = parse(availabilityFixture(date));
    const takenSlot = released.slots.find(slot => slot.court === 6 && slot.startTime === '17:00')!;
    takenSlot.isAvailable = false;
    const releasedEvidence = { snapshot: released, blocks: [], failedCourts: [], dateState: 'RELEASED' as const };
    expect(classifyTargetEvidence({ court: 6, start: '17:00', durationHours: 1 }, releasedEvidence, date).evidence).toBe('UNAVAILABLE_WITHOUT_PUBLIC_BOOKING');
    expect(classifyTargetEvidence({ court: 6, start: '17:00', durationHours: 1 }, { ...releasedEvidence, blocks: [{ court: 6, startTime: '17:00', endTime: '18:00' }] }, date).evidence)
      .toBe('UNAVAILABLE_WITH_PUBLIC_BOOKING');
    expect(classifyTargetEvidence({ court: 1, start: '10:00', durationHours: 1 }, releasedEvidence, date)).toMatchObject({ evidence: 'CONFIRMED_OPEN', eligible: true });
    expect(classifyTargetEvidence({ court: 1, start: '10:00', durationHours: 1 }, { snapshot: undefined, blocks: [], failedCourts: [], dateState: 'UNKNOWN' }, date).evidence).toBe('UNKNOWN');
  });
});

describe('scheduled Proofless: dispatch window and prepared security context', () => {
  const directories: string[] = [];
  afterEach(async () => { delete process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT; for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
  const customer = { clientId: 'client', customerId: 'customer', customerEmail: 'e@example.invalid', customerPhone: '09123456789', customerFirstName: 'F', customerLastName: 'P' };
  const plan = () => prooflessReleasePlan({ ...preferences(), courtPriority: [7] });
  const fakePage = () => {
    const listeners: Array<(frame: unknown) => void> = [];
    const mainFrame = {};
    const evaluate = vi.fn(async () => ({ status: 409, contentType: 'application/json', server: '', cloudflareRay: '', cfMitigated: '',
      body: JSON.stringify({ success: false, error: 'unavailable' }) }));
    const page = { isClosed: () => false, url: () => 'https://app.onda.fit/book/thirsty-pickle', evaluate, mainFrame: () => mainFrame,
      on: (event: string, listener: (frame: unknown) => void) => { if (event === 'framenavigated') listeners.push(listener); }, off: () => undefined } as unknown as Page;
    return { page, evaluate, navigate: () => listeners.forEach(listener => listener(mainFrame)) };
  };
  const journalFor = async () => { const directory = await mkdtemp(join(tmpdir(), 'window-')); directories.push(directory); return new DurableSubmissionJournal(directory); };
  const headers = async () => ({ turnstileToken: 'genuine-token', publicFingerprint: 'genuine-fp' });

  it('refuses to acquire security inline for a release dispatch and records the attempt as provably unsent', async () => {
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    const { page, evaluate } = fakePage(), acquire = vi.fn(headers);
    const transport = new OndaBrowserSessionTransport(page, acquire), journal = await journalFor();
    const error = await submitDirectCheckout(plan(), customer, transport, journal, releaseMs, [], () => releaseMs + 10, { requirePreparedContext: true }).catch(value => value);
    expect(error).toBeInstanceOf(SubmissionDispatchError);
    expect((error as SubmissionDispatchError).code).toBe('PREPARED_SECURITY_CONTEXT_REQUIRED');
    expect((error as SubmissionDispatchError).dispatched).toBe(false);
    expect(acquire).not.toHaveBeenCalled();
    expect(evaluate).not.toHaveBeenCalled();
    const key = DurableSubmissionJournal.key(prooflessRequest(plan(), customer).facilityId, plan().courts[0]!.spaceId, date, '17:00', '20:00');
    expect((await journal.read(key)).state).toBe('rejected');
  });

  it('context invalidated by navigation near release is not silently reacquired', async () => {
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    const { page, evaluate, navigate } = fakePage();
    const transport = new OndaBrowserSessionTransport(page, headers);
    await transport.prepareCheckoutContext();
    expect(transport.preparedContextAgeMs()).toBeGreaterThanOrEqual(0);
    navigate();
    expect(transport.preparedContextAgeMs()).toBeUndefined();
    await expect(submitDirectCheckout(plan(), customer, transport, await journalFor(), releaseMs, [], () => releaseMs + 10, { requirePreparedContext: true }))
      .rejects.toThrow('PREPARED_SECURITY_CONTEXT_REQUIRED');
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('re-checks the release window as the last step before POST (no late POST after the first check passes)', async () => {
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    const { page, evaluate } = fakePage();
    const transport = new OndaBrowserSessionTransport(page, headers);
    await transport.prepareCheckoutContext();
    let clock = releaseMs + 100;
    const spy = vi.spyOn(transport, 'publicCheckoutProofless').mockImplementation(async (request, permit, options) => {
      clock = releaseMs + 4_000; // e.g. slow work between the first check and the network send
      return OndaBrowserSessionTransport.prototype.publicCheckoutProofless.call(transport, request, permit, options);
    });
    const journal = await journalFor();
    const error = await submitDirectCheckout(plan(), customer, transport, journal, releaseMs, [], () => clock, { requirePreparedContext: true }).catch(value => value);
    expect((error as SubmissionDispatchError).code).toBe('DIRECT_RELEASE_WINDOW_MISSED');
    expect((error as SubmissionDispatchError).dispatched).toBe(false);
    expect(evaluate).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('dispatches with the prepared context inside the window and records a confirmed rejection', async () => {
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    const { page, evaluate } = fakePage(), observations: string[] = [];
    const transport = new OndaBrowserSessionTransport(page, headers, undefined, {}, observation => observations.push(observation.event));
    await transport.prepareCheckoutContext();
    const journal = await journalFor();
    await expect(submitDirectCheckout(plan(), customer, transport, journal, releaseMs, [], () => releaseMs + 20, { requirePreparedContext: true }))
      .rejects.toThrow('ONDA_HTTP_STATUS_INVALID');
    expect(evaluate).toHaveBeenCalledOnce();
    expect(observations).toContain('CHECKOUT_PRE_POST');
    expect(observations.indexOf('CHECKOUT_PRE_POST')).toBeLessThan(observations.indexOf('CHECKOUT_RESPONSE_COMPLETED'));
  });

  it('rejects a stale prepared context (over 120 s) before POST', async () => {
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    const { page, evaluate } = fakePage();
    const transport = new OndaBrowserSessionTransport(page, headers);
    const realNow = Date.now;
    await transport.prepareCheckoutContext();
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 121_000);
    try {
      await expect(submitDirectCheckout(plan(), customer, transport, await journalFor(), undefined, [], realNow, { requirePreparedContext: true }))
        .rejects.toThrow('CURRENT_CHECKOUT_HEADERS_STALE');
    } finally { spy.mockRestore(); }
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('judges network-clock freshness against the 2-hour arming threshold', () => {
    const now = Date.parse('2026-09-24T00:00:00.000Z');
    const state = (ageMs: number) => ({ source: 'time.google.com', offsetMs: -30, roundTripMs: 40, synchronizedAt: new Date(now - ageMs).toISOString() });
    expect(networkClockFresh(state(10 * 60_000), now)).toBe(true);
    expect(networkClockFresh(state(NETWORK_CLOCK_MAX_AGE_MS + 1), now)).toBe(false);
    expect(networkClockFresh(null, now)).toBe(false);
  });
});
