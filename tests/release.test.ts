import { beforeAll, beforeEach, afterEach, afterAll, it, expect, vi } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { readFile } from 'node:fs/promises';
import { ONDA_URL, ObservationSchema, ConfigSchema } from '../src/config.js';
import { Safety, waitUntil } from '../src/safety.js';
import { Telemetry } from '../src/telemetry.js';
import { observeRelease } from '../src/release.js';
import { releaseNavigationTarget, waitForBookingShellForRelease, navigateReleasedTargetDate, preopenReleaseCalendar, observePreopenedTarget } from '../src/release-navigation.js';
import { snapshot, validateSnapshot } from '../src/grid.js';
import { availabilityFixture } from './availability-fixture.js';

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
  expect(t.events.filter(e=>e.event==='gridSnapshotCompleted')).toHaveLength(1);
  expect(t.document().navigations).toEqual([{stage:'RELOAD_COMMIT',outcome:'HTTP_RESPONSE',httpStatus:200}]);
  expect(await page.evaluate(() => (window as any).actions)).toEqual(['picker', 'target']);
  expect(t.events.map(e => e.event)).toEqual([
    'preflightStarted', 'preflightCompleted', 'preflightStarted', 'preflightCompleted', 'armed', 'releaseScheduled',
    'releaseTriggerFired', 'reloadStarted', 'reloadCommitted', 'releaseUrlVerified', 'releaseVenueAttached',
    'releaseVenueVisible', 'releaseVenueVerified', 'releasePickerAttached', 'releasePickerVisible',
    'releasePickerEnabled', 'releaseShellReady', 'targetPickerOpened',
    'targetDateDetected', 'targetDateEnabled', 'targetDateClickStarted', 'targetDateClicked',
    'targetHeadingDetected','targetGridReady','gridSnapshotStarted','gridSnapshotCompleted',
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

it('shell waits for enabled picker with no date heading or grid required', async () => {
  await page.locator('[data-testid="booking-grid-body"],h3').evaluateAll(elements => elements.forEach(e => e.remove()));
  await page.getByRole('button', { name: 'Select booking date', exact: true }).evaluate(e => (e as HTMLButtonElement).disabled = true);
  let done = false;
  const waiting = waitForBookingShellForRelease(page, new Safety(), 2000).then(() => { done = true; });
  await page.waitForTimeout(100); expect(done).toBe(false);
  await page.getByRole('button', { name: 'Select booking date', exact: true }).evaluate(e => (e as HTMLButtonElement).disabled = false);
  await waiting; expect(await page.evaluate(() => (window as any).actions)).toEqual([]);
});

it('shell ignores an overlay and animation without trial or real clicks', async () => {
  await page.evaluate(() => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:white';
    document.body.append(overlay);
  });
  await waitForBookingShellForRelease(page, new Safety(), 500);
  expect(await page.evaluate(() => (window as any).actions)).toEqual([]);
  expect(await readFile('src/release-navigation.ts', 'utf8')).not.toMatch(/trial\s*:/);
});

it.each(['missing', 'duplicate', 'hiddenDuplicate'])('shell rejects %s exact picker', async kind => {
  await page.getByRole('button', { name: 'Select booking date', exact: true }).evaluate((e, kind) => {
    if (kind === 'missing') { e.setAttribute('aria-label', 'Select booking date extra'); return; }
    const clone = e.cloneNode(true) as HTMLElement;
    if (kind === 'hiddenDuplicate') clone.hidden = true;
    e.after(clone);
  }, kind);
  await expect(waitForBookingShellForRelease(page, new Safety(), 150)).rejects.toThrow();
  expect(await page.evaluate(() => (window as any).actions)).toEqual([]);
});

it.each([true, false])('preopened target at release enabled=%s uses one observation and correct path', async enabled => {
  await page.locator(target.daySelector).evaluate(e => (e as HTMLButtonElement).disabled = true);
  let waits = 0;
  vi.mocked(waitUntil).mockImplementation(async epoch => {
    vi.mocked(Date.now).mockReturnValue(epoch);
    if (++waits === 2) {
      expect(await page.evaluate(() => (window as any).actions)).toEqual(['picker']);
      await page.locator(target.daySelector).evaluate((e, enabled) => (e as HTMLButtonElement).disabled = !enabled, enabled);
    }
  });
  const reload = vi.spyOn(page, 'reload');
  const t = new Telemetry();
  const result = await observeRelease(page, { ...settings, RELEASE_PREOPEN_CALENDAR: true }, new Safety(), t, false);
  expect(validateSnapshot(result.grid, target.date)).toHaveLength(112);
  expect(reload).toHaveBeenCalledTimes(enabled ? 0 : 1);
  expect(waits).toBe(2);
  expect(t.events.filter(e => e.event === 'preopenReleaseCheckStarted')).toHaveLength(1);
  expect(t.events.filter(e => e.event === 'preopenTargetDisabled')).toHaveLength(1);
  const names = t.events.map(e => e.event);
  const decision = names.indexOf(enabled ? 'targetEnabledWithoutReload' : 'targetStillDisabledAtRelease');
  expect(names[decision + 1]).toBe(enabled ? 'targetDateEnabled' : 'reloadFallbackStarted');
  expect(names).toContain('targetGridReady');
  expect(names.filter(name => ['targetEnabledWithoutReload', 'targetStillDisabledAtRelease'].includes(name))).toHaveLength(1);
  for (const event of ['preopenPreparationStarted', 'preopenTargetDetected', 'preopenTargetDisabled', 'preopenCalendarLeftOpen']) expect(names).toContain(event);
  expect(await page.evaluate(() => (window as any).actions)).toEqual(['picker', 'target']);
});

it('preopen refuses unexpected availability before arming', async () => {
  const reload = vi.spyOn(page, 'reload');
  await expect(observeRelease(page, { ...settings, RELEASE_PREOPEN_CALENDAR: true }, new Safety(), new Telemetry(), false)).rejects.toThrow('TARGET_DATE_ALREADY_RELEASED');
  expect(reload).not.toHaveBeenCalled();
});

it('preopen rejects booking state changes caused by opening the calendar', async () => {
  await page.locator(target.daySelector).evaluate(e => (e as HTMLButtonElement).disabled = true);
  await page.getByRole('button', { name: 'Select booking date', exact: true }).evaluate(e => e.addEventListener('click', () => {
    document.querySelector('[data-testid="booking-selected-date-label"]')!.textContent = 'changed';
  }));
  await expect(preopenReleaseCalendar(page, target, new Safety(), new Telemetry(), 1000, true)).rejects.toThrow('PREOPEN_BOOKING_STATE_CHANGED');
});

it.each(['disabled', 'enabled', 'missing', 'ambiguous', 'hidden'])('immediate %s target observation evaluates DOM exactly once with no action or wait', async state => {
  await page.locator(target.daySelector).evaluate((e, state) => {
    (e as HTMLButtonElement).hidden = state === 'hidden';
    (e as HTMLButtonElement).disabled = state === 'disabled';
    if (state === 'missing') e.remove();
    if (state === 'ambiguous') e.after(e.cloneNode(true));
  }, state);
  const evaluate = vi.spyOn(page, 'evaluate'), wait = vi.spyOn(page, 'waitForFunction'), reload = vi.spyOn(page, 'reload');
  expect(await observePreopenedTarget(page, target, new Safety())).toBe(state === 'enabled');
  expect(evaluate).toHaveBeenCalledOnce();
  expect(wait).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled();
});

it('enabled no-reload path cannot bypass a stale target grid', async () => {
  await page.locator(target.daySelector).evaluate(e => (e as HTMLButtonElement).disabled = true);
  let waits = 0;
  vi.mocked(waitUntil).mockImplementation(async epoch => {
    vi.mocked(Date.now).mockReturnValue(epoch);
    if (++waits === 2) await page.evaluate(() => {
      (document.querySelector('button[data-day]') as HTMLButtonElement).disabled = false;
      (window as any).deferGrid = true;
    });
  });
  const reload = vi.spyOn(page, 'reload'), t = new Telemetry();
  await expect(observeRelease(page, { ...settings, RELEASE_PREOPEN_CALENDAR: true, CRITICAL_STEP_TIMEOUT_MS: 200 }, new Safety(), t, false)).rejects.toThrow();
  expect(reload).not.toHaveBeenCalled();
  expect(t.events.some(e => e.event === 'targetEnabledWithoutReload')).toBe(true);
  expect(t.events.some(e => e.event === 'targetGridReady')).toBe(false);
  expect(await page.evaluate(() => (window as any).actions)).toEqual(['picker', 'target']);
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
  const completed=await waiting;if(completed==='TARGET_DATE_NOT_RELEASED')throw Error('TARGET_NOT_RELEASED');expect(validateSnapshot(completed,target.date)).toHaveLength(112);
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
  expect(settings.RELEASE_PREOPEN_CALENDAR).toBe(false);
  expect(ObservationSchema.parse({ RELEASE_PREOPEN_CALENDAR: 'false' }).RELEASE_PREOPEN_CALENDAR).toBe(false);
  expect(settings.MAX_RELEASE_RELOADS).toBe(2);
  expect(ObservationSchema.safeParse({ RELEASE_LEAD_MS: -50 }).success).toBe(false);
  expect(ObservationSchema.safeParse({ MAX_RELEASE_RELOADS: 3 }).success).toBe(false);
});

it('waits past the critical-step timeout for reload and shell rendering', async () => {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const venue = document.querySelector('[data-testid="public-booking-hero-title"]');
      if (!venue) return;
      venue.remove();
      setTimeout(() => document.body.prepend(venue), 300);
    });
  });
  await page.route('**/*', async route => {
    await new Promise(resolve => setTimeout(resolve, 300));
    await route.fulfill({ body: fixture(), contentType: 'text/html' });
  });
  const t = new Telemetry();
  const result = await observeRelease(page, { ...settings, CRITICAL_STEP_TIMEOUT_MS: 200 }, new Safety(), t, false);
  expect(validateSnapshot(result.grid, target.date)).toHaveLength(112);
  expect(t.events.some(e => e.event === 'releaseShellReady')).toBe(true);
  expect(await page.evaluate(() => (window as any).actions)).toEqual(['picker', 'target']);
});

