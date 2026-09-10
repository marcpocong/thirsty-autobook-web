import { beforeAll, beforeEach, afterEach, afterAll, it, expect, vi } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { readFile } from 'node:fs/promises';
import { ONDA_URL, ObservationSchema } from '../src/config.js';
import { Safety, waitUntil } from '../src/safety.js';
import { Telemetry } from '../src/telemetry.js';
import { observeRelease } from '../src/release.js';
import { releaseNavigationTarget, waitForBookingShellForRelease, navigateReleasedTargetDate } from '../src/release-navigation.js';
import { snapshot, validateSnapshot } from '../src/grid.js';

vi.mock('../src/safety.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/safety.js')>(), waitUntil: vi.fn(),
}));
let browser: Browser, page: Page, schedule: string;
const target = releaseNavigationTarget('2026-09-13');
const settings = ObservationSchema.parse({});
function fixture(incomplete = false, disabled = false) {
  return schedule.replace('</script>', `
    render('2026-09-11');
    document.querySelector('h3').textContent='Fri, September 11';
    if (${incomplete}) document.querySelector('[data-testid="booking-grid-body"]').replaceChildren();
    window.actions=[];
    const filter=document.createElement('span');filter.dataset.testid='booking-court-filter-label';filter.textContent='All Courts';document.body.append(filter);
    const picker=document.createElement('button');picker.setAttribute('aria-label','Select booking date');picker.setAttribute('aria-expanded','false');picker.textContent='Date';document.body.append(picker);
    const day=document.createElement('button');day.dataset.day='9/13/2026';day.textContent='13';day.hidden=true;day.disabled=${disabled};document.body.append(day);
    picker.onclick=()=>{day.hidden=!day.hidden;picker.setAttribute('aria-expanded',String(!day.hidden));window.actions.push('picker');};
    day.onclick=()=>{window.actions.push('target');day.hidden=true;picker.setAttribute('aria-expanded','false');document.querySelector('h3').textContent='Sun, September 13';if(!window.deferGrid)render('2026-09-13');};
    document.addEventListener('click',e=>{if(e.target.closest('[data-testid="court-schedule-slot-cell"]'))window.actions.push('SLOT');});
    </script>`);
}
beforeAll(async () => {
  schedule = await readFile('fixtures/schedule.html', 'utf8');
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) });
});
beforeEach(async () => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', route => route.request().isNavigationRequest()
    ? route.fulfill({ body: fixture(), contentType: 'text/html' }) : route.abort());
  page = await context.newPage(); await page.goto(ONDA_URL);
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-11T07:59:20+08:00'));
  vi.mocked(waitUntil).mockImplementation(async epoch => { vi.mocked(Date.now).mockReturnValue(epoch); });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => { await page.context().close(); vi.restoreAllMocks(); vi.mocked(waitUntil).mockReset(); });
afterAll(async () => { await browser.close(); });

it('release reload goes straight from incomplete Today to target and records distinct milestones', async () => {
  let reloads = 0;
  await page.route('**/*', route => { reloads++; return route.fulfill({ body: fixture(true), contentType: 'text/html' }); });
  const t = new Telemetry();
  const result = await observeRelease(page, settings, new Safety(), t, false);
  expect(reloads).toBe(1);
  expect(validateSnapshot(result.grid, target.date)).toHaveLength(112);
  expect(await page.evaluate(() => (window as any).actions)).toEqual(['picker', 'target']);
  expect(t.events.map(e => e.event)).toEqual([
    'preflightStarted', 'preflightCompleted', 'preflightStarted', 'preflightCompleted', 'armed', 'releaseScheduled',
    'releaseTriggerFired', 'reloadStarted', 'reloadCommitted', 'releaseShellReady', 'targetPickerOpened',
    'targetDateDetected', 'targetDateEnabled', 'targetDateClickStarted', 'targetDateClicked',
    'targetHeadingDetected', 'targetGridReady', 'gridSnapshotStarted', 'gridSnapshotCompleted',
  ]);
});

it.each(['initial', 'final'])('still rejects an incomplete Today grid in %s preflight', async phase => {
  const removeRows = () => page.getByTestId('booking-grid-body').evaluate(e => e.replaceChildren());
  if (phase === 'initial') await removeRows();
  else vi.mocked(waitUntil).mockImplementation(async epoch => { vi.mocked(Date.now).mockReturnValue(epoch); await removeRows(); });
  const reload = vi.spyOn(page, 'reload'), t = new Telemetry();
  await expect(observeRelease(page, settings, new Safety(), t, false)).rejects.toThrow('STALE_OR_INCOMPLETE_GRID');
  expect(reload).not.toHaveBeenCalled(); expect(t.events.some(e => e.event === 'armed')).toBe(false);
});

