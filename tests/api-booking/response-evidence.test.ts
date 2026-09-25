import { describe, expect, it } from 'vitest';
import { parseHttpDate, parseVercelId, redactText, responseBodyEvidence, responseEvidence, sanitizeResponseHeaders }
  from '../../src/api-booking/response-evidence.js';

// Synthetic private values. None of them may appear anywhere in stored evidence.
const PRIVATE = {
  email: 'juan.dela.cruz+court@example.invalid',
  phone: '09171234567',
  name: 'Juan Dela Cruz',
  customerId: '1f2e3d4c-5b6a-4789-8abc-def012345678',
  clientId: 'c0ffee00-1234-4abc-9def-00000000c11e',
  turnstile: '0.AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdEfGhIjKlMnOp',
  fingerprint: 'fp_9a8b7c6d5e4f3a2b1c0d',
  cookie: 'sb-access-token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl',
};
const known = Object.values(PRIVATE);
const assertNoPrivate = (value: unknown) => {
  const text = JSON.stringify(value).toLowerCase();
  for (const secret of [...known, '9171234567', 'juan', 'dela cruz', 'example.invalid', 'eyjhbgci']) expect(text).not.toContain(secret.toLowerCase());
};

describe('redactText', () => {
  it('removes known private values before any pattern rule', () => {
    const counts: Record<string, number> = {};
    const text = redactText(`Customer ${PRIVATE.name} (${PRIVATE.email}, ${PRIVATE.phone}) already holds this slot`, known, counts);
    assertNoPrivate(text);
    expect(counts.known).toBeGreaterThanOrEqual(3);
  });

  it('removes generic identifiers, contacts, tokens and names that the caller did not know', () => {
    const counts: Record<string, number> = {};
    const text = redactText([
      'Contact maria.santos@example.org or +63 917 765 4321 / 0917-765-4321.',
      'Booking BK20260927001 by Maria Santos conflicts (session 3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b).',
      'token eyJhbGciOiJIUzI1NiJ9.eyJmb28iOiJiYXIifQ.abcdefghijkl hex deadbeefdeadbeefdeadbeef',
      'see https://app.onda.fit/checkout?bookingId=abc123def456 raw 123456789012',
    ].join(' '), [], counts);
    for (const leaked of ['maria', 'santos', '917 765', '0917', 'bk2026', '3e4f5a6b', 'eyjhbg', 'deadbeef', 'onda.fit/checkout', '123456789012'])
      expect(text.toLowerCase()).not.toContain(leaked);
    expect(Object.keys(counts).sort()).toEqual(expect.arrayContaining(['email', 'phone', 'uuid', 'jwt', 'hex', 'url', 'name']));
  });

  it('keeps the operational words, dates, times, courts and prices that make a message useful', () => {
    const text = redactText('Court 7: Mango Wing is unavailable on 2026-09-27 from 19:00 to 22:00 (PHP 2100). Please Try Again.');
    expect(text).toBe('Court 7: Mango Wing is unavailable on 2026-09-27 from 19:00 to 22:00 (PHP 2100). Please Try Again.');
    expect(redactText('This booking date is not available yet.')).toBe('This booking date is not available yet.');
  });

  it('bounds length and strips control characters', () => {
    const text = redactText(`line\none\u0000${'x '.repeat(400)}`);
    expect(text.length).toBeLessThanOrEqual(301);
    expect(text).not.toMatch(/[\u0000-\u001f]/);
  });
});

describe('responseBodyEvidence', () => {
  const short = JSON.stringify({ success: false, error: 'The selected slot is no longer available.' });
  const long = JSON.stringify({ success: false, error: `Slot conflict for ${PRIVATE.name}`, code: 'SLOT_CONFLICT',
    conflicts: [{ spaceId: '0e853a91-33b6-4de2-9237-778007a9313b', date: '2026-09-27', startTime: '19:00:00', endTime: '20:00:00', customerEmail: PRIVATE.email }],
    customer: { email: PRIVATE.email, phone: PRIVATE.phone, id: PRIVATE.customerId } });

  it('keeps structure, lengths and sanitized allowlisted fields but never raw text', () => {
    const evidence = responseBodyEvidence(long, 'application/json; charset=utf-8', known);
    assertNoPrivate(evidence);
    expect(evidence.byteLength).toBe(Buffer.byteLength(long));
    expect(evidence.contentKind).toBe('json');
    expect(evidence.shape).toEqual(expect.arrayContaining([
      { path: '$', type: 'object' }, { path: 'code', type: 'string', length: 13 }, { path: 'conflicts', type: 'array', length: 1 },
      { path: 'conflicts[].startTime', type: 'string', length: 8 }, { path: 'customer.email', type: 'string', length: PRIVATE.email.length },
    ]));
    expect(evidence.fields).toMatchObject({ success: false, code: 'SLOT_CONFLICT', error: 'Slot conflict for [redacted]' });
    // Non-allowlisted keys (customer.email, conflicts[].customerEmail) contribute only a type and length.
    expect(JSON.stringify(evidence)).not.toContain('@');
  });

  it('separates two bodies of different structure (the ~220 B / ~400 B question) and groups same-structure bodies', () => {
    const a = responseBodyEvidence(short, 'application/json', known), b = responseBodyEvidence(long, 'application/json', known);
    expect(a.shapeFingerprint).not.toBe(b.shapeFingerprint);
    const otherCustomer = responseBodyEvidence(long.replaceAll(PRIVATE.email, 'someone.else@example.invalid').replaceAll(PRIVATE.name, 'Pedro Penduko'),
      'application/json', [...known, 'someone.else@example.invalid', 'Pedro Penduko']);
    expect(otherCustomer.shapeFingerprint).toBe(b.shapeFingerprint);
    expect(otherCustomer.sanitizedFingerprint).not.toBe(b.sanitizedFingerprint); // string lengths differ with the e-mail
  });

  it('never parses or keeps text from HTML, plain text, invalid JSON or oversized bodies', () => {
    for (const [body, type] of [[`<html><body>${PRIVATE.email}</body></html>`, 'text/html'], [`${PRIVATE.name}`, 'text/plain'],
      [`{"error":"${PRIVATE.email}"`, 'application/json'], ['', 'application/json']] as const) {
      const evidence = responseBodyEvidence(body, type, known);
      assertNoPrivate(evidence);
      expect(evidence.fields).toBeUndefined();
      expect(evidence.shape).toBeUndefined();
    }
    const huge = JSON.stringify({ error: PRIVATE.email, pad: 'x'.repeat(1_100_000) });
    expect(responseBodyEvidence(huge, 'application/json', known)).toEqual({ version: 1, byteLength: Buffer.byteLength(huge), contentKind: 'json' });
  });

  it('bounds the shape of deep or wide payloads', () => {
    const wide = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`k${index}`, index]));
    const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
    expect(responseBodyEvidence(JSON.stringify(wide), 'application/json').shape!.length).toBeLessThanOrEqual(64);
    expect(responseBodyEvidence(JSON.stringify(wide), 'application/json').shapeTruncated).toBe(true);
    expect(responseBodyEvidence(JSON.stringify(deep), 'application/json').shapeTruncated).toBe(true);
    const weirdKeys = responseBodyEvidence(JSON.stringify({ [PRIVATE.email]: 1, 'a b': 2 }), 'application/json', known);
    assertNoPrivate(weirdKeys);
    expect(weirdKeys.shape!.map(entry => entry.path)).toEqual(['$', '<key>', '<key>']);
  });
});

