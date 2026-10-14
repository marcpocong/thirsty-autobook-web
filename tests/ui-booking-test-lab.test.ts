import { beforeAll, afterAll, it, expect } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { openRenderer } from './renderer-harness.js';
import { bookingView, defaultSetup } from '../ui/booking.js';
import { ConfigSchema } from '../src/config.js';
import { nextReleaseFor } from '../src/wing-release-data.js';
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) }); });
afterAll(async () => { await browser.close(); });
const booking = () => bookingView(ConfigSchema.parse({ ...defaultSetup, PLAYER_FULL_NAME: 'Fixture', PLAYER_PHONE: '09000000000', PLAYER_EMAIL: 'offline@example.invalid' }));
const players = { primary: true, extended: true, third: true, fourth: true, fifth: true, sixth: true, seventh: true };

it('plans both wings, keeps Buko offline-only with an explicit reason and hides no live action', async () => {
  const page = await openRenderer(browser, { booking: booking(), playerStatus: players }, 'home', { width: 1280, height: 1000 });
  await page.locator('nav [data-dest="setup"]').click();
  await page.locator('#goal-BUKO-enabled').check();
  const mango = nextReleaseFor(Date.now(), 'MANGO').bookingDate, buko = nextReleaseFor(Date.now(), 'BUKO').bookingDate;
  expect(await page.locator('#goal-MANGO-date').inputValue()).toBe(mango);
  expect(await page.locator('#goal-BUKO-date').inputValue()).toBe(buko);
  expect(await page.locator('[data-wing="BUKO"] .evidence-chip').innerText()).toContain('OWNER ASSUMED');
  await page.locator('#setup-steps [data-step="2"]').click();
  expect(await page.locator('#capability-panel').innerText()).toMatch(/Mango · LIVE PILOT[\s\S]*Buko · OFFLINE ONLY/);
  expect(await page.locator('#capability-panel').innerText()).toContain('BUKO_PROOFLESS_NOT_ENABLED');
  await page.locator('#setup-steps [data-step="5"]').click();
  expect(await page.locator('#main-action').isDisabled()).toBe(true);
  expect(await page.locator('#action-bar-hint').innerText()).toContain('Mango-only');
  expect(await page.locator('#inspector-binding').innerText()).toContain('Not live-saveable');
  expect(await page.locator('#strategy-inspector').innerText()).toMatch(/Buko is OFFLINE ONLY for live use/);
  await page.locator('#save-draft').click();
  await page.waitForFunction(() => (window as any).fixtureCalls.includes('objective:save'));
  expect(await page.locator('#setup-save-status').innerText()).toContain('Draft saved');
  expect(await page.evaluate(() => (window as any).fixtureCalls.filter((c: string) => c === 'saveBooking' || c === 'resetPrepare'))).toEqual([]);
  await page.close();
});

it('runs the exact Booking Setup plan offline, compares strategies on the same goal and gates live environments', async () => {
  const page = await openRenderer(browser, { booking: booking(), playerStatus: players }, 'lab', { width: 1280, height: 1000 });
  await page.evaluate(() => { const w = window as any; w.labRequests = [];
    w.thirsty.shotgunLab = async (request: any) => { if (request.action !== 'run') return null; w.labRequests.push(request.value);
      const strategy = request.value.objective.strategy, normal = strategy === 'NORMAL';
      return { label: 'OFFLINE / INTERCEPTED', environment: 'OFFLINE_SIMULATION', strategy, scenario: request.value.scenario, planned: normal ? 1 : 8, initiated: normal ? 1 : 8, omitted: 0, missedDeadlines: normal ? undefined : 0,
        timing: normal ? undefined : { p50: 3.4, p95: 4.6, max: 5.1 }, cpuBusyPercent: normal ? undefined : 9, memoryUsedPercent: 41, outcomes: [], steps: normal ? [{ step: 1, wing: 'MANGO', worker: 'A', state: 'REJECTED', code: 'SLOT_REJECTED' }] : [],
        wings: normal ? [] : [{ wing: 'MANGO', planned: 8, initiated: 8, holds: 0, distinctCourts: 0, ideal: 1, complete: false }], objectiveOutcome: { status: 'NONE', holds: 0, extraHolds: 0 }, warnings: ['synthetic'] }; }; });
  expect(await page.locator('#lab-environment-banner').innerText()).toContain('OFFLINE SIMULATION');
  await page.locator('#lab-run-offline').click();
  await page.waitForFunction(() => document.querySelectorAll('#lab-results-table tbody tr').length === 1);
  const first = await page.evaluate(() => (window as any).labRequests[0]);
  expect(first).toMatchObject({ scenario: 'ALL_REJECTED', countdownSeconds: 10, objective: { version: 3, mode: 'NEXT_RELEASE', strategy: 'SHOTGUN' } });
  expect(await page.locator('#lab-results-table').innerText()).toContain('3.4 / 4.6 / 5.1 ms');
  await page.locator('#lab-compare').click();
  await page.waitForFunction(() => document.querySelectorAll('#lab-results-table tbody tr').length === 4);
  expect(await page.evaluate(() => (window as any).labRequests.slice(1).map((r: any) => [r.objective.strategy, r.scenario]))).toEqual([['SHOTGUN', 'ALL_REJECTED'], ['PRECISION', 'ALL_REJECTED'], ['NORMAL', 'ALL_REJECTED']]);
  expect(await page.locator('#lab-results-table').innerText()).toContain('n/a (no browser dispatch)');
  await page.locator('[data-env="PRODUCTION"] input').check();
  expect(await page.locator('#lab-environment-banner').innerText()).toContain('PRODUCTION');
  expect(await page.locator('#lab-run-offline').isDisabled()).toBe(true);
  expect(await page.evaluate(() => (window as any).fixtureCalls.filter((c: string) => ['saveBooking', 'resetPrepare', 'armFullBooking', 'testBooking'].includes(c)))).toEqual([]);
  await mkdir('.local/ui-v3/shots', { recursive: true }); await page.screenshot({ path: '.local/ui-v3/shots/booking-test-lab.png', fullPage: true });
  await page.setViewportSize({ width: 560, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.close();
});
