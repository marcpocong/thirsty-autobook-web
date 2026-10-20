import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OndaBrowserSessionTransport, armCheckoutRequest } from '../../src/api-booking/browser-session-transport.js';
import { prooflessReleasePlan, prooflessRequest } from '../../src/api-booking/proofless-checkout.js';
import { DurableSubmissionJournal } from '../../src/api-booking/durable-submission-journal.js';
import { TwoHourReservationAdapter, standardPlanJournalKeys, type SlotCheckRequest, type TwoHourCheckoutRequest } from '../../src/api-booking/two-hour-reservation.js';
import { currentHeadersFromNormalSiteHelpers } from '../../src/api-booking/normal-site-security-context.js';
import { CalendarFreeSecurityError } from '../../src/api-booking/calendar-free-security-context.js';
import { SubmissionDispatchError } from '../../src/api-booking/submission-errors.js';
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

  it('keeps checkout and one-shot journal behavior unchanged when diagnostic hooks fail', async () => {
    const handlers = new Set<(request: { method(): string; url(): string }) => void>();
    const evaluate = vi.fn(async (_fn: unknown, argument: unknown) => {
      const url = (argument as { url: string }).url;
      handlers.forEach(handler => handler({ method: () => 'POST', url: () => url }));
      return { status: 200, contentType: 'application/json', server: '', cloudflareRay: '', cfMitigated: '',
        body: JSON.stringify({ success: true }) };
    });
    const page = { isClosed: () => false, url: () => 'https://app.onda.fit/book/thirsty-pickle', evaluate,
      on: (event: string, handler: (request: { method(): string; url(): string }) => void) => { if(event==='request')handlers.add(handler); },
      off: (event: string, handler: (request: { method(): string; url(): string }) => void) => { if(event==='request')handlers.delete(handler); } } as unknown as Page;
    const observations: string[] = [];
    const transport = new OndaBrowserSessionTransport(page,
      async () => ({ turnstileToken: 'synthetic-current-token', publicFingerprint: 'synthetic-current-fingerprint' }),
      undefined, {}, observation => { observations.push(observation.event); throw Error('diagnostic failure'); });
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    const dispatch = await permit();
    await expect(transport.publicCheckout(checkout, dispatch)).resolves.toEqual({ success: true });
    expect(observations).toEqual(expect.arrayContaining(['CHECKOUT_FUNCTION_ENTERED', 'SECURITY_PREPARATION_STARTED',
      'SECURITY_PREPARATION_COMPLETED', 'CHECKOUT_HTTP_POST_INITIATED', 'CHECKOUT_RESPONSE_COMPLETED']));
    await expect(transport.publicCheckout(checkout, dispatch)).rejects.toThrow('SUBMISSION_PERMIT_INVALID_OR_USED');
    expect(evaluate).toHaveBeenCalledOnce();
  });

  it('reports UNKNOWN when checkout evaluation may have dispatched but returned no response', async () => {
    const observations: unknown[] = [];
    const page = { isClosed: () => false, url: () => 'https://app.onda.fit/book/thirsty-pickle',
      evaluate: vi.fn(async () => { throw Error('connection lost'); }) } as unknown as Page;
    const transport = new OndaBrowserSessionTransport(page,
      async () => ({ turnstileToken: 'synthetic-current-token', publicFingerprint: 'synthetic-current-fingerprint' }),
      undefined, {}, observation => observations.push(observation));
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    await expect(transport.publicCheckout(checkout, await permit())).rejects.toMatchObject({ dispatched: true });
    expect(observations).toContainEqual(expect.objectContaining({ event: 'CHECKOUT_FUNCTION_ENTERED' }));
    expect(observations).toContainEqual(expect.objectContaining({ event: 'CHECKOUT_RESPONSE_COMPLETED',
      dispatchState: 'UNKNOWN', failureCategory: 'ONDA_TRANSPORT_FAILED' }));
    expect(observations).not.toContainEqual(expect.objectContaining({ event: 'CHECKOUT_HTTP_POST_INITIATED' }));
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

  it('identifies an explicit application 409 as a confirmed rejection', async () => {
    const evaluate = vi.fn(async () => ({ status: 409, contentType: 'application/json', server: 'Vercel',
      cloudflareRay: '', cfMitigated: '', body: JSON.stringify({ success: false, error: 'Checkout rejected.' }) }));
    const page = { isClosed: () => false, url: () => 'https://app.onda.fit/book/thirsty-pickle', evaluate } as unknown as Page;
    const transport = new OndaBrowserSessionTransport(page,
      async () => ({ turnstileToken: 'synthetic-current-token', publicFingerprint: 'synthetic-visitor' }));
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    const error = await transport.publicCheckout(checkout, await permit()).catch(value => value);
    expect(error).toBeInstanceOf(SubmissionDispatchError);
    expect(error).toMatchObject({ code: 'ONDA_HTTP_STATUS_INVALID', dispatched: true, confirmedRejected: true });
  });

  it('classifies only the canary-observed unreleased-date 400 as conclusive',async()=>{
    for(const [body,confirmedRejected] of [
      [JSON.stringify({success:false,error:'This booking date is not available yet.'}),true],
      [JSON.stringify({success:false,error:'Unexpected checkout response.'}),false],
    ] as const){
      const evaluate=vi.fn(async()=>({status:400,contentType:'application/json',server:'Vercel',
        cloudflareRay:'',cfMitigated:'',body}));
      const page={isClosed:()=>false,url:()=> 'https://app.onda.fit/book/thirsty-pickle',evaluate} as unknown as Page;
      const transport=new OndaBrowserSessionTransport(page,async()=>({turnstileToken:'synthetic-current-token',publicFingerprint:'synthetic-visitor'}));
      process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT='SUPERVISED_ONE_SHOT';
      const error=await transport.publicCheckout(checkout,await permit()).catch(value=>value);
      expect(error).toMatchObject({dispatched:true,confirmedRejected});
    }
  });

  it('keeps ambiguous or infrastructure 409 responses unresolved', async () => {
    const evaluate = vi.fn(async () => ({ status: 409, contentType: 'text/html', server: 'cloudflare',
      cloudflareRay: 'abc123def4567890-MNL', cfMitigated: 'challenge', body: '<html>Conflict</html>' }));
    const page = { isClosed: () => false, url: () => 'https://app.onda.fit/book/thirsty-pickle', evaluate } as unknown as Page;
    const transport = new OndaBrowserSessionTransport(page,
      async () => ({ turnstileToken: 'synthetic-current-token', publicFingerprint: 'synthetic-visitor' }));
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    const error = await transport.publicCheckout(checkout, await permit()).catch(value => value);
    expect(error).toMatchObject({ dispatched: true, confirmedRejected: false });
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

  it('reuses a recent genuine prewarm once and reacquires after its short window',async()=>{
    const {page,evaluate}=fakePage({success:true});
    const current=vi.fn(async()=>({turnstileToken:'synthetic-current-token',publicFingerprint:'synthetic-current-fingerprint'}));
    const transport=new OndaBrowserSessionTransport(page,current);
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT='SUPERVISED_ONE_SHOT';
    const dispatch=await permit();
    vi.useFakeTimers();
    try{
      vi.setSystemTime(new Date('2026-09-18T00:00:00.000Z'));
      await transport.prepareCheckoutContext();
      vi.setSystemTime(new Date('2026-09-18T00:00:05.000Z'));
      await transport.prepareCheckoutContext();
      expect(current).toHaveBeenCalledOnce();
      vi.setSystemTime(new Date('2026-09-18T00:00:21.000Z'));
      await transport.prepareCheckoutContext();
      expect(current).toHaveBeenCalledTimes(2);
      await transport.publicCheckout(checkout,dispatch);
      expect(evaluate).toHaveBeenCalledOnce();
      await transport.prepareCheckoutContext();
      expect(current).toHaveBeenCalledTimes(3);
    }finally{vi.useRealTimers();}
  });

  it('deduplicates concurrent security prewarms for the same browser transport',async()=>{
    const {page}=fakePage({success:true});
    let resolveHeaders!: (value:{turnstileToken:string;publicFingerprint:string})=>void;
    const current=vi.fn(()=>new Promise<{turnstileToken:string;publicFingerprint:string}>(resolve=>{resolveHeaders=resolve;}));
    const transport=new OndaBrowserSessionTransport(page,current);
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT='SUPERVISED_ONE_SHOT';
    const first=transport.prepareCheckoutContext();
    const second=transport.prepareCheckoutContext();
    expect(current).toHaveBeenCalledOnce();
    resolveHeaders({turnstileToken:'synthetic-current-token',publicFingerprint:'synthetic-current-fingerprint'});
    await Promise.all([first,second]);
    expect(current).toHaveBeenCalledOnce();
  });

  it('discards prewarmed security context if the booking page navigates',async()=>{
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT='SUPERVISED_ONE_SHOT';
    const frame={},handlers=new Map<string,(value:unknown)=>void>();
    const page={isClosed:()=>false,url:()=> 'https://app.onda.fit/book/thirsty-pickle',
      mainFrame:()=>frame,on:(event:string,handler:(value:unknown)=>void)=>{handlers.set(event,handler);}} as unknown as Page;
    const current=vi.fn(async()=>({turnstileToken:'synthetic-current-token',publicFingerprint:'synthetic-current-fingerprint'}));
    const transport=new OndaBrowserSessionTransport(page,current);
    await transport.prepareCheckoutContext();
    handlers.get('framenavigated')?.(frame);
    await transport.prepareCheckoutContext();
    expect(current).toHaveBeenCalledTimes(2);
  });

  it('preserves a sanitized challenge failure code without starting a proof or checkout request', async () => {
    const { page, evaluate } = fakePage();
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    const transport = new OndaBrowserSessionTransport(page, async () => { throw new CalendarFreeSecurityError('CHALLENGE_ERROR_600010'); });
    await expect(transport.prepareCheckoutContext()).rejects.toThrow('CHALLENGE_ERROR_600010');
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('records a challenge frame Onda rendered but never displayed, and which helper failed, without prompting anyone', async () => {
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    let fail: ((error: Error) => void) | undefined;
    const current = vi.fn(() => new Promise<{ turnstileToken: string; publicFingerprint: string }>((_, reject) => { fail = reject; }));
    const required = vi.fn(async () => undefined);
    const observations: unknown[] = [];
    const page = { isClosed: () => false, url: () => 'https://app.onda.fit/book/thirsty-pickle',
      locator: (selector: string) => ({ count: async () => {
        if (selector.endsWith(':visible')) return 0;
        fail?.(new CalendarFreeSecurityError('ONDA_SECURITY_VERIFICATION_FAILED', { failedHelper: 'challenge' }));
        return 1;
      } }) } as unknown as Page;
    const transport = new OndaBrowserSessionTransport(page, current, undefined, { onHumanVerificationRequired: required },
      observation => observations.push(observation));
    await expect(transport.prepareCheckoutContext()).rejects.toThrow('ONDA_SECURITY_VERIFICATION_FAILED');
    expect(required).not.toHaveBeenCalled();
    expect(observations).toContainEqual(expect.objectContaining({ event: 'SECURITY_PREPARATION_COMPLETED', securitySource: 'FRESH_ACQUISITION',
      failureCategory: 'ONDA_SECURITY_VERIFICATION_FAILED', challengeFrame: 'hidden', failedHelper: 'challenge' }));
  });

  it('shows one identified browser while a visible Cloudflare challenge is pending, then continues', async () => {
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    let finish: ((headers: { turnstileToken: string; publicFingerprint: string }) => void) | undefined;
    const current = vi.fn(() => new Promise<{ turnstileToken: string; publicFingerprint: string }>(resolve => { finish = resolve; }));
    const required = vi.fn(async () => { finish?.({ turnstileToken: 'human-token', publicFingerprint: 'human-fingerprint' }); });
    const completed = vi.fn(async () => undefined);
    const page = { isClosed: () => false, url: () => 'https://app.onda.fit/book/thirsty-pickle',
      locator: () => ({ count: async () => 1 }) } as unknown as Page;
    const observations: unknown[] = [];
    const transport = new OndaBrowserSessionTransport(page, current, undefined,
      { onHumanVerificationRequired: required, onHumanVerificationCompleted: completed }, observation => observations.push(observation));
    await transport.prepareCheckoutContext();
    expect(current).toHaveBeenCalledOnce();
    expect(required).toHaveBeenCalledOnce();
    expect(completed).toHaveBeenCalledOnce();
    const completion = observations.find(value => (value as { event?: string }).event === 'SECURITY_PREPARATION_COMPLETED');
    expect(completion).toMatchObject({ securitySource: 'FRESH_ACQUISITION', challengeFrame: 'visible' });
    expect(completion).not.toHaveProperty('failedHelper');
    expect(completion).not.toHaveProperty('failureCategory');
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

// 2026-09-29: the payload now ends the 23:00 hour at "00:00", but journal and permit keys keep "24:00".
// A mismatched key made the transport throw before sending, and made Precision refuse to arm.
describe('midnight-ending proofless checkout keys', () => {
  const plan = prooflessReleasePlan({ mode: 'standard', targetDate: date, durationHours: 2, preferredStartTimes: ['22:00'],
    fallbackStartTimes: [], courtPriority: [6], fallbackCourts: [], courtCount: 1, maximumTotalPrice: Infinity, currency: 'PHP' });
  const customer = { clientId: 'synthetic-client', customerId: 'synthetic-customer', customerEmail: 'example@test.invalid',
    customerPhone: '0000000000', customerFirstName: 'Synthetic', customerLastName: 'Player' };
  const deepFreeze = <T,>(value: T): T => { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };

  it('consumes the permit claimed under the plan key and sends 00:00', async () => {
    const { page, evaluate } = fakePage({ success: true });
    const transport = new OndaBrowserSessionTransport(page, async () => ({ turnstileToken: 'synthetic-current-token', publicFingerprint: 'synthetic-current-fingerprint' }));
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    const directory = await mkdtemp(join(tmpdir(), 'onda-transport-')); directories.push(directory);
    const journal = new DurableSubmissionJournal(directory), [key] = standardPlanJournalKeys(plan, facilityId);
    expect(plan.endTime).toBe('24:00');
    await journal.begin(key!);
    await expect(transport.publicCheckoutProofless(prooflessRequest(plan, customer), await journal.claimSupervisedOneShot(key!))).resolves.toEqual({ success: true });
    expect(evaluate).toHaveBeenCalledOnce();
    expect(JSON.stringify(evaluate.mock.calls[0]![1])).toContain('"endTime":"00:00"');
  });

  it('arms under the same key as the Precision target journal', () => {
    const request = deepFreeze(prooflessRequest(plan, customer));
    expect(armCheckoutRequest(request).key).toBe(standardPlanJournalKeys(plan, facilityId)[0]);
  });
});

describe('strict Shotgun page gate and prepared hot path',()=>{
  const plan=prooflessReleasePlan({mode:'standard',targetDate:date,durationHours:2,preferredStartTimes:['12:00'],fallbackStartTimes:[],courtPriority:[3],fallbackCourts:[],courtCount:1,maximumTotalPrice:Infinity,currency:'PHP'});
  const customer={clientId:'synthetic-client',customerId:'synthetic-customer',customerEmail:'fixture@example.invalid',customerPhone:'0000000000',customerFirstName:'Fixture',customerLastName:'Player'};
  it('a CDP evaluation delayed past the strict deadline never fetches, creates a page, navigates, acquires security or constructs a body',async()=>{
    const fetcher=vi.fn(),newPage=vi.fn(()=>{throw Error('NO_NEW_PAGE');}),goto=vi.fn(()=>{throw Error('NO_NAVIGATION');});
    const current=vi.fn(async()=>({turnstileToken:'synthetic-token',publicFingerprint:'synthetic-print'}));
    let delay=false;
    const evaluate=vi.fn(async(fn:(args?:any)=>unknown,arg?:unknown)=>{if(delay)await new Promise(done=>setTimeout(done,80));return fn(arg);});
    const page={isClosed:()=>false,url:()=> 'https://app.onda.fit/book/thirsty-pickle',evaluate,newPage,goto} as unknown as Page;
    const transport=new OndaBrowserSessionTransport(page,current);process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT='SUPERVISED_ONE_SHOT';
    const directory=await mkdtemp(join(tmpdir(),'shotgun-page-'));directories.push(directory);
    const journal=new DurableSubmissionJournal(directory),key=standardPlanJournalKeys(plan,facilityId)[0]!;
    await journal.begin(key);const token=await journal.claimSupervisedOneShot(key);
    const request=prooflessRequest(plan,customer);request.items.forEach(Object.freeze);Object.freeze(request.items);Object.freeze(request);armCheckoutRequest(request,{plan,key});
    await transport.prepareCheckoutContext();await transport.prepareStrictTiming();current.mockClear();
    const stringify=vi.spyOn(JSON,'stringify').mockImplementation(()=>{throw Error('NO_HOT_PATH_SERIALIZATION');});vi.stubGlobal('fetch',fetcher);delay=true;
    try{const trigger=performance.now();await expect(transport.publicCheckoutProofless(request,token,{requirePreparedContext:true,beforePost:()=>{},strictTiming:{notBeforeNodeMs:trigger-1,notAfterNodeMs:trigger+50}})).rejects.toMatchObject({code:'SHOTGUN_TRIGGER_MISSED',dispatched:false});
      expect(fetcher).not.toHaveBeenCalled();expect(current).not.toHaveBeenCalled();expect(newPage).not.toHaveBeenCalled();expect(goto).not.toHaveBeenCalled();expect(stringify).not.toHaveBeenCalled();
    }finally{stringify.mockRestore();vi.unstubAllGlobals();}
  });
  it('fails closed without pre-release page calibration',async()=>{
    const {page}=fakePage(),transport=new OndaBrowserSessionTransport(page,async()=>({turnstileToken:'synthetic-token',publicFingerprint:'synthetic-print'}));
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT='SUPERVISED_ONE_SHOT';await transport.prepareCheckoutContext();
    await expect(transport.publicCheckout(checkout,await permit())).resolves.toBeDefined();
    await transport.prepareCheckoutContext();
    await expect(transport.publicCheckoutProofless({...checkout,items:checkout.items.map(i=>({...i,availabilityProof:null}))},await permit(),{requirePreparedContext:true,strictTiming:{notBeforeNodeMs:0,notAfterNodeMs:100}})).rejects.toMatchObject({code:'SHOTGUN_TIMING_CLOCK_NOT_READY',dispatched:false});
  });
});

it('keeps known payload rejection conclusive before deferred response persistence',async()=>{
  const {page,evaluate}=fakePage();evaluate.mockResolvedValue({status:400,contentType:'application/json',body:'{"success":false,"error":"Invalid booking session time"}'});
  const safety=vi.fn(),capture=vi.fn(async()=>{}),transport=new OndaBrowserSessionTransport(page,async()=>({turnstileToken:'synthetic-token',publicFingerprint:'synthetic-print'}),capture);
  process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT='SUPERVISED_ONE_SHOT';await transport.prepareCheckoutContext();
  await expect(transport.publicCheckoutProofless({...checkout,items:checkout.items.map(i=>({...i,availabilityProof:null}))},await permit(),{requirePreparedContext:true,onResponseSafety:safety,beforeResponseBookkeeping:async()=>{expect(safety).toHaveBeenCalledWith(undefined,expect.objectContaining({confirmedRejected:true}));expect(capture).not.toHaveBeenCalled();}})).rejects.toMatchObject({code:'ONDA_PAYLOAD_REJECTED',confirmedRejected:true});
});
