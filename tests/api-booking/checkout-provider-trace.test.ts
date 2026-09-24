import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHECKOUT_TRACE_URL, CheckoutProviderTrace, PROVIDER_TRACE_COMMANDS, ProviderTraceSet, sanitizeContentType, sanitizeHeader, sanitizeProtocol,
  sanitizeServerTiming, type CdpSessionLike } from '../../src/api-booking/checkout-provider-trace.js';
import { OndaBrowserSessionTransport } from '../../src/api-booking/browser-session-transport.js';
import { DurableSubmissionJournal } from '../../src/api-booking/durable-submission-journal.js';
import type { TwoHourCheckoutRequest } from '../../src/api-booking/two-hour-reservation.js';

/** A DevTools session stand-in: records every command and lets the test emit events. */
class FakeSession implements CdpSessionLike {
  readonly sent: Array<{ method: string; params?: Record<string, unknown> }> = [];
  private readonly handlers = new Map<string, Set<(params: unknown) => void>>();
  detached = false;
  constructor(private readonly failSend = false) {}
  on(event: string, listener: (params: unknown) => void) { (this.handlers.get(event) ?? this.handlers.set(event, new Set()).get(event)!).add(listener); }
  off(event: string, listener: (params: unknown) => void) { this.handlers.get(event)?.delete(listener); }
  async send(method: string, params?: Record<string, unknown>) { this.sent.push({ method, ...(params ? { params } : {}) }); if (this.failSend) throw Error('CDP_GONE'); return {}; }
  async detach() { this.detached = true; }
  emit(event: string, params: unknown) { for (const listener of this.handlers.get(event) ?? []) listener(params); }
}

const SECRETS = ['COOKIE_SENTINEL', 'AUTH_SENTINEL', 'TURNSTILE_SENTINEL', 'FINGERPRINT_SENTINEL', '11111111-2222-4333-8444-555555555555',
  'email-sentinel@example.invalid', '09170000000', 'NAME_SENTINEL', 'CHECKOUT_TOKEN_SENTINEL', 'QR_PAYLOAD_SENTINEL', 'SETCOOKIE_SENTINEL',
  'SECRET_DESC_SENTINEL', '203.0.113.9', '192.168.1.23', 'BODY_SENTINEL'];

/** One realistic checkout exchange as Chrome reports it, carrying every kind of secret the trace must never keep. */
function emitCheckout(session: FakeSession, requestId = 'req-1', responseHeaders: Record<string, string> = {}) {
  session.emit('Network.requestWillBeSent', { requestId, timestamp: 1000.0005, wallTime: 1790208000.0005, type: 'Fetch',
    request: { url: CHECKOUT_TRACE_URL, method: 'POST', hasPostData: true,
      headers: { Cookie: 'sid=COOKIE_SENTINEL', Authorization: 'Bearer AUTH_SENTINEL', 'X-Turnstile-Token': 'TURNSTILE_SENTINEL', 'X-Onda-Public-Fingerprint': 'FINGERPRINT_SENTINEL' },
      postData: JSON.stringify({ customerId: '11111111-2222-4333-8444-555555555555', customerEmail: 'email-sentinel@example.invalid', customerPhone: '09170000000', customerFirstName: 'NAME_SENTINEL' }) } });
  session.emit('Network.requestWillBeSentExtraInfo', { requestId, associatedCookies: [{ cookie: { value: 'COOKIE_SENTINEL' } }], headers: { cookie: 'COOKIE_SENTINEL' } });
  session.emit('Network.responseReceived', { requestId, timestamp: 1017.48, type: 'Fetch', response: { url: CHECKOUT_TRACE_URL, status: 409, protocol: 'h2',
    connectionReused: true, connectionId: 42, remoteIPAddress: '203.0.113.9', remotePort: 443, securityDetails: { subjectName: 'app.onda.fit' },
    timing: { requestTime: 1000.001, dnsStart: -1, dnsEnd: -1, connectStart: -1, connectEnd: -1, sslStart: -1, sslEnd: -1, sendStart: 0.2, sendEnd: 0.3,
      receiveHeadersStart: 17_479.1, receiveHeadersEnd: 17_479.4 },
    headers: { 'Content-Type': 'application/json; charset=utf-8', Server: 'Vercel', 'X-Vercel-Id': 'sin1::iad1::abcde-1790208017480-0123456789ab',
      'X-Request-Id': '0f8fad5b-d9cb-469f-a165-70867728950e', 'x-vercel-cache': 'MISS', age: '0', 'set-cookie': 'a=SETCOOKIE_SENTINEL',
      'Server-Timing': 'db;dur=12.5;desc="SECRET_DESC_SENTINEL", app;dur=3', 'x-customer-email': 'email-sentinel@example.invalid', 'x-client-ip': '192.168.1.23',
      ...responseHeaders } } });
  session.emit('Network.responseReceivedExtraInfo', { requestId, headers: { 'set-cookie': 'a=SETCOOKIE_SENTINEL' }, headersText: 'HTTP/2 409\r\nset-cookie: SETCOOKIE_SENTINEL' });
  session.emit('Network.dataReceived', { requestId, dataLength: 60 });
  session.emit('Network.loadingFinished', { requestId, timestamp: 1017.5405, encodedDataLength: 812 });
}

