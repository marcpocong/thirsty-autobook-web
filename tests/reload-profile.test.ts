import { beforeAll, beforeEach, afterEach, afterAll, it, expect, vi } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { readFile } from 'node:fs/promises';
import { DateTime } from 'luxon';
import { ONDA_URL } from '../src/config.js';
import { Safety } from '../src/safety.js';
import { Telemetry } from '../src/telemetry.js';
import { assertReloadProfileTime, profileReload, reloadProfileReport, formatReloadProfile } from '../src/reload-profile.js';

let browser: Browser, page: Page, fixture: string;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) });
  fixture = (await readFile('fixtures/schedule.html', 'utf8')).replace('</script>', `
    const filter=document.createElement('span');filter.dataset.testid='booking-court-filter-label';filter.textContent='All Courts';document.body.append(filter);
    const picker=document.createElement('button');picker.setAttribute('aria-label','Select booking date');picker.setAttribute('aria-expanded','false');document.body.append(picker);
    window.actions=[];document.addEventListener('click',()=>window.actions.push('CLICK'));
    </script>`);
});
beforeEach(async () => {
  page = await (await browser.newContext()).newPage();
  await page.route('**/*', route => route.fulfill({ body: fixture, contentType: 'text/html' }));
  await page.goto(ONDA_URL);
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-11T09:00:00+08:00'));
});
afterEach(async () => { await page.context().close(); vi.restoreAllMocks(); });
afterAll(async () => { await browser.close(); });

it.each(['07:55:00', '08:00:00', '08:05:00'])('refuses the Manila unsafe boundary %s regardless of input zone', time => {
  expect(() => assertReloadProfileTime(DateTime.fromISO(`2026-09-11T${time}+08:00`).toUTC())).toThrow('RELOAD_PROFILE_UNSAFE_TIME');
});
it.each(['07:54:59', '08:05:01'])('allows safe time %s', time => {
  expect(() => assertReloadProfileTime(DateTime.fromISO(`2026-09-11T${time}+08:00`))).not.toThrow();
});
it('performs one commit reload, records every structural stage and never clicks anything', async () => {
  const reload = vi.spyOn(page, 'reload'), t = new Telemetry();
  const result = await profileReload(page, new Safety(), t, 2000);
  expect(reload).toHaveBeenCalledExactlyOnceWith({ waitUntil: 'commit', timeout: 2000 });
  expect(t.events.map(e => e.event)).toEqual(['reloadProfileStarted', 'reloadStarted', 'reloadCommitted',
    'profileUrlVerified', 'profileVenueAttached', 'profileVenueVisible', 'profileVenueVerified',
    'profilePickerAttached', 'profilePickerVisible', 'profilePickerEnabled', 'profileShellReady', 'reloadProfileCompleted']);
  expect(result.commitToShellReadyMs).toBeGreaterThanOrEqual(0);
  expect(await page.evaluate(() => (window as any).actions)).toEqual([]);
  expect(JSON.stringify(result)).not.toMatch(/https?:|onda.fit|cookie|token|email|phone|Court/);
});
it.each(['time', 'hold', 'review', 'summary', 'selected', 'hidden', 'filter', 'challenge', 'expanded', 'extraTab'])('refuses unsafe %s without reloading', async kind => {
  let extra: Page | undefined;
  if (kind === 'time') vi.mocked(Date.now).mockReturnValue(Date.parse('2026-09-11T08:00:00+08:00'));
  if (kind === 'extraTab') { extra = await page.context().newPage(); await extra.route('**/*', r => r.fulfill({ body: '<body>Other tab</body>' })); await extra.goto(ONDA_URL); }
  await page.evaluate(kind => {
    if (kind === 'hold') document.body.insertAdjacentHTML('beforeend', '<p>Slot reserved for</p><span>09:00</span>');
    if (kind === 'review') document.body.insertAdjacentHTML('beforeend', '<h1>Review Booking</h1>');
    if (kind === 'summary') document.body.insertAdjacentHTML('beforeend', '<div data-testid="booking-review-payment-summary-sheet">Payment Summary</div>');
    if (kind === 'selected') (document.querySelector('[data-testid="court-schedule-slot-cell"]') as HTMLButtonElement).click();
    if (kind === 'hidden') Object.defineProperty(document, 'visibilityState', { value: 'hidden' });
    if (kind === 'filter') document.querySelector('[data-testid="booking-court-filter-label"]')!.textContent = 'Court 1';
    if (kind === 'challenge') document.body.append('Verify you are human');
    if (kind === 'expanded') document.querySelector('[aria-label="Select booking date"]')!.setAttribute('aria-expanded', 'true');
  }, kind);
  const reload = vi.spyOn(page, 'reload');
  await expect(profileReload(page, new Safety(), new Telemetry(), 200)).rejects.toThrow();
  expect(reload).not.toHaveBeenCalled();
  await extra?.close();
});
it('does not retry a reload failure', async () => {
  const reload = vi.spyOn(page, 'reload').mockRejectedValue(Error('TIMEOUT'));
  await expect(profileReload(page, new Safety(), new Telemetry(), 100)).rejects.toThrow('TIMEOUT');
  expect(reload).toHaveBeenCalledOnce();
});
it('does not retry missing shell controls and retains partial milestones', async () => {
  await page.route('**/*', route => route.fulfill({ body: '<body><h1 data-testid="public-booking-hero-title">Thirsty Pickle | SM Seaside</h1></body>', contentType: 'text/html' }));
  const reload = vi.spyOn(page, 'reload'), t = new Telemetry();
  // Give the real browser time to reach the intended missing-picker stage on busy CI.
  // A 150 ms reload can fail before the venue attaches, testing a different failure.
  await expect(profileReload(page, new Safety(), t, 2000)).rejects.toThrow('RELEASE_DATE_PICKER_MISSING');
  expect(reload).toHaveBeenCalledOnce();
  expect(t.events.map(e => e.event)).toContain('profileVenueVerified');
  expect(t.events.map(e => e.event)).not.toContain('profilePickerAttached');
  expect(reloadProfileReport(t.events).commitToVenueAttachedMs).not.toBeNull();
  expect(reloadProfileReport(t.events).commitToShellReadyMs).toBeNull();
});
it('marks shell readiness while document completion is still blocked', async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/*', async route => {
    if (route.request().resourceType() === 'image') { await pending; await route.fulfill({ status: 204 }); }
    else await route.fulfill({ body: fixture + '<img src="/slow.png">', contentType: 'text/html' });
  });
  try {
    const t = new Telemetry();
    await profileReload(page, new Safety(), t, 2000);
    expect(t.events.some(e => e.event === 'profileShellReady')).toBe(true);
    expect(await page.evaluate(() => document.readyState)).not.toBe('complete');
  } finally { finish(); await page.waitForLoadState('load'); }
});
it('preserves NOT MEASURED and emits only allowlisted report fields', () => {
  const report = reloadProfileReport([{ event: 'secret?token=private', monoMs: 1 }]);
  expect(report.commitToShellReadyMs).toBeNull();
  expect(formatReloadProfile(report)).toContain('NOT MEASURED');
  expect(formatReloadProfile(report)).not.toMatch(/0\.0 ms|secret|token|private/);
});
it.each([[1499, 'FAST'], [1500, 'MODERATE'], [4000, 'SLOW'], [10000, 'SLOW'], [10001, 'EXTREME']])('classifies %s ms descriptively', (ms, classification) => {
  expect(reloadProfileReport([{ event: 'reloadCommitted', monoMs: 100 }, { event: 'profileShellReady', monoMs: 100 + Number(ms) }]).classification).toBe(classification);
});
