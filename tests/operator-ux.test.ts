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
  await page.locator('#strategy-shotgun-advanced').evaluate(node=>(node as HTMLDetailsElement).open=true);
  expect(await page.locator('#strategy-shotgun-advanced').getAttribute('open')).not.toBeNull();
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
it('offers a one-click Shotgun fast path that resolves release-day configuration blockers',async()=>{
  const page=await openRenderer(browser,{booking:booking(false,true),playerStatus:players},'strategy',{width:1440,height:1000});
  expect(await page.locator('input[name="strategy-intensity"][value="NORMAL"]').isChecked()).toBe(true);
  await page.locator('#strategy-shotgun-quick-ready').click();
  await page.waitForFunction(()=>!document.getElementById('strategy-shotgun-quick-ready')?.textContent?.includes('SAVING'));
  expect(await page.locator('input[name="strategy-intensity"][value="SHOTGUN"]').isChecked()).toBe(true);
  expect(await page.locator('#strategy-shotgun-quick-status').innerText()).toContain('SHOTGUN SAVED');
  expect(await page.locator('#strategy-shotgun-advanced').getAttribute('open')).toBeNull();
  expect(await page.evaluate(()=>(window as any).fixtureCalls)).toEqual(['saveBooking']);
  expect(await page.evaluate(()=>(window as any).fixtureSaved.STRATEGY_V2.shotgun.budget)).toBe(20);
  await page.screenshot({path:'.local/operator-ux/quick-saved.png',fullPage:true});
  expect(await page.locator('#strategy-shotgun-allocation').inputValue()).toBe('CUSTOM');
  const checks=page.locator('#strategy-shotgun-targets input[type="checkbox"]');
  expect(await checks.nth(0).isChecked()).toBe(true);expect(await checks.nth(1).isChecked()).toBe(false);
  expect(await page.locator('#strategy-shotgun-timing-override').isChecked()).toBe(true);
  expect(await page.locator('#strategy-shotgun-standby-override').isChecked()).toBe(true);
  expect(await page.locator('#strategy-shotgun-quick-status').innerText()).toContain('21/21 READY');
  expect(await page.locator('#strategy-current-plan').innerText()).toContain('SAVED');
  expect(await page.locator('#strategy-save').isEnabled()).toBe(true);
  await page.close();
});
it('auto-fits one-click Shotgun below 20 when the preparation forecast cannot ready all attempts',async()=>{
  const page=await openRenderer(browser,{booking:booking(false),playerStatus:players,prewarmFeasibility:{p95Source:'COMPATIBLE_MEASURED_HISTORY',preparationP95Ms:18000,sampleCount:30}},'strategy',{width:1440,height:1000});
  await page.locator('#strategy-shotgun-quick-ready').click();
  await page.waitForFunction(()=>!document.getElementById('strategy-shotgun-quick-ready')?.textContent?.includes('SAVING'));
  const budget=Number(await page.locator('#strategy-shotgun-budget').inputValue());
  expect(budget).toBeGreaterThan(0);expect(budget).toBeLessThan(20);
  expect(await page.locator('#strategy-shotgun-quick-status').innerText()).toContain(`${budget}/${budget} READY`);
  expect(budget).toBe(5);
  await page.screenshot({path:'.local/operator-ux/quick-autofit.png',fullPage:true});
  expect(await page.locator('#strategy-current-plan').innerText()).toContain('SAVED');
  expect(await page.locator('#strategy-save').isEnabled()).toBe(true);
  await page.close();
});
it('has a warning-free Dense Core when spacing is harmless and preserves selected targets on balanced restore',async()=>{
  const page=await openRenderer(browser,{booking:booking(false,true),playerStatus:players},'strategy');
  await page.locator('input[name="strategy-intensity"][value="SHOTGUN"]').check();
  await page.locator('#strategy-shotgun-advanced').evaluate(node=>(node as HTMLDetailsElement).open=true);
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
  await page.locator('#strategy-shotgun-advanced').evaluate(node=>(node as HTMLDetailsElement).open=true);
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
  await page.locator('#strategy-shotgun-advanced').evaluate(node=>(node as HTMLDetailsElement).open=true);
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

it('invalidates saved Quick Shotgun when preparation state changes and refreshes in one action',async()=>{
  const page=await openRenderer(browser,{booking:booking(false),playerStatus:players},'strategy');
  await page.screenshot({path:'.local/operator-ux/quick-before.png',fullPage:true});
  await page.locator('#strategy-shotgun-quick-ready').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.getElementById('strategy-shotgun-quick-status')?.textContent?.includes('SHOTGUN SAVED'));
  await page.evaluate(()=>{const w=window as any;w.fixtureState.prewarmFeasibility={p95Source:'COMPATIBLE_MEASURED_HISTORY',preparationP95Ms:18000,sampleCount:30};w.fixturePublish(w.fixtureState);});
  expect(await page.locator('#strategy-shotgun-quick-status').innerText()).toContain('SHOTGUN NEEDS REFRESH');
  expect(await page.locator('#strategy-shotgun-next').isHidden()).toBe(true);
  expect(await page.locator('#strategy-shotgun-quick-ready').innerText()).toBe('REFRESH & SAVE SHOTGUN');
  await page.screenshot({path:'.local/operator-ux/quick-stale.png',fullPage:true});
  await page.locator('#strategy-shotgun-quick-ready').click();
  await page.waitForFunction(()=>document.getElementById('strategy-shotgun-quick-status')?.textContent?.includes('SHOTGUN SAVED'));
  expect(await page.evaluate(()=>(window as any).fixtureSaved.STRATEGY_V2.shotgun.budget)).toBe(5);
  await page.locator('#strategy-shotgun-next').click();
  expect(await page.locator('#view-release').isVisible()).toBe(true);
  expect(await page.locator('#next-strategy-facts').innerText()).toContain('Shotgun · Dense Core · 5 attempts');
  await page.screenshot({path:'.local/operator-ux/quick-next-release.png',fullPage:true});
  expect(await page.evaluate(()=>(window as any).fixtureCalls)).toEqual(['saveBooking','saveBooking']);
  await page.close();
});
it('preserves custom Shotgun until explicitly replaced and fits at narrow width',async()=>{
  const page=await openRenderer(browser,{booking:booking(false),playerStatus:players},'strategy',{width:390,height:844});
  await page.locator('#strategy-shotgun-quick-ready').click();
  await page.waitForFunction(()=>document.getElementById('strategy-shotgun-quick-status')?.textContent?.includes('SHOTGUN SAVED'));
  expect(await page.locator('#strategy-shotgun-advanced').getAttribute('open')).toBeNull();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'.local/operator-ux/quick-narrow.png',fullPage:true});
  await page.locator('#strategy-shotgun-advanced > summary').click();
  await page.locator('#strategy-shotgun-budget').fill('4');await page.locator('#strategy-shotgun-budget').blur();
  expect(await page.locator('#strategy-shotgun-quick-status').innerText()).toContain('CUSTOM SHOTGUN');
  expect(await page.locator('#strategy-shotgun-budget').inputValue()).toBe('4');
  expect(await page.locator('#strategy-shotgun-quick-ready').innerText()).toBe('REPLACE WITH QUICK SHOTGUN');
  expect(await page.evaluate(()=>(window as any).fixtureCalls)).toEqual(['saveBooking']);
  await page.screenshot({path:'.local/operator-ux/quick-custom.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'.local/operator-ux/quick-advanced.png',fullPage:true});
  await page.locator('#strategy-shotgun-quick-ready').click();
  await page.waitForFunction(()=>document.getElementById('strategy-shotgun-quick-status')?.textContent?.includes('SHOTGUN SAVED'));
  expect(await page.locator('#strategy-shotgun-budget').inputValue()).toBe('20');await page.close();
});
it('blocks no target and no fully READY configuration without saving or live side effects',async()=>{
  const noTarget=booking(false);noTarget.setup.RELEASE_STRATEGY='general';delete noTarget.setup.PRECISION_PHASE3;noTarget.setup.PRECISION_TARGETS=[];
  const empty=await openRenderer(browser,{booking:noTarget,playerStatus:players},'strategy');
  expect(await empty.locator('#strategy-shotgun-quick-ready').isDisabled()).toBe(true);
  expect(await empty.locator('#strategy-shotgun-quick-status').innerText()).toContain('Add at least one release target');
  expect(await empty.evaluate(()=>(window as any).fixtureCalls)).toEqual([]);await empty.close();
  const page=await openRenderer(browser,{booking:booking(false),playerStatus:players,prewarmFeasibility:{p95Source:'COMPATIBLE_MEASURED_HISTORY',preparationP95Ms:200000,sampleCount:30}},'strategy');
  await page.locator('#strategy-shotgun-quick-ready').click();
  expect(await page.locator('#strategy-shotgun-quick-status').innerText()).toContain('SHOTGUN NOT READY');
  expect(await page.locator('#strategy-shotgun-next').isHidden()).toBe(true);
  expect(await page.evaluate(()=>(window as any).fixtureCalls)).toEqual([]);
  await page.screenshot({path:'.local/operator-ux/quick-blocked.png',fullPage:true});await page.close();
});
it('invalidates Quick Shotgun on target edits and unavailable workers',async()=>{
  const page=await openRenderer(browser,{booking:booking(false),playerStatus:players},'strategy');
  await page.locator('#strategy-shotgun-quick-ready').click();
  await page.waitForFunction(()=>document.getElementById('strategy-shotgun-quick-status')?.textContent?.includes('SHOTGUN SAVED'));
  await page.locator('#strategy-immediate-court-0').selectOption('6');
  expect(await page.locator('#strategy-shotgun-quick-status').innerText()).toContain('SHOTGUN NEEDS REFRESH');
  await page.evaluate(()=>{const w=window as any;w.fixtureState.playerStatus={primary:false,extended:false,third:false,fourth:false,fifth:false,sixth:false,seventh:false};w.fixturePublish(w.fixtureState);});
  expect(await page.locator('#strategy-shotgun-quick-status').innerText()).not.toContain('SHOTGUN SAVED');
  await page.locator('#strategy-shotgun-quick-ready').click();
  expect(await page.locator('#strategy-shotgun-quick-status').innerText()).toContain('SHOTGUN NOT READY');
  expect(await page.evaluate(()=>(window as any).fixtureCalls)).toEqual(['saveBooking']);await page.close();
});

it('reopening a saved Quick strategy requires fresh preparation evidence',async()=>{
  const page=await openRenderer(browser,{booking:booking(false),playerStatus:players},'strategy');
  await page.locator('#strategy-shotgun-quick-ready').click();
  await page.waitForFunction(()=>document.getElementById('strategy-shotgun-quick-status')?.textContent?.includes('SHOTGUN SAVED'));
  const saved=await page.evaluate(()=>(window as any).fixtureState.booking);
  await page.close();const reopened=await openRenderer(browser,{booking:saved,playerStatus:players},'strategy');
  expect(await reopened.locator('#strategy-shotgun-quick-status').innerText()).toContain('SHOTGUN NEEDS REFRESH');
  expect(await reopened.locator('#strategy-shotgun-quick-ready').innerText()).toBe('REFRESH & SAVE SHOTGUN');
  expect(await reopened.evaluate(()=>(window as any).fixtureCalls)).toEqual([]);await reopened.close();
});

it('does not claim SAVED when authoritative persistence rejects or changes the authorization',async()=>{
  for(const tamper of [false,true]){
    const page=await openRenderer(browser,{booking:booking(false),playerStatus:players},'strategy');
    await page.evaluate(tamper=>{const w=window as any,save=w.thirsty.saveBooking;w.thirsty.saveBooking=async(setup:any)=>{
      if(!tamper){w.fixtureCalls.push('saveBooking');throw Error('Fixture save rejected');}
      await save(setup);w.fixtureState.booking.setup.PRECISION_PHASE3.wave1[0].fanOutOffsetsMs[0]=-999;
    };},tamper);
    await page.locator('#strategy-shotgun-quick-ready').click();
    await page.waitForFunction(()=>!document.getElementById('strategy-shotgun-quick-ready')?.textContent?.includes('SAVING'));
    expect(await page.locator('#strategy-shotgun-quick-status').innerText()).not.toContain('SHOTGUN SAVED');
    expect(await page.locator('#strategy-shotgun-next').isHidden()).toBe(true);
    expect(await page.evaluate(()=>(window as any).fixtureCalls)).toEqual(['saveBooking']);await page.close();
  }
});

it('withdraws a prior success if a repeated quick save fails',async()=>{
  const page=await openRenderer(browser,{booking:booking(false),playerStatus:players},'strategy');
  await page.locator('#strategy-shotgun-quick-ready').click();
  await page.waitForFunction(()=>document.getElementById('strategy-shotgun-quick-status')?.textContent?.includes('SHOTGUN SAVED'));
  await page.evaluate(()=>{(window as any).thirsty.saveBooking=async()=>{throw Error('Fixture save rejected');};});
  await page.locator('#strategy-shotgun-quick-ready').click();
  await page.waitForFunction(()=>!document.getElementById('strategy-shotgun-quick-ready')?.textContent?.includes('SAVING'));
  expect(await page.locator('#strategy-shotgun-quick-status').innerText()).toContain('SHOTGUN NOT SAVED');
  expect(await page.locator('#strategy-shotgun-next').isHidden()).toBe(true);await page.close();
});

it('clears schedule loading, reports HTTP 403, and preserves confirmed bookings and UNKNOWN evidence',async()=>{
  const page=await openRenderer(browser,{booking:booking(false),playerStatus:players},'strategy');
  await page.locator('#strategy-schedule > summary').click();
  await page.evaluate(()=>{const w=window as any;w.thirsty.checkReleaseBlocks=async(date:string)=>{
    w.fixtureCalls.push('checkReleaseBlocks');await new Promise(resolve=>{w.finishAudit=resolve;});
    w.fixtureState.blockAudit={type:'blockAudit',date,cells:Array.from({length:7},(_,i)=>i+1).flatMap(court=>Array.from({length:16},(_,i)=>({court,hour:`${String(i+8).padStart(2,'0')}:00`,status:court===7&&i===11?'BLOCKED':'UNKNOWN',source:court===7&&i===11?'PUBLIC_BOOKING':'AVAILABILITY_READ_FAILED'}))),diagnostics:{availability:{status:'FAILED',httpStatus:403,code:'AVAILABILITY_HTTP_FAILED',durationMs:767},publicBookings:{failedCourts:[],durationMs:300},durationMs:800}};
    w.fixturePublish(w.fixtureState);
  };});
  await page.locator('#strategy-check-schedule').click();
  expect(await page.locator('#strategy-check-schedule').isDisabled()).toBe(true);
  expect(await page.locator('#strategy-schedule-status').innerText()).toContain('Reading public bookings');
  await page.evaluate(()=>{(window as any).finishAudit();});
  await page.waitForFunction(()=>document.getElementById('strategy-schedule-status')?.textContent?.includes('HTTP 403'));
  expect(await page.locator('#strategy-check-schedule').isEnabled()).toBe(true);
  expect(await page.locator('#strategy-schedule-status').innerText()).toContain('0.80 s');
  expect(await page.locator('#strategy-schedule-status').innerText()).not.toContain('Reading public bookings');
  expect(await page.locator('#strategy-schedule-grid').innerText()).toContain('booked');
  expect(await page.locator('#strategy-schedule-grid').innerText()).toContain('unknown');
  expect(await page.evaluate(()=>(window as any).fixtureCalls)).toEqual(['checkReleaseBlocks']);
  await page.screenshot({path:'.local/operator-ux/schedule-http403.png',fullPage:true});await page.close();
});