describe('response headers', () => {
  it('keeps only allowlisted, valid headers', () => {
    const headers = sanitizeResponseHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': PRIVATE.cookie,
      Authorization: `Bearer ${PRIVATE.turnstile}`, 'X-Turnstile-Token': PRIVATE.turnstile, 'X-Vercel-Id': 'sin1::sin1::p8z7w-1790294400030-a73f748bcd1f',
      'x-vercel-cache': 'MISS', date: 'Fri, 25 Sep 2026 00:00:29 GMT', 'server-timing': 'db;dur=12.5;desc="secret query", app;dur=3',
      'content-length': '397', 'x-matched-path': '/api/bookings/public-checkout', 'x-ratelimit-remaining': '4', server: 'Vercel',
      'x-request-id': `${PRIVATE.email}`, 'cache-control': 'private, no-cache, no-store, max-age=0, must-revalidate' });
    assertNoPrivate(headers);
    expect(headers).toEqual({ 'content-type': 'application/json', 'content-length': '397', server: 'Vercel', date: 'Fri, 25 Sep 2026 00:00:29 GMT',
      'cache-control': 'private, no-cache, no-store, max-age=0, must-revalidate', 'x-vercel-id': 'sin1::sin1::p8z7w-1790294400030-a73f748bcd1f',
      'x-vercel-cache': 'MISS', 'x-matched-path': '/api/bookings/public-checkout', 'server-timing': 'db;dur=12.5, app;dur=3', 'x-ratelimit-remaining': '4' });
  });

  it('parses x-vercel-id regions and its undocumented embedded number without trusting it', () => {
    expect(parseVercelId('sin1::sin1::p8z7w-1790294400030-a73f748bcd1f')).toEqual({ regions: ['sin1', 'sin1'], edgeRegion: 'sin1', functionRegion: 'sin1',
      embeddedMs: 1790294400030, embeddedInterpretation: 'UNDOCUMENTED' });
    expect(parseVercelId('hkg1::iad1::abcde-1790294400030-a73f748bcd1f')?.functionRegion).toBe('iad1');
    // A 10-digit (seconds-like) number is a valid id but is not surfaced as milliseconds.
    expect(parseVercelId('sin1::abcde-1790294400-a73f748bcd1f')).toMatchObject({ functionRegion: null, embeddedMs: null });
    for (const bad of ['', 'sin1', 'sin1::sin1::p8z7w', `${PRIVATE.email}`, null, 42]) expect(parseVercelId(bad)).toBeNull();
    expect(parseHttpDate('Fri, 25 Sep 2026 00:00:29 GMT')).toBe(Date.UTC(2026, 8, 25, 0, 0, 29));
    expect(parseHttpDate('yesterday')).toBeNull();
  });

  it('builds complete response evidence and never throws on hostile input', () => {
    const evidence = responseEvidence({ status: 409, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Slot unavailable' }),
      headers: { 'x-vercel-id': 'sin1::sin1::p8z7w-1790294400030-a73f748bcd1f', date: 'Fri, 25 Sep 2026 00:00:34 GMT', 'server-timing': 'total;dur=29000' } }, known);
    expect(evidence).toMatchObject({ status: 409, vercel: { embeddedMs: 1790294400030 }, serverDateMs: Date.UTC(2026, 8, 25, 0, 0, 34),
      serverTiming: [{ name: 'total', durMs: 29000 }], body: { fields: { success: false, error: 'Slot unavailable' } } });
    expect(() => responseEvidence({ status: NaN, contentType: undefined as unknown as string, body: undefined as unknown as string, headers: null as never })).not.toThrow();
  });
});
