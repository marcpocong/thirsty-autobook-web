import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { bookingView, defaultSetup } from '../ui/booking.js';
import { ConfigSchema } from '../src/config.js';
import { compileSmartPlan, confirmSmartRates, describeSmartPlan, emptySmartDraft, type SmartDraft } from '../src/precision-simple.js';
import { FanOutProfileSchema, recommendFanOutWidth, summarizeWidth, type ChildSample, type RunSample } from '../src/fanout-capacity.js';
import type { LiveRunView } from '../ui/types.js';
import { openRenderer as openRendererBase, showRendererView } from './renderer-harness.js';

async function openRenderer(...args:Parameters<typeof openRendererBase>){
  const page=await openRendererBase(...args),view=args[2];
  if(view==='strategy')await page.evaluate(()=>{for(const id of ['strategy-advanced','strategy-edit-targets','strategy-schedule','strategy-normal-settings'])document.getElementById(id)?.setAttribute('open','');document.getElementById('strategy-review-technical')?.closest('details')?.setAttribute('open','');});
  if(view==='history')await page.locator('.history-forensics').evaluate(element=>element.setAttribute('open',''));
  return page;
}

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) }); });
afterAll(async () => { await browser.close(); });

const players = { PLAYER_FULL_NAME: 'Fixture Player', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'fixture@example.invalid',
  PLAYER_B_FULL_NAME: 'Second Fixture', PLAYER_B_PHONE: '09987654321', PLAYER_B_EMAIL: 'second@example.invalid' };
const base = bookingView(ConfigSchema.parse({ ...defaultSetup, ...players }));
const targetDate = base.targetDate;
function smartBooking(extra: Partial<SmartDraft> = {}) {
  const draft: SmartDraft = { ...emptySmartDraft(), immediate: [{ court: 7, start: '19:00', durationHours: 3 }], backups: [],
    rates: confirmSmartRates(600, 700, 'VENUE_SCHEDULE', targetDate, new Date()), ...extra };
  return bookingView(ConfigSchema.parse({ ...defaultSetup, BOOKING_METHOD: 'proofless', DURATION_HOURS: 3, RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: [],
    PRECISION_PHASE3: compileSmartPlan(draft, { targetDate }).phase3!, ...players }));
}
/** Block audit for the target date: every hour unreleased with no record except the listed public bookings. */
function blockAudit(booked: Array<[number, string]>) {
  const cells = [];
  for (let court = 1; court <= 7; court++) for (let hour = 8; hour <= 23; hour++) {
    const text = `${String(hour).padStart(2, '0')}:00`;
    cells.push(booked.some(([c, h]) => c === court && h === text) ? { court, hour: text, status: 'BLOCKED', source: 'PUBLIC_BOOKING' }
      : { court, hour: text, status: 'UNRELEASED', source: 'DATE_UNRELEASED' });
  }
  return { type: 'blockAudit', date: targetDate, cells };
}
/** A synthetic machine profile recommending two children per target. */
function fanOutDigest() {
  const run = (width: number, perChild: number): RunSample[] => Array.from({ length: 20 }, (_, index) => ({ run: index, width, workers: 7, firstTriggerOffsetMs: 0, nodeCpuMs: 50, systemBusyPct: 10,
    children: Array.from({ length: 7 * width }, (_, child): ChildSample => { const lag = 3 + (child % width) * perChild + (index % 5) / 5;
      return { run: index, workerIndex: Math.floor(child / width), workerId: 'ABCDEFG'[Math.floor(child / width)]!, fanOutIndex: child % width, fanOutCount: width, configuredOffsetMs: 0,
        schedulerWakeMs: 0, workerInvokedMs: 0.5, transportEnteredMs: 0.6, prePostMs: 0.7, evaluateEnteredMs: lag - 2, fetchInvokedMs: lag - 1, chromeStartMs: lag, requestEventMs: lag + 3,
        responseMs: lag + 9, state: 'REJECTED', prewarmDurationMs: 6, prewarmReadyMs: -1_490 }; }) }));
  const widths = [1, 2, 3, 4].map(width => summarizeWidth(width, run(width, width <= 2 ? 1 : 6)));
  const profile = FanOutProfileSchema.parse({ schema: 'fanout-capacity-profile/v1', createdAt: '2026-09-29T05:07:08.790Z', build: { gitSha: 'a'.repeat(40), buildId: 'a', dirty: false },
    machine: { cpuModel: 'Fixture CPU', logicalCores: 20, totalMemGb: 32, platform: 'win32', osRelease: '10', chromeVersion: null },
    config: { workers: 7, widths: [1, 2, 3, 4], runsPerWidth: 20, pattern: 'burst', dispatcher: 'central', prewarmLeadMs: 1500, prewarmConcurrency: null, headed: false,
      syntheticPrewarm: 'cpu:0,wait:0', pageBusy: '0' }, widths, recommendation: recommendFanOutWidth(widths) });
  const entry = { createdAt: profile.createdAt, dispatcher: 'central', compatible: true, stale: false, notes: [], recommendedWidth: profile.recommendation.width, reasons: profile.recommendation.reasons,
    widths: widths.map(width => ({ width: width.width, attempts: width.attempts, chromeP50: width.triggerToChromeStart.p50, chromeP95: width.triggerToChromeStart.p95,
      chromeP99: width.triggerToChromeStart.p99, chromeMax: width.triggerToChromeStart.max, spreadP95: width.spread.p95, perChildP95: width.perChildIndex.map(value => value.triggerToChromeStart.p95) })) };
  return { latest: { ...entry, profile }, history: [entry] };
}
const saved = (page: Page) => page.evaluate(() => (window as any).fixtureSaved);
async function controlStrategyEvidence(page: Page) {
  await page.evaluate(() => {
    const w = window as any; w.fixtureEvidenceRequests = [];
    w.thirsty.strategyEvidence = (input: unknown) => new Promise((resolve, reject) => w.fixtureEvidenceRequests.push({ input, resolve, reject }));
  });
}
const evidenceRequestCount = (page: Page) => page.evaluate(() => (window as any).fixtureEvidenceRequests.length as number);
async function settleEvidence(page: Page, index: number, reject = false) {
  await page.evaluate(({ index, reject, targetDate }) => {
    const request = (window as any).fixtureEvidenceRequests[index];
    if (reject) request.reject(new Error('fixture evidence failure'));
    else request.resolve({ targetDate, dayOfWeek: 'Saturday', releasesConsidered: 0, wellObservedReleases: 0, realReleases: 0,
      historicalPrePhase3: 0, strength: 'NONE', ranges: [], sharedRisk: [] });
  }, { index, reject, targetDate });
}

