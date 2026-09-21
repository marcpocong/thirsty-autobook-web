import {afterAll,beforeAll,expect,it} from 'vitest';
import {chromium,type Browser} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {bookingView,defaultSetup} from '../ui/booking.js';
import {ConfigSchema} from '../src/config.js';

let browser:Browser;
beforeAll(async()=>{browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});});
afterAll(async()=>{await browser.close();});
const booking=(method:'browser'|'api-first'='browser',strategy:'standard'|'extended'='standard')=>bookingView(ConfigSchema.parse({
  ...defaultSetup,BOOKING_METHOD:method,BOOKING_TYPE:strategy,DURATION_HOURS:strategy==='extended'?4:2,
  PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid',
  PLAYER_B_FULL_NAME:'Second Fixture',PLAYER_B_PHONE:'09987654321',PLAYER_B_EMAIL:'second@example.invalid',
}));
async function renderer(extra:Record<string,unknown>={}){
  const page=await browser.newPage({viewport:{width:1060,height:760}});
  const html=(await readFile('ui/renderer/index.html','utf8')).replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/,'').replace(/<script[^>]*src="app.js"[^>]*><\/script>/,'');
  await page.setContent(html);
  await page.addStyleTag({content:await readFile('ui/renderer/styles.css','utf8')});
  const state={operation:'idle',headline:'Fixture status',detail:'Ready for review',ready:false,workflow:'release',cdp:false,lock:false,
    inspection:null,clock:null,plan:null,logs:[],liveRace:true,booking:booking(),termsAuthorized:false,apiFirstReady:false,
    browserHealth:{A:false,B:false},capabilities:{selectionReady:true,checkoutReady:true,paymentBoundaryReady:true},
    selection:null,mode:'full',handoff:null,preparedContext:null,playerStatus:{primary:true,extended:true},...extra};
  await page.evaluate(value=>{const w=window as any;w.fixtureState=value;w.thirsty={getStatus:async()=>value,onStatus:(callback:any)=>{w.fixturePublish=callback;return ()=>{};},
    setWorkflow:async(workflow:string)=>{value.workflow=workflow;value.ready=false;},invalidatePreparation:async()=>{},
    authorizeTerms:async(authorized:boolean)=>{value.termsAuthorized=authorized;w.fixturePublish(value);},
    resetPrepare:async()=>{},armFullBooking:async()=>{},reviewLock:async()=>{},saveBooking:async()=>{}};},state);
  const source=(await readFile('src/booking-setup.ts','utf8'))+'\n'+(await readFile('ui/renderer/app.ts','utf8')).replace(/^import .*booking-setup\.js';\r?\n/m,'');
  await page.addScriptTag({type:'module',content:stripTypeScriptTypes(source)});
  await page.waitForFunction(()=>document.getElementById('headline')?.textContent==='Fixture status');
  return page;
}

it('shows four focused views with a wide grid and stacked narrow layout',async()=>{
  const page=await renderer();
  expect(await page.locator('[data-view]').allTextContents()).toEqual(['Next Release','Edit Plan','Tests','Runs']);
  expect(await page.locator('#release-schedule').isVisible()).toBe(true);
  expect(await page.locator('#booking-method').isVisible()).toBe(false);
  await mkdir('.local',{recursive:true});await page.screenshot({path:'.local/ui-redesign-release.png'});
  await page.locator('[data-view="plan"]').click();
  expect(await page.locator('#booking-method').isVisible()).toBe(true);
  expect(await page.locator('#court-order').isVisible()).toBe(true);
  expect(await page.locator('#fallback-time').isVisible()).toBe(true);
  await page.locator('[data-view="tests"]').click();
  expect(await page.locator('.test-date-card').isVisible()).toBe(true);
  expect(await page.locator('#test-date').isVisible()).toBe(true);
  expect(await page.locator('#test-plan-summary').isVisible()).toBe(true);
  expect(await page.locator('#test-main-action').innerText()).toBe('Prepare');
  expect(await page.locator('#full-date,#practice-date,#dual-date').first().isVisible()).toBe(false);
  expect(await page.locator('#test-booking').isVisible()).toBe(false);
  await page.locator('[data-view="runs"]').click();
  expect(await page.locator('.activity').isVisible()).toBe(true);
  expect(await page.locator('.run-history').isVisible()).toBe(true);
  expect(await page.locator('#activity-resize-handle').count()).toBe(0);
  const runsHeight=await page.locator('.run-history').evaluate(e=>e.getBoundingClientRect().height);
  const activityHeight=await page.locator('.activity').evaluate(e=>e.getBoundingClientRect().height);
  expect(activityHeight).toBe(runsHeight);
  expect(activityHeight).toBeGreaterThan(350);
  await page.screenshot({path:'.local/ui-redesign-runs.png'});
  expect(await page.locator('#advanced').getAttribute('open')).toBeNull();
  await page.setViewportSize({width:640,height:760});
  expect(await page.locator('#view-runs').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length)).toBe(1);
  await page.close();
});

