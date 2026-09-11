import { beforeAll, beforeEach, afterEach, afterAll, it, expect, vi } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { readFile } from 'node:fs/promises';
import { DateTime } from 'luxon';
import { ONDA_URL, ObservationSchema } from '../src/config.js';
import { checkPreopenStability, tomorrowRelease } from '../src/preopen-check.js';
import { Safety } from '../src/safety.js';
import { Telemetry } from '../src/telemetry.js';

const c = ObservationSchema.parse({});
// Keep wall-clock edits (such as set({ hour: 7 })) in Manila on UTC CI hosts too.
const now = DateTime.fromISO('2026-09-11T09:00:00+08:00', { zone: 'Asia/Manila' });
let browser: Browser, page: Page;
beforeAll(async () => { browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) }); });
beforeEach(async () => {
  page = await browser.newPage();
  let fixture = await readFile('fixtures/schedule.html', 'utf8');
  fixture = fixture.replace('</script>', `
    render('2026-09-11'); document.querySelector('h3').textContent='Fri, September 11';
    window.actions=[];
    const filter=document.createElement('span');filter.dataset.testid='booking-court-filter-label';filter.textContent='All Courts';document.body.append(filter);
    const picker=document.createElement('button');picker.setAttribute('aria-label','Select booking date');picker.setAttribute('aria-expanded','false');document.body.append(picker);
    const day=document.createElement('button');day.dataset.day='9/14/2026';day.disabled=true;day.hidden=true;document.body.append(day);
    picker.onclick=()=>{window.actions.push('picker');day.hidden=!day.hidden;picker.setAttribute('aria-expanded',String(!day.hidden));};
    day.onclick=()=>window.actions.push('DATE');
    document.addEventListener('click',e=>{if(e.target.closest('[data-testid="court-schedule-slot-cell"]'))window.actions.push('SLOT');});
    </script>`);
  await page.route('**/*', r => r.request().isNavigationRequest() ? r.fulfill({ body: fixture, contentType: 'text/html' }) : r.abort());
  await page.goto(ONDA_URL);
  vi.spyOn(Date, 'now').mockReturnValue(now.toMillis());
});
afterEach(async () => { await page.close(); vi.restoreAllMocks(); });
afterAll(async () => { await browser.close(); });

it('derives the next day release target across Manila month/year rollover', () => {
  expect(tomorrowRelease(c, now).targetDate).toBe('2026-09-14');
  expect(tomorrowRelease(c, DateTime.fromISO('2026-12-31T09:00:00+08:00')).targetDate).toBe('2027-01-03');
});
it('five bounded observations only open and close picker, without reload or booking interactions', async () => {
  const pause = vi.fn(async () => {}), reload = vi.spyOn(page, 'reload'), t = new Telemetry();
  const result = await checkPreopenStability(page, c, new Safety(), t, pause, now);
  expect(result).toMatchObject({ targetDate: '2026-09-14', preopenUiStability: 'VERIFIED', autoEnableAtRelease: 'UNVERIFIED', selectedSlots: 0 });
  expect(pause).toHaveBeenCalledTimes(4);
  expect(t.events.filter(e => e.event === 'preopenStabilitySample').map(e => e.value)).toEqual([0, 15000, 30000, 45000, 60000]);
  expect(reload).not.toHaveBeenCalled();
  expect(await page.evaluate(() => (window as any).actions)).toEqual(['picker', 'picker']);
  expect(await page.getByRole('button', { name: 'Select booking date', exact: true }).getAttribute('aria-expanded')).toBe('false');
});
it.each(['closed', 'duplicate', 'enabled', 'selected', 'date', 'challenge', 'hidden', 'navigation', 'filter'])('fails closed on %s during observation with no recovery clicks', async kind => {
  const safety = new Safety();
  const pause = vi.fn(async () => {
    if (kind === 'navigation') { await page.evaluate(() => history.pushState({}, '', '#changed')); return; }
    await page.evaluate(kind => {
      const picker = document.querySelector('[aria-label="Select booking date"]')!;
      const day = document.querySelector('button[data-day]') as HTMLButtonElement;
      if (kind === 'closed') picker.setAttribute('aria-expanded', 'false');
      if (kind === 'duplicate') day.after(day.cloneNode(true));
      if (kind === 'enabled') day.disabled = false;
      if (kind === 'selected') { const cell = document.querySelector('[data-testid="court-schedule-slot-cell"]')!; cell.setAttribute('aria-label', 'Court 1: Mango Wing 8 AM to 9 AM selected'); cell.querySelector('[data-slot-state]')!.setAttribute('data-slot-state','selected'); }
      if (kind === 'date') document.querySelector('h3')!.textContent = 'Changed';
      if (kind === 'challenge') document.body.append('Verify you are human');
      if (kind === 'hidden') Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      if (kind === 'filter') document.querySelector('[data-testid="booking-court-filter-label"]')!.textContent = 'Court 1';
    }, kind);
  });
  await expect(checkPreopenStability(page, c, safety, new Telemetry(), pause, now)).rejects.toThrow();
  expect(pause).toHaveBeenCalledOnce();
  expect(await page.evaluate(() => (window as any).actions)).toEqual(['picker']);
});
it('refuses checks before the current release with no picker interaction', async () => {
  await expect(checkPreopenStability(page, c, new Safety(), new Telemetry(), async () => {}, now.set({ hour: 7 }))).rejects.toThrow('OUTSIDE_SAFE_WINDOW');
  expect(await page.evaluate(() => (window as any).actions)).toEqual([]);
});
