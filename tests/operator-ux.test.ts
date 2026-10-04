import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { bookingView, defaultSetup } from '../ui/booking.js';
import { DateTime } from 'luxon';
import { clockStatus } from '../ui/status.js';
import { ConfigSchema, ObservationSchema } from '../src/config.js';
import { compileSmartPlan, confirmSmartRates, emptySmartDraft } from '../src/precision-simple.js';
import { openRenderer, showRendererView } from './renderer-harness.js';

let browser:Browser;
beforeAll(async()=>{browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});await mkdir('.local/operator-ux',{recursive:true});});
afterAll(async()=>{await browser.close();});
function booking(backups=true,multi=false){
  const base=bookingView(ConfigSchema.parse({...defaultSetup,PLAYER_FULL_NAME:'Fixture',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'})),targetDate=base.targetDate;
  const draft={...emptySmartDraft(),rates:confirmSmartRates(600,700,'VENUE_SCHEDULE',targetDate,new Date()),immediate:[{court:7,start:'19:00',durationHours:3},...(multi?[{court:6,start:'19:00',durationHours:3}]:[])],backups:backups?[1,2,3,4].map(court=>({court,start:'19:00',durationHours:3})):[]};
  return bookingView(ConfigSchema.parse({...defaultSetup,BOOKING_METHOD:'proofless',RELEASE_STRATEGY:'precision',PRECISION_TARGETS:[],PRECISION_PHASE3:compileSmartPlan(draft,{targetDate}).phase3!,PLAYER_FULL_NAME:'Fixture',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'}));
}
const players={primary:true,extended:true,third:true,fourth:true,fifth:true,sixth:true,seventh:true};
it('resolves both acknowledgements without Advanced, keeps priority explicit, saves literal timing and passes keyboard checks',async()=>{
  const page=await openRenderer(browser,{booking:booking(),playerStatus:players},'strategy',{width:1440,height:1000});
  await page.locator('input[name="strategy-intensity"][value="SHOTGUN"]').check();
  expect(await page.locator('#strategy-shotgun-advanced').getAttribute('open')).toBeNull();
  expect(await page.locator('#shotgun-attention-title').innerText()).toContain('2 THINGS');
  expect(await page.locator('#strategy-save').isDisabled()).toBe(true);
  expect(await page.locator('#shotgun-resource-effect').innerText()).toContain('4 → 3');
  expect(await page.locator('#shotgun-preparation').innerText()).toContain('Forecast: 20/20');
  expect(await page.locator('#shotgun-timeline-summary').innerText()).toContain('4 early probes · 16 concentrated');
  expect(await page.locator('#strategy-shotgun-preview').innerText()).toContain('LAST ATTEMPT\n0 ms');
  expect(await page.locator('#strategy-current-plan').innerText()).toContain('NEEDS ATTENTION');
  expect(await page.locator('#strategy-review-warnings').innerText()).not.toMatch(/spacing|standby/);
  expect(await page.locator('#strategy-shotgun-preview').innerText()).not.toMatch(/BLOCKED|Requested Dense/);
  await page.screenshot({path:'.local/operator-ux/both-unresolved.png',fullPage:true});
  await page.locator('input[name="release-priority"][value="MAXIMUM"]').check();
  expect(await page.locator('#strategy-shotgun-standby-override').isChecked()).toBe(false);
  await page.locator('#strategy-shotgun-timing-override').focus();await page.keyboard.press('Space');
  expect(await page.locator('#shotgun-timing-state').innerText()).toContain('ACKNOWLEDGED');
  expect(await page.locator('#shotgun-attention-title').innerText()).toContain('1 THING');
  await page.screenshot({path:'.local/operator-ux/one-resolved.png',fullPage:true});
  await page.locator('#strategy-shotgun-standby-override').focus();await page.keyboard.press('Space');
  expect(await page.locator('#shotgun-standby-state').innerText()).toContain('ACKNOWLEDGED');
  expect(await page.locator('#strategy-save').isEnabled()).toBe(true);
  expect(await page.locator('#strategy-current-plan').innerText()).toContain('READY TO SAVE');
  await page.screenshot({path:'.local/operator-ux/both-resolved.png',fullPage:true});
  await page.locator('#strategy-save').click();await page.waitForFunction(()=>(window as any).fixtureSaved);
  expect(await page.locator('#strategy-save').innerText()).toContain('STRATEGY SAVED');
  const saved=await page.evaluate(()=>(window as any).fixtureSaved);
  expect(saved.STRATEGY_V2.shotgun.exactSchedule.map((shot:any)=>shot.configuredOffsetMs)).toEqual(saved.PRECISION_PHASE3.wave1.flatMap((group:any)=>group.fanOutOffsetsMs??[group.releaseOffsetMs??0]));
  expect(saved.PRECISION_PHASE3.wave1.map((group:any)=>group.fanOutOffsetsMs.length)).toEqual([6,6,6,2]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'.local/operator-ux/saved.png',fullPage:true});
  expect(await page.evaluate(()=>(window as any).fixtureCalls.filter((name:string)=>['armFullBooking','authorizeTerms','testBooking','checkReleaseBlocks'].includes(name)))).toEqual([]);
  await page.close();
});
it('has a warning-free Dense Core when spacing is harmless and preserves selected targets on balanced restore',async()=>{
  const page=await openRenderer(browser,{booking:booking(false,true),playerStatus:players},'strategy');
  await page.locator('input[name="strategy-intensity"][value="SHOTGUN"]').check();
  await page.locator('#strategy-shotgun-budget').fill('1');await page.locator('#strategy-shotgun-budget').blur();
  expect(await page.locator('#shotgun-attention').isHidden()).toBe(true);
  const before=await page.locator('#strategy-shotgun-targets input[type="checkbox"]').evaluateAll(inputs=>inputs.map(input=>(input as HTMLInputElement).checked));
  await page.getByText('Restore balanced resource setup',{exact:true}).click();await page.locator('#shotgun-restore-balanced').click();
  expect(await page.locator('#strategy-shotgun-targets input[type="checkbox"]').evaluateAll(inputs=>inputs.map(input=>(input as HTMLInputElement).checked))).toEqual(before);
  expect(await page.locator('#strategy-shotgun-budget').inputValue()).toBe('1');
  await page.close();
});
it('renders multi-target allocation and Focus on #1, and leaves invalid plans BLOCKED',async()=>{
  const page=await openRenderer(browser,{booking:booking(false,true),playerStatus:players},'strategy');
  await page.locator('input[name="strategy-intensity"][value="SHOTGUN"]').check();
  expect(await page.locator('#shotgun-allocation-summary meter').count()).toBe(2);
  expect(await page.locator('#shotgun-allocation-summary').innerText()).toContain('10 / 20');
  await page.locator('#strategy-shotgun-focus').click();
  expect(await page.locator('#shotgun-allocation-summary').innerText()).toContain('20 / 20');
  await page.locator('#strategy-shotgun-budget').fill('0');await page.locator('#strategy-shotgun-budget').blur();
  expect(await page.locator('#strategy-gate').innerText()).toContain('BLOCKED');
  expect(await page.locator('#strategy-save').isDisabled()).toBe(true);
  expect(await page.locator('#shotgun-preparation').innerText()).toContain('NOT FORECASTABLE');
  await page.setViewportSize({width:760,height:900});
  expect(await page.locator('#strategy-review').evaluate(node=>getComputedStyle(node).position)).toBe('static');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.close();
});
it('mirrors the existing arm gate on Next Release and puts Live waiting first',async()=>{
  const page=await openRenderer(browser,{booking:booking(false),playerStatus:players},'release');
  expect(await page.locator('#next-preflight').innerText()).toContain('NOT READY');
  await showRendererView(page,'live');expect(await page.locator('#live-result').innerText()).toBe('WAITING FOR RELEASE');
  await page.close();
});
it('shows partial preparation from the engine forecast and prevents saving that release plan',async()=>{
  const page=await openRenderer(browser,{booking:booking(false),playerStatus:players,prewarmFeasibility:{p95Source:'COMPATIBLE_MEASURED_HISTORY',preparationP95Ms:18000,sampleCount:30}},'strategy',{width:1440,height:1000});
  await page.locator('input[name="strategy-intensity"][value="SHOTGUN"]').check();
  await page.locator('#strategy-shotgun-timing-override').check();
  expect(await page.locator('#shotgun-preparation').innerText()).toContain('PREPARATION INCOMPLETE');
  expect(await page.locator('#shotgun-preparation').innerText()).toContain('17/20');
  expect(await page.locator('#strategy-save').isDisabled()).toBe(true);
  await page.screenshot({path:'.local/operator-ux/partial-preparation.png',fullPage:true});
  await page.close();
});
it('shows the ready preflight from fixture engine state, without calling Terms or arming',async()=>{
  const value=booking(false),workers={A:true},page=await openRenderer(browser,{booking:value,playerStatus:players,browserHealth:workers,ready:true,cdp:true,apiFirstReady:true,termsAuthorized:true,clock:{...clockStatus(ObservationSchema.parse({}),DateTime.now()),networkSynced:true,clockOffsetMs:0,canArmToday:true,remainingMs:120000,releaseMs:value.releaseMs,targetDate:value.targetDate}},'release');
  expect(await page.locator('#arm').isEnabled()).toBe(true);
  expect(await page.locator('#next-preflight').innerText()).toContain('READY FOR RELEASE');
  expect(await page.locator('#next-preflight').innerText()).toContain('AUTHORIZED');
  expect(await page.evaluate(()=>(window as any).fixtureCalls)).toEqual([]);
  await page.screenshot({path:'.local/operator-ux/next-release-ready.png',fullPage:true});
  await page.close();
});
it('renders verified, rejected, throttle and unknown Live outcomes from fixture events',async()=>{
  const page=await openRenderer(browser,{booking:booking(false),playerStatus:players},'live');
  for(const [state,code,title] of [['ARMED','','WAITING FOR RELEASE'],['HOLD_VERIFIED','','HOLD VERIFIED'],['REJECTED','','ALL RELEASE ATTEMPTS REJECTED'],['REJECTED','HTTP_429','PROVIDER THROTTLED'],['UNKNOWN','','OUTCOME UNKNOWN']]){
    await page.evaluate(({state,code})=>{const w=window as any;w.fixtureState.live={parents:[{key:'fixture',wave:'WAVE_1',court:7,startTime:'19:00',endTime:'22:00',children:[{attemptId:'fixture',label:'A',fanOutIndex:0,fanOutCount:1,state,code}]}],predictions:[],notes:[]};w.fixturePublish(w.fixtureState);},{state,code});
    expect(await page.locator('#live-result').innerText()).toBe(title);
    if(state==='ARMED')expect(await page.locator('#live-ready').innerText()).toBe('0');
  }
  expect(await page.evaluate(()=>(window as any).fixtureCalls)).toEqual([]);
  await page.close();
});