describe('Strategy view (Goal → Known schedule → Preset → Suggested plan → Review)', () => {
  it('creates and saves a manual target from an empty general plan with unknown schedule evidence', async () => {
    const page = await openRenderer(browser, { booking: base }, 'strategy');
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    expect(await page.locator('#strategy-target-date').innerText()).toBe(targetDate);
    expect(await page.locator('#strategy-add-immediate').isVisible()).toBe(true);
    await page.locator('#strategy-ideal-start').selectOption('19:00');
    await page.locator('#strategy-prime-from').selectOption('19:00');
    await page.locator('#strategy-add-immediate').click();
    expect(await page.locator('#strategy-edit-immediate .strategy-edit-row').count()).toBe(1);
    expect(await page.locator('#strategy-review-warnings').innerText()).not.toContain('failed public-booking read');
    expect(await page.locator('#strategy-normal-save').isEnabled()).toBe(true);
    await page.locator('#strategy-normal-save').click();
    await page.waitForFunction(() => !!(window as any).fixtureSaved);
    const setup = await saved(page);
    expect(setup.PRECISION_PHASE3.candidates[0]).toMatchObject({court:7,start:'19:00',durationHours:3,
      publicEvidence:{evidence:'NOT_CHECKED'}});
    expect(setup.STRATEGY_V2.provenance.source).toBe('OPERATOR_BUILT');
    expect(errors).toEqual([]);
    await page.close();
  });
  it('keeps secondary evidence and engine controls collapsed by default',async()=>{
    const page=await openRendererBase(browser,{booking:smartBooking()},'strategy');
    expect(await page.locator('#strategy-schedule').getAttribute('open')).toBeNull();
    expect(await page.locator('#strategy-normal-settings').getAttribute('open')).toBeNull();
    expect(await page.locator('#strategy-shotgun').isHidden()).toBe(true);
    await page.locator('input[name="strategy-intensity"][value="SHOTGUN"]').check();
    await page.close();
  });
  it('builds and applies in one action, automatically reads evidence, excludes conflicts and preserves primary across modes',async()=>{
    const page=await openRendererBase(browser,{booking:smartBooking(),blockAudit:blockAudit([[7,'19:00']])},'strategy');
    await page.locator('#strategy-ideal-start').selectOption('19:00');
    await page.locator('#strategy-suggest').click();
    await expect.poll(()=>page.locator('#strategy-target-summary').innerText()).toContain('PRIMARY');
    expect(await page.locator('#strategy-apply').isVisible()).toBe(false);
    expect(await page.locator('#smart-suggest').isVisible()).toBe(false);
    expect(await page.locator('#strategy-edit-targets').getAttribute('open')).toBeNull();
    const primary=await page.locator('.target-primary').innerText();expect(primary).toContain('Court 6');
    await page.locator('input[name="strategy-intensity"][value="SHOTGUN"]').check();
    expect(await page.locator('.target-primary').innerText()).toBe(primary);
    await page.locator('input[name="strategy-intensity"][value="NORMAL"]').check();
    expect(await page.locator('.target-primary').innerText()).toBe(primary);
    await page.locator('#strategy-normal-save').click();await page.waitForFunction(()=>(window as any).fixtureSaved);
    expect(await page.locator('#strategy-normal-status').innerText()).toContain('NORMAL STRATEGY SAVED');
    const calls=await page.evaluate(()=>(window as any).fixtureCalls);expect(calls).toContain('checkReleaseBlocks');
    expect(calls.filter((v:string)=>['prepare','authorizeTerms','armFullBooking','testBooking'].includes(v))).toEqual([]);
    const setup=await saved(page);expect(setup.PRECISION_PHASE3.candidates.some((c:any)=>c.court===7&&c.start==='19:00'&&c.durationHours===3)).toBe(false);
    await page.close();
  });
  it('faithfully edits existing single-child and fan-out saved plans using the authoritative representation', async () => {
    const single = await openRenderer(browser, { booking: smartBooking({ immediate: [{ court: 7, start: '19:00', durationHours: 3, releaseOffsetMs: -25 }] }) }, 'strategy');
    expect(await single.locator('#strategy-edit-provenance').innerText()).toBe('Source: Existing Smart plan');
    expect(await single.locator('#strategy-editable').isVisible()).toBe(true);
    expect(await single.locator('#strategy-immediate-offset-0-0').inputValue()).toBe('25');
    expect(await single.locator('[id^="strategy-immediate-offset-0-"]').count()).toBe(1);
    await single.locator('#strategy-immediate-offset-0-0').fill('10'); await single.locator('#strategy-immediate-offset-0-0').press('Tab');
    await single.locator('#strategy-normal-save').click(); await single.waitForFunction(() => !!(window as any).fixtureSaved);
    expect((await saved(single)).PRECISION_PHASE3.wave1[0]).toMatchObject({ releaseOffsetMs: -10 });
    await single.close();

    const fanOut = await openRenderer(browser, { booking: smartBooking({ immediate: [{ court: 7, start: '19:00', durationHours: 3, fanOutOffsetsMs: [-25, -10] }] }) }, 'strategy');
    expect(await fanOut.locator('#strategy-immediate-offset-0-0').inputValue()).toBe('25');
    expect(await fanOut.locator('#strategy-immediate-offset-0-1').inputValue()).toBe('10');
    await fanOut.locator('#strategy-immediate-offset-0-1').fill('5'); await fanOut.locator('#strategy-immediate-offset-0-1').press('Tab');
    await fanOut.locator('#strategy-normal-save').click(); await fanOut.waitForFunction(() => !!(window as any).fixtureSaved);
    const assignment = (await saved(fanOut)).PRECISION_PHASE3.wave1[0];
    expect(assignment.fanOutOffsetsMs).toEqual([-25, -5]);
    expect(assignment).not.toHaveProperty('releaseOffsetMs');
    expect(await fanOut.locator('#strategy-review-technical').innerText()).toContain('A0 25 ms early, A1 5 ms early');
    await fanOut.close();
  });

  it('labels a manual row as Operator added with no reset action, and saving an unchanged old Smart plan preserves authorization', async () => {
    const booking=smartBooking(),before=structuredClone(booking.setup.PRECISION_PHASE3);
    const page=await openRenderer(browser,{booking},'strategy');
    expect(await page.locator('#strategy-edit-provenance').innerText()).toBe('Source: Existing Smart plan');
    await page.locator('#smart-add-immediate').evaluate((button:HTMLButtonElement)=>button.click());
    const added=page.locator('#strategy-edit-immediate .strategy-edit-row').last();
    expect(await added.locator('.strategy-source').first().innerText()).toBe('OPERATOR ADDED');
    expect(await added.getByRole('button',{name:'Reset editable target 2',exact:true}).isDisabled()).toBe(true);
    await page.locator('#strategy-normal-save').click();await page.waitForFunction(()=>!!(window as any).fixtureSaved);
    const setup=await saved(page);expect(setup.STRATEGY_V2).toBeUndefined();
    // Remove the manual edit and save the original old plan: opening alone never creates a Smart-generated baseline.
    await added.getByRole('button',{name:/Remove editable target/}).click();
    (await page.evaluate(()=>(window as any).fixtureSaved=null));
    await page.locator('#strategy-normal-save').click();await page.waitForFunction(()=>!!(window as any).fixtureSaved);
    expect((await saved(page)).PRECISION_PHASE3).toEqual(before);
    await page.close();
  });

  it('an explicit fan-out width is recorded as an operator override, and preset Custom suggests nothing', async () => {
    const page = await openRenderer(browser, { booking: smartBooking(), blockAudit: blockAudit([]), fanOut: fanOutDigest() }, 'strategy');
    await page.locator('#strategy-fanout').selectOption('3');
    expect(await page.locator('#strategy-fanout-note').innerText()).toContain('Operator override: 3 per target');
    await page.locator('#strategy-suggest').click();
    await page.waitForFunction(()=>!document.getElementById('strategy-suggest')?.hasAttribute('disabled'));
    await page.locator('#strategy-normal-save').click();
    await page.waitForFunction(() => !!(window as any).fixtureSaved);
    expect((await saved(page)).STRATEGY_V2.fanOut).toMatchObject({ width: 3, source: 'OPERATOR_OVERRIDE', recommendedWidth: 2 });
    await page.locator('input[name="strategy-preset"][value="CUSTOM"]').check();
    expect(await page.locator('#strategy-suggest').isEnabled()).toBe(true);
    await page.close();
  });

  it('applies and persists a manual live group shift without switching the Strategy preset to Custom', async () => {
    const page = await openRenderer(browser, { booking: smartBooking(), blockAudit: blockAudit([]), fanOut: fanOutDigest() }, 'strategy');
    await page.locator('#strategy-anchor-mode').selectOption('MANUAL');
    await page.locator('#strategy-anchor-shift').fill('5');
    await page.locator('#strategy-anchor-shift').press('Tab');
    await page.locator('#strategy-suggest').click();
    await page.waitForFunction(()=>!document.getElementById('strategy-suggest')?.hasAttribute('disabled'));
    expect(await page.locator('#strategy-immediate-offset-0-0').inputValue()).toBe('10');
    expect(await page.locator('#strategy-immediate-offset-0-1').inputValue()).toBe('5');
    expect(await page.locator('#strategy-review-technical').innerText()).toContain('A0 10 ms early, A1 5 ms early');
    await page.locator('#strategy-normal-save').click(); await page.waitForFunction(() => !!(window as any).fixtureSaved);
    const setup = await saved(page);
    expect(setup.STRATEGY_V2.timingCalibration).toMatchObject({ anchorSource: 'OPERATOR_OVERRIDE', groupShiftMs: -5, spacingSource: 'MACHINE_PROFILE' });
    expect(setup.PRECISION_PHASE3.wave1[0].fanOutOffsetsMs).toEqual([-10, -5]);
    expect(setup.STRATEGY_V2.preset).toBe('BALANCED');
    await page.close();
  });

  it('composes worker de-skew into the displayed, reviewed and saved literal offsets', async () => {
    // Two fresh width-2 real releases: worker A's own invocation -> Chrome lag is 10 ms, every other worker 4 ms.
    const lagStats = { n: 14, p50: 5, p95: 11, p99: 11, max: 11, min: 5, mean: 6 }, none = { n: 0, p50: null, p95: null, p99: null, max: null, min: null, mean: null };
    const telemetry = ['2026-09-28T00:00:00Z', '2026-09-29T00:00:00Z'].map((generatedAt, run) => ({ runId: `live-${run}`, date: '2026-10-01', generatedAt, releaseMs: Date.parse(generatedAt),
      origin: 'REAL_RELEASE', mode: 'live', machineKey: null, runtimeKey: null,
      children: 'ABCDEFG'.split('').flatMap((workerId, worker) => [0, 1].map(fanOutIndex => {
        const configuredOffsetMs = fanOutIndex ? 0 : -10, invoked = configuredOffsetMs + worker * 0.4, chrome = invoked + (workerId === 'A' ? 10 : 4);
        return { attemptId: `${workerId}${fanOutIndex}`, label: `${workerId}${fanOutIndex}`, workerId, parentGoalId: null, fanOutIndex, fanOutCount: 2, configuredOffsetMs,
          workerInvokedMs: invoked, fetchInvokedMs: null, chromeStartMs: chrome, requestEventMs: chrome + 1, responseMs: 8_000, errorMs: Math.round((chrome - configuredOffsetMs) * 100) / 100,
          prewarmReadyMs: -1_400, finalState: 'REJECTED', dispatchMode: 'node', trustedClockValid: true, dispatched: true };
      })),
      summary: { configuredToChrome: lagStats, perChildIndex: [], perWorker: {}, spreadMs: 12, compression: 1, prewarmHeadroomMs: none, adaptiveSelectionToPost: none, reopenPredictionErrorMs: none } }));
    const page = await openRenderer(browser, { booking: smartBooking(), blockAudit: blockAudit([]), fanOut: fanOutDigest(), telemetry }, 'strategy');
    await page.locator('#strategy-anchor-mode').selectOption('MANUAL');
    await page.locator('#strategy-anchor-shift').fill('5');
    await page.locator('#strategy-anchor-shift').press('Tab');
    await page.locator('#strategy-suggest').click();
    expect(await page.locator('#strategy-timing-children').innerText()).toContain('A0: base -10 ms + local de-skew -6 ms = final -16 ms · USABLE');
    await page.waitForFunction(()=>!document.getElementById('strategy-suggest')?.hasAttribute('disabled'));
    expect(await page.locator('#strategy-immediate-offset-0-0').inputValue()).toBe('16');
    expect(await page.locator('#strategy-immediate-offset-0-1').inputValue()).toBe('11');
    expect(await page.locator('#strategy-review-technical').innerText()).toContain('A0 16 ms early, A1 11 ms early');
    await page.locator('#strategy-normal-save').click(); await page.waitForFunction(() => !!(window as any).fixtureSaved);
    const setup = await saved(page);
    expect(setup.PRECISION_PHASE3.wave1[0].fanOutOffsetsMs).toEqual([-16, -11]);
    expect(setup.STRATEGY_V2.timingCalibration.deskew.corrections).toContainEqual({ workerId: 'A', fanOutIndex: 0, correctionMs: -6, matchingReleases: 2, evidenceStrength: 'USABLE' });
    expect(setup.STRATEGY_V2.timingCalibration.deskew.corrections).toContainEqual({ workerId: 'B', fanOutIndex: 1, correctionMs: 0, matchingReleases: 2, evidenceStrength: 'USABLE' });
    await page.close();
  });

  it('shows width-1 live history as context but not as width-2 matching calibration', async () => {
    const children = [-50, -25, -10, -5, 0, 0, 0].map((configuredOffsetMs, index) => ({ attemptId: `a${index}`, label: String.fromCharCode(65 + index), workerId: String.fromCharCode(65 + index),
      parentGoalId: null, fanOutIndex: 0, fanOutCount: 1, configuredOffsetMs, workerInvokedMs: configuredOffsetMs, fetchInvokedMs: null,
      chromeStartMs: configuredOffsetMs + 4.2, requestEventMs: configuredOffsetMs + 4.4, responseMs: 8_000 + index, errorMs: 4.2,
      prewarmReadyMs: -9_000, finalState: 'REJECTED', dispatchMode: 'node', trustedClockValid: true, dispatched: true }));
    const lagStats = { n: 7, p50: 4.2, p95: 4.2, p99: 4.2, max: 4.2, min: 4.2, mean: 4.2 }, none = { n: 0, p50: null, p95: null, p99: null, max: null, min: null, mean: null };
    const telemetry = [{ runId: 'sep-28', date: '2026-09-30', generatedAt: '2026-09-28T00:00:00Z', releaseMs: Date.parse('2026-09-28T00:00:00Z'),
      origin: 'REAL_RELEASE', mode: 'live', machineKey: null, runtimeKey: null, children, summary: { configuredToChrome: lagStats,
        perChildIndex: [{ fanOutIndex: 0, error: lagStats }], perWorker: {}, spreadMs: 50, compression: 1, prewarmHeadroomMs: none,
        adaptiveSelectionToPost: none, reopenPredictionErrorMs: none } }];
    const page = await openRenderer(browser, { booking: smartBooking(), fanOut: fanOutDigest(), telemetry }, 'strategy');
    expect(await page.locator('#strategy-anchor-note').innerText()).toContain('No usable matching width-2 live calibration');
    expect(await page.locator('#strategy-anchor-note').innerText()).toContain('7 single-attempt timing samples are available');
    await page.locator('#strategy-fanout').selectOption('1');
    expect(await page.locator('#strategy-anchor-note').innerText()).toContain('4 ms early');
    expect(await page.locator('#strategy-anchor-note').innerText()).toContain('1 matching real release');
    await page.close();
  });

  it('resets by stable origin after reorder, removal, backup reorder, save and reload', async () => {
    const digest=fanOutDigest(),audit=blockAudit([]),page=await openRenderer(browser,{booking:smartBooking(),blockAudit:audit,fanOut:digest},'strategy');
    await page.locator('#strategy-suggest').click();await page.waitForFunction(()=>!document.getElementById('strategy-suggest')?.hasAttribute('disabled'));
    const target=(index:number)=>page.locator('#strategy-edit-immediate .strategy-edit-row').nth(index);
    const backup=(index:number)=>page.locator('#strategy-edit-backups .strategy-edit-row').nth(index);
    const originalA={court:await target(0).locator('select[id*="-court-"]').inputValue(),start:await target(0).locator('select[id*="-start-"]').inputValue()};
    const originalB={court:await target(1).locator('select[id*="-court-"]').inputValue(),start:await target(1).locator('select[id*="-start-"]').inputValue()};
    await target(1).getByRole('button',{name:'Move editable target 2 up'}).click();
    await target(0).locator('select[id*="-start-"]').selectOption('23:00');
    await target(0).getByRole('button',{name:'Reset editable target 1',exact:true}).click();
    expect({court:await target(0).locator('select[id*="-court-"]').inputValue(),start:await target(0).locator('select[id*="-start-"]').inputValue()}).toEqual(originalB);
    expect({court:await target(1).locator('select[id*="-court-"]').inputValue(),start:await target(1).locator('select[id*="-start-"]').inputValue()}).toEqual(originalA);
    await target(1).getByRole('button',{name:'Remove editable target 2'}).click();
    await target(0).locator('select[id*="-court-"]').selectOption('1');
    await target(0).getByRole('button',{name:'Reset editable target 1',exact:true}).click();
    expect(await target(0).locator('select[id*="-court-"]').inputValue()).toBe(originalB.court);

    const backup2={court:await backup(1).locator('select[id*="-court-"]').inputValue(),start:await backup(1).locator('select[id*="-start-"]').inputValue()};
    await backup(1).getByRole('button',{name:'Move editable backup 2 up'}).click();
    await backup(0).locator('select[id*="-court-"]').selectOption('1');
    await backup(0).getByRole('button',{name:'Reset editable backup 1',exact:true}).click();
    expect({court:await backup(0).locator('select[id*="-court-"]').inputValue(),start:await backup(0).locator('select[id*="-start-"]').inputValue()}).toEqual(backup2);

    await page.locator('#strategy-reset-all').click();await target(1).getByRole('button',{name:'Move editable target 2 up'}).click();
    await page.locator('#strategy-immediate-offset-0-0').fill('25');await page.locator('#strategy-immediate-offset-0-0').press('Tab');
    await page.locator('#strategy-normal-save').click();await page.waitForFunction(()=>!!(window as any).fixtureSaved);
    const setup=await saved(page);expect(setup.STRATEGY_V2.lineage.immediate.slice(0,2)).toEqual(['I1','I0']);await page.close();
    const reloaded=await openRenderer(browser,{booking:bookingView(ConfigSchema.parse({...defaultSetup,...setup,...players})),blockAudit:audit,fanOut:digest},'strategy');
    const first=reloaded.locator('#strategy-edit-immediate .strategy-edit-row').first();
    await first.getByRole('button',{name:'Reset editable target 1',exact:true}).click();
    expect({court:await first.locator('select[id*="-court-"]').inputValue(),start:await first.locator('select[id*="-start-"]').inputValue()}).toEqual(originalB);
    await reloaded.close();
  },60_000);

  it('continues with a warning after public read failure and applies preference ranking',async()=>{
    const page=await openRendererBase(browser,{booking:smartBooking()},'strategy');
    await page.evaluate(()=>{(window as any).thirsty.checkReleaseBlocks=async()=>{throw new Error('403')};});
    await page.locator('#strategy-suggest').click();
    await expect.poll(()=>page.locator('#strategy-target-summary').innerText()).toContain('Public schedule could not be fully verified');
    expect(await page.locator('#strategy-target-summary').innerText()).toContain('preference ranking used');
    expect(await page.locator('#strategy-edit-immediate .strategy-edit-row').count()).toBeGreaterThan(0);
    expect(await page.locator('#strategy-target-summary').innerText()).not.toContain('confirmed open');await page.close();
  });
  it('discards a pending suggestion when the Goal changes and keeps Use this plan disabled', async () => {
    const page=await openRenderer(browser,{booking:smartBooking(),blockAudit:blockAudit([])},'strategy');await controlStrategyEvidence(page);
    await page.locator('#strategy-courts').fill('7');await page.locator('#strategy-courts').dispatchEvent('change');
    await page.locator('#strategy-suggest').click();await expect.poll(()=>evidenceRequestCount(page)).toBe(1);
    expect(await page.locator('#strategy-suggestion').innerText()).toContain('Building target plan');
    await page.locator('#strategy-courts').fill('6');await page.locator('#strategy-courts').dispatchEvent('change');
    await settleEvidence(page,0);await page.waitForTimeout(0);
    expect(await page.locator('#strategy-apply').isDisabled()).toBe(true);
    expect(await page.locator('#strategy-apply').isDisabled()).toBe(true);await page.close();
  });

  it('tracks the main court order, preserves a Strategy override, and invalidates pending suggestions on reorder', async()=>{
    const page=await openRenderer(browser,{booking:smartBooking(),blockAudit:blockAudit([])},'strategy');await controlStrategyEvidence(page);
    await showRendererView(page,'plan');
    const move=page.locator('#court-order li').first().getByRole('button',{name:/down/i});
    expect(await page.locator('#strategy-courts').inputValue()).toBe('7,6,5,4,3,2,1');
    await page.locator('#strategy-suggest').click();await expect.poll(()=>evidenceRequestCount(page)).toBe(1);
    await move.click();
    expect(await page.locator('#strategy-courts').inputValue()).toBe('6,7,5,4,3,2,1');
    await settleEvidence(page,0);expect(await page.locator('#strategy-apply').isDisabled()).toBe(true);
    await page.locator('#strategy-courts').fill('1,2');await page.locator('#strategy-courts').dispatchEvent('change');
    await page.locator('#court-order li').first().getByRole('button',{name:/down/i}).click();
    expect(await page.locator('#strategy-courts').inputValue()).toBe('1,2');
    await page.locator('#strategy-sync-courts').click();
    expect(await page.locator('#strategy-courts').inputValue()).toBe('7,6,5,4,3,2,1');
    await page.close();
  });

  it('keeps the newest suggestion authoritative when successful requests finish out of order', async () => {
    const page=await openRenderer(browser,{booking:smartBooking(),blockAudit:blockAudit([])},'strategy');await controlStrategyEvidence(page);
    await page.locator('#strategy-courts').fill('7');await page.locator('#strategy-courts').dispatchEvent('change');await page.locator('#strategy-suggest').click();
    await expect.poll(()=>evidenceRequestCount(page)).toBe(1);
    await page.locator('#strategy-courts').fill('6');await page.locator('#strategy-courts').dispatchEvent('change');await page.locator('#strategy-suggest').click();
    await expect.poll(()=>evidenceRequestCount(page)).toBe(2);
    const requestCourts=await page.evaluate(()=>(window as any).fixtureEvidenceRequests.map((request:any)=>[...new Set(request.input.ranges.map((range:any)=>range.court))]));
    expect(requestCourts).toEqual([[7],[6]]);
    await settleEvidence(page,1);await expect.poll(()=>page.locator('.target-primary').innerText()).toMatch(/Court 6/);
    const authoritative=await page.locator('#strategy-target-summary').innerText();expect(authoritative).not.toMatch(/Court 7/);
    await settleEvidence(page,0);await page.waitForTimeout(0);
    expect(await page.locator('#strategy-target-summary').innerText()).toBe(authoritative);
    expect(await page.locator('#strategy-apply').isDisabled()).toBe(false);await page.close();
  });

  it('does not let a stale evidence failure replace a newer successful suggestion', async () => {
    const page=await openRenderer(browser,{booking:smartBooking(),blockAudit:blockAudit([])},'strategy');await controlStrategyEvidence(page);
    await page.locator('#strategy-courts').fill('7');await page.locator('#strategy-courts').dispatchEvent('change');await page.locator('#strategy-suggest').click();
    await expect.poll(()=>evidenceRequestCount(page)).toBe(1);
    await page.locator('#strategy-courts').fill('6');await page.locator('#strategy-courts').dispatchEvent('change');await page.locator('#strategy-suggest').click();
    await expect.poll(()=>evidenceRequestCount(page)).toBe(2);await settleEvidence(page,1);
    await expect.poll(()=>page.locator('.target-primary').innerText()).toMatch(/Court 6/);const authoritative=await page.locator('#strategy-target-summary').innerText();
    await settleEvidence(page,0,true);await page.waitForTimeout(0);expect(await page.locator('#strategy-target-summary').innerText()).toBe(authoritative);
    expect(await page.locator('#strategy-apply').isDisabled()).toBe(false);await page.close();
  });

  it('invalidates pending work on preset, intelligence-mode, and fan-out timing changes', async () => {
    const changes: Array<(page:Page)=>Promise<void>>=[
      async page=>{await page.locator('input[name="strategy-preset"][value="RESCUE_FOCUSED"]').check();},
      async page=>{await page.locator('#strategy-intelligence').selectOption('PREFERENCE_ONLY');},
      async page=>{await page.locator('#strategy-fanout').selectOption('2');},
      async page=>{await page.locator('#strategy-timing').selectOption('WIDE');},
    ];
    for(const change of changes){
      const page=await openRenderer(browser,{booking:smartBooking(),blockAudit:blockAudit([])},'strategy');await controlStrategyEvidence(page);
      await page.locator('#strategy-suggest').click();await expect.poll(()=>evidenceRequestCount(page)).toBe(1);await change(page);await settleEvidence(page,0);await page.waitForTimeout(0);
      expect(await page.locator('#strategy-apply').isDisabled()).toBe(true);expect(await page.locator('.target-primary').innerText()).toContain('Court 7');await page.close();
    }
  });

  it('Preference only builds immediately without requesting historical evidence', async () => {
    const page=await openRenderer(browser,{booking:smartBooking(),blockAudit:blockAudit([])},'strategy');await controlStrategyEvidence(page);
    await page.locator('#strategy-intelligence').selectOption('PREFERENCE_ONLY');await page.locator('#strategy-suggest').click();
    expect(await evidenceRequestCount(page)).toBe(0);expect(await page.locator('#strategy-target-summary').innerText()).toMatch(/PRIMARY/);await page.close();
  });
});

