import {it,expect,beforeAll,afterAll} from 'vitest';
import {chromium,type Browser} from 'playwright';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,sep} from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
import {pathToFileURL} from 'node:url';
import {Controller} from '../ui/controller.js';
import {bookingView,defaultSetup} from '../ui/booking.js';
import {ConfigSchema} from '../src/config.js';
import {ObservationSchema} from '../src/config.js';
import {clockStatus} from '../ui/status.js';
import {DateTime} from 'luxon';
let browser:Browser;
beforeAll(async()=>{browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});});
afterAll(async()=>{await browser.close();});
const plan=bookingView(ConfigSchema.parse({...defaultSetup,PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'}));
async function renderer(old=false, extra:Record<string,unknown>={}){
 const page=await browser.newPage();const html=(old?execFileSync('git',['show','2edebd0:ui/renderer/index.html'],{encoding:'utf8'}):await readFile('ui/renderer/index.html','utf8')).replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/,'').replace(/<script[^>]*src="app.js"[^>]*><\/script>/,'');await page.setContent(html);
 const state={operation:'idle',headline:'Test retained lock',detail:'',ready:false,workflow:'test',cdp:true,lock:true,inspection:null,clock:null,plan:null,logs:[],liveRace:true,booking:plan,termsAuthorized:false,capabilities:{selectionReady:true,checkoutReady:true,paymentBoundaryReady:true},selection:null,mode:'full',handoff:null};
 Object.assign(state,extra);
 await page.evaluate(state=>{(window as any).fixtureState=state;(window as any).thirsty={getStatus:async()=>state,onStatus:(callback:any)=>{(window as any).fixturePublish=callback;return ()=>{};},authorizeTerms:async(value:boolean)=>{state.termsAuthorized=value;(window as any).fixturePublish?.(state);},invalidatePreparation:async()=>{state.ready=false;state.termsAuthorized=false;},setWorkflow:async(workflow:string)=>{state.workflow=workflow;state.ready=false;state.termsAuthorized=false;},resetPractice:async()=>{},armFullBooking:async()=>{},saveBooking:async(input:any)=>{state.booking.setup=input;state.booking.fingerprint='saved';state.headline='Booking plan saved';}};},state);
 let source=old?execFileSync('git',['show','2edebd0:ui/renderer/app.ts'],{encoding:'utf8'}):await readFile('ui/renderer/app.ts','utf8');
 if(!old)source=(await readFile('src/booking-setup.ts','utf8'))+'\n'+source.replace(/^import .*booking-setup\.js';\r?\n/m,'');
 await page.addScriptTag({type:'module',content:stripTypeScriptTypes(source)});
 await page.waitForFunction(()=>document.getElementById('headline')?.textContent==='Test retained lock');return page;
}
it('reproduces the previous retained-lock editor and Save disabling in the actual renderer',async()=>{const p=await renderer(true);expect(await p.locator('#duration').isDisabled()).toBe(true);expect(await p.locator('#save-booking').isDisabled()).toBe(true);await p.close();});
it('actual renderer keeps all setup controls, Save, Review and Stop enabled while booking actions remain blocked',async()=>{
 const p=await renderer();await p.locator('#workflow-release').click();await p.locator('#advanced > summary').click();for(const id of ['start-time','duration','attempts','fallback-time','save-booking','review-lock','reset-practice','stop'])expect(await p.locator('#'+id).isEnabled(),id).toBe(true);
 expect(await p.locator('#court-order button').nth(1).isEnabled()).toBe(true);
 for(const id of ['arm','dry','observe','practice','full-practice'])expect(await p.locator('#'+id).isDisabled(),id).toBe(true);
 expect(await p.locator('#chrome').isEnabled()).toBe(true);
 expect(await p.locator('#full-terms').isEnabled()).toBe(true);
 expect(await p.locator('#full-date').isEnabled()).toBe(true);
 await p.locator('#duration').fill('3');await p.locator('#start-time').selectOption('10:00');await p.locator('#save-booking').click();await p.waitForFunction(()=>document.getElementById('edit-status')?.textContent==='BOOKING PLAN SAVED');expect(await p.locator('#duration').inputValue()).toBe('3');await p.close();
});
it('default renderer keeps engineering diagnostics collapsed',async()=>{
 const p=await renderer();
 expect(await p.locator('#dual-panel').isVisible()).toBe(false);
 await p.locator('#advanced > summary').click();
 expect(await p.locator('#dual-readiness').innerText()).toContain('Set Courts to book to 2');
 expect(await p.locator('#dual-prepare').isDisabled()).toBe(true);
 expect(await p.locator('#dual-selection').isDisabled()).toBe(true);
 expect(await p.locator('#dual-full').isDisabled()).toBe(true);
 await p.close();
});
it('shows local strategy and calculated next target without implying stale inspection is ready',async()=>{
 const clock=clockStatus(ObservationSchema.parse({RELEASE_PREOPEN_CALENDAR:true}),DateTime.fromISO('2026-09-11T09:00:00+08:00'));
 const p=await renderer(false,{clock});await p.locator('#advanced > summary').click();
 expect(await p.locator('#release-strategy').innerText()).toContain('Pre-open calendar: ON');
 expect(await p.locator('#release-strategy').innerText()).toContain('08:00:00.000');
 expect(await p.locator('#release-strategy').innerText()).toContain('immediate reload fallback');
 expect(await p.locator('#next-readiness').innerText()).toContain('Target: 2026-09-14');
 expect(await p.locator('#next-readiness').innerText()).toContain('Onda: NEEDS INSPECTION');
 expect(await p.locator('#next-readiness').innerText()).toContain('Automation lock: BLOCKED');
 await p.close();
});
it('real config save/reload persists duration, price, start, attempts, courts and fallback into engine config under a retained lock',async()=>{
 await mkdir('.local',{recursive:true});const root=await mkdtemp(resolve('.local/config-persistence-'));
 try{await mkdir(resolve(root,'.local'));await writeFile(resolve(root,'.local/automation.lock'),'fixture-lock');await writeFile(resolve(root,'.env.local'),'PLAYER_FULL_NAME=Fixture Player\nPLAYER_PHONE=09123456789\nPLAYER_EMAIL=fixture@example.invalid\n');
 const booking=pathToFileURL(resolve('ui/booking.ts')).href,config=pathToFileURL(resolve('src/config.ts')).href;
 const setup={...defaultSetup,START_TIME:'10:00',DURATION_HOURS:3,MAX_PRICE:1800,MAX_SELECTION_ATTEMPTS:2,PREFERRED_COURTS:[1,2,3,4,5,6,7],FALLBACK_TIMES:['14:00']};
 const script=`import {saveBooking} from ${JSON.stringify(booking)};import {loadConfig} from ${JSON.stringify(config)};process.chdir(${JSON.stringify(root)});saveBooking(${JSON.stringify(setup)});const c=loadConfig();console.log(JSON.stringify({start:c.START_TIME,duration:c.DURATION_HOURS,maximum:c.MAX_PRICE,attempts:c.MAX_SELECTION_ATTEMPTS,courts:c.PREFERRED_COURTS,fallback:c.FALLBACK_TIMES}));`;
 const output=execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',script],{encoding:'utf8'});
 expect(JSON.parse(output)).toEqual({start:'10:00',duration:3,maximum:1800,attempts:2,courts:[1,2,3,4,5,6,7],fallback:['14:00']});expect(await readFile(resolve(root,'.local/automation.lock'),'utf8')).toBe('fixture-lock');
 const reload=execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',`import {readBooking} from ${JSON.stringify(booking)};process.chdir(${JSON.stringify(root)});console.log(JSON.stringify(readBooking().setup));`],{encoding:'utf8'});expect(JSON.parse(reload)).toEqual(setup);
 }finally{if(!root.startsWith(resolve('.local')+sep))throw Error('UNSAFE_TEST_PATH');await rm(root,{recursive:true,force:true});}
});
it('EXE delegates to the same npm UI entry and main resolves project root independently of cwd',async()=>{
 expect(await readFile('scripts/ThirstyLauncher.cs','utf8')).toContain('scripts/run-ui.mjs');expect(await readFile('scripts/ThirstyLauncher.cs','utf8')).toContain('start.WorkingDirectory = root');expect(await readFile('ui/main.ts','utf8')).toContain("resolve(dirname(fileURLToPath(import.meta.url)), '../..')");
});
it('Standard two courts shows one checkout; Extended has no historical evidence gate in the normal flow',async()=>{
 const dualPlan=bookingView(ConfigSchema.parse({...defaultSetup,COURT_COUNT:2,PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'}));
 const p=await renderer(false,{booking:dualPlan,lock:false,ready:true,termsAuthorized:true,dualValidation:{selection:false,full:false}});
 await p.locator('#workflow-release').click();
 expect(await p.locator('#booking-preview').innerText()).toContain('1 checkout');
 expect(await p.locator('#booking-preview').innerText()).toContain('No price ceiling');
 expect(await p.locator('#dual-panel').isVisible()).toBe(false);
 expect(await p.locator('#prepare').isEnabled()).toBe(true);
 await p.addStyleTag({content:await readFile('ui/renderer/styles.css','utf8')});await p.setViewportSize({width:1010,height:800});
 await mkdir('.local',{recursive:true});await p.screenshot({path:'.local/phase7-ui.png',fullPage:true});await p.close();
});
it('Extended Test Now prepares from test fields without saving production count and consumes per-run Terms',async()=>{
 const p=await renderer(false,{lock:false,ready:false,booking:{...plan,extendedPlayerConfigured:true}});
 await p.evaluate(()=>{const w=window as any;w.calls=[];w.thirsty.resetPrepare=async(strategy:string)=>{w.calls.push({prepare:strategy});w.fixtureState.ready=true;w.fixturePublish(w.fixtureState);};w.thirsty.testBooking=async(input:any)=>{w.calls.push({test:input});};w.thirsty.saveBooking=async()=>{throw Error('Test must not save production');};});
 await p.locator('#booking-type').selectOption('extended');await p.locator('#court-count').selectOption('2');await p.locator('#start-time').selectOption('20:00');await p.locator('#duration').fill('4');await p.locator('#duration').dispatchEvent('change');
 await p.locator('#prepare').click();await p.locator('#terms').check();
 expect(await p.locator('#test-booking').isEnabled()).toBe(true);await p.locator('#test-booking').click();
 const calls=await p.evaluate(()=>(window as any).calls);expect(calls[0]).toMatchObject({prepare:{workflow:'test',request:{strategy:'extended',courtCount:2,start:'20:00',duration:4}}});expect(calls[1].test).toMatchObject({request:{strategy:'extended',courtCount:2,start:'20:00',duration:4},authorizeTerms:true});
 expect(await p.locator('#terms').isChecked()).toBe(false);await p.close();
});
it('after today release the normal screen shows tomorrow, target, plan, readiness and usable preparation',async()=>{
 const clock=clockStatus(ObservationSchema.parse({BOOKING_HORIZON_DAYS:2}),DateTime.fromISO('2026-09-15T08:30:00+08:00'));
 const p=await renderer(false,{clock,booking:plan,lock:false,ready:false,playerStatus:{primary:true,extended:false}});await p.locator('#workflow-release').click();await p.addStyleTag({content:await readFile('ui/renderer/styles.css','utf8')});await p.setViewportSize({width:1010,height:800});
 expect(await p.locator('#release-passed').innerText()).toContain('HAS PASSED');expect(await p.locator('#next-release').innerText()).toContain('September 16');expect(await p.locator('#next-target').innerText()).toContain('September 18');
 expect(await p.locator('#booking-preview').innerText()).toContain('RELEASE PLAN');expect(await p.locator('#release-readiness-card').isVisible()).toBe(true);expect(await p.locator('#prepare').isEnabled()).toBe(true);expect(await p.locator('#advanced').getAttribute('open')).toBeNull();expect(await p.locator('body').innerText()).not.toContain('ZodError');
 expect(await p.locator('#booking-preview').innerText()).toContain('No price ceiling');
 await mkdir('.local',{recursive:true});await p.screenshot({path:'.local/phase8-release-ui.png',fullPage:true});await p.close();
});
it('renderer shows only missing/configured player status and blocks Extended without B',async()=>{
 const p=await renderer(false,{lock:false,ready:true,termsAuthorized:true});
 await p.locator('#booking-type').selectOption('extended');
 expect(await p.locator('#player-status').innerText()).toContain('Primary player: Configured');
 expect(await p.locator('#player-status').innerText()).toContain('Extended player: Missing');
 expect(await p.locator('#test-booking').isDisabled()).toBe(true);
 expect(await p.locator('#arm').isDisabled()).toBe(true);
 expect(await p.locator('body').innerText()).not.toContain('fixture@example.invalid');await p.close();
});
it('shows both local player profiles used for checkout',async()=>{
 const primaryDetails={fullName:'Primary Fixture',phone:'09123456789',email:'primary@example.invalid'};
 const extendedDetails={fullName:'Extended Fixture',phone:'09987654321',email:'extended@example.invalid'};
 const p=await renderer(false,{playerStatus:{primary:true,extended:true,primaryDetails,extendedDetails}});
 const details=await p.locator('#player-details').innerText();
 expect(details).toContain(primaryDetails.fullName);expect(details).toContain(primaryDetails.phone);expect(details).toContain(primaryDetails.email);
 expect(details).toContain(extendedDetails.fullName);expect(details).toContain(extendedDetails.phone);expect(details).toContain(extendedDetails.email);
 await p.close();
});
it('shows a millisecond timer and labeled Activity timeline for every booking method',async()=>{
 const p=await renderer(false,{clock:clockStatus(ObservationSchema.parse({}),DateTime.fromISO('2026-09-21T08:00:00+08:00'))});
 await p.evaluate(()=>{
   const state=(window as any).fixtureState;
   state.operation='fullPractice';
   state.runTiming={runId:'fixture',label:'BROWSER TEST',startedAt:new Date(Date.now()-1500).toISOString(),elapsedMs:0};
   state.logs=[{at:new Date().toISOString(),text:'Target grid ready',level:'info',elapsedMs:1500,deltaMs:900}];
   (window as any).fixturePublish(state);
 });
 expect(await p.locator('.hero').isVisible()).toBe(true);
 expect(await p.locator('.activity').isVisible()).toBe(true);
 expect(await p.locator('#countdown-label').innerText()).toBe('BROWSER TEST ELAPSED');
 expect(await p.locator('#countdown').innerText()).toMatch(/^00:00:01\.\d{3}$/);
 expect(await p.locator('#log').innerText()).toContain('Elapsed 1.500 seconds (1500 milliseconds)');
 expect(await p.locator('#log').innerText()).toContain('Step +0.900 seconds (900 milliseconds)');
 await p.locator('#activity-expand').click();
 expect(await p.locator('.activity').evaluate(e=>e.classList.contains('expanded'))).toBe(true);
 expect(await p.locator('#activity-expand').getAttribute('aria-expanded')).toBe('true');
 await p.keyboard.press('Escape');
 expect(await p.locator('.activity').evaluate(e=>e.classList.contains('expanded'))).toBe(false);
 expect(await p.locator('#clock').innerText()).toMatch(/^\d{2}:\d{2}:\d{2}$/);
 await p.close();
});
it('Reset & Prepare stays accessible while a UI booking worker is running',async()=>{
 const p=await renderer(false,{operation:'fullPractice',ready:false});
 expect(await p.locator('#prepare').isEnabled()).toBe(true);
 expect(await p.locator('#test-booking').isDisabled()).toBe(true);await p.close();
});
it('keeps independent Test and Release drafts across workflow switches and status refreshes',async()=>{
 const releasePlan=bookingView(ConfigSchema.parse({...defaultSetup,START_TIME:'18:00',DURATION_HOURS:3,PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'}));
 const p=await renderer(false,{booking:releasePlan,lock:false,ready:false});
 await p.evaluate(()=>{const w=window as any;w.calls=[];w.thirsty.resetPrepare=async(input:any)=>w.calls.push(input);});
 await p.locator('#booking-type').selectOption('extended');await p.locator('#court-count').selectOption('2');await p.locator('#start-time').selectOption('20:00');await p.locator('#duration').fill('4');await p.locator('#duration').dispatchEvent('change');
 await p.evaluate(()=>{const w=window as any;w.fixturePublish(w.fixtureState);});
 expect(await p.locator('#booking-type').inputValue()).toBe('extended');expect(await p.locator('#start-time').inputValue()).toBe('20:00');
 await p.locator('#workflow-release').click();expect(await p.locator('#booking-type').inputValue()).toBe('standard');expect(await p.locator('#start-time').inputValue()).toBe('18:00');expect(await p.locator('#duration').inputValue()).toBe('3');
 await p.locator('#workflow-test').click();expect(await p.locator('#booking-type').inputValue()).toBe('extended');expect(await p.locator('#court-count').inputValue()).toBe('2');expect(await p.locator('#start-time').inputValue()).toBe('20:00');expect(await p.locator('#duration').inputValue()).toBe('4');
 await p.locator('#prepare').click();expect(await p.evaluate(()=>(window as any).calls[0])).toMatchObject({workflow:'test',request:{strategy:'extended',courtCount:2,start:'20:00',duration:4}});await p.close();
});
it('immediately removes stale Release fallbacks and shows the effective normal summary',async()=>{
 const releasePlan=bookingView(ConfigSchema.parse({...defaultSetup,START_TIME:'18:00',DURATION_HOURS:3,FALLBACK_TIMES:['19:00','20:00'],PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid',PLAYER_B_FULL_NAME:'Fixture Extended',PLAYER_B_PHONE:'09987654321',PLAYER_B_EMAIL:'extended@example.invalid'}));
 const p=await renderer(false,{booking:releasePlan,lock:false,ready:false,playerStatus:{primary:true,extended:true}});
 await p.locator('#workflow-release').click();await p.locator('#booking-type').selectOption('extended');await p.locator('#duration').fill('6');await p.locator('#duration').dispatchEvent('change');
 expect(await p.locator('#booking-adjustment').innerText()).toContain('2 invalid fallback starts were removed');
 expect(await p.locator('#configuration-status').innerText()).toContain('CONFIGURATION: VALID');
 expect(await p.locator('#booking-preview').innerText()).toContain('6:00 PM');expect(await p.locator('#booking-preview').innerText()).toContain('12:00 MN');
 expect(await p.locator('#booking-preview').innerText()).toContain('Fallback starts: None');
 expect(await p.locator('#prepare').isEnabled()).toBe(true);await mkdir('.local',{recursive:true});await p.addStyleTag({content:await readFile('ui/renderer/styles.css','utf8')});await p.setViewportSize({width:1010,height:800});await p.screenshot({path:'.local/fallback-hotfix-ui.png',fullPage:true});await p.close();
});
it('removes a fallback when the Release primary start changes and preserves the Test draft',async()=>{
 const releasePlan=bookingView(ConfigSchema.parse({...defaultSetup,BOOKING_TYPE:'extended',START_TIME:'17:00',DURATION_HOURS:6,FALLBACK_TIMES:['18:00'],PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid',PLAYER_B_FULL_NAME:'Fixture Extended',PLAYER_B_PHONE:'09987654321',PLAYER_B_EMAIL:'extended@example.invalid'}));
 const p=await renderer(false,{booking:releasePlan,lock:false,ready:false,playerStatus:{primary:true,extended:true}});await p.locator('#advanced > summary').click();
 await p.locator('#fallback-time').selectOption('20:00');await p.locator('#add-fallback').click();
 expect(await p.locator('#fallback-order').innerText()).toContain('8:00 PM');
 await p.locator('#workflow-release').click();expect(await p.locator('#fallback-order').innerText()).toContain('6:00 PM');
 await p.locator('#start-time').selectOption('18:00');expect(await p.locator('#fallback-order').innerText()).not.toContain('6:00 PM');
 expect(await p.locator('#booking-adjustment').innerText()).toContain('1 invalid fallback start was removed');
 await p.locator('#workflow-test').click();expect(await p.locator('#fallback-order').innerText()).toContain('8:00 PM');await p.close();
});