it('tests the saved plan with only the selected date changed',async()=>{
  const page=await renderer();
  await page.evaluate(()=>{const w=window as any;w.thirsty.resetPrepare=async(value:unknown)=>{w.fixturePreparation=value;};});
  await page.locator('[data-view="tests"]').click();
  await page.locator('#test-date').fill('2026-09-25');
  await page.locator('#test-main-action').click();
  await page.waitForFunction(()=>!!(window as any).fixturePreparation);
  const sent=await page.evaluate(()=>(window as any).fixturePreparation);
  expect(sent).toMatchObject({workflow:'test',method:'browser',request:{date:'2026-09-25',strategy:'standard',start:defaultSetup.START_TIME,duration:defaultSetup.DURATION_HOURS,courtCount:defaultSetup.COURT_COUNT,priority:defaultSetup.PREFERRED_COURTS,fallbackStarts:defaultSetup.FALLBACK_TIMES}});
  expect(await page.locator('#test-plan-summary').innerText()).toContain('Test date: Friday, September 25');
  await page.close();
});

it('runs a prepared test through the existing Terms and test booking action',async()=>{
  const page=await renderer();
  await page.evaluate(()=>{const w=window as any;w.thirsty.testBooking=async(value:unknown)=>{w.fixtureTestBooking=value;};});
  await page.locator('[data-view="tests"]').click();
  await page.evaluate(()=>{const w=window as any;w.fixtureState.ready=true;w.fixtureState.browserHealth.A=true;w.fixtureState.preparedContext={workflow:'test',date:(document.getElementById('test-date') as HTMLInputElement).value};w.fixturePublish(w.fixtureState);});
  expect(await page.locator('#test-main-action').innerText()).toBe('Review & Test');
  await page.locator('#test-main-action').click();
  expect(await page.evaluate(()=>(window as any).fixtureTestBooking)).toBeUndefined();
  await page.locator('#terms').check();
  await page.waitForFunction(()=>(window as any).fixtureState.termsAuthorized===true);
  await page.locator('#test-main-action').click();
  await page.waitForFunction(()=>!!(window as any).fixtureTestBooking);
  const sent=await page.evaluate(()=>(window as any).fixtureTestBooking);
  expect(sent).toMatchObject({authorizeTerms:true,request:{strategy:'standard',priority:defaultSetup.PREFERRED_COURTS}});
  await page.close();
});

it('shows API-first browser readiness and the state-based release action',async()=>{
  const page=await renderer({booking:booking('api-first','extended'),ready:true,apiFirstReady:true,browserHealth:{A:true,B:true},cdp:true});
  expect(await page.locator('#release-readiness').innerText()).toContain('OK Browser A prepared');
  expect(await page.locator('#release-readiness').innerText()).toContain('OK Browser B prepared');
  expect(await page.locator('#release-readiness').innerText()).not.toContain('All Courts verified');
  expect(await page.locator('#main-action').innerText()).toBe('Review & Arm');
  await page.evaluate(()=>{const w=window as any;w.fixtureState.scheduledRelease={releaseMs:Date.now()+60000,targetDate:'2026-09-24'};w.fixtureState.operation='scheduled';w.fixturePublish(w.fixtureState);});
  expect(await page.locator('#main-action').innerText()).toBe('Armed');
  await page.close();
});

it('keeps a retained hold visible while booking controls stay blocked',async()=>{
  const page=await renderer({lock:true});
  expect(await page.locator('#main-action').innerText()).toBe('Review Hold');
  expect(await page.locator('#lock-card').isVisible()).toBe(true);
  expect(await page.locator('#arm').isDisabled()).toBe(true);
  await page.locator('[data-view="plan"]').click();
  expect(await page.locator('#duration').isEnabled()).toBe(true);
  expect(await page.locator('#save-booking').isEnabled()).toBe(true);
  await page.close();
});

it('offers Prepare New Run for a verified hold without dismissing the lock',async()=>{
  const page=await renderer({lock:true,canPrepareOverHold:true});
  await page.evaluate(()=>{const w=window as any;w.thirsty.resetPrepare=async(value:unknown)=>{w.fixturePreparation=value;};});
  expect(await page.locator('#main-action').innerText()).toBe('Prepare New Run');
  await page.locator('[data-view="tests"]').click();
  expect(await page.locator('#test-main-action').innerText()).toBe('Prepare New Run');
  await page.locator('#test-main-action').click();
  await page.waitForFunction(()=>!!(window as any).fixturePreparation);
  expect(await page.evaluate(()=>(window as any).fixturePreparation.workflow)).toBe('test');
  expect(await page.locator('#lock-card').isVisible()).toBe(true);
  await page.close();
});

it('has no price ceiling control and shows the observed amount',async()=>{
  const page=await renderer();
  expect(await page.locator('#maximum,#full-maximum,#dual-maximum').count()).toBe(0);
  await page.evaluate(()=>{const w=window as any;w.fixtureState.selection={court:7,date:'2026-09-24',hours:['10:00','11:00'],amount:1800};w.fixturePublish(w.fixtureState);});
  expect(await page.locator('#selection-result').innerText()).toContain('₱1,800');
  await page.close();
});
