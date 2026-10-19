import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { openRenderer } from './renderer-harness.js';
import { bookingView, defaultSetup } from '../ui/booking.js';
import { BookingSetupSchema, ConfigSchema, type BookingSetup } from '../src/config.js';
import { compileObjective, defaultObjective, enumerateTargets, savedMangoReleaseSetup, withStrategy, type BookingObjective } from '../src/booking-objective.js';
import { nextReleaseFor } from '../src/wing-release-data.js';
import { summarizeRunOutcome } from '../src/run-outcome.js';

/**
 * The operator workflow through the real renderer and a recording bridge: Draft → Save → Prepare → Terms → Arm, the
 * visible reason and recovery for every blocked step, draft/saved conflicts, capacity advice and failure attention.
 * No DOM patching: every action is a click on the operator's own controls.
 */
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) }); await mkdir('.local/operator-workflow', { recursive: true }); });
afterAll(async () => { await browser.close(); });
const players = { PLAYER_FULL_NAME: 'Fixture', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'fixture@example.invalid' };
const playerStatus = { primary: true, extended: true, third: true, fourth: true, fifth: true, sixth: true, seventh: true };
/** The October 18 shape on the current next Mango release: Courts 7/6/5/4 at 19:00 for 3 h, custom allocation. */
function objective(counts: Record<number, unknown>, budget: number): BookingObjective {
  const o = withStrategy(defaultObjective(Date.now(), 'NEXT_RELEASE'), 'SHOTGUN');
  o.wings.BUKO.enabled = false;
  o.wings.MANGO = { ...o.wings.MANGO, courts: [7, 6, 5, 4].map((court, i) => ({ court, priority: i + 1 })), startTimes: ['19:00'], durationHours: 3, minimum: 1, ideal: 1 };
  const ids = enumerateTargets(o).targets.map(t => t.id);
  o.shotgun = { ...o.shotgun, allocationMode: 'CUSTOM', budget, timingMode: 'DENSE_CORE', timingCapacityOverride: true,
    customCounts: Object.fromEntries(Object.entries(counts).map(([court, value]) => [ids[[7, 6, 5, 4].indexOf(Number(court))]!, value])) as Record<string, number> };
  return o;
}
const draftDoc = (o: BookingObjective) => ({ version: 1, objective: o, savedAt: new Date().toISOString(), binding: null });
function savedView(o: BookingObjective) {
  const compiled = compileObjective(o, { nowMs: Date.now() }), setup = savedMangoReleaseSetup(compiled, nextReleaseFor(Date.now(), 'MANGO').bookingDate).setup;
  if (!setup) throw Error(compiled.problems.join(' '));
  return bookingView(ConfigSchema.parse({ ...BookingSetupSchema.parse(setup), ...players }));
}
const calls = (page: Page) => page.evaluate(() => (window as any).fixtureCalls as string[]);
const primary = (page: Page) => page.locator('#main-action');
async function step5(page: Page) { await page.locator('nav [data-dest="setup"]').click(); await page.locator('#setup-steps [data-step="5"]').click(); }
async function publish(page: Page, patch: Record<string, unknown>) {
  await page.evaluate(value => { const w = window as any; Object.assign(w.fixtureState, value); w.fixturePublish(w.fixtureState); }, patch);
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 1);

