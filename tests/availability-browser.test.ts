import { beforeAll, beforeEach, afterEach, afterAll, it, expect, vi } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { readFile } from 'node:fs/promises';
import { ONDA_URL } from '../src/config.js';
import { Safety } from '../src/safety.js';
import { Telemetry } from '../src/telemetry.js';
import { browserAvailabilityRequest, releaseAvailabilityRequest } from '../src/availability-discovery.js';
import { compareCurrentAvailability } from '../src/availability-compare.js';
import { COURT_TO_SPACE_ID } from '../src/onda-availability.js';
import { availabilityFixture, availabilityDate as date } from './availability-fixture.js';
let browser: Browser, page: Page;
let requests: { method: string; path: string; query: string }[];
beforeAll(async () => { browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) }); });
beforeEach(async () => {
  page = await browser.newPage(); requests = [];
  const fixture = (await readFile('fixtures/schedule.html', 'utf8')).replace('</script>', `
    window.actions=[];
    const filter=document.createElement('span');filter.dataset.testid='booking-court-filter-label';filter.textContent='All Courts';document.body.append(filter);
    const picker=document.createElement('button');picker.setAttribute('aria-label','Select booking date');picker.setAttribute('aria-expanded','false');document.body.append(picker);
    const day=document.createElement('button');day.dataset.day='9/13/2026';day.hidden=true;document.body.append(day);
    picker.onclick=()=>{day.hidden=!day.hidden;picker.setAttribute('aria-expanded',String(!day.hidden));window.actions.push('picker');};
    day.onclick=()=>{render('2026-09-13');document.querySelector('h3').textContent='Sun, September 13';day.hidden=true;picker.setAttribute('aria-expanded','false');window.actions.push('date');};
    document.addEventListener('click',e=>{if(e.target.closest('[data-testid="court-schedule-slot-cell"]'))window.actions.push('SLOT');});
    </script>`);
  await page.route('**/*', r => r.request().isNavigationRequest() ? r.fulfill({ body: fixture, contentType: 'text/html' }) : r.abort());
  await page.route('**/date-availability?*', async r => {
    const url = new URL(r.request().url()); requests.push({ method: r.request().method(), path: url.pathname, query: url.search });
    const raw = availabilityFixture(); raw.data.slotsBySpace[COURT_TO_SPACE_ID[3]]!.forEach(s => { s.isAvailable = false; });
    await r.fulfill({ json: raw });
  });
  await page.goto(ONDA_URL);
});
afterEach(async () => { await page.close(); });
afterAll(async () => { await browser.close(); });
it('compare navigates normally, makes one exact same-origin GET and performs no booking clicks', async () => {
  const t = new Telemetry(), report = await compareCurrentAvailability(page, date, new Safety(), t);
  expect(report).toMatchObject({ targetDate: date, knownCourts: 7, hourSlotsParsed: 112, availableCount: 96, agreed: 112, domOpenApiClosed: 0, domClosedApiOpen: 0, unknownSpaces: 0 });
  expect(requests).toHaveLength(1); expect(requests[0]!.method).toBe('GET');
  expect(requests[0]!.query).toBe(`?startDate=${date}&endDate=${date}&duration=60&includeSchedule=true&slotDateMode=web-operating-day`);
  expect(await page.evaluate(() => (window as any).actions)).toEqual(['picker', 'date']);
  expect(JSON.stringify(report)).not.toMatch(/https?:|spaceId|cookie|token|pricing|@/);
});
it.each(['malformed', 'schema', '5xx', 'route', 'wrongDate'])('degrades %s response without resetting Safety or retrying', async kind => {
  let count = 0;
  await page.route('**/date-availability?*', async r => {
    count++;
    if (kind === 'malformed') await r.fulfill({ body: '{broken', contentType: 'application/json' });
    else if (kind === 'schema') await r.fulfill({ json: { success: false } });
    else if (kind === 'wrongDate') await r.fulfill({ json: availabilityFixture('2026-09-12') });
    else await r.fulfill({ status: kind === '5xx' ? 503 : 404, body: 'Unavailable' });
  });
  const safety = new Safety(), t = new Telemetry();
  expect(await browserAvailabilityRequest(page, date, safety, t)()).toBeUndefined();
  expect(safety.signal.aborted).toBe(false); expect(count).toBe(1);
  expect(t.events.some(e => e.event === 'availabilityFallbackToUi')).toBe(true);
});
it.each(['429', 'retry', '403', '401', 'challenge', 'challengeHeader'])('hard stops on %s with sanitized evidence', async kind => {
  await page.route('**/date-availability?*', r => r.fulfill({ status: ['429', '403', '401'].includes(kind) ? Number(kind) : 200,
    headers: kind === 'retry' ? { 'retry-after': '30' } : kind === 'challengeHeader' ? { 'cf-mitigated': 'challenge' } : {},
    contentType: 'text/html', body: 'Verify you are human' }));
  const safety = new Safety(), t = new Telemetry();
  await browserAvailabilityRequest(page, date, safety, t)();
  expect(safety.signal.aborted).toBe(true);
  expect(() => safety.check()).toThrow(kind === '429' || kind === 'retry' ? 'RATE_LIMITED' : kind === '403' || kind === '401' ? 'ACCESS_BLOCKED' : 'SECURITY_CHALLENGE');
  expect(JSON.stringify(t.events)).not.toMatch(/Verify you|retry-after|https?:|startDate/);
});
it('timeout aborts the browser fetch and produces only optional fallback', async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/date-availability?*', async r => { await pending; await r.fulfill({ json: availabilityFixture() }).catch(() => {}); });
  const safety = new Safety();
  try { expect(await browserAvailabilityRequest(page, date, safety, new Telemetry(), 50)()).toBeUndefined(); }
  finally { finish(); }
  expect(safety.signal.aborted).toBe(false);
});
it('a reload-destroyed browser request is not retried', async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/date-availability?*', async r => { await pending; await r.fulfill({ json: availabilityFixture() }).catch(() => {}); });
  const requestSeen = page.waitForRequest(r => r.url().includes('/date-availability?'));
  const t = new Telemetry();
  const request = browserAvailabilityRequest(page, date, new Safety(), t)();
  await requestSeen; await page.reload({ waitUntil: 'commit' });
  try { expect(await request).toBeUndefined(); } finally { finish(); }
  expect(t.events.map(e => e.event)).toContain('availabilityPageContextDestroyed');
});
it('release request parses a post-release response despite a simultaneous page reload', async () => {
  const t = new Telemetry(), safety = new Safety();
  const get = vi.spyOn(page.context().request, 'get').mockImplementation(async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
    return { status: () => 200, headers: () => ({ 'content-type': 'application/json' }),
      body: async () => Buffer.from(JSON.stringify(availabilityFixture())) } as any;
  });
  try {
    const request = releaseAvailabilityRequest(page, date, safety, t)();
    await page.reload({ waitUntil: 'commit' });
    const result = await request;
    expect(result?.targetDate).toBe(date);
    expect(result?.slots).toHaveLength(112);
    expect(t.events.map(e => e.event)).toContain('availabilityParsed');
    expect(t.events.map(e => e.event)).not.toContain('availabilityFallbackToUi');
    expect(get).toHaveBeenCalledOnce();
  } finally { get.mockRestore(); }
});
it('retries the exact unreleased empty response and uses the first fresh released snapshot', async () => {
  let calls = 0;
  const get = vi.spyOn(page.context().request, 'get').mockImplementation(async () => {
    const raw = ++calls === 1 ? { success: true, data: { dates: {}, slotsBySpace: {} } } : availabilityFixture();
    return { status: () => 200, headers: () => ({ 'content-type': 'application/json' }),
      body: async () => Buffer.from(JSON.stringify(raw)) } as any;
  });
  const t = new Telemetry();
  try {
    const result = await releaseAvailabilityRequest(page, date, new Safety(), t)();
    expect(calls).toBe(2);
    expect(result?.released).toBe(true);
    expect(result?.slots).toHaveLength(112);
    expect(t.events.map(event => event.event)).toContain('availabilityDateNotReleased');
    expect(t.events.map(event => event.event)).not.toContain('availabilityFallbackToUi');
  } finally { get.mockRestore(); }
});
it('refuses a dirty compare before any availability request', async () => {
  await page.getByTestId('court-schedule-slot-cell').first().click();
  await expect(compareCurrentAvailability(page, date, new Safety(), new Telemetry())).rejects.toThrow('DIAGNOSTIC_SCHEDULE_NOT_CLEAN');
  expect(requests).toHaveLength(0);
});

