import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { internalRangeEnd, normalizeOndaRange, ondaWireBoundary, rangesOverlap } from '../../src/time-range.js';
import { readPublicBookingRecords } from '../../src/api-booking/public-bookings.js';
import { classifyTargetEvidence } from '../../src/api-booking/pre-release-evidence.js';
import { prooflessCourtHourStatuses, prooflessRequest, recordDirectCheckoutOutcome, submitDirectCheckout, preflightProoflessWire } from '../../src/api-booking/proofless-checkout.js';
import { assertWireCheckoutBody, WirePayloadError } from '../../src/api-booking/wire-payload-check.js';
import { armCheckoutRequest, BrowserSessionTransportError, isPayloadRejection, OndaBrowserSessionTransport } from '../../src/api-booking/browser-session-transport.js';
import { classifyPrecisionDispatchError, freezePrecisionRace, precisionTargetPlan, validatePrecisionTargets } from '../../src/api-booking/precision-race.js';
import { armPrecisionRace } from '../../src/api-booking/armed-dispatch.js';
import { DurableSubmissionJournal } from '../../src/api-booking/durable-submission-journal.js';
import { standardPlanJournalKeys } from '../../src/api-booking/two-hour-reservation.js';
import { THIRSTY_PICKLE_FACILITY_ID } from '../../src/api-booking/live-availability-provider.js';
import { COURT_TO_SPACE_ID } from '../../src/api-booking/availability-parser.js';
import type { BookingPlan } from '../../src/api-booking/types.js';

const date = '2026-10-01';
const customer = { clientId: 'synthetic-client', customerId: 'synthetic-customer', customerEmail: 'phase0@example.invalid',
  customerPhone: '09000000000', customerFirstName: 'Phase', customerLastName: 'Zero' };
