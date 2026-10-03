import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { bookingView, defaultSetup } from '../ui/booking.js';
import { ConfigSchema } from '../src/config.js';
import { compileSmartPlan, confirmSmartRates, emptySmartDraft, type SmartDraft } from '../src/precision-simple.js';
import { openRenderer } from './renderer-harness.js';

/** The Release Offset selector in Edit Plan, in real Chrome against the real renderer. */
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) }); });
afterAll(async () => { await browser.close(); });

const players = { PLAYER_FULL_NAME: 'Fixture Player', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'fixture@example.invalid' };
const booking = (extra: Record<string, unknown> = {}) => bookingView(ConfigSchema.parse({ ...defaultSetup, BOOKING_METHOD: 'proofless', ...players, ...extra }));
const earlyBy = (page: Page) => page.locator('#release-offset-ms').inputValue();
const saved = (page: Page) => page.evaluate(() => (window as any).fixtureSaved);

it('shows a free 0-2000 ms Release Offset input for a Proofless release and saves it release-relative', async () => {
  const page = await openRenderer(browser, { booking: booking() });
  const block = page.locator('#release-offset');
  expect(await block.isVisible()).toBe(true);
  expect(await block.locator('h3').textContent()).toBe('Release Offset');
  const field=block.locator('#release-offset-ms');
  expect(await field.getAttribute('min')).toBe('0');expect(await field.getAttribute('max')).toBe('2000');expect(await field.getAttribute('step')).toBe('1');
  expect(await block.locator('p').textContent()).toBe('Choose any whole millisecond from 0 (Normal) through 2000 (2 seconds early).');
  expect(await earlyBy(page)).toBe('0');
  expect(await page.locator('#release-lab').isVisible()).toBe(true);
  await page.locator('#release-lab summary').click();
  expect(await page.locator('#release-lab-status').innerText()).toContain('Choose PRECISION RELEASE');
  expect(await page.locator('#release-lab-preset').isDisabled()).toBe(true);
  await field.fill('1733');
  await page.locator('#save-booking').click();
  await page.waitForFunction(() => (window as any).fixtureSaved);
  expect((await saved(page)).RELEASE_OFFSET_MS).toBe(-1733);
  await page.close();
});

it('loads the saved offset as a positive early-by value, and hides it (saving 0 ms) when the method cannot use it', async () => {
  const page = await openRenderer(browser, { booking: booking({ RELEASE_OFFSET_MS: -1425 }) });
  expect(await earlyBy(page)).toBe('1425');
  await page.locator('#booking-method').selectOption('browser');
  expect(await page.locator('#release-offset').isVisible()).toBe(false);
  await page.locator('#save-booking').click();
  await page.waitForFunction(() => (window as any).fixtureSaved);
  expect((await saved(page)).RELEASE_OFFSET_MS).toBe(0);
  await page.close();
});

it('Precision hides the plan-wide box and gives each Fixed attempt its own Offset, Normal by default', async () => {
  const a = { court: 7, start: '19:00', durationHours: 3 }, b = { court: 6, start: '19:00', durationHours: 3 };
  const page = await openRenderer(browser, { booking: booking({ DURATION_HOURS: 3, RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: [{ ...a, releaseOffsetMs: -1010 }, b] }) });
  expect(await page.locator('#precision-setup').isVisible()).toBe(true);
  expect(await page.locator('#release-offset').isVisible()).toBe(false);
  expect(await page.locator('#precision-offset-1').getAttribute('inputmode')).toBe('numeric');
  expect(await page.locator('#precision-offset-0').inputValue()).toBe('1010');
  expect(await page.locator('#precision-offset-1').inputValue()).toBe('0');
  await page.locator('#precision-offset-1').fill('1750');
  await page.locator('#precision-offset-0').fill('0');
  await page.locator('#save-booking').click();
  await page.waitForFunction(() => (window as any).fixtureSaved);
  const setup = await saved(page);
  expect(setup.PRECISION_TARGETS).toEqual([a, { ...b, releaseOffsetMs: -1750 }]);
  expect(setup.RELEASE_OFFSET_MS).toBe(0);
  await page.close();
});