describe('Next Release, Live and History & Insights', () => {
  it('Next Release states the plan generated from the SAVED authorization', async () => {
    const booking = smartBooking({ immediate: [{ court: 7, start: '19:00', durationHours: 3, fanOutOffsetsMs: [-10, 0] }, { court: 6, start: '20:00', durationHours: 3, fanOutOffsetsMs: [-10, 0] }],
      backups: [{ court: 5, start: '18:00', durationHours: 3 }], retryReopened: true, maxReopenedAttempts: 2 });
    const page = await openRenderer(browser, { booking, build: { schema: 'thirsty-build-info/v1', kind: 'installation', gitSha: 'b'.repeat(40), branch: 'x', dirty: false,
      builtAt: '2026-09-29T00:00:00.000Z', packageVersion: '0.1.0', node: 'v24', contentId: 'c'.repeat(64), buildId: 'bbbbbbb-cccccccccc' } }, 'release');
    // textContent: the badge is upper-cased by CSS only.
    const text = (await page.locator('#next-strategy').textContent())!;
    const expected = describeSmartPlan(booking.setup.PRECISION_PHASE3!);
    expect(text).toContain('Smart (custom)');
    expect(text).toMatch(/Immediate logical targets\s*2/);
    expect(text).toMatch(/Fan-out\s*2 per target · 4 sends/);
    expect(text).toMatch(new RegExp(`Maximum possible sends\\s*${expected.maxSends}`));
    expect(text).toMatch(/Rescue\s*on · up to 2/);
    expect(text).toContain('bbbbbbb');
    await page.close();
  });

  it('Live summarizes by logical target and expands children instead of 28 undifferentiated rows', async () => {
    const live: LiveRunView = { predictions: [{ candidateId: 'c', court: 3, startTime: '19:00', endTime: '22:00', predictedStartMs: 598_000, predictedEndMs: 610_000, confidence: 'HOLD_EXPIRY_PATTERN', prewarm: 'READY' }],
      notes: [], rescueEnabled: true, rescueMax: 2, tiers: 'Tier 1 ready: 7/7 · Tier 2 ready: 7/7 · Tier 3 ready: 5/7 (2 preparing) · Tier 4 ready: 0/7 (7 omitted)',
      parents: 'ABCDEFG'.split('').map((worker, index) => ({ key: `W1/${worker}`, wave: 'WAVE_1' as const, workerId: worker, court: 7 - index, startTime: '19:00', endTime: '22:00',
        children: [0, 1, 2, 3].map(child => ({ attemptId: `${worker}${child}`, label: `${worker}${child}`, fanOutIndex: child, fanOutCount: 4,
          state: child === 3 ? 'NOT_DISPATCHED' : child === 2 && index === 0 ? 'IN_FLIGHT' : 'REJECTED' })) })) };
    const page = await openRenderer(browser, { live }, 'live');
    expect(await page.locator('#live-attempts .live-parent').count()).toBe(7);
    expect(await page.locator('#live-attempts .live-child').count()).toBe(28);
    expect(await page.locator('#live-attempts .live-parent').first().locator('summary').innerText()).toBe('Court 7 · 7 PM–10 PM · Worker A · Release attempts — 2 rejected, 1 in flight, 1 not dispatched');
    // Dense attempt groups stay collapsed until the operator requests detail.
    expect(await page.locator('#live-attempts .live-parent[open]').count()).toBe(0);
    expect(await page.locator('#live-prewarm').innerText()).toContain('Tier 4 ready: 0/7 (7 omitted)');
    expect(await page.locator('#live-rescue').innerText()).toContain('may reopen +9:58…+10:10');
    expect(await page.locator('#live-rescue').innerText()).toContain('Predictions only prepare a Rescue worker');
    await page.close();
  });

  it('History & Insights shows the machine benchmark, offset calibration and reopen prediction accuracy', async () => {
    const telemetry = [{ runId: 'run-1234567890', date: '2026-10-01', generatedAt: '2026-09-29T00:00:00.000Z', children: [
      { attemptId: 'x', label: 'A0', workerId: 'A', parentGoalId: 'g', fanOutIndex: 0, fanOutCount: 2, configuredOffsetMs: -10, workerInvokedMs: -9.5, fetchInvokedMs: -7, chromeStartMs: -5, requestEventMs: -2, responseMs: 900, errorMs: 5, prewarmReadyMs: -9000, finalState: 'REJECTED' },
      { attemptId: 'y', label: 'A1', workerId: 'A', parentGoalId: 'g', fanOutIndex: 1, fanOutCount: 2, configuredOffsetMs: 0, workerInvokedMs: 0.4, fetchInvokedMs: 3, chromeStartMs: 6, requestEventMs: 9, responseMs: 910, errorMs: 6, prewarmReadyMs: -8000, finalState: 'REJECTED' }],
      summary: { configuredToChrome: { n: 2, p50: 5, p95: 6, p99: 6, max: 6, min: 5, mean: 5.5 }, perChildIndex: [{ fanOutIndex: 0, error: { n: 1, p50: 5, p95: 5, p99: 5, max: 5, min: 5, mean: 5 } },
        { fanOutIndex: 1, error: { n: 1, p50: 6, p95: 6, p99: 6, max: 6, min: 6, mean: 6 } }], perWorker: {}, spreadMs: 11, compression: 1.1,
        prewarmHeadroomMs: { n: 2, p50: 8000, p95: 8990, p99: 8990, max: 8990, min: 8000, mean: 8495 }, adaptiveSelectionToPost: { n: 0, p50: null, p95: null, p99: null, max: null, min: null, mean: null },
        reopenPredictionErrorMs: { n: 0, p50: null, p95: null, p99: null, max: null, min: null, mean: null } } }];
    const slotWatchHistory = [{ id: 'w', date: '2026-10-01', releaseMs: Date.parse('2026-09-29T00:00:00Z'), legacy: true, status: 'finished', availability: { answered: 40 }, quality: { expiryPredictions: { predicted: 4, reopenedInWindow: 3, reopenedOutside: 0, notReopened: 1, medianAbsErrorMs: 1800, rows: [] } } }];
    const page = await openRenderer(browser, { fanOut: fanOutDigest(), telemetry, slotWatchHistory }, 'history');
    expect(await page.locator('#fanout-benchmark').innerText()).toContain('Machine recommendation: 2 attempts per target (local dispatch only)');
    expect(await page.locator('#fanout-benchmark > table tbody tr').count()).toBe(4);
    expect(await page.locator('#offset-calibration').innerText()).toMatch(/A0\s*−10\.0 ms\s*−5\.0 ms\s*5\.0 ms/);
    expect(await page.locator('#offset-calibration').innerText()).toContain('offsets preserved 110%');
    expect(await page.locator('#reopen-accuracy').innerText()).toMatch(/2026-10-01\s*4\s*3\s*0\s*1\s*1\.8 s/);
    await page.close();
  });
});

