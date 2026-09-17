import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { availabilityFixture } from '../availability-fixture.js';
import { parseAvailability } from '../../src/api-booking/availability-parser.js';
import { planBooking } from '../../src/api-booking/booking-planner.js';
import { DurableSubmissionJournal } from '../../src/api-booking/durable-submission-journal.js';
import { assessHeaderlessCheckout } from '../../src/api-booking/headerless-assessment.js';
import type { ApprovedHeaderlessAttempt } from '../../src/api-booking/headerless-assessment-transport.js';

const date = '2026-09-18';
const now = new Date('2026-09-18T00:00:00.000Z');
const snapshot = parseAvailability(availabilityFixture(date), { startDate: date, endDate: date,
  capturedAt: now.toISOString(), fixtureKind: 'synthetic', label: 'offline', now, maximumAgeMs: 1000 });
const plan = planBooking(snapshot, { mode: 'standard', targetDate: date, durationHours: 2,
  preferredStartTimes: ['12:00'], fallbackStartTimes: [], courtPriority: [3], fallbackCourts: [], courtCount: 1,
  maximumTotalPrice: 1200, currency: 'PHP' });
const freshAvailability = () => ({ ...snapshot, fixtureKind: 'live' as const, capturedAt: new Date().toISOString() });
const customer = { clientId: 'synthetic-client', customerId: 'synthetic-customer', customerFirstName: 'Synthetic',
  customerLastName: 'Guest', customerEmail: 'example@test.invalid', customerPhone: '0000000000' };
const approval: ApprovedHeaderlessAttempt = { environment: 'production',
  facilityId: '5f8786bd-dc61-4509-b893-74cda8f783f7', spaceId: plan.courts[0]!.spaceId,
  date, startTime: '12:00', endTime: '14:00', maximumAmount: 1200, clientId: customer.clientId,
  customerId: customer.customerId, approvalReference: 'synthetic-review' };
const directories: string[] = [];
afterEach(async () => {
  delete process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT;
  delete process.env.ONDA_HEADERLESS_ASSESSMENT;
  vi.unstubAllGlobals();
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});

async function setup(status = 403, body: unknown = { success: false }) {
  const path = await mkdtemp(join(tmpdir(), 'onda-assessment-'));
  directories.push(path);
  const journal = new DurableSubmissionJournal(path);
  const fetcher = vi.fn(async (url: string, init: RequestInit) => new Response(
    url.includes('is-slot-available') ? JSON.stringify({ success: true,
      availabilityProof: `synthetic-proof-${JSON.parse(init.body as string).startTime}` }) : JSON.stringify(body),
    { status: url.includes('is-slot-available') ? 200 : status, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetcher);
  const evaluate = vi.fn(async (fn: (arg: any) => Promise<unknown>, arg: unknown) => fn(arg));
  const page = { isClosed: () => false, url: () => 'https://app.onda.fit/book/thirsty-pickle', evaluate } as unknown as Page;
  const observe = vi.fn();
  return { page, journal, fetcher, observe };
}

describe('isolated headerless assessment boundary', () => {
  it('requires a fresh live availability snapshot before slot checks', async () => {
    const { page, journal, fetcher, observe } = await setup();
    await expect(assessHeaderlessCheckout({ page, journal, observe, plan, availability: snapshot,
      customer, approval })).rejects.toThrow('ASSESSMENT_FRESH_AVAILABILITY_REQUIRED');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects an unapproved plan before any request', async () => {
    const { page, journal, fetcher, observe } = await setup();
    await expect(assessHeaderlessCheckout({ page, journal, observe, plan, availability: freshAvailability(), customer,
      approval: { ...approval, endTime: '15:00' } })).rejects.toThrow('ASSESSMENT_PLAN_MISMATCH');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('requires both explicit gates and cannot send checkout with either closed', async () => {
    const { page, journal, fetcher, observe } = await setup();
    await expect(assessHeaderlessCheckout({ page, journal, observe, plan, availability: freshAvailability(), customer, approval }))
      .rejects.toThrow('LIVE_SUBMISSION_DISABLED');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sends one exact headerless checkout after two fresh proofs and retains unknown outcome on HTTP rejection', async () => {
    const { page, journal, fetcher, observe } = await setup();
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    process.env.ONDA_HEADERLESS_ASSESSMENT = 'APPROVED_ONE_SHOT';
    await expect(assessHeaderlessCheckout({ page, journal, observe, plan, availability: freshAvailability(), customer, approval }))
      .rejects.toThrow('SUBMISSION_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED');
    expect(fetcher).toHaveBeenCalledTimes(3);
    const checkout = fetcher.mock.calls[2]!;
    expect(checkout[0]).toBe('https://app.onda.fit/api/bookings/public-checkout');
    expect(checkout[1]).toMatchObject({ method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' } });
    expect(JSON.stringify(checkout[1].headers)).not.toMatch(/turnstile|fingerprint|cookie|authorization/i);
    expect(observe).toHaveBeenCalledWith({ status: 403, json: true, challengeHint: false, success: false,
      bookingCount: undefined, sessionCount: undefined, pendingTransaction: false });
    const key = DurableSubmissionJournal.key(approval.facilityId, approval.spaceId, date, '12:00', '14:00');
    await expect(journal.read(key)).resolves.toMatchObject({ state: 'unknown',
      diagnostic: { status: 403, category: 'http-rejection' } });
    await expect(assessHeaderlessCheckout({ page, journal, observe, plan, availability: freshAvailability(), customer, approval }))
      .rejects.toThrow('DUPLICATE_LOGICAL_BOOKING_BLOCKED');
    expect(fetcher).toHaveBeenCalledTimes(5); // A repeat can read proofs, but the journal blocks a second checkout.
  });

  it('persists only an allowlisted application code from a rejected response', async () => {
    const { page, journal, fetcher, observe } = await setup(403, {
      success: false, code: 'VERIFICATION_REQUIRED', message: 'private details must not persist',
    });
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    process.env.ONDA_HEADERLESS_ASSESSMENT = 'APPROVED_ONE_SHOT';
    await expect(assessHeaderlessCheckout({ page, journal, observe, plan, availability: freshAvailability(), customer, approval }))
      .rejects.toThrow('SUBMISSION_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED');
    expect(fetcher).toHaveBeenCalledTimes(3);
    const key = DurableSubmissionJournal.key(approval.facilityId, approval.spaceId, date, '12:00', '14:00');
    const record = await journal.read(key);
    expect(record.diagnostic).toEqual({ status: 403, category: 'http-rejection', contentKind: 'json',
      responseSource: 'application', errorHint: 'verification', applicationCode: 'VERIFICATION_REQUIRED' });
    expect(JSON.stringify(record)).not.toContain('private details');
  });
});