it('lets each Fixed Precision worker keep a different goal and configure four independent tab offsets', async () => {
  const page = await openRenderer(browser, { booking: booking({ RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: [{ court: 7, start: '19:00', durationHours: 3 }] }) });
  const toggle = page.locator('#precision-fan-out');
  expect(await toggle.isChecked()).toBe(false);
  await toggle.check();
  expect(await page.locator('#precision-count').inputValue()).toBe('1');
  expect(await page.locator('#precision-fan-out-note').isVisible()).toBe(true);
  await page.locator('#precision-count').selectOption('2');
  await page.locator('#precision-court-0').selectOption('4');
  await page.locator('#precision-start-0').selectOption('18:00');
  await page.locator('#precision-duration-0').selectOption('2');
  await page.locator('#precision-court-1').selectOption('6');
  await page.locator('#precision-start-1').selectOption('19:00');
  await page.locator('#precision-duration-1').selectOption('3');
  await page.locator('#precision-width-0').selectOption('4');
  await page.locator('#precision-width-1').selectOption('4');
  const earlyBy = [[25, 10, 0, 100], [20, 0, 250, 500]];
  for (const [worker, values] of earlyBy.entries()) for (const [child, value] of values.entries())
    await page.locator(child ? `#precision-offset-${worker}-${child}` : `#precision-offset-${worker}`).fill(String(value));
  await page.locator('#save-booking').click();
  await page.waitForFunction(() => (window as any).fixtureSaved);
  const setup = await saved(page);
  expect(setup.PRECISION_FAN_OUT).toBe(true);
  expect(setup.PRECISION_TARGETS).toEqual([
    { court: 4, start: '18:00', durationHours: 2, fanOutReleaseOffsetsMs: [-25, -10, 0, -100] },
    { court: 6, start: '19:00', durationHours: 3, fanOutReleaseOffsetsMs: [-20, 0, -250, -500] },
  ]);
  await toggle.uncheck();
  expect(await page.locator('#precision-court-1').isEnabled()).toBe(true);
  await page.close();
});

it('routes the 20-shot preset through unified Smart Shotgun metadata and PRECISION_PHASE3', async () => {
  const targetDate=booking().targetDate,rates=confirmSmartRates(600,700,'VENUE_SCHEDULE',targetDate,new Date());
  const draft:SmartDraft={...emptySmartDraft(),rates,retryReopened:true,maxReopenedAttempts:3,immediate:[{court:6,start:'22:00',durationHours:2},{court:7,start:'22:00',durationHours:2},
    {court:1,start:'20:00',durationHours:3},{court:2,start:'21:00',durationHours:3}],backups:[{court:3,start:'17:00',durationHours:2},{court:4,start:'17:00',durationHours:2},{court:5,start:'17:00',durationHours:2}]};
  const phase3=compileSmartPlan(draft,{targetDate}).phase3!;
  const page=await openRenderer(browser,{booking:booking({RELEASE_STRATEGY:'precision',PRECISION_TARGETS:[],PRECISION_PHASE3:phase3})});
  await page.locator('[data-view="strategy"]').first().click();
  await page.locator('input[name="strategy-intensity"][value="SHOTGUN"]').check();
  await page.locator('#strategy-shotgun-preset').click();
  const checks=page.locator('#strategy-shotgun-targets input[type="checkbox"]');await checks.nth(2).uncheck();await checks.nth(3).uncheck();
  await page.locator('#strategy-shotgun-allocation').selectOption('PRIORITY_WEIGHTED');
  await page.locator('#strategy-shotgun-override').check();
  await page.locator('#strategy-save').click();
  await page.waitForFunction(()=>(window as any).fixtureSaved);
  const result=await saved(page);
  expect(result.STRATEGY_V2.shotgun.counts).toEqual({'court-6:22:00:2h':12,'court-7:22:00:2h':8});
  expect(result.STRATEGY_V2.shotgun.exactSchedule).toHaveLength(20);
  expect(result.PRECISION_PHASE3.wave1.filter((value:any)=>value.candidateIndex===0).map((value:any)=>value.fanOutOffsetsMs?.length??1)).toEqual([6,6]);
  expect(result.PRECISION_PHASE3.wave1.filter((value:any)=>value.candidateIndex===1).map((value:any)=>value.fanOutOffsetsMs?.length??1)).toEqual([6,2]);
  expect(result.PRECISION_PHASE3.wave1.filter((value:any)=>value.candidateIndex===2)).toHaveLength(1);
  expect(result.PRECISION_PHASE3.wave1.filter((value:any)=>value.candidateIndex===3)).toHaveLength(1);
  await page.close();
});

