import {afterAll,beforeAll,expect,it} from 'vitest';
import {chromium,type Browser} from 'playwright';
import {mkdir} from 'node:fs/promises';
import {bookingView,defaultSetup} from '../ui/booking.js';
import {ConfigSchema} from '../src/config.js';
import {openRenderer} from './renderer-harness.js';
let browser:Browser;
beforeAll(async()=>{browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});await mkdir('.local/strategy-flow',{recursive:true});});
afterAll(async()=>{await browser.close();});
const booking=()=>bookingView(ConfigSchema.parse({...defaultSetup,BOOKING_METHOD:'proofless',PLAYER_FULL_NAME:'Fixture',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'}));
it('reviews the complete goal to saved release flow at every required viewport with no execution side effects',async()=>{
 const page=await openRenderer(browser,{booking:booking(),playerStatus:{primary:true,extended:true,third:true,fourth:true,fifth:true,sixth:true,seventh:true}},'strategy',{width:1440,height:1000});
 const shot=async(name:string)=>page.screenshot({path:`.local/strategy-flow/${name}.png`,fullPage:true});
 await shot('01-fresh');
 await page.locator('#strategy-ideal-start').selectOption('19:00');await page.locator('#strategy-prime-from').selectOption('18:00');await shot('02-goal');
 await page.evaluate(()=>{const w=window as any;w.thirsty.strategyEvidence=async(input:any)=>{w.fixtureCalls.push('strategyEvidence');return {...input,dayOfWeek:'Thursday',releasesConsidered:0,wellObservedReleases:0,strength:'NONE',ranges:[],sharedRisk:[]};};});
 await page.locator('#strategy-suggest').click();await page.waitForFunction(()=>document.getElementById('strategy-target-summary')?.textContent?.includes('Public schedule could not be fully verified'));
 expect(await page.locator('.target-primary').innerText()).toContain('7:00 PM');
 await shot('03-plan');await shot('04-public-failed');await shot('05-no-history');await shot('07-editor-closed');
 await page.locator('#strategy-advanced > summary').click();await page.locator('#strategy-edit-targets > summary').click();await shot('08-editor-open');await page.locator('#strategy-edit-targets > summary').click();await page.locator('#strategy-advanced > summary').click();
 await shot('09-normal');await page.locator('#strategy-normal-save').click();await page.waitForFunction(()=>document.getElementById('strategy-normal-status')?.textContent?.includes('SAVED'));await shot('10-normal-saved');
 expect(await page.locator('#strategy-normal-save').isVisible()).toBe(false);expect(await page.locator('#strategy-save').isVisible()).toBe(false);
 await page.locator('#strategy-advanced > summary').click();await page.locator('#strategy-edit-targets > summary').click();await page.locator('#strategy-immediate-start-0').selectOption('20:00');
 expect(await page.locator('#strategy-normal-status').innerText()).toContain('UNSAVED CHANGES');await page.locator('#strategy-edit-targets > summary').click();await page.locator('#strategy-advanced > summary').click();
 // A usable release fixture changes ranking and reports actual comparable releases.
 await page.evaluate(()=>{const w=window as any;w.thirsty.strategyEvidence=async(input:any)=>({...input,dayOfWeek:'Thursday',releasesConsidered:5,wellObservedReleases:5,strength:'USABLE',ranges:[{court:6,start:'19:00',durationHours:3,wellObserved:5,fullyOpenFirst:5,stillOpenAt1s:{observed:5,open:5},stillOpenAt5s:{observed:5,open:5},reopened:0,good:5,fair:0}],sharedRisk:[]});});
 await page.locator('#strategy-suggest').click();await page.waitForFunction(()=>document.getElementById('strategy-target-summary')?.textContent?.includes('5 comparable releases'));await shot('06-usable-history');
 expect(await page.locator('.target-primary').innerText()).toContain('Court 6');
 await page.locator('input[name="strategy-intensity"][value="SHOTGUN"]').check();await shot('11-shotgun-before');
 await page.locator('#strategy-shotgun-quick-ready').click();await page.waitForFunction(()=>document.getElementById('strategy-shotgun-quick-status')?.textContent?.includes('SHOTGUN SAVED'));await shot('12-shotgun-saved');
 expect(await page.locator('#strategy-shotgun-quick-ready').isVisible()).toBe(false);
 const setup=await page.evaluate(()=>(window as any).fixtureSaved);
 const sends=setup.PRECISION_PHASE3.wave1.reduce((n:number,a:any)=>n+(a.fanOutOffsetsMs?.length??1),0);expect(sends).toBe(setup.STRATEGY_V2.shotgun.budget);
 expect(new Set(setup.PRECISION_PHASE3.wave1.map((a:any)=>a.candidateId)).size).toBe(1);
 expect(setup.PRECISION_PHASE3.candidates.length).toBeGreaterThan(1);
 await page.locator('#strategy-shotgun-next').click();await shot('16-next-release');await page.locator('nav [data-view="strategy"]').click();
 await page.evaluate(()=>{const w=window as any;w.fixtureState.prewarmFeasibility={p95Source:'COMPATIBLE_MEASURED_HISTORY',preparationP95Ms:18000,sampleCount:30};w.fixturePublish(w.fixtureState);});
 expect(await page.locator('#strategy-shotgun-quick-status').innerText()).toContain('NEEDS REFRESH');await shot('13-shotgun-stale');
 await page.locator('#strategy-advanced > summary').click();await shot('14-advanced');await page.locator('#strategy-advanced > summary').click();
 for(const width of [1440,1024,760,390]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.locator('#strategy-suggest').isVisible()).toBe(true);expect(await page.locator('#strategy-shotgun-quick-ready').isVisible()).toBe(true);await shot(`15-narrow-${width}`);}
 expect(await page.evaluate(()=>(window as any).fixtureCalls.filter((v:string)=>['authorizeTerms','prepare','armFullBooking','testBooking'].includes(v)))).toEqual([]);
 await page.close();
},30000);


it('automatically checks public bookings, exposes partial uncertainty, keeps primary stable through Shotgun, and has one save action',async()=>{
 const page=await openRenderer(browser,{booking:booking(),playerStatus:{primary:true,extended:true,third:true,fourth:true,fifth:true,sixth:true,seventh:true}},'strategy');
 await page.locator('#strategy-ideal-start').selectOption('19:00');await page.locator('#strategy-prime-from').selectOption('18:00');
 await page.evaluate(()=>{const w=window as any;w.thirsty.checkReleaseBlocks=async(date:string)=>{
  w.fixtureCalls.push('checkReleaseBlocks');w.fixtureState.blockAudit={date,cells:Array.from({length:7},(_,i)=>i+1).flatMap(court=>Array.from({length:16},(_,i)=>({court,hour:`${String(i+8).padStart(2,'0')}:00`,status:court===7&&i+8===19?'BLOCKED':'UNRELEASED',source:court===7&&i+8===19?'PUBLIC_BOOKING':'DATE_UNRELEASED'})))};w.fixturePublish(w.fixtureState);
 };});
 await page.locator('#strategy-suggest').click();await page.waitForFunction(()=>document.getElementById('strategy-target-summary')?.textContent?.includes('Known conflicts excluded'));
 const primary=await page.locator('.target-primary').innerText();expect(primary).toContain('Court 6');
 expect(await page.locator('#strategy-advanced').getAttribute('open')).toBeNull();
 expect(await page.locator('#strategy-review').isVisible()).toBe(true);
 expect(await page.locator('#strategy-review button').count()).toBe(0);
 expect(await page.locator('#strategy-normal-save').isVisible()).toBe(true);expect(await page.locator('#strategy-save').isVisible()).toBe(false);
 const steps=await page.locator('#view-strategy .eyebrow').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().width>0).map(n=>n.textContent));
 expect(steps.filter(t=>t?.startsWith('Step'))).toEqual(['Step 1 · Booking goal','Step 2 · Target plan','Step 3 · Release mode','Step 4 · Review & Continue']);
 await page.locator('input[name="strategy-intensity"][value="SHOTGUN"]').check();
 expect(await page.locator('#strategy-normal-save').isVisible()).toBe(false);expect(await page.locator('#strategy-shotgun-quick-ready').isVisible()).toBe(true);
 await page.locator('#strategy-shotgun-quick-ready').click();await page.waitForFunction(()=>document.getElementById('strategy-shotgun-quick-status')?.textContent?.includes('SHOTGUN SAVED'));
 expect(await page.locator('.target-primary').innerText()).toBe(primary);
 expect(await page.locator('#strategy-review-body').innerText()).toContain('20 Dense Core attempts');
 const saved=await page.evaluate(()=>(window as any).fixtureSaved);expect(saved.PRECISION_PHASE3.candidates[0].court).toBe(6);
 await page.locator('input[name="strategy-intensity"][value="NORMAL"]').check();expect(await page.locator('#strategy-normal-save').isVisible(),JSON.stringify(await page.locator('#strategy-normal-fast-path').evaluate(n=>({hidden:(n as HTMLElement).hidden,text:n.textContent})))).toBe(true);
 await page.locator('#strategy-normal-save').click();await page.waitForFunction(()=>document.getElementById('strategy-normal-status')?.textContent?.includes('SAVED'));
 await page.locator('#strategy-ideal-start').selectOption('20:00');expect(await page.locator('#strategy-normal-next').isVisible()).toBe(false);
 await page.evaluate(()=>{const w=window as any;w.thirsty.checkReleaseBlocks=async()=>{w.fixtureCalls.push('checkReleaseBlocks');for(const c of w.fixtureState.blockAudit.cells)if(c.court===6)c.status='UNKNOWN';w.fixturePublish(w.fixtureState);};});
 await page.locator('#strategy-suggest').click();await page.waitForFunction(()=>document.getElementById('strategy-target-summary')?.textContent?.includes('could not be fully verified'));
 expect(await page.locator('.target-primary').innerText()).not.toContain('Court 6');
 expect(await page.evaluate(()=>(window as any).fixtureCalls.filter((v:string)=>['authorizeTerms','prepare','armFullBooking','testBooking'].includes(v)))).toEqual([]);
 await page.close();
});