async function withDirectory<T>(work: (directory: string) => Promise<T>) {
  const directory = await mkdtemp(join(tmpdir(), 'thirsty-provider-trace-'));
  try { return await work(directory); }
  finally { if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw Error('TEST_CLEANUP_PATH_INVALID'); await rm(directory, { recursive: true, force: true }); }
}

describe('passive checkout provider trace', () => {
  it('attaches with nothing enabled, enables Network only when told, and only ever sends Network.enable/disable', async () => {
    const session = new FakeSession();
    const trace = new CheckoutProviderTrace({ workerId: 'A' }, () => 0);
    expect(await trace.attach(async () => session)).toBe(true);
    // Attached before release: no domain enabled, so no per-request DevTools work at the release instant.
    expect(session.sent).toEqual([]);
    expect(trace.status).toBe('attached');
    // Events before enabling (which Chrome would not send anyway) are ignored.
    emitCheckout(session);
    expect(trace.records()).toEqual([]);
    expect(await trace.enable()).toBe(true);
    emitCheckout(session, 'req-2');
    expect(trace.records()).toHaveLength(1);
    await trace.detach();
    expect(session.sent.map(value => value.method)).toEqual(['Network.enable', 'Network.disable']);
    expect(session.sent.every(value => PROVIDER_TRACE_COMMANDS.has(value.method))).toBe(true);
    // The request body is excluded from this session's events.
    expect(session.sent[0]!.params).toMatchObject({ maxPostDataSize: 1 });
    expect(session.detached).toBe(true);
  });

  it('captures protocol, connection reuse, header arrival separately from body completion, and provider IDs', () => {
    const session = new FakeSession();
    let offset = 12.34;
    const trace = new CheckoutProviderTrace({ workerId: 'A', attemptId: 'core-A-official-1', court: 3, startTime: '15:00', endTime: '18:00' }, () => offset);
    void trace.attach(async () => session).then(() => trace.enable());
    return new Promise<void>(done => setImmediate(() => {
      emitCheckout(session);
      offset = 17_600;
      const [record] = trace.records();
      expect(record).toMatchObject({ workerId: 'A', attemptId: 'core-A-official-1', target: { court: 3, startTime: '15:00', endTime: '18:00' },
        method: 'POST', path: '/api/bookings/public-checkout', complete: true, failure: null,
        connection: { protocol: 'h2', reused: true },
        browser: { dnsMs: null, connectMs: null, tlsMs: null, sendMs: 0.1, waitMs: 17_478.8,
          headersStartMs: 17_479.1, headersEndMs: 17_479.4, bodyCompleteMs: 17_539.5, failedMs: null },
        response: { status: 409, contentType: 'application/json', server: 'Vercel', vercelId: 'sin1::iad1::abcde-1790208017480-0123456789ab',
          requestId: '0f8fad5b-d9cb-469f-a165-70867728950e', vercelCache: 'MISS', ageS: 0, cfRay: null, cfMitigated: null,
          serverTiming: [{ name: 'db', durMs: 12.5 }, { name: 'app', durMs: 3 }], encodedBytes: 812 } });
      expect(record!.nodeObserved).toEqual({ enabledOffsetMs: 12.3, headersOffsetMs: 12.3, finishedOffsetMs: 12.3 });
      done();
    }));
  });

  it('reports DNS/TCP/TLS as not exposed (null) when Chrome gives -1 or nothing, and survives malformed events', async () => {
    const session = new FakeSession();
    const trace = new CheckoutProviderTrace({ workerId: 'B' }, () => 0);
    await trace.attach(async () => session);
    await trace.enable();
    for (const junk of [null, undefined, 42, 'x', [], { requestId: 7 }, { response: null }, { requestId: 'r', response: { url: 7 } }])
      for (const event of ['Network.responseReceived', 'Network.loadingFinished', 'Network.loadingFailed']) session.emit(event, junk);
    session.emit('Network.responseReceived', { requestId: 'r2', response: { url: CHECKOUT_TRACE_URL, status: 409, headers: {}, timing: { requestTime: 5 } } });
    session.emit('Network.loadingFailed', { requestId: 'r2', timestamp: 5.25, errorText: 'net::ERR_CONNECTION_RESET', canceled: false });
    // Another path, the same path on another origin, or a failure that was never a traced response is not traced.
    session.emit('Network.responseReceived', { requestId: 'r4', response: { url: 'https://app.onda.fit/api/public/is-slot-available', status: 200, headers: {} } });
    session.emit('Network.responseReceived', { requestId: 'r5', response: { url: 'https://evil.example/api/bookings/public-checkout', status: 200, headers: {} } });
    session.emit('Network.loadingFailed', { requestId: 'r6', timestamp: 7, errorText: 'net::ERR_FAILED' });
    const records = trace.records();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ complete: true, connection: { protocol: null, reused: null },
      browser: { dnsMs: null, connectMs: null, tlsMs: null, sendMs: null, waitMs: null, headersStartMs: null, headersEndMs: null, bodyCompleteMs: null, failedMs: 250 },
      failure: { errorText: 'net::ERR_CONNECTION_RESET', canceled: false }, response: { status: 409, contentType: null } });
    session.emit('Network.loadingFailed', { requestId: 'r2', timestamp: 6, errorText: 'net::<img src=x> leaked email-sentinel@example.invalid' });
    expect(trace.records()[0]!.failure!.errorText).toBe('net::UNKNOWN');
  });

  it('rejects arbitrary or unsafe header values instead of truncating them', () => {
    expect(sanitizeHeader('x-request-id', 'bad value <script>')).toBeNull();
    expect(sanitizeHeader('x-request-id', 'email-sentinel@example.invalid')).toBeNull();
    expect(sanitizeHeader('x-request-id', 'a'.repeat(200))).toBeNull();
    expect(sanitizeHeader('x-vercel-id', 'sin1::iad1::abcde-1790208017480-0123456789ab\r\nset-cookie: x')).toBeNull();
    expect(sanitizeHeader('x-vercel-id', 'sin1::sin1::xz9xx-1790243561504-48ab0f0d95c1')).toBe('sin1::sin1::xz9xx-1790243561504-48ab0f0d95c1');
    expect(sanitizeHeader('cf-ray', '8c1d2e3f4a5b6c7d-SIN')).toBe('8c1d2e3f4a5b6c7d-SIN');
    expect(sanitizeHeader('cf-ray', '8c1d2e3f4a5b6c7d-SIN; secret')).toBeNull();
    expect(sanitizeHeader('server', 'x'.repeat(41))).toBeNull();
    expect(sanitizeHeader('cookie', 'anything')).toBeNull();
    expect(sanitizeHeader('age', '12')).toBe('12');
    expect(sanitizeHeader('age', '-1')).toBeNull();
    expect(sanitizeContentType('application/json; charset=utf-8')).toBe('application/json');
    expect(sanitizeContentType('text/html; <script>')).toBe('text/html');
    expect(sanitizeContentType('evil')).toBeNull();
    expect(sanitizeServerTiming('db;dur=12.5;desc="SECRET_DESC_SENTINEL", cache;desc="hit", bad name;dur=1')).toEqual([{ name: 'db', durMs: 12.5 }, { name: 'cache' }]);
    expect(sanitizeProtocol('h2')).toBe('h2');
    expect(sanitizeProtocol('http/1.1')).toBe('http/1.1');
    expect(sanitizeProtocol('gopher')).toBeNull();
  });

  it('never persists cookies, authorization, Turnstile token, fingerprint, request body, customer data, IPs or other headers', () => withDirectory(async directory => {
    const session = new FakeSession();
    const set = new ProviderTraceSet('run-1', 'release', 1_790_208_000_000, () => 100);
    set.start({ workerId: 'A', attemptId: 'core-A-official-1', court: 3, startTime: '15:00', endTime: '18:00' }, async () => session);
    await set.ready(1_000);
    set.postInitiated('A');
    await new Promise(done => setImmediate(done));
    await new Promise(done => setImmediate(done));
    emitCheckout(session, 'req-1', { 'x-request-id': 'CUSTOMER 11111111-2222-4333-8444-555555555555' });
    const path = await set.persist(directory);
    const text = await readFile(path!, 'utf8');
    for (const secret of SECRETS) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/cookie|authorization|turnstile|fingerprint|postData|remoteIP|securityDetails|headersText|customer/i);
    const [header, record] = text.trim().split('\n').map(line => JSON.parse(line));
    expect(header).toMatchObject({ type: 'header', runId: 'run-1', reference: 'release', traces: [{ workerId: 'A', status: 'active' }] });
    expect(record).toMatchObject({ type: 'provider-trace', workerId: 'A', response: { requestId: null, status: 409 } });
    // Persisted once; a second call returns the same file without rewriting it.
    expect(await set.persist(directory)).toBe(path);
  }));

  it('a failing DevTools session or attach leaves the trace unavailable and never throws', async () => {
    const rejected = new CheckoutProviderTrace({ workerId: 'A' }, () => 0);
    expect(await rejected.attach(async () => { throw Error('CDP_ATTACH_REFUSED'); })).toBe(false);
    expect(rejected.status).toBe('unavailable');
    const failingSend = new FakeSession(true);
    const failing = new CheckoutProviderTrace({ workerId: 'B' }, () => 0);
    expect(await failing.attach(async () => failingSend)).toBe(true);
    expect(await failing.enable()).toBe(false);
    expect(failing.status).toBe('unavailable');
    expect(failing.failureCode).toBe('CDP_GONE');
    const slow = new CheckoutProviderTrace({ workerId: 'C' }, () => 0);
    const late = new FakeSession();
    expect(await slow.attach(() => new Promise(done => setTimeout(() => done(late), 100)), 20)).toBe(false);
    await new Promise(done => setTimeout(done, 150));
    // A session that arrives after the timeout is closed and never enabled.
    expect(late.sent).toEqual([]);
    expect(late.detached).toBe(true);
    const set = new ProviderTraceSet('run-2', 'release', 0, () => { throw Error('clock broken'); });
    set.start({ workerId: 'A' }, async () => { throw Error('CDP_GONE'); });
    set.start({ workerId: 'B' }, () => { throw Error('SYNC_THROW'); });
    await set.ready(500);
    set.postInitiated('A'); set.postInitiated('unknown-worker'); set.enableAll();
    await new Promise(done => setImmediate(done));
    expect(set.statuses().map(value => value.status)).toEqual(['unavailable', 'unavailable']);
    expect(set.records()).toEqual([]);
  });
});