it('still stops an unlimited shell wait when the operator aborts', async () => {
  await page.route('**/*', route => route.fulfill({
    body: fixture().replace('data-testid="public-booking-hero-title"', 'data-testid="missing-hero"'),
    contentType: 'text/html',
  }));
  const safety = new Safety();
  const run = observeRelease(page, settings, safety, new Telemetry(), false);
  setTimeout(() => safety.stop('USER_ABORT'), 300);
  await expect(run).rejects.toThrow('USER_ABORT');
});

it('allows one bounded pre-selection recovery for a classified reload timeout', async () => {
  const original=page.reload.bind(page);let calls=0;
  vi.spyOn(page,'reload').mockImplementation(async options=>{if(++calls===1){const error=Error('private transport detail');error.name='TimeoutError';throw error;}return original(options);});
  const t=new Telemetry(),result=await observeRelease(page,{...settings,MAX_RELEASE_RELOADS:2,RELEASE_RETRY_DELAY_MS:500},new Safety(),t,false);
  expect(validateSnapshot(result.grid,target.date)).toHaveLength(112);expect(calls).toBe(2);
  expect(t.events.filter(e=>e.event==='releaseShellRecoveryAllowed')).toHaveLength(1);
  expect(t.document().releaseFailures).toEqual([{stage:'RELOAD_NAVIGATION',code:'RELEASE_PAGE_LOAD_TIMEOUT',classification:'PAGE_LOADING_TIMEOUT'}]);
  expect(await page.evaluate(()=>(window as any).actions)).toEqual(['picker','target']);
});