it('keeps Release Lab discoverable in Fixed mode and applies its preset by switching the exact rows to Smart', async () => {
  const rows = [{ court: 7, start: '19:00', durationHours: 3 }, { court: 6, start: '18:00', durationHours: 2 }];
  const page = await openRenderer(browser, { booking: booking({ RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: rows }) });
  expect(await page.locator('#precision-mode-fixed').isChecked()).toBe(true);
  expect(await page.locator('#release-lab').isVisible()).toBe(true);
  expect(await page.locator('#release-lab summary').innerText()).toContain('Release Lab');
  await page.locator('#release-lab summary').click();
  expect(await page.locator('#release-lab-matrix tr').count()).toBe(2);
  await page.locator('#release-lab-preset').click();
  expect(await page.locator('#precision-mode-smart').isChecked()).toBe(true);
  expect(await page.locator('#smart-editor').isVisible()).toBe(true);
  expect(await page.locator('#smart-immediate .smart-row').count()).toBe(2);
  expect(await page.locator('#smart-immediate [id^="smart-immediate-court-"]').evaluateAll(elements => elements.map(element => (element as HTMLSelectElement).value))).toEqual(['7', '6']);
  expect(await page.locator('#smart-immediate [id^="smart-immediate-start-"]').evaluateAll(elements => elements.map(element => (element as HTMLSelectElement).value))).toEqual(['19:00', '18:00']);
  expect(await page.locator('#smart-immediate [id^="smart-immediate-duration-"]').evaluateAll(elements => elements.map(element => (element as HTMLSelectElement).value))).toEqual(['3', '3']);
  expect(await page.locator('#smart-immediate [id^="smart-immediate-offset"]').evaluateAll(elements => elements.map(element => (element as HTMLInputElement).value))).toEqual(['25', '10']);
  await page.close();
});

it('each Smart immediate attempt has its own Offset; backups have none', async () => {
  const targetDate = booking().targetDate;
  const draft: SmartDraft = { ...emptySmartDraft(), immediate: [{ court: 7, start: '19:00', durationHours: 3, releaseOffsetMs: -1500 }, { court: 6, start: '19:00', durationHours: 3 }],
    backups: [{ court: 3, start: '19:00', durationHours: 3 }], rates: confirmSmartRates(600, 700, 'VENUE_SCHEDULE', targetDate, new Date()) };
  const phase3 = compileSmartPlan(draft, { targetDate }).phase3!;
  const page = await openRenderer(browser, { booking: booking({ DURATION_HOURS: 3, RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: [], PRECISION_PHASE3: phase3 }) });
  expect(await page.locator('#release-offset').isVisible()).toBe(false);
  expect(await page.locator('#smart-immediate-offset-0').inputValue()).toBe('1500');
  expect(await page.locator('#smart-immediate-offset-1').inputValue()).toBe('0');
  expect(await page.locator('#smart-backups [id^="smart-backups-offset"]').count()).toBe(0);
  await page.locator('#smart-immediate-offset-1').fill('875');
  await page.locator('#smart-immediate-offset-1').blur();
  await page.locator('#save-booking').click();
  await page.waitForFunction(() => (window as any).fixtureSaved);
  expect((await saved(page)).PRECISION_PHASE3.wave1.map((value: { releaseOffsetMs?: number }) => value.releaseOffsetMs)).toEqual([-1500, -875]);
  await page.close();
});
