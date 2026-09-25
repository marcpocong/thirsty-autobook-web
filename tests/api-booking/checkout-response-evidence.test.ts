import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OndaBrowserSessionTransport, type BrowserTransportObservation, type CheckoutHttpResponse } from '../../src/api-booking/browser-session-transport.js';
import { ProviderTraceSet } from '../../src/api-booking/checkout-provider-trace.js';
import { DurableSubmissionJournal } from '../../src/api-booking/durable-submission-journal.js';
import type { TwoHourCheckoutRequest } from '../../src/api-booking/two-hour-reservation.js';

const facilityId = '5f8786bd-dc61-4509-b893-74cda8f783f7';
const spaceId = '0e853a91-33b6-4de2-9237-778007a9313b';
const date = '2026-09-27';
const PRIVATE = { email: 'maria.clara+tp@example.invalid', phone: '09181234567', customerId: '6b0c7c3e-9a0e-4a55-9a53-2d3fa4c01d77',
  clientId: 'c1c1c1c1-2222-4333-8444-555555555555', token: 'synthetic-turnstile-0123456789abcdefghijklmnop', fingerprint: 'synthetic-fp-a1b2c3d4e5' };
const request = { bookingType: 'online', clientId: PRIVATE.clientId, customerId: PRIVATE.customerId, customerEmail: PRIVATE.email,
  customerPhone: PRIVATE.phone, customerFirstName: null, customerLastName: null, facilityId, usedCustomerMembershipId: null, userId: null,
  items: [{ spaceId, date, startTime: '19:00', endTime: '20:00', availabilityProof: 'synthetic-proof', activityKey: null, activityLabel: null,
    chargedAmount: 700, duration: 60, facilityId, guestCount: 1, promotionId: null, rate: 700, sessionRef: 'session_1' }] } as TwoHourCheckoutRequest;
const directories: string[] = [];
afterEach(async () => {
  delete process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT;
  vi.unstubAllGlobals();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
const leaks = (text: string) => Object.values(PRIVATE).concat(['9181234567', 'maria.clara']).filter(secret => text.toLowerCase().includes(secret.toLowerCase()));

describe('rejected checkout evidence', () => {
  it('keeps structure, size, provider headers and renderer marks of a 409 without any private value', async () => {
    // A hostile 409 that echoes the customer and security values back.
    const body = JSON.stringify({ success: false, error: `Slot unavailable for ${PRIVATE.email} (${PRIVATE.phone})`, code: 'SLOT_TAKEN',
      conflicts: [{ spaceId, date, startTime: '19:00:00', heldBy: PRIVATE.customerId }], echo: { token: PRIVATE.token, fp: PRIVATE.fingerprint } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 409, headers: { 'content-type': 'application/json', server: 'Vercel',
      'x-vercel-id': 'sin1::sin1::abcde-1790294400031-0123456789ab', date: 'Fri, 25 Sep 2026 00:00:29 GMT', 'x-vercel-cache': 'MISS',
      'set-cookie': `session=${PRIVATE.token}` } })));
    const handlers = new Set<(value: { method(): string; url(): string }) => void>();
    const page = { isClosed: () => false, url: () => 'https://app.onda.fit/book/thirsty-pickle',
      evaluate: vi.fn(async (fn: (arg: any) => Promise<unknown>, arg: { url: string }) => {
        handlers.forEach(handler => handler({ method: () => 'POST', url: () => arg.url }));
        return fn(arg);
      }),
      on: (event: string, handler: (value: { method(): string; url(): string }) => void) => { if (event === 'request') handlers.add(handler); },
      off: (event: string, handler: (value: { method(): string; url(): string }) => void) => { if (event === 'request') handlers.delete(handler); } } as unknown as Page;
    const captured: CheckoutHttpResponse[] = [], observations: BrowserTransportObservation[] = [];
    const transport = new OndaBrowserSessionTransport(page, async () => ({ turnstileToken: PRIVATE.token, publicFingerprint: PRIVATE.fingerprint }),
      async response => { captured.push(response); }, {}, observation => observations.push(observation));
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    const directory = await mkdtemp(join(tmpdir(), 'evidence-journal-')); directories.push(directory);
    const journal = new DurableSubmissionJournal(directory), key = DurableSubmissionJournal.key(facilityId, spaceId, date, '19:00', '20:00');
    await journal.begin(key);
    await expect(transport.publicCheckout(request, await journal.claimSupervisedOneShot(key))).rejects.toMatchObject({
      code: 'ONDA_HTTP_STATUS_INVALID', dispatched: true, confirmedRejected: true });

    const evidence = captured[0]!.evidence!;
    expect(leaks(JSON.stringify(evidence))).toEqual([]);
    expect(evidence).toMatchObject({ status: 409, vercel: { edgeRegion: 'sin1', embeddedMs: 1790294400031 }, serverDateMs: Date.UTC(2026, 8, 25, 0, 0, 29),
      headers: { 'x-vercel-cache': 'MISS', server: 'Vercel' }, body: { byteLength: Buffer.byteLength(body), fields: { success: false, code: 'SLOT_TAKEN' } } });
    expect(evidence.body.fields!.error).toMatch(/^Slot unavailable for \[redacted\]/);
    expect(evidence.headers).not.toHaveProperty('set-cookie');

    const completed = observations.find(value => value.event === 'CHECKOUT_RESPONSE_COMPLETED') as Extract<BrowserTransportObservation, { event: 'CHECKOUT_RESPONSE_COMPLETED' }>;
    expect(completed).toMatchObject({ statusCode: 409, errorHint: 'availability', responseBytes: Buffer.byteLength(body) });
    expect(completed.bodyShape).toMatch(/^[a-f0-9]{12}$/);
    const renderer = completed.renderer!;
    expect(renderer.fetchAt).toBeGreaterThanOrEqual(renderer.enteredAt);
    expect(renderer.headersAt).toBeGreaterThanOrEqual(renderer.fetchAt);
    expect(renderer.completedAt).toBeGreaterThanOrEqual(renderer.headersAt);

    // The shared forensic file gets the same sanitized evidence and still nothing private.
    const traces = new ProviderTraceSet('run', 'release', 0, () => 0);
    traces.captureFallback({ workerId: 'A', attemptId: 'core-A-official-1' }, captured[0]!);
    const out = await mkdtemp(join(tmpdir(), 'evidence-trace-')); directories.push(out);
    const file = await traces.persist(out);
    const text = await readFile(file!, 'utf8');
    expect(leaks(text)).toEqual([]);
    expect(text).toContain('"shapeFingerprint"');
  });
});