it('classifies the September 17 barrier as a missing venue element after a completed document', async () => {
  await page.getByTestId('public-booking-hero-title').evaluate(e=>e.remove());
  const t = new Telemetry(), worker=t.worker('A');
  await expect(waitForBookingShellForRelease(page,new Safety(),100,worker,{httpStatus:200})).rejects.toThrow('RELEASE_VENUE_ELEMENT_MISSING');
  expect(t.document('RELEASE_VENUE_ELEMENT_MISSING').releaseFailures).toEqual([{
    workerId:'A',stage:'WAIT_FOR_VENUE_ATTACHED',code:'RELEASE_VENUE_ELEMENT_MISSING',classification:'MISSING_VENUE_ELEMENT',httpStatus:200,
  }]);
  expect(await page.evaluate(() => (window as any).actions)).toEqual([]);
});

it('accepts bounded delayed venue rendering without reloading or clicking', async () => {
  const venue=page.getByTestId('public-booking-hero-title'),html=await venue.evaluate(e=>e.outerHTML);await venue.evaluate(e=>e.remove());
  await page.evaluate(html=>setTimeout(()=>document.body.insertAdjacentHTML('afterbegin',html),40),html);
  const reload=vi.spyOn(page,'reload');await waitForBookingShellForRelease(page,new Safety(),500,new Telemetry(),{httpStatus:200});
  expect(reload).not.toHaveBeenCalled();expect(await page.evaluate(() => (window as any).actions)).toEqual([]);
});

