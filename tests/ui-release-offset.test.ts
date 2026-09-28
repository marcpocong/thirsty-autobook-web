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
  expect(await page.locator('#precision-offset-1').getAttribute('max')).toBe('2000');
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
