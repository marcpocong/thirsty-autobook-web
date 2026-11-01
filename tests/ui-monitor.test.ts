import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { openRenderer, showRendererView } from './renderer-harness.js';
import { bookingView, defaultSetup } from '../ui/booking.js';
import { compileObjective, defaultObjective, savedMangoReleaseSetup, withStrategy, enumerateTargets } from '../src/booking-objective.js';
import { ConfigSchema } from '../src/config.js';

let browser: Browser;
const shots = '.local/ui-overhaul/shots';
beforeAll(async () => { browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) }); await mkdir(shots, { recursive: true }); });
afterAll(async () => { await browser.close(); });
const objective=withStrategy(defaultObjective(Date.now()),'SHOTGUN');
objective.wings.MANGO={...objective.wings.MANGO,courts:[{court:7,priority:1},{court:6,priority:2}],startTimes:['19:00'],durationHours:2,minimum:2,ideal:2};
const ids=enumerateTargets(objective).targets.map(t=>t.id);
objective.shotgun={...objective.shotgun,budget:4,allocationMode:'CUSTOM',timingMode:'CUSTOM',customOffsetsMs:[-100,0,-100,0],customCounts:{[ids[0]!]:2,[ids[1]!]:2},timingCapacityOverride:true};
const saved=savedMangoReleaseSetup(compileObjective(objective,{nowMs:Date.now()}),objective.wings.MANGO.bookingDate).setup!;
const booking = bookingView(ConfigSchema.parse({ ...defaultSetup,...saved, PLAYER_FULL_NAME: 'Fixture', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'fixture@example.invalid' }));
const now = Date.now(), releaseMs = now + 300000;
const clock = { releaseMs, remainingMs: 300000, networkSynced: true, clockOffsetMs: 0, clockQuality: 'GOOD', manilaTime: '07:55:00', manilaDate: 'Fixture date', targetDate: booking.targetDate, releaseTime: '08:00:00', timezone: 'Asia/Manila', clockSynchronizedAt: new Date().toISOString() };
const activeApiRelease = { releaseMs, targetDate: booking.targetDate, phase: 'WAITING' };
const live = (states: string[]) => ({ parents: states.map((state, i) => ({ key: String(i), wave: 'WAVE_1', workerId: ['A', 'B', 'C'][i % 3], court: 7 - i, startTime: '19:00', endTime: '20:00', children: [{ attemptId: String(i), state, label: 'Primary', fanOutIndex: 0, fanOutCount: 1 }] })), predictions: [], notes: [] });
const possible = (i: number) => ({ key: String(i), date: '2025-01-01', courts: [5, 6, 7], startTime: '19:00', endTime: '22:00', holdExpiresAt: '2025-01-01T00:00:00Z', amount: 600, bookingIds: ['PRIVATE-BOOKING-ID'], bookingNumbers: ['PRIVATE-NUMBER'], code: 'UNKNOWN' });

