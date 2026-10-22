import { installAvailabilityHelper } from './availability-browser-fixture.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { checkAvailability, cellsFromSnapshot } from '../src/api-booking/availability-observer.js';
import { MANGO_SPACE_IDS, BUKO_SPACE_IDS } from '../src/court-registry.js';
import { ONDA_URL, VENUE } from '../src/config.js';

const DATE = '2026-10-16';
/** Provider-shaped response containing both wings, as the real endpoint returns them. */
function bothWings(date: string) {
  const slot = (start: number, open: boolean, price: number) => ({ date, bookingDate: date, startTime: `${String(start).padStart(2, '0')}:00`, endTime: start === 23 ? '24:00' : `${String(start + 1).padStart(2, '0')}:00`,
    isAvailable: open, isNightRate: start >= 16, pricing: { currency: 'PHP', amount: price } });
  const slotsBySpace: Record<string, unknown[]> = {};
  for (const [court, id] of Object.entries(MANGO_SPACE_IDS)) slotsBySpace[id] = Array.from({ length: 16 }, (_, i) => slot(8 + i, !(Number(court) === 1 && i + 8 === 19), i + 8 >= 16 ? 700 : 600));
  // Weekday Buko: evening hours only. Missing morning cells must stay UNKNOWN, never open.
  for (const id of Object.values(BUKO_SPACE_IDS)) slotsBySpace[id] = Array.from({ length: 8 }, (_, i) => slot(16 + i, i % 2 === 0, 700));
  return { success: true, data: { dates: { [date]: true }, slotsBySpace } };
}
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterAll(async () => { await browser.close(); });
async function fixtureSession(respond: (url: URL) => { status: number; body: unknown }) {
  const context = await browser.newContext(); await installAvailabilityHelper(context); let posts = 0, reads = 0;
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() !== 'GET') { posts++; await route.abort(); return; }
    if (url.pathname.endsWith('/date-availability')) { reads++; const r = respond(url); await route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) }); return; }
    await route.fulfill({ contentType: 'text/html', body: `<h1 data-testid="public-booking-hero-title">${VENUE}</h1>` });
  });
  const page = await context.newPage(); await page.goto(ONDA_URL);
  return { session: { page, close: () => context.close() }, counts: () => ({ posts, reads }), page };
}

describe('one-click read-only availability', () => {
  it('maps every registered court/hour to OPEN, BLOCKED, UNRELEASED or UNKNOWN without inventing openness', () => {
    expect(cellsFromSnapshot('BUKO', DATE, null).every(c => c.state === 'UNKNOWN' && !c.available)).toBe(true);
    expect(cellsFromSnapshot('MANGO', DATE, { slots: [], emptyUnreleasedResponse: true }).every(c => c.state === 'UNRELEASED')).toBe(true);
    const cells = cellsFromSnapshot('MANGO', DATE, { slots: [{ court: 2, date: DATE, startTime: '19:00', isAvailable: true, price: 700 }] });
    expect(cells).toHaveLength(112);
    expect(cells.find(c => c.court === 2 && c.start === '19:00')).toMatchObject({ state: 'OPEN', price: 700 });
    expect(cells.filter(c => c.state === 'UNKNOWN')).toHaveLength(111);
  });
  it('reads both wings through its own session, records freshness and prices and sends no POST', async () => {
    const fixture = await fixtureSession(() => ({ status: 200, body: bothWings(DATE) }));
    const check = await checkAvailability(DATE, { directory: 'unused-offline', open: async () => fixture.session });
    expect(check.wings.map(w => [w.wing, w.status, w.cells])).toEqual([['MANGO', 'OK', 112], ['BUKO', 'OK', 56]]);
    expect(check.cells.find(c => c.wing === 'MANGO' && c.court === 1 && c.start === '19:00')).toMatchObject({ state: 'BLOCKED', price: 700 });
    expect(check.cells.find(c => c.wing === 'MANGO' && c.court === 2 && c.start === '09:00')).toMatchObject({ state: 'OPEN', price: 600 });
    expect(check.cells.find(c => c.wing === 'BUKO' && c.court === 3 && c.start === '09:00')!.state).toBe('UNKNOWN');
    expect(check.cells.filter(c => c.wing === 'BUKO' && c.state === 'OPEN')).toHaveLength(28);
    expect(Date.parse(check.capturedAt)).toBeLessThanOrEqual(Math.min(...check.wings.map(w => Date.parse(w.capturedAt!))));
    expect(fixture.counts()).toEqual({ posts: 0, reads: 2 });
  });
  it('distinguishes an unreleased date from unavailable cells', async () => {
    const fixture = await fixtureSession(() => ({ status: 200, body: { success: true, data: { dates: {}, slotsBySpace: {} } } }));
    const check = await checkAvailability('2026-10-25', { directory: 'unused-offline', open: async () => fixture.session });
    expect(check.wings.every(w => w.status === 'UNRELEASED')).toBe(true);
    expect(check.cells.every(c => c.state === 'UNRELEASED')).toBe(true);
  });
  it('isolates a provider refusal to its wing and reports it as UNKNOWN', async () => {
    let call = 0;
    const fixture = await fixtureSession(() => ++call === 2 ? { status: 403, body: { success: false } } : { status: 200, body: bothWings(DATE) });
    const check = await checkAvailability(DATE, { directory: 'unused-offline', open: async () => fixture.session });
    expect(check.wings[0]!.status).toBe('OK');
    expect(check.wings[1]).toMatchObject({ wing: 'BUKO', status: 'ERROR', code: 'AVAILABILITY_HTTP_FAILED' });
    expect(check.cells.filter(c => c.wing === 'BUKO').every(c => c.state === 'UNKNOWN')).toBe(true);
  });
});