it('records only a safe HTTP status and classification for a failed navigation response', async () => {
  const t=new Telemetry(),worker=t.worker('B');
  await expect(waitForBookingShellForRelease(page,new Safety(),100,worker,{httpStatus:503})).rejects.toThrow('RELEASE_HTTP_STATUS');
  const text=JSON.stringify(t.document('RELEASE_HTTP_STATUS'));
  expect(text).toContain('"httpStatus":503');expect(text).toContain('"classification":"HTTP_ERROR_STATUS"');expect(text).not.toContain(ONDA_URL);
});

it('distinguishes security challenge, unexpected navigation, and browser disconnection at the venue barrier', async () => {
  await page.getByTestId('public-booking-hero-title').evaluate(e=>e.remove());await page.evaluate(()=>document.body.textContent='Verify you are human');
  const security=new Telemetry().worker('A');await expect(waitForBookingShellForRelease(page,new Safety(),30,security)).rejects.toThrow('SECURITY_CHALLENGE');
  expect(security.document().releaseFailures?.[0]?.classification).toBe('SECURITY_CHALLENGE');
  await page.goto('data:text/html,unexpected');
  const redirect=new Telemetry().worker('A');await expect(waitForBookingShellForRelease(page,new Safety(),30,redirect)).rejects.toThrow('UNEXPECTED_REDIRECT');
  expect(redirect.document().releaseFailures?.[0]?.classification).toBe('UNEXPECTED_NAVIGATION');
  const disposable=await browser.newPage();await disposable.close();const disconnected=new Telemetry().worker('B');
  await expect(waitForBookingShellForRelease(disposable,new Safety(),30,disconnected)).rejects.toThrow('CHROME_DISCONNECTED');
  expect(disconnected.document().releaseFailures?.[0]?.classification).toBe('BROWSER_DISCONNECTED');
});

it('compiles preferences before the release wait and returns without a diagnostic flush', async () => {
  const config = ConfigSchema.parse({ START_TIME: '08:00', DURATION_HOURS: 2, PREFERRED_COURTS: [7, 6],
    FALLBACK_TIMES: ['10:00'], MAX_PRICE: 1200, PLAYER_FULL_NAME: 'Fixture User',
    PLAYER_PHONE: '0000000000', PLAYER_EMAIL: 'fixture@example.invalid' });
  vi.mocked(waitUntil).mockImplementation(async epoch => {
    vi.mocked(Date.now).mockReturnValue(epoch);
    // Changing the input at the wait cannot cause late preference compilation.
    config.PREFERRED_COURTS = [1]; config.START_TIME = '12:00';
  });
  const t = new Telemetry(), flush = vi.spyOn(t, 'flush');
  const result = await observeRelease(page, config, new Safety(), t, false, true);
  expect(result.preferences).toEqual([
    { court: 7, hours: ['08:00', '09:00'] }, { court: 6, hours: ['08:00', '09:00'] },
    { court: 7, hours: ['10:00', '11:00'] }, { court: 6, hours: ['10:00', '11:00'] },
  ]);
  expect(flush).not.toHaveBeenCalled();
});

