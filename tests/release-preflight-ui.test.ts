import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { openRenderer } from './renderer-harness.js';
import { bookingView } from '../ui/booking.js';
import { BookingSetupSchema, ConfigSchema } from '../src/config.js';
import { compileObjective, defaultObjective, enumerateTargets, savedMangoReleaseSetup, withStrategy, type BookingObjective } from '../src/booking-objective.js';
import { nextReleaseFor } from '../src/wing-release-data.js';

/**
 * Release Day Preflight through the real renderer: one verdict shared by Booking Setup and the execution console, no
 * silent re-dating of a draft or saved plan, the primary action's typed explanation, and the Live run report.
 */
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) }); await mkdir('.local/release-preflight-ui', { recursive: true }); });
afterAll(async () => { await browser.close(); });
const players = { PLAYER_FULL_NAME: 'Fixture', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'fixture@example.invalid' };
const playerStatus = { primary: true, extended: true, third: true, fourth: true, fifth: true, sixth: true, seventh: true };
/** The exact two-court plan: Mango Court 7 → A, Court 6 → B, 19:00–22:00, both required, two attempts at 0 ms. */
function twoCourt(nowMs = Date.now()): BookingObjective {
  const o = withStrategy(defaultObjective(nowMs, 'NEXT_RELEASE'), 'SHOTGUN'); o.wings.BUKO.enabled = false;
  o.wings.MANGO = { ...o.wings.MANGO, courts: [{ court: 7, priority: 1 }, { court: 6, priority: 2 }], startTimes: ['19:00'], durationHours: 3, minimum: 2, ideal: 2 };
  const ids = enumerateTargets(o).targets.map(t => t.id);
  o.shotgun = { ...o.shotgun, allocationMode: 'CUSTOM', budget: 2, timingMode: 'CUSTOM', customOffsetsMs: [0, 0], timingCapacityOverride: true, customCounts: { [ids[0]!]: 1, [ids[1]!]: 1 } };
  return o;
}
function saved(o = twoCourt()) {
  const setup = savedMangoReleaseSetup(compileObjective(o, { nowMs: Date.now() }), nextReleaseFor(Date.now(), 'MANGO').bookingDate).setup;
  if (!setup) throw Error('fixture plan does not save');
  return bookingView(ConfigSchema.parse({ ...BookingSetupSchema.parse(setup), ...players }));
}
const iso = (ms: number) => new Date(ms).toISOString();
function readyState(view = saved()) {
  const now = Date.now(), good = (id: string, label: string, hardBlock = false) => ({ id, label, level: 'GOOD', hardBlock, detail: `${label} ok` });
  return { booking: view, playerStatus, objectiveDocument: { version: 1, objective: twoCourt(), savedAt: iso(now), binding: null }, ready: true, workflow: 'release', apiFirstReady: true,
    preparedPlanFingerprint: view.fingerprint, browserHealth: { A: true, B: true },
    prewarmFeasibility: { verdict: 'READY', projectedReady: 2, configuredWave1Attempts: 2, projectedAtRisk: 0, projectedOmitted: 0, p95Source: 'COMPATIBLE_MEASURED_HISTORY', preparationP95Ms: 30_492, sampleCount: 84, prewarmLeadMs: 53_115, limitingConstraints: [] },
    securityCheck: { status: 'PASSED', detail: 'A verified in 3.3 s · B verified in 3.1 s', checkedAt: iso(now - 240_000), expiresAt: iso(now + 3_360_000),
      workers: [{ id: 'A', outcome: 'READY', durationMs: 3301, challengeFrame: 'none', code: null }, { id: 'B', outcome: 'READY', durationMs: 3118, challengeFrame: 'none', code: null }] },
    shotgunTimingVerdict: { status: 'READY', reason: 'Every calibrated attempt started within 50 ms of its trigger.', testedAt: iso(now - 3_600_000), expiresAt: iso(now + 20 * 3_600_000), p95: 4.13, max: 4.37, shotCount: 2, runs: 10, matchesPlan: true, mismatches: [] },
    planDate: { status: 'CURRENT', planDate: view.targetDate, targetDate: view.targetDate, detail: '' },
    releaseReadiness: { verdict: 'READY', measuredAt: iso(now), readyWorkers: ['A', 'B'], degradedWorkers: [], unavailableWorkers: [],
      checks: [good('build', 'Build integrity'), good('config', 'Configuration', true), good('clock', 'Trusted clock'), good('machine', 'Machine'), good('shotgun-topology', 'Exact Shotgun topology', true),
        good('wave1-preparation-capacity', 'Wave 1 preparation capacity', true), good('shotgun-timing', 'Local Shotgun timing test', true), good('security-check', 'Pre-release security check', true)] } };
}
async function step5(page: Page) { await page.locator('nav [data-dest="setup"]').click(); await page.locator('#setup-steps [data-step="5"]').click(); }
const publish = (page: Page, patch: Record<string, unknown>) => page.evaluate(value => { const w = window as any; Object.assign(w.fixtureState, value); w.fixturePublish(w.fixtureState); }, patch);
const calls = (page: Page) => page.evaluate(() => (window as any).fixtureCalls as string[]);