it('normalizes stale hidden resource overrides through the real Quick save and records only necessary changes',async()=>{
 const page=await openRenderer(browser,{booking:booking(),playerStatus:{primary:true,extended:true,third:true,fourth:true,fifth:true,sixth:true,seventh:true}},'plan');
 await page.locator('#strategy-suggest').click();await page.waitForFunction(()=>document.querySelector('.target-primary'));
 await page.locator('#smart-advanced').evaluate(node=>(node as HTMLDetailsElement).open=true);
 await page.locator('#smart-adv-wave2').fill('8');await page.locator('#smart-adv-wave2').blur();
 await page.locator('#strategy-advanced > summary').click();
 await page.locator('input[name="strategy-intensity"][value="SHOTGUN"]').check();
 await page.locator('#strategy-shotgun-quick-ready').click();await page.waitForFunction(()=>document.getElementById('strategy-shotgun-quick-status')?.textContent?.includes('SHOTGUN SAVED'));
 expect(await page.locator('#strategy-advanced').getAttribute('open')).toBeNull();
 expect(await page.locator('#strategy-shotgun-quick-status').innerText()).toContain('backup attempt limit');
 const saved=await page.evaluate(()=>(window as any).fixtureSaved);
 expect(saved.STRATEGY_V2.quickShotgun.normalized).toContain('wave2');
 expect(saved.STRATEGY_V2.shotgun.budget).toBe(20);
 expect(await page.evaluate(()=>(window as any).fixtureState.playerStatus.primary)).toBe(true);
 await page.close();
});


