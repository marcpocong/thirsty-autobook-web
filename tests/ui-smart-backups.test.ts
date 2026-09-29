import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { bookingView, defaultSetup } from '../ui/booking.js';
import { ConfigSchema } from '../src/config.js';
import { compileSmartPlan, confirmSmartRates, emptySmartDraft, type SmartDraft } from '../src/precision-simple.js';
import { openRenderer } from './renderer-harness.js';

/** Operator-level checks of the simplified Smart backups editor, in real Chrome against the real renderer. */
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) }); });
afterAll(async () => { await browser.close(); });

const players = { PLAYER_FULL_NAME: 'Fixture Player', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'fixture@example.invalid',
  PLAYER_B_FULL_NAME: 'Second Fixture', PLAYER_B_PHONE: '09987654321', PLAYER_B_EMAIL: 'second@example.invalid' };
const legacy = () => bookingView(ConfigSchema.parse({ ...defaultSetup, BOOKING_METHOD: 'proofless', DURATION_HOURS: 3, RELEASE_STRATEGY: 'precision',
  PRECISION_TARGETS: [{ court: 7, start: '19:00', durationHours: 3 }, { court: 6, start: '19:00', durationHours: 3 }], ...players }));
function smartBooking(extra: Partial<SmartDraft> = {}) {
  const targetDate = legacy().targetDate;
  const draft: SmartDraft = { ...emptySmartDraft(), immediate: [{ court: 7, start: '19:00', durationHours: 3 }, { court: 6, start: '19:00', durationHours: 3 },
    { court: 5, start: '18:00', durationHours: 3 }, { court: 4, start: '17:00', durationHours: 3 }],
    backups: [{ court: 3, start: '19:00', durationHours: 3 }, { court: 2, start: '18:00', durationHours: 3 }, { court: 1, start: '17:00', durationHours: 3 }],
    rates: confirmSmartRates(600, 700, 'VENUE_SCHEDULE', targetDate, new Date()), ...extra };
  const phase3 = compileSmartPlan(draft, { targetDate }).phase3!;
  return bookingView(ConfigSchema.parse({ ...defaultSetup, BOOKING_METHOD: 'proofless', DURATION_HOURS: 3, RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: [], PRECISION_PHASE3: phase3, ...players }));
}

const open = (extra: Record<string, unknown>) => openRenderer(browser, extra);
const rows = (page: Page, list: 'immediate' | 'backups') => page.locator(`#smart-${list} .smart-row`);
const saved = (page: Page) => page.evaluate(() => (window as any).fixtureSaved);