it.each(['fast', 'slow', 'reload'])('hybrid dry release with %s API never waits or selects and preserves the target barrier', async kind => {
  const config = ConfigSchema.parse({ AVAILABILITY_DISCOVERY_MODE: 'hybrid', RELEASE_PREOPEN_CALENDAR: true,
    START_TIME: '08:00', DURATION_HOURS: 2, PREFERRED_COURTS: [7, 6], MAX_PRICE: 1200,
    PLAYER_FULL_NAME: 'Fixture User', PLAYER_PHONE: '0000000000', PLAYER_EMAIL: 'fixture@example.invalid' });
  await page.locator(target.daySelector).evaluate(e => (e as HTMLButtonElement).disabled = true);
  let waits = 0, requests = 0, releaseResponse!: () => void;
  const pending = new Promise<void>(resolve => { releaseResponse = resolve; });
  const apiGet = vi.spyOn(page.context().request, 'get').mockImplementation(async () => {
    requests++;
    if (kind !== 'fast') await pending;
    return { status: () => 200, headers: () => ({ 'content-type': 'application/json' }),
      body: async () => Buffer.from(JSON.stringify(availabilityFixture(target.date))) } as any;
  });
  vi.mocked(waitUntil).mockImplementation(async epoch => {
    vi.mocked(Date.now).mockReturnValue(epoch);
    if (++waits === 2 && kind !== 'reload') await page.locator(target.daySelector).evaluate(e => (e as HTMLButtonElement).disabled = false);
  });
  const t = new Telemetry();
  try {
    const result = await observeRelease(page, config, new Safety(), t, true);
    expect(validateSnapshot(result.grid, target.date)).toHaveLength(112);
    expect(requests).toBeLessThanOrEqual(1);
    expect(t.events.filter(e => e.event === 'availabilityRequestStarted')).toHaveLength(1);
    expect(t.events.map(e => e.event)).toContain(kind === 'fast' ? 'candidateSourceApiUi' : 'candidateSourceUiOnly');
    expect(t.events.some(e => e.event === 'selectionAttemptStarted')).toBe(false);
    expect(await page.evaluate(() => (window as any).actions)).not.toContain('SLOT');
  } finally { releaseResponse(); apiGet.mockRestore(); }
});

it('simulated release computes API candidates while the target grid is deliberately stalled, but cannot select yet', async () => {
  const config = ConfigSchema.parse({ AVAILABILITY_DISCOVERY_MODE: 'hybrid', RELEASE_PREOPEN_CALENDAR: true,
    START_TIME: '08:00', DURATION_HOURS: 2, PREFERRED_COURTS: [7, 6], MAX_PRICE: 1200,
    PLAYER_FULL_NAME: 'Fixture User', PLAYER_PHONE: '0000000000', PLAYER_EMAIL: 'fixture@example.invalid' });
  await page.locator(target.daySelector).evaluate(e => (e as HTMLButtonElement).disabled = true);
  await page.evaluate(() => { (window as typeof window & { deferGrid?: boolean }).deferGrid = true; });
  const apiGet = vi.spyOn(page.context().request, 'get').mockResolvedValue({
    status: () => 200, headers: () => ({ 'content-type': 'application/json' }),
    body: async () => Buffer.from(JSON.stringify(availabilityFixture(target.date))) } as any);
  let waits = 0;
  vi.mocked(waitUntil).mockImplementation(async epoch => {
    vi.mocked(Date.now).mockReturnValue(epoch);
    if (++waits === 2) await page.locator(target.daySelector).evaluate(e => (e as HTMLButtonElement).disabled = false);
  });
  const t = new Telemetry();
  const pending = observeRelease(page, config, new Safety(), t, true);
  try {
    await vi.waitFor(() => expect(t.events.some(e => e.event === 'availabilityApiCandidatesReady')).toBe(true));
    await vi.waitFor(() => expect(t.events.some(e => e.event === 'targetHeadingDetected')).toBe(true));
    expect(t.events.some(e => e.event === 'targetGridReady')).toBe(false);
    expect(t.events.some(e => e.event === 'preferenceResolved')).toBe(false);
    expect(await page.evaluate(() => (window as { actions?: string[] }).actions)).not.toContain('SLOT');
    // Hold the visual grid back after the API candidate is ready.
    await new Promise(resolve => setTimeout(resolve, 250));
    await page.evaluate(date => (window as typeof window & { render: (date: string) => void }).render(date), target.date);
    const result = await pending;
    expect(validateSnapshot(result.grid, target.date)).toHaveLength(112);
    expect(t.events.map(e => e.event).indexOf('availabilityApiCandidatesReady'))
      .toBeLessThan(t.events.map(e => e.event).indexOf('targetGridReady'));
    expect(t.events.some(e => e.event === 'candidateSourceApiUi')).toBe(true);
    expect(t.events.some(e => e.event === 'selectionAttemptStarted')).toBe(false);
  } finally {
    apiGet.mockRestore();
    await page.evaluate(date => (window as typeof window & { render: (date: string) => void }).render(date), target.date).catch(() => {});
    await pending.catch(() => {});
  }
});