// Real-release history reaches the de-skew panel even while another view is selected.
it.each([5,6])('keeps Strategy controls responsive with saved width %i and live timing history',async width=>{
 const stamp=new Date().toISOString(),stats={n:1,p50:5,p95:5,p99:5,max:5,min:5,mean:5},none={n:0,p50:null,p95:null,p99:null,max:null,min:null,mean:null};
 const telemetry=[{runId:'wide-topology-fixture',date:targetDate,generatedAt:stamp,releaseMs:Date.parse(stamp),origin:'REAL_RELEASE',mode:'live',machineKey:null,runtimeKey:null,
   children:[{attemptId:'A0',label:'A0',workerId:'A',parentGoalId:null,fanOutIndex:0,fanOutCount:2,configuredOffsetMs:0,workerInvokedMs:1,fetchInvokedMs:2,chromeStartMs:5,requestEventMs:6,responseMs:10,errorMs:5,prewarmReadyMs:-1400,finalState:'REJECTED',dispatchMode:'node',trustedClockValid:true,dispatched:true}],
   summary:{configuredToChrome:stats,perChildIndex:[],perWorker:{},spreadMs:0,compression:null,prewarmHeadroomMs:none,adaptiveSelectionToPost:none,reopenPredictionErrorMs:none}}];
 const page=await openRendererBase(browser,{booking:smartBooking({immediate:[{court:7,start:'19:00',durationHours:3,fanOutOffsetsMs:Array.from({length:width},(_,i)=>(i-width+1)*10)}]}),telemetry},'strategy');
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 expect(await page.locator('#strategy-suggest').isEnabled()).toBe(true);
 await page.locator('input[name="strategy-intensity"][value="SHOTGUN"]').check();
 expect(await page.locator('#strategy-shotgun-fast-path').isVisible()).toBe(true);
 await page.locator('input[name="strategy-intensity"][value="NORMAL"]').check();
 expect(await page.locator('#strategy-normal-fast-path').isVisible()).toBe(true);
 await page.locator('#strategy-advanced > summary').click();await page.locator('#strategy-edit-targets > summary').click();expect(await page.locator('#strategy-add-immediate').isVisible()).toBe(true);
 await page.locator('#strategy-ideal-start').selectOption('20:00');await page.locator('#strategy-suggest').click();
 await expect.poll(()=>page.locator('.target-primary').innerText()).toContain('8:00 PM');
 expect(await page.locator('#strategy-normal-save').isEnabled()).toBe(true);
 expect(errors).toEqual([]);
 expect(await page.evaluate(()=>(window as any).fixtureCalls.filter((name:string)=>['prepare','authorizeTerms','armFullBooking','testBooking'].includes(name)))).toEqual([]);
 await page.close();
});