// Exercises the actual dry command boundary on the same routed browser fixture.
it('hybrid dry uses current plan, one GET and only calendar clicks', async () => {
  const { dryCurrentAvailability } = await import('../src/availability-dry.js');
  const { ConfigSchema } = await import('../src/config.js');
  const config = ConfigSchema.parse({ START_TIME:'19:00', DURATION_HOURS:2, PREFERRED_COURTS:[5,7,6,4,3,2,1],
    FALLBACK_TIMES:['18:00'], MAX_PRICE:1200, PLAYER_FULL_NAME:'Fixture Player', PLAYER_PHONE:'09123456789', PLAYER_EMAIL:'fixture@example.test' });
  const report = await dryCurrentAvailability(page, date, config, new Safety(), new Telemetry());
  expect(report).toMatchObject({ pass:true, candidateSource:'API+UI', chosen:{court:5,hours:['19:00','20:00']}, slotClicks:0, proceedClicks:0 });
  expect(requests).toHaveLength(1);
  expect(await page.evaluate(() => (window as any).actions)).toEqual(['picker','date']);
  expect(JSON.stringify(report)).not.toMatch(/Fixture Player|09123456789|fixture@/);
});
it('readiness does not navigate, reload, request availability or click', async () => {
  const { readScheduleReadiness } = await import('../src/readiness.js');
  const before = page.url();
  const report = await readScheduleReadiness(page);
  expect(report).toMatchObject({schedule:'CLEAN', allCourts:'YES', selectedSlots:0, paymentHold:'NONE'});
  expect(page.url()).toBe(before); expect(requests).toHaveLength(0);
  expect(await page.evaluate(() => (window as any).actions)).toEqual([]);
});