describe('Release Day Preflight (renderer)', () => {
  it('shows one verdict in Booking Setup and the execution console, and a calibration recovery that only calibrates', async () => {
    const page = await openRenderer(browser, readyState(), 'home', { width: 1440, height: 1000 });
    await step5(page);
    await expect.poll(() => page.locator('#readiness-layers .preflight-verdict').innerText()).toBe('READY FOR OPERATOR AUTHORIZATION');
    await page.locator('#execution-console').evaluate(node => { (node as HTMLDetailsElement).open = true; });
    expect(await page.locator('#next-preflight .preflight-verdict').innerText()).toBe('READY FOR OPERATOR AUTHORIZATION');
    expect(await page.locator('#main-action').getAttribute('data-action')).toBe('AUTHORIZE_ARM');
    expect(await page.locator('#action-explainer').getAttribute('data-action')).toBe('AUTHORIZE_ARM');
    expect(await page.locator('#action-explainer').innerText()).toContain('owner attestation');
    await page.screenshot({ path: '.local/release-preflight-ui/ready-1440.png', fullPage: true });
    await publish(page, { shotgunTimingVerdict: { ...readyState().shotgunTimingVerdict, status: 'EXPIRED', reason: 'The calibration is older than 24 hours.' } });
    await expect.poll(() => page.locator('#readiness-layers [data-row="timing"]').getAttribute('data-status')).toBe('EXPIRED');
    expect(await page.locator('#readiness-layers .preflight-verdict').innerText()).toBe('NEEDS ACTION');
    expect(await page.locator('#next-preflight .preflight-verdict').innerText()).toBe('NEEDS ACTION');
    await page.locator('#readiness-layers [data-row="timing"] [data-recovery="CALIBRATE_TIMING"]').click();
    expect(await calls(page)).toEqual(['calibrateTiming']);
    await page.close();
  });
  it('never re-dates a released draft on load; moving it is an explicit draft-only edit and saving stays a reviewed action', async () => {
    // Today's shape: the saved plan still carries the passed release's date (as config.local.json does after a skipped release).
    const released = twoCourt(Date.now() - 3 * 86_400_000), current = saved();
    const setup = structuredClone(current.setup);
    for (const candidate of setup.PRECISION_PHASE3!.candidates) candidate.rateEvidence.date = released.wings.MANGO.bookingDate;
    const view = bookingView(ConfigSchema.parse({ ...BookingSetupSchema.parse(setup), ...players }));
    const page = await openRenderer(browser, { ...readyState(view), ready: false, apiFirstReady: false, preparedPlanFingerprint: null, browserHealth: {},
      objectiveDocument: { version: 1, objective: released, savedAt: iso(Date.now()), binding: null },
      planDate: { status: 'STALE', planDate: released.wings.MANGO.bookingDate, targetDate: view.targetDate, detail: `Saved for ${released.wings.MANGO.bookingDate}, whose release has already passed.` } }, 'home', { width: 1366, height: 900 });
    await step5(page);
    await expect.poll(() => page.locator('#stale-plan-banner').isVisible()).toBe(true);
    expect(await page.locator('#stale-plan-banner').innerText()).toContain('whose release has passed');
    expect(await page.locator('#readiness-layers [data-row="date"]').getAttribute('data-status')).toBe('BLOCKED');
    expect(await page.locator('#plan-summary').innerText()).toContain('DATE PASSED');
    expect(await page.locator('#main-action').getAttribute('data-action')).toBe('SAVE_PLAN');
    expect(await page.locator('#main-action').isDisabled()).toBe(true);
    await page.screenshot({ path: '.local/release-preflight-ui/stale-1366.png', fullPage: true });
    await page.locator('#stale-plan-move').click();
    await expect.poll(() => page.locator('#setup-save-status').innerText()).toContain('Nothing was saved');
    expect(await page.locator('#action-explainer').getAttribute('data-action')).toBe('SAVE_PLAN');
    expect(await page.locator('#action-explainer').innerText()).toContain('only after you confirm the exact differences');
    const recorded = await calls(page);
    expect(recorded).not.toContain('saveBooking'); expect(recorded).not.toContain('armFullBooking'); expect(recorded).not.toContain('authorizeTerms');
    await page.close();
  });
  it('reports per-browser progress, verified courts against the quota and the settled run summary', async () => {
    const page = await openRenderer(browser, { ...readyState(), live: { parents: [
      { key: 'a', wave: 'WAVE_1', workerId: 'A', court: 7, startTime: '19:00', endTime: '22:00', children: [{ attemptId: 'a0', label: 'A0', fanOutIndex: 0, fanOutCount: 1, shotIndex: 0, state: 'HOLD_VERIFIED_QR_ATTENTION' }] },
      { key: 'b', wave: 'WAVE_1', workerId: 'B', court: 6, startTime: '19:00', endTime: '22:00', children: [{ attemptId: 'b0', label: 'B0', fanOutIndex: 0, fanOutCount: 1, shotIndex: 0, state: 'REJECTED', code: 'ONDA_HTTP_STATUS_INVALID' }] }],
      predictions: [], notes: [] },
      runSummary: { planned: 2, prepared: 2, initiated: 2, holds: 1, rejected: 1, unsent: 0, unknown: 0, pending: 0, internalFailures: 0, unsentReasons: {}, settled: true, headline: 'HOLD VERIFIED', detail: '2 planned · 2 sent · 1 hold · 1 rejected', nextStep: 'Pay the verified hold manually before it expires.' } }, 'live', { width: 1440, height: 1000 });
    await expect.poll(() => page.locator('#live-workers').innerText()).toContain('Browser A');
    expect(await page.locator('#live-workers li[data-tone="ok"]').innerText()).toContain('verified hold');
    expect(await page.locator('#live-objective').innerText()).toContain('Courts held: 1 of 2 required');
    const report = await page.locator('#live-report').innerText();
    expect(report).toContain('NOT ACHIEVED · 1 of 2'); expect(report).toContain('Court 7'); expect(report).toContain('Pay the verified hold manually');
    await page.screenshot({ path: '.local/release-preflight-ui/live-1440.png', fullPage: true });
    await page.close();
  });
  it('fits a 390 px window without horizontal scrolling', async () => {
    const page = await openRenderer(browser, readyState(), 'home', { width: 390, height: 844 });
    await step5(page);
    await expect.poll(() => page.locator('#readiness-layers .preflight-verdict').isVisible()).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: '.local/release-preflight-ui/ready-390.png', fullPage: true });
    await page.close();
  });
});