describe('operator workflow (renderer)', () => {
  it.each(['General', 'Fixed Precision', 'Smart standby'] as const)('%s uses every saved-plan worker for browser and player gates', async kind => {
    let setup: BookingSetup = { ...defaultSetup, BOOKING_METHOD: 'proofless', COURT_COUNT: 3 };
    if (kind === 'Fixed Precision') setup = { ...setup, RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: [
      { court: 7, start: '19:00', durationHours: 3 }, { court: 6, start: '19:00', durationHours: 3 }
    ] };
    if (kind === 'Smart standby') {
      const source = savedView(objective({ 7: 3 }, 3)).setup;
      setup = { ...source, STRATEGY_V2: undefined, PRECISION_PHASE3: { ...source.PRECISION_PHASE3!, standby: ['B'],
        budgets: { wave2: 1, rescue: 0, total: 4 }, rescueEnabled: false } };
    }
    const saved = bookingView(ConfigSchema.parse({ ...setup, ...players }));
    const page = await openRenderer(browser, { booking: saved, playerStatus, objectiveDocument: draftDoc(objective({ 7: 2 }, 2)),
      ready: true, apiFirstReady: true, workflow: 'release', preparedPlanFingerprint: saved.fingerprint, termsAuthorized: true,
      browserHealth: { A: true, B: false }, prewarmFeasibility: { verdict: 'READY', projectedReady: 3, configuredWave1Attempts: 3,
        projectedAtRisk: 0, projectedOmitted: 0, p95Source: 'FALLBACK', sampleCount: 0, prewarmLeadMs: 45000, preparationP95Ms: 9000 } }, 'home', { width: 560, height: 800 });
    await step5(page);
    await page.locator('#conflict-keep-saved').click();
    await expect.poll(() => page.locator('#action-blockers').innerText()).toContain('Browser B is disconnected');
    expect(await primary(page).isDisabled()).toBe(true);
    expect(await page.locator('#readiness-layers [data-layer="ENVIRONMENT"]').innerText()).toContain('1/2 browsers connected');
    expect(await page.locator('#next-preflight').innerText()).toContain('1/2 browsers connected');
    await publish(page, { browserHealth: { A: true, B: true }, playerStatus: { ...playerStatus, extended: false } });
    await expect.poll(() => page.locator('#action-blockers').innerText()).toContain('Browser B has no configured player/customer');
    expect(await primary(page).isDisabled()).toBe(true);
    expect(await noOverflow(page)).toBe(true);
    expect(await calls(page)).toEqual([]);
    await page.close();
  }, 60_000);

  it('Draft → Save → Prepare → Terms → Authorize and Arm, preparing exactly the saved plan with no substitution', async () => {
    const o = objective({ 7: 3 }, 3), old = savedView(objective({ 7: 20 }, 20));
    const page = await openRenderer(browser, { booking: old, playerStatus, objectiveDocument: draftDoc(o) }, 'home', { width: 1366, height: 768 });
    await step5(page);
    await expect.poll(() => primary(page).innerText()).toBe('Save release plan');
    // The saved 20-attempt plan and this 3-attempt draft differ: shown with exact before/after, nothing chosen silently.
    await expect.poll(() => page.locator('#plan-conflict').isVisible()).toBe(true);
    expect(await page.locator('#plan-identity').innerText()).toContain('differs from the saved release plan');
    expect(await page.locator('#action-blockers').innerText()).toContain('different from your saved release plan');
    await page.screenshot({ path: '.local/operator-workflow/1366-draft-differs.png', fullPage: true });
    await primary(page).click();
    await expect.poll(() => primary(page).innerText()).toBe('Prepare');
    expect(await page.locator('#setup-save-status').innerText()).toContain('Release plan saved');
    expect(await page.locator('#plan-conflict').isVisible()).toBe(false);
    // Before preparation the forecast is the plan's capacity forecast, never a connected-browser forecast that omits everything.
    expect(await page.locator('#readiness-layers [data-layer="FORECAST"]').innerText()).toContain('capacity, before preparation');
    expect(await page.locator('#readiness-layers [data-layer="FORECAST"]').innerText()).not.toContain('not connected');
    await primary(page).click();
    await expect.poll(() => calls(page)).toEqual(['saveBooking', 'objective:save', 'resetPrepare']);
    // Prepare sends no setup: the controller prepares exactly the saved authorization.
    expect(await page.evaluate(() => (window as any).fixtureArgs.resetPrepare)).toEqual({ workflow: 'release', strategy: 'standard' });
    // The controller reports preparation for the saved fingerprint.
    await page.evaluate(() => { const w = window as any, s = w.fixtureState, workers = [...new Set(s.booking.setup.PRECISION_PHASE3.wave1.map((a: any) => a.workerId))] as string[];
      Object.assign(s, { ready: true, apiFirstReady: true, workflow: 'release', preparedPlanFingerprint: s.booking.fingerprint, browserHealth: Object.fromEntries(workers.map(x => [x, true])),
        prewarmFeasibility: { verdict: 'READY', projectedReady: 3, configuredWave1Attempts: 3, projectedAtRisk: 0, projectedOmitted: 0, p95Source: 'COMPATIBLE_MEASURED_HISTORY', sampleCount: 12, prewarmLeadMs: 45000, preparationP95Ms: 9000 } });
      w.fixturePublish(s); });
    await expect.poll(() => primary(page).innerText()).toBe('Authorize and Arm');
    expect(await primary(page).isDisabled()).toBe(true);
    expect(await page.locator('#action-blockers').innerText()).toContain('Tick the Terms authorization');
    expect(await page.locator('#readiness-layers').innerText()).toContain('live security is verified only after arming');
    await page.screenshot({ path: '.local/operator-workflow/1366-prepared-terms.png', fullPage: true });
    // The primary action and its blocker are visible without scrolling at 1366×768.
    for (const id of ['#main-action', '#action-blockers']) { const box = await page.locator(id).boundingBox(); expect(box && box.y + box.height <= 768, id).toBe(true); }
    await page.locator('#action-blockers [data-recovery="AUTHORIZE_TERMS"]').click();
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('terms');
    await page.locator('#terms').check();
    await expect.poll(() => primary(page).isEnabled()).toBe(true);
    await primary(page).click();
    await expect.poll(() => calls(page)).toEqual(['saveBooking', 'objective:save', 'resetPrepare', 'authorizeTerms', 'armFullBooking']);
    // Armed: the immutable snapshot is identified and the button is Emergency Stop.
    await publish(page, { operation: 'full', activeApiRelease: { releaseMs: Date.now() + 120_000, targetDate: '2026-10-20', phase: 'WAITING' } });
    await expect.poll(() => primary(page).innerText()).toBe('Emergency Stop');
    expect(await page.locator('#plan-identity').innerText()).toContain('armed snapshot');
    expect(await noOverflow(page)).toBe(true);
    await page.screenshot({ path: '.local/operator-workflow/1366-armed.png', fullPage: true });
    // Monitor the simulated run through the same published state used by the controller.
    await page.setViewportSize({ width: 560, height: 800 });
    await publish(page, { activeApiRelease: { releaseMs: Date.now(), targetDate: o.wings.MANGO.bookingDate, phase: 'RUNNING' },
      live: { parents: [{ key: 'fixture', wave: 'WAVE_1', workerId: 'A', children: [
        { attemptId: 'fixture-1', label: '1', fanOutIndex: 0, fanOutCount: 3, state: 'READY' }
      ] }], predictions: [], notes: [] } });
    await expect.poll(() => page.locator('#next-preflight').innerText()).toContain('RELEASE IN PROGRESS');
    expect(await primary(page).innerText()).toBe('Emergency Stop');
    expect(await noOverflow(page)).toBe(true);
    await publish(page, { operation: 'idle', activeApiRelease: null, ready: false, termsAuthorized: false,
      runSummary: summarizeRunOutcome([{ state: 'QR_READY' }, { state: 'NOT_DISPATCHED' }, { state: 'NOT_DISPATCHED' }], 3),
      qrHandoffs: [{ status: 'qr-ready', wing: 'MANGO', checkout: 'A', courts: [7], date: o.wings.MANGO.bookingDate,
        startTime: '19:00', endTime: '22:00', amount: 2100, verifiedAt: new Date().toISOString(), holdExpiresAt: new Date(Date.now() + 300_000).toISOString() }] });
    await expect.poll(() => page.locator('#run-summary').innerText()).toContain('HOLD VERIFIED');
    expect(await page.locator('#run-summary').innerText()).toContain('pay manually');
    expect(await page.locator('#strategy-inspector .outcome').innerText()).toContain('1 payment pending (manual)');
    expect(await noOverflow(page)).toBe(true);
    await page.screenshot({ path: '.local/operator-workflow/560-outcome.png', fullPage: true });
    expect(await calls(page)).toEqual(['saveBooking', 'objective:save', 'resetPrepare', 'authorizeTerms', 'armFullBooking']);
    await page.close();
  }, 60_000);

  it('an invalid custom count is explained before any preparation, and draft values are never shown as executable', async () => {
    const page = await openRenderer(browser, { booking: savedView(objective({ 7: 3 }, 3)), playerStatus, objectiveDocument: draftDoc(objective({ 7: 17, 6: 1.5 }, 20)) }, 'home', { width: 1440, height: 900 });
    await step5(page);
    await expect.poll(() => primary(page).innerText()).toBe('Save release plan');
    expect(await primary(page).isDisabled()).toBe(true);
    const blockers = await page.locator('#action-blockers').innerText();
    expect(blockers).toContain('Mango Court 6 · 19:00');
    expect(blockers).toContain('found 1.5');
    expect(await page.locator('#strategy-inspector').innerText()).toContain('Draft plan (not executable yet)');
    expect(await page.locator('#strategy-inspector').innerText()).toMatch(/Draft attempts \(not executable\)/i);
    expect(await page.locator('#plan-ladder li[data-status="BLOCKED"]').count()).toBeGreaterThan(0);
    // The saved plan stays usable only by an explicit choice while the draft cannot be saved.
    expect(await page.locator('#plan-conflict').innerText()).toContain('the saved release plan is unchanged');
    expect(await page.locator('#conflict-keep-saved').isVisible()).toBe(true);
    const style = await page.locator('#action-blockers li').first().evaluate(node => ({ size: parseFloat(getComputedStyle(node).fontSize), color: getComputedStyle(node).color }));
    expect(style.size).toBeGreaterThanOrEqual(12);
    await page.screenshot({ path: '.local/operator-workflow/1440-invalid-count.png', fullPage: true });
    await page.locator('#action-blockers [data-recovery="REVIEW_PROBLEMS"]').first().click();
    await expect.poll(() => page.locator('#setup-step-3').isVisible()).toBe(true);
    expect(await calls(page)).toEqual([]);
    await page.close();
  }, 60_000);

  it('a capacity-limited 20-attempt plan gets a transparent smaller plan, applied to the draft only after explicit acceptance', async () => {
    const twenty = objective({ 7: 20 }, 20);
    const page = await openRenderer(browser, { booking: savedView(twenty), playerStatus, objectiveDocument: draftDoc(twenty),
      prewarmFeasibility: { p95Source: 'COMPATIBLE_MEASURED_HISTORY', preparationP95Ms: 30_492, sampleCount: 20, verdict: 'NOT_FEASIBLE', projectedReady: 11, configuredWave1Attempts: 20, projectedAtRisk: 0, projectedOmitted: 9, prewarmLeadMs: 105_000 } }, 'home', { width: 1440, height: 900 });
    await page.locator('nav [data-dest="setup"]').click(); await page.locator('#setup-steps [data-step="3"]').click();
    await expect.poll(() => page.locator('#capacity-forecast').innerText()).toContain('PREPARATION INCOMPLETE');
    const table = await page.locator('#capacity-diff').innerText();
    expect(table).toMatch(/Attempts\s+20\s+\d+/i);
    expect(table).toMatch(/Forecast omitted\s+[1-9]\d*\s+0/i);
    await page.screenshot({ path: '.local/operator-workflow/1440-capacity.png', fullPage: true });
    await page.locator('#capacity-accept').click();
    expect(await page.locator('#setup-save-status').innerText()).toContain('nothing is saved or armed automatically');
    expect(await calls(page)).not.toContain('saveBooking');
    await page.locator('#setup-steps [data-step="5"]').click();
    await expect.poll(() => primary(page).innerText()).toBe('Save release plan');
    await page.close();
  }, 60_000);

  it('a failed preparation shows its category, stage and one recovery, and the recovery acts through the controller', async () => {
    const o = objective({ 7: 3 }, 3), saved = savedView(o);
    const page = await openRenderer(browser, { booking: saved, playerStatus, objectiveDocument: draftDoc(o),
      attention: { category: 'INVALID_PREPARATION_EVIDENCE', code: 'PREPARATION_RESULT_INVALID', title: 'Preparation evidence invalid', detail: 'Preparation reached its final check but its evidence did not validate (field paths are in Activity). Nothing was submitted. (step final)',
        operation: 'prepare', step: 'final', workerId: null, retrySafe: true, recovery: { label: 'Prepare again', action: 'PREPARE' }, at: new Date().toISOString() } }, 'home', { width: 560, height: 800 });
    await step5(page);
    await expect.poll(() => page.locator('#attention-panel').isVisible()).toBe(true);
    expect(await page.locator('#attention-panel').innerText()).toContain('Preparation evidence invalid');
    expect(await page.locator('#attention-panel').innerText()).toContain('step final');
    expect(await noOverflow(page)).toBe(true);
    await page.screenshot({ path: '.local/operator-workflow/560-attention.png', fullPage: true });
    await page.locator('#attention-recovery').click();
    await expect.poll(() => calls(page)).toContain('resetPrepare');
    await page.close();
  }, 60_000);

  it('keeping the saved advanced-editor plan is an explicit choice, and an unresolved earlier checkout routes to review', async () => {
    const page = await openRenderer(browser, { booking: savedView(objective({ 7: 20 }, 20)), playerStatus, objectiveDocument: draftDoc(objective({ 7: 3 }, 3)) }, 'home', { width: 1440, height: 900 });
    await step5(page);
    await expect.poll(() => page.locator('#plan-conflict').isVisible()).toBe(true);
    await page.locator('#conflict-review').click();
    expect(await page.locator('#diff-summary').innerText()).toMatch(/Attempts\s+20\s+3/i);
    await page.locator('#conflict-keep-saved').click();
    await expect.poll(() => primary(page).innerText()).toBe('Prepare');
    expect(await page.locator('#plan-identity').innerText()).toContain('This Booking Setup draft is not used');
    await publish(page, { lock: true, canPrepareOverHold: false, retainedLockStage: 'FINAL_ACTION_DISPATCHING' });
    await expect.poll(() => primary(page).innerText()).toBe('Review previous submission');
    await primary(page).click();
    await expect.poll(() => calls(page)).toEqual(['reviewLock']);
    await page.close();
  }, 60_000);
});
