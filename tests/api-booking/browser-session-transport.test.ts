import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OndaBrowserSessionTransport } from '../../src/api-booking/browser-session-transport.js';
import { DurableSubmissionJournal } from '../../src/api-booking/durable-submission-journal.js';
import { TwoHourReservationAdapter, type SlotCheckRequest, type TwoHourCheckoutRequest } from '../../src/api-booking/two-hour-reservation.js';
import { currentHeadersFromNormalSiteHelpers } from '../../src/api-booking/normal-site-security-context.js';
import { CalendarFreeSecurityError } from '../../src/api-booking/calendar-free-security-context.js';
import { availabilityFixture } from '../availability-fixture.js';
import { parseAvailability } from '../../src/api-booking/availability-parser.js';
import { planBooking } from '../../src/api-booking/booking-planner.js';

const facilityId = '5f8786bd-dc61-4509-b893-74cda8f783f7';
const spaceId = '0e853a91-33b6-4de2-9237-778007a9313b';
const date = '2026-09-18';
const slot: SlotCheckRequest = { clientId: 'synthetic-client', facilityId, spaceId, date, startTime: '12:00', endTime: '13:00' };
const checkout = { bookingType: 'online', clientId: 'synthetic-client', customerId: 'synthetic-customer',
  customerEmail: 'example@test.invalid', customerPhone: '0000000000', customerFirstName: null,
  customerLastName: null, facilityId, usedCustomerMembershipId: null, userId: null,
  items: [
    { spaceId, date, startTime: '12:00', endTime: '13:00', availabilityProof: 'synthetic-proof-1',
      activityKey: null, activityLabel: null, chargedAmount: 600, duration: 60, facilityId,
      guestCount: 1, promotionId: null, rate: 600, sessionRef: 'session_1' },
    { spaceId, date, startTime: '13:00', endTime: '14:00', availabilityProof: 'synthetic-proof-2',
      activityKey: null, activityLabel: null, chargedAmount: 600, duration: 60, facilityId,
      guestCount: 1, promotionId: null, rate: 600, sessionRef: 'session_1' },
  ],
} as TwoHourCheckoutRequest;
const directories: string[] = [];
afterEach(async () => { delete process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT;
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

function fakePage(body: unknown = { success: true, availabilityProof: 'synthetic-proof-1' }) {
  const evaluate = vi.fn(async (_fn: unknown, argument: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
  const page = { isClosed: () => false, url: () => 'https://app.onda.fit/book/thirsty-pickle', evaluate } as unknown as Page;
  return { page, evaluate };
}

async function permit() {
  const directory = await mkdtemp(join(tmpdir(), 'onda-transport-'));
  directories.push(directory);
  const journal = new DurableSubmissionJournal(directory);
  const key = DurableSubmissionJournal.key(facilityId, spaceId, date, '12:00', '14:00');
  await journal.begin(key);
  return journal.claimSupervisedOneShot(key);
}

describe('browser session transport, offline', () => {
  it('uses the observed same-origin slot POST body without checkout headers', async () => {
    const { page, evaluate } = fakePage();
    const headers = vi.fn();
    const transport = new OndaBrowserSessionTransport(page, headers);
    await expect(transport.checkSlot(slot)).resolves.toEqual({ success: true, availabilityProof: 'synthetic-proof-1' });
    expect(evaluate).toHaveBeenCalledOnce();
    expect(evaluate.mock.calls[0]![1]).toEqual({ url: 'https://app.onda.fit/api/public/is-slot-available', payload: slot, headers: {} });
    expect(headers).not.toHaveBeenCalled();
  });

  it('uses browser fetch with same-origin cookies, JSON, and no cache', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ success: true, availabilityProof: 'synthetic-fresh-proof' }),
      { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    try {
      const evaluate = vi.fn(async (fn: (arg: any) => Promise<unknown>, arg: unknown) => fn(arg));
      const page = { isClosed: () => false, url: () => 'https://app.onda.fit/book/thirsty-pickle', evaluate } as unknown as Page;
      const transport = new OndaBrowserSessionTransport(page, async () => { throw Error('unused'); });
      await expect(transport.checkSlot(slot)).resolves.toMatchObject({ success: true });
      expect(fetcher).toHaveBeenCalledOnce();
      const [url, init] = fetcher.mock.calls[0]! as unknown as [string, RequestInit];
      expect(url).toBe('https://app.onda.fit/api/public/is-slot-available');
      expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(slot) });
      expect(JSON.stringify(init)).not.toMatch(/cookie|authorization|turnstile|fingerprint/i);
    } finally { vi.unstubAllGlobals(); }
  });

  it('requires the supervised gate and a journal permit for checkout; uses current headers only', async () => {
    const { page, evaluate } = fakePage({ success: true });
    const current = vi.fn(async () => ({ turnstileToken: 'synthetic-current-token', publicFingerprint: 'synthetic-current-fingerprint' }));
    const transport = new OndaBrowserSessionTransport(page, current);
    const dispatch = await permit();
    await expect(transport.publicCheckout(checkout, dispatch)).rejects.toThrow('LIVE_SUBMISSION_DISABLED');
    expect(evaluate).not.toHaveBeenCalled();
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    await expect(transport.publicCheckout(checkout, dispatch)).resolves.toEqual({ success: true });
    expect(current).toHaveBeenCalledOnce();
    expect(evaluate.mock.calls[0]![1]).toEqual({ url: 'https://app.onda.fit/api/bookings/public-checkout',
      payload: checkout, headers: { 'X-Turnstile-Token': 'synthetic-current-token',
        'X-Onda-Public-Fingerprint': 'synthetic-current-fingerprint' } });
    await expect(transport.publicCheckout(checkout, dispatch)).rejects.toThrow('SUBMISSION_PERMIT_INVALID_OR_USED');
    expect(evaluate).toHaveBeenCalledOnce();
  });

  it('captures a checkout response before rejecting an unexpected content type', async () => {
    const captured = vi.fn(async (_response: unknown) => undefined);
    const evaluate = vi.fn(async () => ({ status: 200, contentType: 'text/plain', server: '',
      cloudflareRay: '', cfMitigated: '', body: '{"success":true,"bookings":[{"id":"synthetic-booking"}]}' }));
    const page = { isClosed: () => false, url: () => 'https://app.onda.fit/book/thirsty-pickle', evaluate } as unknown as Page;
    const transport = new OndaBrowserSessionTransport(page,
      async () => ({ turnstileToken: 'synthetic-current-token', publicFingerprint: 'synthetic-visitor' }), captured);
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    await expect(transport.publicCheckout(checkout, await permit())).rejects.toThrow('ONDA_CONTENT_TYPE_INVALID');
    expect(captured).toHaveBeenCalledOnce();
    expect(captured.mock.calls[0]![0]).toMatchObject({ status: 200,
      body: '{"success":true,"bookings":[{"id":"synthetic-booking"}]}' });
  });

  it('blocks checkout when current security headers are unavailable or page is wrong', async () => {
    const { page, evaluate } = fakePage();
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    const invalid = new OndaBrowserSessionTransport(page, async () => ({ turnstileToken: '<CAPTURED>', publicFingerprint: '' }));
    await expect(invalid.publicCheckout(checkout, await permit())).rejects.toThrow('CURRENT_CHECKOUT_HEADERS_INVALID');
    expect(evaluate).not.toHaveBeenCalled();
    const wrong = { ...page, url: () => 'https://example.invalid/' } as Page;
    await expect(new OndaBrowserSessionTransport(wrong, async () => ({ turnstileToken: 'x', publicFingerprint: 'y' }))
      .checkSlot(slot)).rejects.toThrow('ONDA_SESSION_PAGE_INVALID');
  });

  it('rejects a prepared challenge after the freshness margin before dispatch', async () => {
    const { page, evaluate } = fakePage();
    const current = vi.fn(async () => ({ turnstileToken: 'synthetic-current-token',
      publicFingerprint: 'synthetic-current-fingerprint' }));
    const transport = new OndaBrowserSessionTransport(page, current);
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-18T00:00:00.000Z'));
      await transport.prepareCheckoutContext();
      vi.setSystemTime(new Date('2026-09-18T00:02:00.001Z'));
      await expect(transport.publicCheckout(checkout, await permit())).rejects.toThrow('CURRENT_CHECKOUT_HEADERS_STALE');
      expect(current).toHaveBeenCalledOnce();
      expect(evaluate).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('preserves a sanitized challenge failure code without starting a proof or checkout request', async () => {
    const { page, evaluate } = fakePage();
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    const transport = new OndaBrowserSessionTransport(page, async () => { throw new CalendarFreeSecurityError('CHALLENGE_ERROR_600010'); });
    await expect(transport.prepareCheckoutContext()).rejects.toThrow('CHALLENGE_ERROR_600010');
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('stops before proof checks or a journal claim when normal verification fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'onda-context-failure-'));
    directories.push(directory);
    const evaluate = vi.fn(async (_fn: unknown, argument: unknown) => {
      const { url, payload } = argument as { url: string; payload: { startTime: string } };
      if (url.includes('public-checkout')) throw Error('checkout must not run');
      return { status: 200, contentType: 'application/json', body: JSON.stringify({ success: true,
        availabilityProof: `synthetic-proof-${payload.startTime}` }) };
    });
    const page = { isClosed: () => false, url: () => 'https://app.onda.fit/book/thirsty-pickle', evaluate } as unknown as Page;
    const context = currentHeadersFromNormalSiteHelpers({
      getPublicBookingTurnstileToken: async () => { throw Error('verification failed'); },
      getPublicFingerprintId: async () => 'current-visitor',
    });
    const journal = new DurableSubmissionJournal(directory);
    const transport = new OndaBrowserSessionTransport(page, context);
    const clock = () => new Date('2026-09-18T00:00:00.000Z');
    const snapshot = parseAvailability(availabilityFixture(date), { startDate: date, endDate: date,
      capturedAt: clock().toISOString(), fixtureKind: 'synthetic', label: 'offline', now: clock(), maximumAgeMs: 1000 });
    const plan = planBooking(snapshot, { mode: 'standard', targetDate: date, durationHours: 2,
      preferredStartTimes: ['12:00'], fallbackStartTimes: [], courtPriority: [3], fallbackCourts: [], courtCount: 1,
      maximumTotalPrice: 1200, currency: 'PHP' });
    const adapter = new TwoHourReservationAdapter(transport, journal, clock);
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    const customer = { clientId: 'synthetic-client', customerId: 'synthetic-customer', customerFirstName: 'Synthetic', customerLastName: 'Guest',
      customerEmail: 'example@test.invalid', customerPhone: '0000000000' };
    await expect(adapter.submit(plan, customer, { supervisedOneShot: true }))
      .rejects.toThrow('CURRENT_CHECKOUT_HEADERS_UNAVAILABLE');
    expect(evaluate).not.toHaveBeenCalled();
    const key = DurableSubmissionJournal.key(facilityId, spaceId, date, '12:00', '14:00');
    await expect(journal.read(key)).rejects.toThrow();
    await expect(adapter.submit(plan, customer, { supervisedOneShot: true }))
      .rejects.toThrow('CURRENT_CHECKOUT_HEADERS_UNAVAILABLE');
    expect(evaluate).not.toHaveBeenCalled();
  });
});