it('shell waits for actionable picker with no date heading or grid required', async () => {
  await page.locator('[data-testid="booking-grid-body"],h3').evaluateAll(elements => elements.forEach(e => e.remove()));
  await page.getByRole('button', { name: 'Select booking date', exact: true }).evaluate(e => (e as HTMLButtonElement).disabled = true);
  let done = false;
  const waiting = waitForBookingShellForRelease(page, new Safety(), 2000).then(() => { done = true; });
  await page.waitForTimeout(100); expect(done).toBe(false);
  await page.getByRole('button', { name: 'Select booking date', exact: true }).evaluate(e => (e as HTMLButtonElement).disabled = false);
  await waiting; expect(await page.evaluate(() => (window as any).actions)).toEqual([]);
});

it.each(['venue', 'challenge', 'abort'])('shell refuses %s before any calendar click', async kind => {
  const safety = new Safety();
  if (kind === 'venue') await page.getByTestId('public-booking-hero-title').evaluate(e => e.textContent = 'Another venue');
  if (kind === 'challenge') await page.evaluate(() => document.body.append('Verify you are human'));
  if (kind === 'abort') safety.stop('USER_ABORT');
  await expect(waitForBookingShellForRelease(page, safety, 1000)).rejects.toThrow(kind === 'venue' ? 'WRONG_VENUE' : kind === 'challenge' ? 'SECURITY_CHALLENGE' : 'USER_ABORT');
  expect(await page.evaluate(() => (window as any).actions)).toEqual([]);
});

it('disabled target returns the release retry result; a missing day is a structure failure', async () => {
  await page.locator(target.daySelector).evaluate(e => (e as HTMLButtonElement).disabled = true);
  const t = new Telemetry();
  expect(await navigateReleasedTargetDate(page, target, new Safety(), t, 1000)).toBe('TARGET_DATE_NOT_RELEASED');
  expect(t.events.map(e => e.event)).toEqual(['targetPickerOpened', 'targetDateDetected', 'targetDateNotReleased']);
  expect(await page.evaluate(() => (window as any).actions)).toEqual(['picker']);
  await page.locator(target.daySelector).evaluate(e => e.remove());
  await expect(navigateReleasedTargetDate(page, target, new Safety(), new Telemetry(), 100)).rejects.toThrow('TARGET_DATE_STRUCTURE_CHANGED');
});

it('heading alone never releases the target grid barrier; stale, partial and busy grids keep waiting', async () => {
  await page.evaluate(() => { (window as any).deferGrid = true; });
  const t = new Telemetry(); let done = false;
  const waiting = navigateReleasedTargetDate(page, target, new Safety(), t, 4000).then(result => { done = true; return result; });
  await vi.waitFor(() => expect(t.events.some(e => e.event === 'targetHeadingDetected')).toBe(true));
  expect(done).toBe(false); expect(t.events.some(e => e.event === 'targetGridReady')).toBe(false);
  await page.evaluate(() => { (window as any).render('2026-09-13'); document.querySelector('[data-testid="court-schedule-slot-cell"]')!.remove(); });
  await page.waitForTimeout(70); expect(done).toBe(false);
  await page.evaluate(() => { (window as any).render('2026-09-13'); document.body.setAttribute('aria-busy','true'); });
  await page.waitForTimeout(70); expect(done).toBe(false);
  await page.evaluate(() => document.body.removeAttribute('aria-busy'));
  expect(await waiting).toBe('TARGET_GRID_READY');
  expect(validateSnapshot(await snapshot(page), target.date)).toHaveLength(112);
  expect(await page.evaluate(() => (window as any).actions)).toEqual(['picker', 'target']);
});

it.each([false, true])('one bounded retry after disabled target (second enabled: %s)', async secondEnabled => {
  let reloads = 0;
  await page.route('**/*', route => { reloads++; return route.fulfill({ body: fixture(true, reloads === 1 || !secondEnabled), contentType: 'text/html' }); });
  const t = new Telemetry(), run = observeRelease(page, settings, new Safety(), t, false);
  if (secondEnabled) await expect(run).resolves.toHaveProperty('target.targetDate', target.date);
  else await expect(run).rejects.toThrow('RELEASE_HORIZON_UNAVAILABLE');
  expect(reloads).toBe(2);
  expect(t.events.filter(e => e.event === 'targetDateNotReleased')).toHaveLength(secondEnabled ? 1 : 2);
});

it('keeps zero lead and the current conservative retry default', () => {
  expect(settings.RELEASE_LEAD_MS).toBe(0); expect(settings.RELEASE_RETRY_DELAY_MS).toBe(1000);
  expect(settings.MAX_RELEASE_RELOADS).toBe(2);
  expect(ObservationSchema.safeParse({ RELEASE_LEAD_MS: -50 }).success).toBe(false);
  expect(ObservationSchema.safeParse({ MAX_RELEASE_RELOADS: 3 }).success).toBe(false);
});