describe('Smart backups editor (normal operator view)', () => {
  it('keeps Fixed attempts available and loads a legacy plan as Fixed', async () => {
    const page = await open({ booking: legacy() });
    expect(await page.locator('#precision-mode-fixed').isChecked()).toBe(true);
    expect(await page.locator('#legacy-precision-setup').isVisible()).toBe(true);
    expect(await page.locator('#smart-editor').isVisible()).toBe(false);
    expect(await page.locator('text=Send only the exact attempts listed at 8:00.').isVisible()).toBe(true);
    await page.close();
  });

  it('loads an existing Phase 3 plan as Smart backups with derived workers, backup workers and limits', async () => {
    const page = await open({ booking: smartBooking({ retryReopened: true }) });
    expect(await page.locator('#precision-mode-smart').isChecked()).toBe(true);
    expect(await rows(page, 'immediate').count()).toBe(4);
    expect(await rows(page, 'backups').count()).toBe(3);
    expect(await page.locator('#smart-immediate .smart-worker').allInnerTexts()).toEqual(['Worker A', 'Worker B', 'Worker C', 'Worker D']);
    expect(await page.locator('#smart-backup-workers').innerText()).toBe('3 backup workers available: E, F, G');
    const summary = await page.locator('#smart-summary').innerText();
    expect(summary).toContain('4 immediate attempts will be sent.');
    expect(summary).toContain('4 immediate + up to 3 backups + up to 1 reopened-slot attempt. Maximum possible sends: 8.');
    expect(await page.locator('#smart-immediate .smart-rate').first().innerText()).toBe('Expected: ₱2,100 · current configured rate');
    expect(await page.locator('#smart-rescue').isChecked()).toBe(true);
    expect(await page.locator('#smart-rescue-max').inputValue()).toBe('1');
    await page.close();
  });

  it('hides ISO, evidence, standby and budget plumbing by default and never scrolls sideways', async () => {
    const page = await open({ booking: smartBooking() });
    const text = await page.locator('#smart-editor').innerText();
    for (const hidden of ['ISO', 'capturedAt', 'VENUE_SCHEDULE', 'OPERATOR_CONFIRMED', 'Wave', 'Rescue', 'standby', 'candidate', 'Priority', 'Maximum total sends'])
      expect(text).not.toContain(hidden);
    expect(await page.locator('#smart-advanced').evaluate(element => (element as HTMLDetailsElement).open)).toBe(false);
    expect(await page.locator('#smart-editor input[type=checkbox]:visible').count()).toBe(2);
    for (const width of [1060, 620]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
    await page.close();
  });

  it('adds, removes and reorders slots; the visible order becomes the saved priority', async () => {
    const page = await open({ booking: smartBooking() });
    await page.locator('#smart-add-immediate').click();
    expect(await rows(page, 'immediate').count()).toBe(5);
    await page.getByRole('button', { name: 'Remove attempt 5' }).click();
    expect(await rows(page, 'immediate').count()).toBe(4);
    await page.locator('#smart-add-backup').click();
    expect(await rows(page, 'backups').count()).toBe(4);
    await page.getByRole('button', { name: 'Remove backup 4' }).click();
    await page.getByRole('button', { name: 'Move backup 1 down' }).click();
    expect(await page.locator('#smart-backups-court-0').inputValue()).toBe('2');
    expect(await page.locator('#smart-backups-court-1').inputValue()).toBe('3');
    await page.locator('#save-booking').click();
    await page.waitForFunction(() => !!(window as any).fixtureSaved);
    const setup = await saved(page);
    expect(setup.PRECISION_PHASE3.candidates.slice(4).map((c: { court: number; priority: number }) => [c.court, c.priority])).toEqual([[2, 5], [3, 6], [1, 7]]);
    expect(setup.PRECISION_TARGETS).toEqual([]);
    await page.close();
  });

  it('skips a worker that is not ready and shows only its letter', async () => {
    const page = await open({ booking: smartBooking(), identityIssues: ['Worker B — customer identity invalid: duplicates Worker A.'] });
    // The saved mapping used B, so it stays pinned and is flagged rather than silently moved.
    expect(await page.locator('#smart-immediate .smart-row-warn').allInnerTexts()).toEqual(['Worker B is not ready and will not be used.']);
    await page.locator('#smart-add-immediate').click();
    expect(await page.locator('#smart-immediate .smart-worker').allInnerTexts()).toEqual(['Worker A', 'Worker B', 'Worker C', 'Worker D', 'Worker E']);
    const text = await page.locator('#view-strategy').innerText();
    expect(text).not.toContain('fixture@example.invalid'); expect(text).not.toContain('09987654321');
    await page.close();
  });

  it('maps the two behaviour toggles and derives limits from them', async () => {
    const page = await open({ booking: smartBooking() });
    expect(await page.locator('#smart-rescue-max-row').isVisible()).toBe(false);
    await page.locator('#smart-concurrent').check();
    await page.locator('#smart-rescue').check();
    expect(await page.locator('#smart-rescue-max-row').isVisible()).toBe(true);
    await page.locator('#smart-rescue-max').fill('2'); await page.locator('#smart-rescue-max').dispatchEvent('change');
    expect(await page.locator('#smart-summary').innerText()).toContain('4 immediate + up to 3 backups + up to 2 reopened-slot attempts. Maximum possible sends: 9.');
    expect(await page.locator('#smart-summary').innerText()).toContain('Backups may be sent while immediate attempts are still waiting for Onda to respond.');
    await page.locator('#save-booking').click();
    await page.waitForFunction(() => !!(window as any).fixtureSaved);
    const p = (await saved(page)).PRECISION_PHASE3;
    expect(p.concurrentWave2).toBe(true); expect(p.rescueEnabled).toBe(true);
    expect(p.budgets).toEqual({ wave2: 3, rescue: 2, total: 9 });
    expect(p.candidates.every((c: { permissions: { rescue: boolean } }) => c.permissions.rescue)).toBe(true);
    await page.close();
  });

  it('requires a rate review before saving a new Smart plan, then saves confirmed rates for the next release', async () => {
    const page = await open({ booking: legacy() });
    await page.locator('#precision-mode-smart').check();
    expect(await rows(page, 'immediate').count()).toBe(2); // starts from the fixed attempts on screen
    expect(await page.locator('#smart-immediate .smart-rate').first().innerText()).toBe('Rate needs review');
    await page.locator('#save-booking').click();
    expect(await page.locator('#edit-status').innerText()).toContain('Review rates');
    expect(await page.evaluate(() => (window as any).fixtureSaved)).toBeUndefined();
    await page.locator('#smart-review-rates').click();
    await page.locator('#smart-rate-day').fill('600'); await page.locator('#smart-rate-evening').fill('700');
    await page.locator('#smart-rate-status').selectOption('VENUE_SCHEDULE');
    await page.locator('#smart-rate-confirm').click();
    expect(await page.locator('#smart-immediate .smart-rate').first().innerText()).toBe('Expected: ₱2,100 · current configured rate');
    await page.locator('#save-booking').click();
    await page.waitForFunction(() => !!(window as any).fixtureSaved);
    const p = (await saved(page)).PRECISION_PHASE3;
    expect(p.candidates[0].rateEvidence).toMatchObject({ perHour: [700, 700, 700], status: 'VENUE_SCHEDULE', date: legacy().targetDate, actionable: true });
    expect(await page.evaluate(() => (window as any).fixtureCalls)).not.toContain('armFullBooking');
    await page.close();
  });

  it('round-trips Advanced settings and persists across a reload of the saved plan', async () => {
    const page = await open({ booking: smartBooking() });
    await page.locator('#smart-advanced > summary').click();
    await page.locator('#smart-adv-total').fill('5'); await page.locator('#smart-adv-total').dispatchEvent('change');
    await page.locator('#smart-adv-worker-0').selectOption('G');
    await page.locator('#save-booking').click();
    await page.waitForFunction(() => !!(window as any).fixtureSaved);
    const setup = await saved(page);
    expect(setup.PRECISION_PHASE3.budgets.total).toBe(5);
    expect(setup.PRECISION_PHASE3.wave1[0]).toEqual({ workerId: 'G', candidateIndex: 0 });
    await page.close();
    const reloaded = await open({ booking: bookingView(ConfigSchema.parse({ ...setup, ...players })) });
    expect(await reloaded.locator('#smart-immediate .smart-worker').first().innerText()).toBe('Worker G');
    await reloaded.locator('#smart-advanced > summary').click();
    expect(await reloaded.locator('#smart-adv-total').inputValue()).toBe('5');
    expect(await reloaded.locator('#smart-adv-worker-0').inputValue()).toBe('G');
    expect(await rows(reloaded, 'backups').count()).toBe(3);
    await reloaded.close();
  });
});
