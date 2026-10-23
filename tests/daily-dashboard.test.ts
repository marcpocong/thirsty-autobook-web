import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { openRenderer } from './renderer-harness.js';
import { newReleaseProfile, generateReleaseDraft } from '../src/automatic-release.js';
import { compileObjective, savedMangoReleaseSetup } from '../src/booking-objective.js';
import { bookingView } from '../ui/booking.js';
import { ConfigSchema } from '../src/config.js';
import type { DailyView } from '../ui/daily-planning.js';

let browser:Browser;
beforeAll(async()=>{browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});await mkdir('.local/v3-verification/shots',{recursive:true});});
afterAll(async()=>{await browser.close();});
function fixture(){
  const now=Date.now(),profile=newReleaseProfile(now);profile.objective.wings.MANGO.ideal=2;profile.objective.wings.MANGO.minimum=2;profile.objective.wings.MANGO.courts=[7,6,5].map((court,i)=>({court,priority:i+1}));profile.objective.wings.MANGO.durationHours=3;profile.workers=['A','B'];
  const generated=generateReleaseDraft(profile,now),objective=structuredClone(generated.objective);objective.shotgun.budget=6;
  const setup=savedMangoReleaseSetup(compileObjective(objective,{nowMs:now}),objective.wings.MANGO.bookingDate).setup;
  const booking=bookingView(ConfigSchema.parse({...setup,PLAYER_FULL_NAME:'Synthetic Fixture',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'}));
  const daily:DailyView={profile,generated,migrationRequired:false,advice:{preferred:8,compiled:8,recommended:6,executable:0,status:'NEEDS_EVIDENCE',reasons:['Exact-topology timing calibration and permitted provider volume are unverified.']},snapshots:[],reports:[],error:null};
  return {booking,daily,objectiveDocument:{version:1,objective,savedAt:new Date(now).toISOString(),binding:null},playerStatus:{primary:true,extended:true},browserHealth:{A:true,B:true}};
}
for(const width of [390,1060])it(`connects daily planning and shared readiness at ${width}px without false readiness or overflow`,async()=>{
  const page=await openRenderer(browser,fixture(),'home',{width,height:1000}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await expect.poll(()=>page.locator('#daily-dashboard').innerText()).toContain('8');
  expect(await page.locator('#daily-dashboard').innerText()).toContain('DRAFT · NOT AUTHORIZED');
  expect(await page.locator('#daily-dashboard').innerText()).toContain('Executable now');
  expect(await page.locator('#daily-readiness').getAttribute('data-verdict')).not.toBe('READY_FOR_AUTHORIZATION');
  expect((await page.locator('#daily-primary').boundingBox())!.height).toBeLessThan(90);
  expect((await page.locator('#daily-plan-next').boundingBox())!.width).toBeGreaterThan(110);
  await page.locator('#daily-preferences summary').click();await page.locator('#daily-preset').selectOption('HIGH_DENSITY');expect(await page.locator('#daily-budget').inputValue()).toBe('16');
  await page.locator('#daily-budget').fill('11');await page.locator('#daily-save-profile').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).fixtureState.daily.profile.preferredBudget)).toBe(11);
  expect(await page.evaluate(()=>(window as any).fixtureCalls.some((c:string)=>/armFullBooking|saveBooking|resetPrepare|checkSecurity/.test(c)))).toBe(false);
  await page.screenshot({path:`.local/v3-verification/shots/daily-${width}.png`,fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);await page.close();
},30000);

it('accepts a capacity proposal only into the draft, preserves the saved release, and routes notification clicks',async()=>{
  const value=fixture(),page=await openRenderer(browser,value,'home');
  await page.locator('#daily-capacity-proposal summary').click();await page.locator('#daily-accept-capacity').click();
  expect(await page.locator('#setup-step-5').isVisible()).toBe(true);
  expect(await page.evaluate(()=>(window as any).fixtureCalls.filter((c:string)=>/saveBooking|armFullBooking|resetPrepare/.test(c)))).toEqual([]);
  await page.evaluate(()=>(window as any).fixtureDestination('live'));expect(await page.locator('#view-live').isVisible()).toBe(true);
  await page.close();
});


it('does not overwrite an unsaved manual draft when proposal replacement is declined',async()=>{
  const page=await openRenderer(browser,fixture(),'setup');
  await page.locator('#goal-MANGO-duration').selectOption('2');
  await page.locator('nav [data-dest="home"]').click();
  let prompt='';page.once('dialog',async dialog=>{prompt=dialog.message();await dialog.dismiss();});
  await page.locator('#daily-accept').click();expect(prompt).toContain('unsaved draft');
  await page.locator('nav [data-dest="setup"]').click();await page.locator('#setup-steps [data-step="1"]').click();
  expect(await page.locator('#goal-MANGO-duration').inputValue()).toBe('2');
  expect(await page.evaluate(()=>(window as any).fixtureCalls.filter((c:string)=>c==='saveBooking'||c==='objective:save'))).toEqual([]);
  await page.close();
});