for (const width of [1060, 1280, 1440, 1920]) it(`qualifies operational scenarios and responsive layout at ${width}px`, async () => {
  const page = await openRenderer(browser, { booking, clock, browserHealth: { A: true, B: true, C: false } }, 'home', { width, height: width === 1060 ? 760 : 1000 });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  try {
    const scenarios = [
      ['idle-history', { possibleHolds: Array.from({ length: 17 }, (_, i) => possible(i)) }, 'setup'],
      ['saved', { ready: true }, 'home'],
      ['armed-five-minutes', { operation: 'full', activeApiRelease }, 'live'],
      ['armed-seconds', { operation: 'full', activeApiRelease, clock: { ...clock, remainingMs: 8000 } }, 'live'],
      ['dispatching', { operation: 'full', activeApiRelease: { ...activeApiRelease, phase: 'RUNNING' }, live: live(['ARMED', 'IN_FLIGHT', 'NOT_DISPATCHED']) }, 'live'],
      ['mixed', { operation: 'idle', live: live(['HOLD_VERIFIED', 'UNKNOWN', 'REJECTED', 'NOT_DISPATCHED']) }, 'live'],
      ['expired', { possibleHolds: [possible(0)] }, 'records'],
      ['stale-plan', { planDate: { status: 'STALE', planDate: '2025-01-01', targetDate: booking.targetDate } }, 'setup'],
      ['retained-lock', { lock: true, retainedLockStage: 'FINAL_ACTION_DISPATCHING' }, 'home'],
      ['stopped', { operation: 'stopping' }, 'live'],
    ] as const;
    for (const [name, extra, view] of scenarios) {
      await page.evaluate(extra => { const w = window as any; w.fixtureState = { ...w.fixtureState, operation: 'idle', activeApiRelease: null, scheduledRelease: null, live: null, lock: false, ready: false, possibleHolds: [], planDate: null, ...extra }; w.fixturePublish(w.fixtureState); }, { ...extra, clock: 'clock' in extra ? extra.clock : clock });
      await showRendererView(page, view);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      if (name.startsWith('armed')) {
        expect(await page.locator('#monitor-title').innerText()).toBe('ARMED');
        expect(await page.locator('#monitor-countdown').innerText()).toContain('Release in');
        expect(await page.locator('#monitor-stop').isVisible()).toBe(true);
        expect(await page.locator('#monitor-plan').innerText()).toContain(booking.fingerprint);
      }
      if (name === 'idle-history') { expect(await page.locator('#possible-hold-alert').innerText()).toContain('17 unresolved'); expect(await page.locator('#possible-hold-alert').innerText()).not.toContain('PRIVATE-'); expect(await page.locator('#possible-hold-alert').evaluate(e => e.getBoundingClientRect().height)).toBeLessThan(150); }
      await page.screenshot({ path: `${shots}/${width}-${name}.png`, fullPage: true });
    }
    expect(await page.evaluate(() => (window as any).fixtureCalls)).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 120000);

it('navigates once on an authoritative arm transition, preserves manual navigation and uses the existing stop', async () => {
  const page = await openRenderer(browser, { booking, clock }, 'home');
  try {
    await page.evaluate(release => { const w = window as any; w.fixtureState.activeApiRelease = release; w.fixtureState.operation = 'full'; w.fixturePublish(w.fixtureState); }, activeApiRelease);
    expect(await page.locator('#view-live').isVisible()).toBe(true);
    await page.locator('nav [data-dest="home"]').click();
    await page.evaluate(() => { const w = window as any; w.fixturePublish(w.fixtureState); });
    expect(await page.locator('#view-home').isVisible()).toBe(true);
    await page.locator('#operation-indicator').focus(); await page.keyboard.press('Enter');
    expect(await page.locator('#view-live').isVisible()).toBe(true);
    await page.locator('#monitor-stop').click();
    expect(await page.evaluate(() => (window as any).fixtureCalls)).toEqual(['abortAutomation']);
    // Rendering the countdown alone does no bridge work and replaces no worker or timeline nodes.
    const stats = await page.evaluate(async () => { const w = window as any, host = document.getElementById('monitor-events')!; let mutations = 0; const observer = new MutationObserver(r => mutations += r.length); observer.observe(host, { childList: true, subtree: true }); const start = performance.now(); await new Promise(resolve => setTimeout(resolve, 1100)); observer.disconnect(); return { mutations, elapsed: performance.now() - start, calls: w.fixtureCalls }; });
    expect(stats.mutations).toBe(0); expect(stats.calls).toEqual(['abortAutomation']);
  } finally { await page.close(); }
});
it('does not renew an old clock sample on renderer-only publications or steal navigation in the final second',async()=>{
  const page=await openRenderer(browser,{booking,clock},'home');
  try{
    await page.evaluate(({release,clock})=>{const w=window as any;w.fixtureState={...w.fixtureState,operation:'full',activeApiRelease:release,clock:{...clock,remainingMs:500}};w.fixturePublish(w.fixtureState);},{release:activeApiRelease,clock});
    expect(await page.locator('#view-home').isVisible()).toBe(true);
    await page.locator('#operation-indicator').click();
    await page.evaluate(async()=>{const w=window as any;for(let i=0;i<6;i++){await new Promise(resolve=>setTimeout(resolve,900));w.fixturePublish(w.fixtureState);}});
    expect(await page.locator('#monitor-countdown').innerText()).toContain('fresh sample');
    expect(await page.evaluate(()=>(window as any).fixtureCalls)).toEqual([]);
  }finally{await page.close();}
});
it('monitors an Available Now Buko request without substituting the saved Mango release',async()=>{
  const page=await openRenderer(browser,{booking,operation:'full',workflow:'test',preparedContext:{workflow:'test',date:'2026-11-03',configFingerprint:'prepared-request',requiredBrowsers:['C']},apiStage:{workerId:'C',wing:'BUKO',court:4,startTime:'16:00',date:'2026-11-03'},browserHealth:{C:true}},'live');
  try{
    const facts=await page.locator('#monitor-plan').innerText();expect(facts).toContain('2026-11-03');expect(facts).toContain('BUKO');expect(facts).toContain('prepared-request');expect(facts).not.toContain(booking.fingerprint);
    expect(await page.locator('#live-workers').innerText()).toContain('Browser C');expect(await page.locator('#live-workers').innerText()).toContain('Court 4');expect(await page.locator('#live-workers').innerText()).not.toContain('Court 7');
    expect(await page.locator('#live-planned').isVisible()).toBe(false);expect(await page.locator('#live-attempt-counts').innerText()).toContain('not been published');
    expect(await page.evaluate(()=>(window as any).fixtureCalls)).toEqual([]);
    await page.screenshot({path:'.local/ui-overhaul/shots/1060-available-now-buko.png',fullPage:true});
  }finally{await page.close();}
});