it('lets the operator skip a new public read, retains known conflicts, and saves the choice',async()=>{
 const page=await openRendererBase(browser,{booking:smartBooking(),blockAudit:blockAudit([[7,'19:00']])},'strategy');
 await page.locator('#strategy-ideal-start').selectOption('19:00');
 await page.locator('#strategy-advanced').evaluate(node=>(node as HTMLDetailsElement).open=true);await page.locator('#strategy-public-data').selectOption('CACHED_ONLY');
 await page.locator('#strategy-suggest').click();
 await expect.poll(()=>page.locator('.target-primary').innerText()).toContain('Court 6');
 expect(await page.locator('#strategy-target-summary').innerText()).toContain('No new public-booking check requested');
 expect(await page.evaluate(()=>(window as any).fixtureCalls.includes('checkReleaseBlocks'))).toBe(false);
 await page.locator('#strategy-normal-save').click();await page.waitForFunction(()=>(window as any).fixtureSaved);
 const setup=await saved(page);expect(setup.STRATEGY_V2.publicScheduleMode).toBe('CACHED_ONLY');
 ConfigSchema.parse({...setup,...players});
 await page.close();
 const reopened=await openRendererBase(browser,{booking:bookingView(ConfigSchema.parse({...setup,...players}))},'strategy');
 expect(await reopened.locator('#strategy-public-data').inputValue()).toBe('CACHED_ONLY');
 await reopened.close();
});