const directories: string[] = [];
afterEach(async () => { delete process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT; vi.unstubAllGlobals();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
const scratch = async () => { const directory = await mkdtemp(join(tmpdir(), 'phase0-')); directories.push(directory); return directory; };
const planFor = (court: number, start: string, durationHours: number) => {
  const [target] = validatePrecisionTargets([{ court, start, durationHours }], date);
  return { target: target!, plan: precisionTargetPlan(target!, date) };
};

describe('midnight normalization (time-range.ts)', () => {
  it('keeps ordinary ranges and turns a 23:00 → 00:00 record into 23:00 → 24:00', () => {
    expect(normalizeOndaRange('22:00', '23:00')).toEqual({ startTime: '22:00', endTime: '23:00' });
    expect(normalizeOndaRange('22:00:00', '23:00:00')).toEqual({ startTime: '22:00', endTime: '23:00' });
    expect(normalizeOndaRange('23:00:00', '00:00:00')).toEqual({ startTime: '23:00', endTime: '24:00' });
    expect(normalizeOndaRange('21:00', '00:00')).toEqual({ startTime: '21:00', endTime: '24:00' });
    expect(normalizeOndaRange('23:00', '24:00')).toEqual({ startTime: '23:00', endTime: '24:00' });
    expect(internalRangeEnd('00:00', '00:00')).toBe('00:00');
    expect(normalizeOndaRange('00:00', '00:00')).toBeNull();
    expect(normalizeOndaRange('23:00', '22:00')).toBeNull();
    expect(normalizeOndaRange('9:00', '10:00')).toBeNull();
    expect(normalizeOndaRange(undefined, '10:00')).toBeNull();
  });

  it('detects overlap of a midnight record with 21:00–24:00 and with every prime candidate ending at midnight', () => {
    const record = normalizeOndaRange('23:00:00', '00:00:00')!;
    expect(rangesOverlap(record, { startTime: '21:00', endTime: '24:00' })).toBe(true);
    for (const start of ['17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00']) {
      const candidate = { startTime: start, endTime: '24:00' };
      expect(rangesOverlap(record, candidate), `${start}–24:00`).toBe(true);
    }
    // Candidates that end before 23:00 never overlap the 23:00 hour.
    expect(rangesOverlap(record, { startTime: '20:00', endTime: '23:00' })).toBe(false);
    expect(rangesOverlap(normalizeOndaRange('22:00', '23:00')!, { startTime: '21:00', endTime: '24:00' })).toBe(true);
  });

  it('writes the internal 24:00 boundary as Onda 00:00 on the wire only', () => {
    expect(ondaWireBoundary('24:00')).toBe('00:00');
    expect(ondaWireBoundary('23:00')).toBe('23:00');
  });
});

describe('public booking records at midnight', () => {
  const fetcherWith = (records: unknown[]) => vi.fn(async (url: URL) => {
    const space = url.searchParams.get('spaceIds')!;
    return new Response(JSON.stringify({ data: { [space]: space === COURT_TO_SPACE_ID[7] ? records : [] } }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;

  it('keeps a record that ends at 00:00 instead of dropping it', async () => {
    const records = await readPublicBookingRecords(date, { fetcher: fetcherWith([
      { date, startTime: '22:00:00', endTime: '23:00:00' }, { date, startTime: '23:00:00', endTime: '00:00:00' },
      { date: '2026-10-02', startTime: '23:00:00', endTime: '00:00:00' }]) });
    expect(records.failedCourts).toEqual([]);
    expect(records.blocks).toEqual([{ court: 7, startTime: '22:00', endTime: '23:00' }, { court: 7, startTime: '23:00', endTime: '24:00' }]);
  });

  it('blocks the 23:00 cell and a 21:00–24:00 target on the unreleased date', async () => {
    const records = await readPublicBookingRecords(date, { fetcher: fetcherWith([{ date, startTime: '23:00:00', endTime: '00:00:00' }]) });
    const cells = prooflessCourtHourStatuses(undefined, date, records.blocks, records.failedCourts);
    expect(cells.find(cell => cell.court === 7 && cell.hour === '23:00')).toMatchObject({ status: 'BLOCKED', source: 'PUBLIC_BOOKING' });
    expect(cells.find(cell => cell.court === 7 && cell.hour === '22:00')?.status).not.toBe('BLOCKED');
    const evidence = { snapshot: undefined, blocks: records.blocks, failedCourts: records.failedCourts, dateState: 'UNRELEASED' as const };
    expect(classifyTargetEvidence({ court: 7, start: '21:00', durationHours: 3 }, evidence, date)).toMatchObject({ evidence: 'PUBLIC_BOOKING_PRESENT', eligible: false });
    expect(classifyTargetEvidence({ court: 7, start: '20:00', durationHours: 3 }, evidence, date)).toMatchObject({ evidence: 'NO_PUBLIC_BOOKING_DATE_UNRELEASED', eligible: true });
  });
});

describe('arm-time wire payload self-check', () => {
  it('accepts a midnight-ending plan and sends 00:00, never 24:00', () => {
    const { plan } = planFor(7, '21:00', 3);
    const body = preflightProoflessWire(plan, customer);
    expect(body).not.toContain('24:00');
    expect(JSON.parse(body).items.map((item: { startTime: string; endTime: string }) => `${item.startTime}-${item.endTime}`))
      .toEqual(['21:00-22:00', '22:00-23:00', '23:00-00:00']);
  });

  it('accepts every standard 1–3 hour window from 08:00 through midnight', () => {
    for (let start = 8; start <= 23; start++) for (let duration = 1; duration <= 3 && start + duration <= 24; duration++) {
      const { plan } = planFor(7, `${String(start).padStart(2, '0')}:00`, duration);
      expect(() => preflightProoflessWire(plan, customer), `${start}+${duration}`).not.toThrow();
    }
  });

  const valid = () => { const { plan } = planFor(7, '21:00', 3); const key = standardPlanJournalKeys(plan, THIRSTY_PICKLE_FACILITY_ID)[0]!;
    return { plan, key, request: JSON.parse(JSON.stringify(prooflessRequest(plan, customer))) as ReturnType<typeof prooflessRequest> }; };
  const reason = (fn: () => void) => { try { fn(); return 'passed'; } catch (error) { return error instanceof WirePayloadError ? error.detail : String(error); } };

  it('rejects an internal 24:00 on the wire', () => {
    const { plan, key, request } = valid(); request.items[2]!.endTime = '24:00';
    expect(reason(() => assertWireCheckoutBody(JSON.stringify(request), plan, key))).toMatch(/24:00/);
  });
  it('rejects a non-contiguous or wrong-duration item', () => {
    const { plan, key, request } = valid(); request.items[1]!.startTime = '21:00'; request.items[1]!.endTime = '22:00';
    expect(reason(() => assertWireCheckoutBody(JSON.stringify(request), plan, key))).not.toBe('passed');
    const second = valid(); second.request.items[0]!.duration = 120 as 60;
    expect(reason(() => assertWireCheckoutBody(JSON.stringify(second.request), second.plan, second.key))).toMatch(/one hour/);
  });
  it('rejects invalid prices and a total that disagrees with the plan', () => {
    const { plan, key, request } = valid(); request.items[0]!.rate = 0; request.items[0]!.chargedAmount = 0;
    expect(reason(() => assertWireCheckoutBody(JSON.stringify(request), plan, key))).toMatch(/price/);
    const second = valid(); second.request.items[0]!.chargedAmount = 650;
    expect(reason(() => assertWireCheckoutBody(JSON.stringify(second.request), second.plan, second.key))).toMatch(/price/);
  });
  it('rejects a body whose range does not match the journal/permit key', () => {
    const { plan, request } = valid();
    const otherKey = DurableSubmissionJournal.key(THIRSTY_PICKLE_FACILITY_ID, COURT_TO_SPACE_ID[7], date, '21:00', '23:00');
    expect(reason(() => assertWireCheckoutBody(JSON.stringify(request), plan, otherKey))).toMatch(/key/);
  });
  it('rejects unstable (non-canonical) serialization', () => {
    const { plan, key, request } = valid();
    expect(reason(() => assertWireCheckoutBody(JSON.stringify(request, null, 1), plan, key))).toMatch(/stable/);
  });

  it('registers only a validated body, and the transport sends exactly those bytes', async () => {
    const { plan, key } = valid();
    const request = prooflessRequest(plan, customer);
    const freeze = (value: unknown): void => { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } };
    freeze(request);
    const armed = armCheckoutRequest(request, { plan, key });
    expect(armed.key).toBe(key);
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    const evaluate = vi.fn(async () => ({ status: 409, contentType: 'application/json', body: '{"success":false,"error":"conflict"}' }));
    const page = { isClosed: () => false, url: () => 'https://app.onda.fit/book/thirsty-pickle', evaluate, on: () => undefined, off: () => undefined } as unknown as Page;
    const transport = new OndaBrowserSessionTransport(page, async () => ({ turnstileToken: 'synthetic-token', publicFingerprint: 'synthetic-print' }));
    const journal = new DurableSubmissionJournal(await scratch());
    await journal.begin(key);
    await expect(transport.publicCheckoutProofless(request, await journal.claimSupervisedOneShot(key))).rejects.toMatchObject({ code: 'ONDA_HTTP_STATUS_INVALID' });
    expect((evaluate.mock.calls[0] as unknown as [unknown, { text: string }])[1].text).toBe(armed.body);
  });

  it('refuses the whole Precision arm before anything durable when one frozen body is malformed', async () => {
    const good = planFor(7, '19:00', 3), bad = planFor(6, '21:00', 3);
    // Passes every earlier validator (totals agree, hours contiguous) but carries a zero-price hour on the wire.
    const slots = bad.plan.courts[0]!.slots.map((slot, index) => index === 1 ? { ...slot, price: 0 } : slot);
    const total = slots.reduce((sum, slot) => sum + slot.price, 0);
    const court = { ...bad.plan.courts[0]!, slots, price: total };
    const broken: BookingPlan = { ...bad.plan, courts: [court], chunks: [{ ...bad.plan.chunks[0]!, courts: [court], totalPrice: total }], totalPrice: total };
    const race = freezePrecisionRace(date, Date.now() + 60_000, [good, { target: { ...bad.target, workerId: 'B' }, plan: broken }]);
    const root = await scratch();
    const lock = { armed: vi.fn(async () => undefined) };
    await expect(armPrecisionRace(race, { lock, customerFor: () => customer, journalRoot: root, releaseMs: race.releaseMs, now: Date.now }))
      .rejects.toThrow('WIRE_PAYLOAD_SELF_CHECK_FAILED');
    expect(lock.armed).not.toHaveBeenCalled();
  });
});

describe('400 "Invalid booking session time" payload rejection', () => {
  const response = (status: number, body: string, contentType = 'application/json') => ({ status, contentType, body });
  it('recognizes only the exact known payload rejection', () => {
    expect(isPayloadRejection(response(400, '{"success":false,"error":"Invalid booking session time"}'))).toBe(true);
    expect(isPayloadRejection(response(400, '{"success":false,"error":"Invalid booking session time."}'))).toBe(true);
    expect(isPayloadRejection(response(400, '{"success":false,"error":"Something else"}'))).toBe(false);
    expect(isPayloadRejection(response(400, '{"success":false,"error":"Invalid booking session time","bookings":[]}'))).toBe(false);
    expect(isPayloadRejection(response(400, '{"success":true,"error":"Invalid booking session time"}'))).toBe(false);
    expect(isPayloadRejection(response(500, '{"success":false,"error":"Invalid booking session time"}'))).toBe(false);
    expect(isPayloadRejection(response(400, '<html>Invalid booking session time</html>', 'text/html'))).toBe(false);
  });

  const sendWith = async (body: string) => {
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    const { plan } = planFor(7, '21:00', 3);
    const evaluate = vi.fn(async () => ({ status: 400, contentType: 'application/json', body }));
    const page = { isClosed: () => false, url: () => 'https://app.onda.fit/book/thirsty-pickle', evaluate, on: () => undefined, off: () => undefined } as unknown as Page;
    const transport = new OndaBrowserSessionTransport(page, async () => ({ turnstileToken: 'synthetic-token', publicFingerprint: 'synthetic-print' }),
      async () => undefined);
    const journal = new DurableSubmissionJournal(await scratch());
    const key = standardPlanJournalKeys(plan, THIRSTY_PICKLE_FACILITY_ID)[0]!;
    const error = await submitDirectCheckout(plan, customer, transport, journal, undefined, [], Date.now).catch(value => value);
    return { error, state: (await journal.read(key)).state, record: await journal.read(key), key, journal };
  };

  it('is a conclusive REJECTED with its own code, never UNKNOWN', async () => {
    const { error, state, record, journal, key } = await sendWith('{"success":false,"error":"Invalid booking session time"}');
    expect(error).toBeInstanceOf(BrowserSessionTransportError);
    expect(error).toMatchObject({ code: 'ONDA_PAYLOAD_REJECTED', dispatched: true, confirmedRejected: true });
    expect(state).toBe('rejected');
    expect(JSON.stringify(record)).toContain('ONDA_PAYLOAD_REJECTED');
    expect(JSON.stringify(record)).toContain('"errorHint":"payload"');
    await expect(classifyPrecisionDispatchError(error, async () => (await journal.read(key)).state)).resolves.toEqual({ state: 'REJECTED', code: 'ONDA_PAYLOAD_REJECTED' });
  });

  it('keeps any other 400 ambiguous (UNKNOWN), exactly as before', async () => {
    const { error, state } = await sendWith('{"success":false,"error":"Unexpected validation failure"}');
    expect((error as Error).message).toBe('SUBMISSION_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED');
    expect(state).toBe('unknown');
  });

  it('recordDirectCheckoutOutcome stays generic for unrelated failures', async () => {
    const { plan } = planFor(7, '19:00', 3);
    const key = standardPlanJournalKeys(plan, THIRSTY_PICKLE_FACILITY_ID)[0]!;
    const journal = new DurableSubmissionJournal(await scratch());
    await journal.begin(key);
    await expect(recordDirectCheckoutOutcome(async () => { throw Error('boom'); }, prooflessRequest(plan, customer), plan, [{ journal, key }], Date.now))
      .rejects.toThrow('SUBMISSION_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED');
    expect((await journal.read(key)).state).toBe('unknown');
  });
});