it('keeps saved Quick Shotgun refreshable after rebuilding targets instead of mislabelling it Custom',async()=>{
 const players={primary:true,extended:true,third:true,fourth:true,fifth:true,sixth:true,seventh:true};
 const first=await openRenderer(browser,{booking:booking(),playerStatus:players},'strategy');
 await first.locator('#strategy-ideal-start').selectOption('19:00');await first.locator('#strategy-suggest').click();
 await first.waitForFunction(()=>document.querySelector('.target-primary'));
 await first.locator('input[name="strategy-intensity"][value="SHOTGUN"]').check();
 await first.locator('#strategy-shotgun-quick-ready').click();
 await first.waitForFunction(()=>document.getElementById('strategy-shotgun-quick-status')?.textContent?.includes('SHOTGUN SAVED'));
 const setup=await first.evaluate(()=>(window as any).fixtureSaved);await first.close();
 const page=await openRenderer(browser,{booking:bookingView(ConfigSchema.parse({...setup,PLAYER_FULL_NAME:'Fixture',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'})),playerStatus:players},'strategy');
 await page.locator('#strategy-ideal-start').selectOption('17:00');await page.locator('#strategy-suggest').click();
 await page.waitForFunction(()=>document.querySelector('.target-primary')?.textContent?.includes('5:00 PM'));
 expect(await page.locator('#strategy-advanced').getAttribute('open')).toBeNull();
 expect(await page.locator('#strategy-shotgun-quick-status').innerText()).toContain('NEEDS REFRESH');
 expect(await page.locator('#strategy-shotgun-quick-status').innerText()).not.toContain('CUSTOM SHOTGUN');
 expect(await page.locator('#strategy-shotgun-quick-ready').isVisible()).toBe(true);
 expect(await page.locator('#strategy-shotgun-quick-ready').isEnabled()).toBe(true);
 expect(await page.locator('#strategy-save').isVisible()).toBe(false);
 // The old target/settings stay untouched until the operator explicitly refreshes and saves.
 const snapshot=await page.evaluate<import('../src/precision-simple.js').SmartDraft>("(async()=>JSON.parse((await import(new URL('strategy.js',location.href).href)).strategySaveSnapshot()))()");
 expect(snapshot.shotgun!.selectedTargetIds).toEqual(['court-7:19:00:3h']);
 await page.locator('#strategy-shotgun-quick-ready').click();
 await page.waitForFunction(()=>document.getElementById('strategy-shotgun-quick-status')?.textContent?.includes('SHOTGUN SAVED'));
 const saved=await page.evaluate(()=>(window as any).fixtureSaved);
 expect(saved.STRATEGY_V2.shotgun.selectedTargetIds).toEqual(['court-7:17:00:3h']);
 expect(saved.PRECISION_PHASE3.wave1.every((a:any)=>saved.PRECISION_PHASE3.candidates[a.candidateIndex].start==='17:00')).toBe(true);
 expect(await page.locator('#strategy-shotgun-next').isVisible()).toBe(true);
 expect(await page.evaluate(()=>(window as any).fixtureCalls.filter((v:string)=>['authorizeTerms','prepare','armFullBooking','testBooking'].includes(v)))).toEqual([]);
 // A genuine manual edit must still remain Custom when another target plan is built.
 await page.locator('#strategy-advanced > summary').click();await page.locator('#strategy-shotgun-advanced > summary').click();
 await page.locator('#strategy-shotgun-budget').fill('4');await page.locator('#strategy-shotgun-budget').blur();
 await page.locator('#strategy-advanced > summary').click();
 await page.locator('#strategy-ideal-start').selectOption('20:00');await page.locator('#strategy-suggest').click();
 await page.waitForFunction(()=>document.querySelector('.target-primary')?.textContent?.includes('8:00 PM'));
 expect(await page.locator('#strategy-shotgun-quick-status').innerText()).toContain('CUSTOM SHOTGUN');
 const custom=await page.evaluate<import('../src/precision-simple.js').SmartDraft>("(async()=>JSON.parse((await import(new URL('strategy.js',location.href).href)).strategySaveSnapshot()))()");
 expect(custom.shotgun!.budget).toBe(4);expect(custom.shotgun!.selectedTargetIds).toEqual(['court-7:17:00:3h']);
 expect(await page.locator('#strategy-save').isVisible()).toBe(false);
 expect(await page.locator('#strategy-shotgun-quick-ready').isVisible()).toBe(true);
 expect(await page.locator('#strategy-shotgun-quick-ready').isEnabled()).toBe(true);
 expect(await page.locator('#strategy-shotgun-quick-ready').innerText()).toBe('REPLACE WITH QUICK SHOTGUN');
 await page.locator('#strategy-shotgun-quick-ready').click();
 await page.waitForFunction(()=>document.getElementById('strategy-shotgun-quick-status')?.textContent?.includes('SHOTGUN SAVED'));
 const replaced=await page.evaluate(()=>(window as any).fixtureSaved);
 expect(replaced.STRATEGY_V2.shotgun.selectedTargetIds).toEqual(['court-7:20:00:3h']);
 expect(await page.locator('#strategy-shotgun-next').isVisible()).toBe(true);
 await page.close();
});

it('recovers an older persisted Shotgun without Quick provenance after building a new target plan',async()=>{
 const players={primary:true,extended:true,third:true,fourth:true,fifth:true,sixth:true,seventh:true};
 const first=await openRenderer(browser,{booking:booking(),playerStatus:players},'strategy');
 await first.locator('#strategy-suggest').click();await first.waitForFunction(()=>document.querySelector('.target-primary'));
 await first.locator('input[name="strategy-intensity"][value="SHOTGUN"]').check();
 await first.locator('#strategy-shotgun-quick-ready').click();
 await first.waitForFunction(()=>document.getElementById('strategy-shotgun-quick-status')?.textContent?.includes('SHOTGUN SAVED'));
 const setup=await first.evaluate(()=>(window as any).fixtureSaved);await first.close();
 delete setup.STRATEGY_V2.quickShotgun;
 const page=await openRenderer(browser,{booking:bookingView(ConfigSchema.parse({...setup,PLAYER_FULL_NAME:'Fixture',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'})),playerStatus:players},'strategy');
 await page.locator('#strategy-ideal-start').selectOption('17:00');await page.locator('#strategy-suggest').click();
 await page.waitForFunction(()=>document.querySelector('.target-primary')?.textContent?.includes('5:00 PM'));
 expect(await page.locator('#strategy-advanced').getAttribute('open')).toBeNull();
 expect(await page.locator('#strategy-shotgun-quick-status').innerText()).toContain('CUSTOM SHOTGUN NEEDS UPDATE');
 expect(await page.locator('#strategy-save').isVisible()).toBe(false);
 expect(await page.locator('#strategy-shotgun-quick-ready').isVisible()).toBe(true);
 expect(await page.locator('#strategy-shotgun-quick-ready').isEnabled()).toBe(true);
 expect(await page.evaluate(()=>(window as any).fixtureCalls.filter((v:string)=>v==='saveBooking'))).toEqual([]);
 await page.locator('#strategy-shotgun-quick-ready').click();
 await page.waitForFunction(()=>document.getElementById('strategy-shotgun-quick-status')?.textContent?.includes('SHOTGUN SAVED'));
 const saved=await page.evaluate(()=>(window as any).fixtureSaved);
 expect(saved.STRATEGY_V2.shotgun.selectedTargetIds).toEqual(['court-7:17:00:3h']);
 expect(saved.STRATEGY_V2.quickShotgun.version).toBe(1);
 expect(await page.locator('#strategy-shotgun-next').isVisible()).toBe(true);
 expect(await page.evaluate(()=>(window as any).fixtureCalls.filter((v:string)=>['authorizeTerms','prepare','armFullBooking','testBooking'].includes(v)))).toEqual([]);
 await page.close();
});