it('saves Normal with stale pinned limits through its single visible action',async()=>{
 const page=await openRendererBase(browser,{booking:smartBooking({retryReopened:true,maxReopenedAttempts:1,advanced:{total:1}}),playerStatus:{primary:true,extended:true,third:true,fourth:true,fifth:true,sixth:true,seventh:true}},'strategy');
 await page.locator('#strategy-advanced').evaluate(node=>(node as HTMLDetailsElement).open=true);await page.locator('#strategy-public-data').selectOption('CACHED_ONLY');
 await page.locator('#strategy-suggest').click();
 await expect.poll(()=>page.locator('#strategy-normal-status').innerText()).toContain('Saving will use automatic limits');
 expect(await page.locator('#strategy-normal-save').isEnabled()).toBe(true);
 expect(await page.locator('#strategy-normal-summary').innerText()).toContain('Release attempts: 4');
 expect(await page.locator('#strategy-review-body').innerText()).toContain('4 normal measured attempts');
 const before=await page.evaluate<SmartDraft>("(async()=>JSON.parse((await import(new URL('strategy.js',location.href).href)).strategySaveSnapshot()))()");
 expect(before.advanced.total).toBe(1);
 await page.locator('#strategy-advanced > summary').click();
 await page.locator('#strategy-normal-save').click();await page.waitForFunction(()=>(window as any).fixtureSaved);
 const after=await page.evaluate<SmartDraft>("(async()=>JSON.parse((await import(new URL('strategy.js',location.href).href)).strategySaveSnapshot()))()");
 expect(after.immediate).toEqual(before.immediate);expect(after.backups).toEqual(before.backups);
 expect((await saved(page)).PRECISION_PHASE3.budgets.total).not.toBe(1);
 expect(await page.locator('#strategy-advanced').getAttribute('open')).toBeNull();
 expect(await page.locator('#strategy-normal-status').innerText()).toContain('NORMAL STRATEGY SAVED');
 expect((await saved(page)).PRECISION_PHASE3.budgets.total).toBeGreaterThan(1);
 expect(await page.evaluate(()=>(window as any).fixtureCalls.filter((name:string)=>['prepare','authorizeTerms','armFullBooking','testBooking'].includes(name)))).toEqual([]);
 await page.close();
});