describe('passive checkout provider trace in real Chrome', () => {
  let browser: Browser, server: Server, port = 0;
  const received: Array<{ method: string; url: string; headers: IncomingHttpHeaders; body: string }> = [];
  let postCount = 0;
  beforeAll(async () => {
    server = createServer((request, response) => {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        if (request.method !== 'POST') { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<!doctype html><title>trace fixture</title>'); return; }
        received.push({ method: request.method!, url: request.url!, headers: request.headers, body });
        // First POST closes its connection so the next one must open a new one; then it is reused.
        const close = ++postCount === 1;
        // Headers after 200 ms (the trace is enabled while the POST is in flight), body 150 ms later.
        setTimeout(() => {
          response.writeHead(409, { 'content-type': 'application/json; charset=utf-8', server: 'fixture', 'x-request-id': `req-fixture-${postCount}-abcdef`,
            'x-vercel-id': 'sin1::sin1::xz9xx-1790243561504-48ab0f0d95c1', 'server-timing': 'app;dur=5;desc="internal"', ...(close ? { connection: 'close' } : {}) });
          response.flushHeaders();
          setTimeout(() => response.end('{"success":false,"error":"fixture conflict"}'), 150);
        }, 200);
      });
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', () => { port = (server.address() as { port: number }).port; done(); }));
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) });
  });
  afterAll(async () => { await browser?.close(); server?.close(); });

  /** Starts the POST in the page; resolves once the request is in flight, with a promise of its result. */
  const post = async (page: Page) => {
    await page.evaluate(url => { (window as unknown as { pending: Promise<unknown> }).pending = fetch(url, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Turnstile-Token': 'TURNSTILE_SENTINEL', 'X-Onda-Public-Fingerprint': 'FINGERPRINT_SENTINEL' },
      body: JSON.stringify({ customerEmail: 'email-sentinel@example.invalid' }) }).then(async response => ({ status: response.status, body: await response.text() })); },
    `http://127.0.0.1:${port}/api/bookings/public-checkout`);
    await new Promise(done => setTimeout(done, 60));
    return { result: () => page.evaluate(() => (window as unknown as { pending: Promise<{ status: number; body: string }> }).pending) };
  };

  it('leaves the request bytes unchanged and captures protocol, reuse, connection timing and header vs body time', async () => {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    const untraced = await (await post(page)).result();
    const session = await page.context().newCDPSession(page);
    const commands: string[] = [];
    const send = session.send.bind(session) as CdpSessionLike['send'];
    const recording: CdpSessionLike = { on: (event, listener) => session.on(event as never, listener as never), off: (event, listener) => session.off(event as never, listener as never),
      send: (method, params) => { commands.push(method); return send(method, params); }, detach: () => session.detach() };
    const trace = new CheckoutProviderTrace({ workerId: 'A' }, () => 0, `http://127.0.0.1:${port}/api/bookings/public-checkout`);
    expect(await trace.attach(async () => recording)).toBe(true);
    // As in a release: the trace is enabled only once the POST is already in flight.
    const firstPost = await post(page);
    expect(await trace.enable()).toBe(true);
    const first = await firstPost.result(), second = await (await post(page)).result();
    await new Promise(done => setTimeout(done, 100));
    const records = trace.records();
    await trace.detach();
    await page.close();
    expect([untraced, first, second].map(value => value.status)).toEqual([409, 409, 409]);
    expect(first.body).toBe(untraced.body);
    // Byte-identical requests with and without the trace (headers, body, method, path).
    expect(received).toHaveLength(3);
    for (const traced of received.slice(1)) {
      expect(traced.method).toBe(received[0]!.method);
      expect(traced.url).toBe(received[0]!.url);
      expect(traced.body).toBe(received[0]!.body);
      expect(traced.headers).toEqual(received[0]!.headers);
    }
    expect(commands).toEqual(['Network.enable', 'Network.disable']);
    expect(records).toHaveLength(2);
    const [fresh, reused] = records;
    expect(fresh).toMatchObject({ complete: true, connection: { protocol: 'http/1.1' }, response: { status: 409, contentType: 'application/json',
      server: 'fixture', requestId: 'req-fixture-2-abcdef', vercelId: 'sin1::sin1::xz9xx-1790243561504-48ab0f0d95c1', serverTiming: [{ name: 'app', durMs: 5 }] } });
    // Chrome may open another connection during the untraced request, so the first
    // traced request can reuse it even when that earlier POST asks to close its own.
    if (!fresh!.connection.reused) expect(fresh!.browser.connectMs).not.toBeNull();
    expect(reused).toMatchObject({ complete: true, connection: { protocol: 'http/1.1', reused: true }, browser: { dnsMs: null, connectMs: null, tlsMs: null } });
    for (const record of records) {
      expect(record.browser.headersStartMs).toBeGreaterThan(150);
      expect(record.browser.bodyCompleteMs! - record.browser.headersEndMs!).toBeGreaterThan(100);
    }
    expect(JSON.stringify(records)).not.toMatch(/SENTINEL|sentinel/);
  });

  it('with the real checkout transport, the POST Chrome sends is identical with and without the trace', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'thirsty-trace-transport-'));
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    try {
      const facilityId = '5f8786bd-dc61-4509-b893-74cda8f783f7', spaceId = '0e853a91-33b6-4de2-9237-778007a9313b', date = '2026-09-26';
      const checkout = { bookingType: 'online', clientId: 'synthetic-client', customerId: 'synthetic-customer', customerEmail: 'example@test.invalid', customerPhone: '0000000000',
        customerFirstName: null, customerLastName: null, facilityId, usedCustomerMembershipId: null, userId: null,
        items: [{ spaceId, date, startTime: '15:00', endTime: '16:00', availabilityProof: 'synthetic-proof', activityKey: null, activityLabel: null, chargedAmount: 600,
          duration: 60, facilityId, guestCount: 1, promotionId: null, rate: 600, sessionRef: 'session_1' }] } as unknown as TwoHourCheckoutRequest;
      const run = async (traced: boolean) => {
        const page = await browser.newPage();
        const seen: Array<{ headers: Record<string, string>; body: string | null; url: string; method: string }> = [];
        await page.route('https://app.onda.fit/**', async route => {
          const request = route.request();
          if (request.method() === 'POST') { seen.push({ headers: request.headers(), body: request.postData(), url: request.url(), method: request.method() });
            await new Promise(done => setTimeout(done, 100));
            await route.fulfill({ status: 409, contentType: 'application/json', body: '{"success":false,"error":"Slot no longer available"}' }); return; }
          await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>fixture</title>' });
        });
        await page.goto('https://app.onda.fit/book/thirsty-pickle');
        const trace = traced ? new CheckoutProviderTrace({ workerId: 'A' }, () => 0) : undefined;
        if (trace) {
          expect(await trace.attach(async () => page.context().newCDPSession(page) as unknown as CdpSessionLike)).toBe(true);
          // The runner enables from the POST's request event; mirror it.
          page.on('request', request => { if (request.method() === 'POST') setImmediate(() => { void trace.enable(); }); });
        }
        const journalDirectory = join(directory, traced ? 'traced' : 'plain'), journal = new DurableSubmissionJournal(journalDirectory);
        const key = DurableSubmissionJournal.key(facilityId, spaceId, date, '15:00', '16:00');
        await journal.begin(key);
        const permit = await journal.claimSupervisedOneShot(key);
        const transport = new OndaBrowserSessionTransport(page, async () => ({ turnstileToken: 'synthetic-token', publicFingerprint: 'synthetic-print' }));
        const error = await transport.publicCheckout(checkout, permit).then(() => ({} as { code?: string; dispatched?: boolean; diagnostic?: unknown }),
          (value: unknown) => value as { code?: string; dispatched?: boolean; diagnostic?: unknown });
        await new Promise(done => setTimeout(done, 50));
        const records = trace?.records() ?? [];
        await trace?.detach();
        await page.close();
        return { seen, error: { code: error.code, dispatched: error.dispatched, diagnostic: error.diagnostic }, records };
      };
      const plain = await run(false), traced = await run(true);
      expect(traced.seen).toEqual(plain.seen);
      expect(traced.seen).toHaveLength(1);
      expect(traced.error).toEqual(plain.error);
      expect(plain.error).toMatchObject({ code: 'ONDA_HTTP_STATUS_INVALID', dispatched: true });
      expect(traced.records).toHaveLength(1);
      expect(traced.records[0]).toMatchObject({ complete: true, response: { status: 409 } });
    } finally {
      delete process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT;
      if (resolve(directory).startsWith(resolve(tmpdir()) + sep)) await rm(directory, { recursive: true, force: true });
    }
  });
});
