import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { openRenderer } from './renderer-harness.js';
import { bookingView, defaultSetup } from '../ui/booking.js';
import { BookingSetupSchema, ConfigSchema, ObservationSchema } from '../src/config.js';
import { clockStatus } from '../ui/status.js';
import { DateTime } from 'luxon';
import { compileObjective, defaultObjective, enumerateTargets, savedMangoReleaseSetup, withStrategy, type BookingObjective } from '../src/booking-objective.js';
import { nextReleaseFor } from '../src/wing-release-data.js';

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
const forecast = { verdict: 'READY', projectedReady: 2, configuredWave1Attempts: 2, projectedAtRisk: 0, projectedOmitted: 0,
  p95Source: 'COMPATIBLE_MEASURED_HISTORY', preparationP95Ms: 9000, sampleCount: 12, prewarmLeadMs: 45000 };

describe('independent integrated-source verification', () => {
  it('can cancel and accept the exact-plan owner dialog using keyboard and visible controls offline', async () => {
    const o = objective({7:2},2), saved = savedView(o);
    const page = await openRenderer(browser, {booking:saved,playerStatus,objectiveDocument:draftDoc(o),ready:true,workflow:'release',
      preparedPlanFingerprint:saved.fingerprint,browserHealth:{A:true},termsAuthorized:true,prewarmFeasibility:forecast}, 'home', {width:390,height:844});
    await page.evaluate(fingerprint => { const w = window as any;
      w.thirsty.armFullBooking = async () => { w.fixtureCalls.push('armFullBooking');
        const confirmed = await new Promise(resolve => {
          w.thirsty.confirmResponse = async (id: string, accepted: boolean) => { w.fixtureDialogResult={id,accepted}; resolve(accepted); };
          w.fixtureConfirmRequest({id:'offline-owner',tone:'warning',title:'LIVE SHOTGUN PILOT - OWNER ATTESTATION',
            message:'Offline fixture: attest for this exact plan?',detail:`Saved authorization ${fingerprint}. No provider submission.`,confirmLabel:'Attest and arm live Shotgun',cancelLabel:'Do not arm'});
        });
        w.fixtureAttested = confirmed ? fingerprint : null;
      };
    }, saved.fingerprint);
    await step5(page); await expect.poll(() => primary(page).isEnabled()).toBe(true);
    await primary(page).click();
    expect(await page.locator('#confirm-modal').isVisible()).toBe(true);
    expect(await page.locator('#confirm-detail').innerText()).toContain(saved.fingerprint);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('confirm-cancel');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:'.local/operator-workflow/390-owner-dialog.png'});
    await page.keyboard.press('Escape');
    await expect.poll(() => primary(page).isEnabled()).toBe(true);
    expect(await page.evaluate(() => (window as any).fixtureAttested)).toBeNull();
    await primary(page).click(); await page.locator('#confirm-ok').click();
    await expect.poll(() => page.evaluate(() => (window as any).fixtureAttested)).toBe(saved.fingerprint);
    expect(await calls(page)).toEqual(['armFullBooking','armFullBooking']);
    expect(await page.locator('#confirm-modal').isVisible()).toBe(false); await page.close();
  },60_000);

  it.each(['count', 'offset', 'blank count', 'blank offset'] as const)('an invalid %s entered in Customize invalidates the draft instead of keeping historical executable values', async field => {
    const o = objective({ 7: 2 }, 2), saved = savedView(o);
    const page = await openRenderer(browser, { booking: saved, playerStatus, objectiveDocument: draftDoc(o) }, 'home', {width:1440,height:900});
    await page.locator('#home-start-setup').click();
    await page.locator('input[name="setup-mode"][value="NEXT_RELEASE"]').check();
    await page.locator('#setup-steps [data-step="2"]').click();
    await page.locator('input[name="strategy-choice"][value="SHOTGUN"]').check();
    await page.locator('#setup-steps [data-step="3"]').click();
    const input = field.endsWith('count') ? page.locator('.custom-counts label').filter({hasText:'Mango Court 7'}).locator('input') : page.getByRole('spinbutton', {name:'Shot 1 offset in milliseconds',exact:true});
    await input.fill(field.startsWith('blank')?'':field === 'count' ? '1.5' : '-1.5'); await input.press('Tab');
    await step5(page);
    await expect.poll(() => page.locator('#plan-identity').innerText()).toContain('not executable');
    expect(await primary(page).isDisabled()).toBe(true);
    expect(await page.locator('#strategy-inspector').innerText()).toContain('Draft plan (not executable yet)');
    expect(await page.locator('#action-blockers').innerText()).toMatch(field.endsWith('count') ? /Court 7.*(1.5|NaN|blank)/ : /offset|millisecond/i);
    expect(await calls(page)).toEqual([]);
    await page.screenshot({ path: `.local/operator-workflow/1440-entered-invalid-${field}.png` });
    await page.close();
  }, 60_000);

  it('shows a wrong profile and controller hard blockers beside Arm with working recoveries', async () => {
    const o = objective({ 7: 2 }, 2), saved = savedView(o);
    const page = await openRenderer(browser, { booking: saved, playerStatus, objectiveDocument: draftDoc(o), ready: true,
      workflow: 'release', preparedPlanFingerprint: saved.fingerprint, browserHealth: { A: true }, termsAuthorized: true,
      identityIssues: ['Worker A belongs to the wrong profile'],
      prewarmFeasibility: forecast,
      releaseReadiness: { verdict: 'NOT_READY', readyWorkers: [], degradedWorkers: [], unavailableWorkers: [], checks: [{ id: 'clock', label: 'Trusted clock', level: 'UNAVAILABLE', hardBlock: true, detail: 'No valid trusted clock' }] }
    }, 'home', { width: 1366, height: 768 });
    await step5(page);
    await expect.poll(() => page.locator('#action-blockers').innerText()).toContain('wrong profile');
    expect(await primary(page).isDisabled()).toBe(true);
    await page.locator('#action-blockers [data-recovery="RECHECK_BROWSERS"]').click();
    expect(await calls(page)).toEqual(['resetPrepare']);
    await publish(page, { identityIssues: [] });
    await expect.poll(() => page.locator('#action-blockers').innerText()).toContain('No valid trusted clock');
    expect(await primary(page).isDisabled()).toBe(true);
    expect(await page.locator('#next-preflight').innerText()).toContain('No valid trusted clock');
    for (const viewport of [{width:1366,height:768},{width:1440,height:900},{width:390,height:844}]) {
      await page.setViewportSize(viewport);
      await page.locator('#action-blockers').scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `.local/operator-workflow/${viewport.width}-clock-blocker.png` });
    }
    await page.locator('#action-blockers [data-recovery="SYNC_CLOCK"]').click();
    await expect.poll(() => calls(page)).toEqual(['resetPrepare', 'syncClock']);
    await page.close();
  }, 60_000);

  it('shows a failed pre-release security check with a working one-click re-check and the Shotgun Arm blocker', async () => {
    const o = objective({ 7: 2 }, 2), saved = savedView(o);
    const securityCheck = { status: 'FAILED', detail: 'A failed (ONDA_SECURITY_VERIFICATION_FAILED) after 60.2 s', checkedAt: new Date().toISOString() };
    const page = await openRenderer(browser, { booking: saved, playerStatus, objectiveDocument: draftDoc(o), ready: true, apiFirstReady: true, operation: 'idle',
      workflow: 'release', preparedPlanFingerprint: saved.fingerprint, browserHealth: { A: true }, termsAuthorized: true, prewarmFeasibility: forecast, securityCheck,
      releaseReadiness: { verdict: 'NOT_READY', readyWorkers: ['A'], degradedWorkers: [], unavailableWorkers: [], checks: [{ id: 'security-check', label: 'Pre-release security check', level: 'UNAVAILABLE', hardBlock: true, detail: 'failed · ' + securityCheck.detail }] }
    }, 'home', { width: 1366, height: 768 });
    await step5(page);
    await expect.poll(() => page.locator('#readiness-layers [data-layer="SECURITY"]').innerText()).toContain('Pre-release check failed');
    expect(await page.locator('#readiness-layers [data-layer="SECURITY"]').getAttribute('data-status')).toBe('BLOCKED');
    await expect.poll(() => page.locator('#action-blockers').innerText()).toContain('Pre-release security check');
    expect(await primary(page).isDisabled()).toBe(true);
    await page.locator('#security-check-run').click();
    await page.locator('#action-blockers [data-recovery="CHECK_SECURITY"]').click();
    await expect.poll(() => calls(page)).toEqual(['checkSecurity', 'checkSecurity']);
    await publish(page, { securityCheck: { ...securityCheck, status: 'PASSED', detail: 'A verified in 4.2 s' }, releaseReadiness: { verdict: 'READY', readyWorkers: ['A'], degradedWorkers: [], unavailableWorkers: [], checks: [] } });
    await expect.poll(() => page.locator('#readiness-layers [data-layer="SECURITY"]').innerText()).toContain('Pre-release check passed');
    expect(await page.locator('#security-check-run').innerText()).toBe('Check again');
    await page.close();
  }, 60_000);

  it('prevents repeated Prepare, Arm and Save Draft while a bridge call is pending', async () => {
    const o = objective({ 7: 2 }, 2), saved = savedView(o);
    const page = await openRenderer(browser, { booking: saved, playerStatus, objectiveDocument: draftDoc(o), clock: clockStatus(ObservationSchema.parse({}), DateTime.now()) }, 'home');
    await step5(page);
    // Defer bridge responses, not renderer state or controls. All submissions use visible operator controls.
    await page.evaluate(() => { const w = window as any;
      for (const name of ['resetPrepare', 'armFullBooking']) w.thirsty[name] = async () => { w.fixtureCalls.push(name); await new Promise(resolve => w.fixtureResolve = resolve); };
      const original = w.thirsty.objective;
      w.thirsty.objective = async (request: any) => { if (request.action === 'save') await new Promise(resolve => w.fixtureResolve = resolve); return original(request); };
    });
    await expect.poll(() => primary(page).innerText()).toBe('Prepare');
    await primary(page).click();
    expect(await primary(page).isDisabled()).toBe(true);
    expect(await page.locator('#save-draft').isDisabled()).toBe(true);
    await page.locator('#inline-stop').click();
    expect(await calls(page)).toEqual(['resetPrepare', 'abortAutomation']);
    await page.evaluate(() => (window as any).fixtureResolve());
    await publish(page, { ready: true, workflow: 'release', preparedPlanFingerprint: saved.fingerprint, browserHealth: { A: true }, termsAuthorized: true,
      prewarmFeasibility: forecast });
    await expect.poll(() => primary(page).innerText()).toBe('Authorize and Arm');
    await primary(page).click(); expect(await primary(page).isDisabled()).toBe(true);
    expect(await page.locator('#save-draft').isDisabled()).toBe(true);
    await page.evaluate(() => (window as any).fixtureResolve());
    await expect.poll(() => page.locator('#save-draft').isEnabled()).toBe(true);
    await page.locator('#save-draft').click(); expect(await page.locator('#save-draft').isDisabled()).toBe(true);
    await page.evaluate(() => (window as any).fixtureResolve());
    await expect.poll(() => calls(page)).toEqual(['resetPrepare', 'abortAutomation', 'armFullBooking', 'objective:save']);
    await page.close();
  }, 60_000);

  it('uses the saved two-court quota in the detailed summary', async () => {
    const o = objective({ 7: 1, 6: 1 }, 2); o.wings.MANGO.minimum = 2; o.wings.MANGO.ideal = 2;
    const saved = savedView(o);
    const page = await openRenderer(browser, { booking: saved, playerStatus, objectiveDocument: draftDoc(o), clock: clockStatus(ObservationSchema.parse({}), DateTime.now()) }, 'home');
    await step5(page);
    if (await page.locator('#execution-console').getAttribute('open') === null) await page.locator('#execution-console summary').first().click();
    expect(await page.locator('#saved-plan-summary').isVisible()).toBe(true);
    expect(await page.locator('#saved-plan-summary').innerText()).toContain('GOAL: 2 COURTS');
    expect(await page.locator('#saved-plan-summary').innerText()).not.toContain('GOAL: 1 HOLD');
    expect(await page.locator('#precision-panel').innerText()).not.toContain('Goal: 1 successful court');
    await page.locator('#saved-plan-summary').scrollIntoViewIfNeeded();
    await page.screenshot({ path: '.local/operator-workflow/two-court-saved-summary.png', fullPage: true });
    await page.close();
  }, 60_000);

});
