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
  await page.evaluate(value=>{const w=window as any;w.fixtureState=value;w.thirsty={getStatus:async()=>value,onStatus:(callback:any)=>{w.fixturePublish=callback;return ()=>{};},focusBrowser:async(request:unknown)=>{w.fixtureFocusedBrowser=request;return w.fixtureFocusResult??'focused';},
    setWorkflow:async(workflow:string)=>{value.workflow=workflow;value.ready=false;},invalidatePreparation:async()=>{},
    authorizeTerms:async(authorized:boolean)=>{value.termsAuthorized=authorized;w.fixturePublish(value);},
    resetPrepare:async()=>{},armFullBooking:async()=>{},reviewLock:async()=>{},saveBooking:async()=>{},
    onConfirmRequest:(callback:any)=>{w.fixtureConfirmRequest=callback;return ()=>{};},confirmResponse:async(id:string,confirmed:boolean)=>{w.fixtureConfirmResponse={id,confirmed};}};},state);
  const source=(await readFile('src/booking-setup.ts','utf8'))+'\n'+(await readFile('ui/renderer/app.ts','utf8')).replace(/^import .*booking-setup\.js';\r?\n/m,'');
  await page.addScriptTag({type:'module',content:stripTypeScriptTypes(source)});
  await page.waitForFunction(expected=>document.getElementById('headline')?.textContent===expected,state.headline);
  return page;
}

it('shows six focused views with a wide grid and stacked narrow layout',async()=>{
  const page=await renderer();
  expect(await page.locator('[data-view]').allTextContents()).toEqual(['Next Release','Edit Plan','Tests','Slots','Runs','Tools']);
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
  expect(await page.locator('#release-readiness .gate.good').filter({hasText:'Browser A prepared'}).count()).toBe(1);
  expect(await page.locator('#release-readiness .gate.good').filter({hasText:'Browser B prepared'}).count()).toBe(1);
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

it('offers Reset & Prepare for an unresolved final action instead of the non-recovering Review Hold action',async()=>{
  const page=await renderer({lock:true,canPrepareOverHold:true,retainedLockStage:'FINAL_ACTION_DISPATCHING',headline:'UNRESOLVED CHECKOUT LOCK'});
  await page.evaluate(()=>{const w=window as any;w.thirsty.resetPrepare=async(value:unknown)=>{w.fixturePreparation=value;};});
  await page.locator('[data-view="tests"]').click();
  expect(await page.locator('#test-main-action').innerText()).toBe('Reset & Prepare');
  expect(await page.locator('#test-main-action-hint').innerText()).toContain('clears the retained safety lock only after clean-state verification');
  await page.locator('#test-main-action').click();
  await page.waitForFunction(()=>!!(window as any).fixturePreparation);
  expect(await page.evaluate(()=>(window as any).fixturePreparation.workflow)).toBe('test');
  await page.close();
});

it('has no price ceiling control and shows the observed amount',async()=>{
  const page=await renderer();
  expect(await page.locator('#maximum,#full-maximum,#dual-maximum').count()).toBe(0);
  await page.evaluate(()=>{const w=window as any;w.fixtureState.selection={court:7,date:'2026-09-24',hours:['10:00','11:00'],amount:1800};w.fixturePublish(w.fixtureState);});
  expect(await page.locator('#selection-result').innerText()).toContain('₱1,800');
  await page.close();
});

it('opens each previous run to its timing facts and detailed activity timeline',async()=>{
  const page=await renderer({runHistory:[{runId:'00000000-0000-4000-8000-000000000001',label:'API LIVE-NOW',startedAt:'2026-09-22T00:00:00.000Z',readyAt:'2026-09-22T00:00:01.000Z',endedAt:'2026-09-22T00:00:03.500Z',outcome:'complete',totalElapsedMs:3500,readyElapsedMs:2500,activities:[{at:'2026-09-22T00:00:02.000Z',text:'Official QRPH checkout open · Court 7 · 2026-09-24 · 10:00–12:00',level:'info',elapsedMs:2000,deltaMs:1000}]}]});
  await page.locator('[data-view="runs"]').click();
  const run=page.locator('.run-history-item');
  const toggle=run.locator('.run-history-toggle'),modal=page.locator('#run-detail-modal');
  expect(await modal.isVisible()).toBe(false);
  await toggle.click();
  expect(await modal.isVisible()).toBe(true);
  expect(await modal.innerText()).toContain('00000000-0000-4000-8000-000000000001');
  expect(await modal.innerText()).toContain('Official QRPH checkout open · Court 7 · 2026-09-24 · 10:00–12:00');
  expect(await modal.innerText()).toContain('2.500 seconds · browser ready to finish');
  await page.evaluate(()=>{const w=window as any;w.fixturePublish(w.fixtureState);});
  expect(await modal.isVisible()).toBe(true);
  await page.locator('#run-detail-close').click();
  expect(await modal.isVisible()).toBe(false);
  await toggle.click();
  await mkdir('.local',{recursive:true});await page.screenshot({path:'.local/ui-run-details.png'});
  await page.close();
});

it('keeps previous payment holds scrollable while running output republishes the state',async()=>{
  const hold=(n:number)=>({runID:`0000000${n}-0000-4000-8000-00000000000${n}`,archivedAt:`2026-09-22T0${n}:00:00.000Z`,expiresAt:`2026-09-22T0${n}:10:00.000Z`});
  const page=await renderer({previousHolds:[1,2,3,4,5,6,7,8].map(hold)});
  await page.locator('[data-view="runs"]').click();
  const list=page.locator('#previous-holds-list');
  expect(await list.locator('.previous-hold-item').count()).toBe(8);

  await page.evaluate(()=>{document.getElementById('previous-holds-list')!.scrollTop=60;});
  // A log line republishes the whole state; the list must not be rebuilt under the operator.
  await page.evaluate(()=>{const w=window as any;w.fixtureState.logs=[{at:new Date().toISOString(),text:'running',level:'info'}];w.fixturePublish(w.fixtureState);});
  expect(await page.evaluate(()=>document.getElementById('previous-holds-list')!.scrollTop)).toBe(60);

  // A genuinely new archived hold still appears without a restart.
  await page.evaluate(()=>{const w=window as any;
    w.fixtureState.previousHolds=[{runID:'99999999-0000-4000-8000-000000000099',archivedAt:'2026-09-22T09:00:00.000Z',expiresAt:null},...w.fixtureState.previousHolds];
    w.fixturePublish(w.fixtureState);});
  await list.locator('.previous-hold-item').first().filter({hasText:'99999999'}).waitFor();
  expect(await list.locator('.previous-hold-item').count()).toBe(9);
  await page.close();
});

it('never claims a browser is in front when the window did not take the foreground',async()=>{
  const qrHandoffs=[{checkout:'A',courts:[7],date:'2026-09-24',startTime:'10:00',endTime:'12:00',amount:1200,
    verifiedAt:'2026-09-22T00:00:03.000Z',holdExpiresAt:new Date(Date.now()+600000).toISOString()}];
  const page=await renderer({qrHandoffs,playerStatus:{primary:true,extended:true,third:false,fourth:false,
    primaryDetails:{fullName:'Fixture Player',phone:'09123456789',email:'fixture@example.invalid'}}});
  await page.evaluate(()=>{(window as any).fixtureFocusResult='unconfirmed';});
  const result=page.locator('#qr-summary-release .show-browser-result').first();

  await page.locator('#qr-summary-release .show-browser').first().click();
  await result.filter({hasText:'Windows kept another window in front'}).waitFor();

  expect(await result.innerText()).not.toContain('is now in front');
  await page.close();
});

it('keeps every previous run readable and scrollable instead of collapsing the rows',async()=>{
  const runHistory=Array.from({length:30},(_,i)=>({runId:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,label:'API LIVE-NOW',
    startedAt:'2026-09-22T00:00:00.000Z',readyAt:'2026-09-22T00:00:01.000Z',endedAt:'2026-09-22T00:00:03.500Z',
    outcome:'complete',totalElapsedMs:3500,readyElapsedMs:2500,activities:[]}));
  const page=await renderer({runHistory});
  await page.locator('[data-view="runs"]').click();
  expect(await page.locator('.run-history-item').count()).toBe(30);
  // The items clip their contents, so the grid rows must be sized to content;
  // otherwise every run collapses to its 2px border inside the fixed-height panel.
  const {itemHeight,scrollHeight,clientHeight}=await page.evaluate(()=>{
    const list=document.getElementById('run-history-list')!;
    return {itemHeight:list.querySelector('.run-history-item')!.getBoundingClientRect().height,
      scrollHeight:list.scrollHeight,clientHeight:list.clientHeight};
  });
  expect(itemHeight).toBeGreaterThan(40);
  expect(scrollHeight).toBeGreaterThan(clientHeight);
  await page.close();
});

it('shows verified QR handoffs with the corresponding players in release and test status',async()=>{
  const qrHandoffs=[
    {checkout:'A',courts:[7,6],date:'2026-09-24',startTime:'10:00',endTime:'12:00',amount:2400,verifiedAt:'2026-09-22T00:00:03.000Z',holdExpiresAt:new Date(Date.now()+600000).toISOString()},
    {checkout:'B',courts:[5,4],date:'2026-09-24',startTime:'10:00',endTime:'12:00',amount:2400,verifiedAt:'2026-09-22T00:00:04.000Z'}
  ];
  const playerStatus={primary:true,extended:true,third:false,fourth:false,
    primaryDetails:{fullName:'Primary Fixture',email:'primary@example.invalid',phone:'09123456789'},
    extendedDetails:{fullName:'Second Fixture',email:'second@example.invalid',phone:'09987654321'}};
  const page=await renderer({headline:'Official QRPH checkout open',detail:'Automation stopped at the QR page.',qrHandoffs,playerStatus});
  const release=await page.locator('#qr-summary-release').innerText();
  expect(release).toContain('All QR pages reached · 2 checkouts');
  expect(release).toContain('Browser A · Primary Fixture');
  expect(release).toContain('primary@example.invalid');
  expect(release).toContain('Courts 7 + 6');
  expect(release).toContain('Date: Thursday, September 24 (2026-09-24)');
  expect(release).toContain('Time: 10:00–12:00');
  expect(release).toContain('Slots: 10:00–11:00 · 11:00–12:00');
  expect(release).toContain('Browser B · Second Fixture');
  expect(release).toContain('Courts 5 + 4');
  expect(release).toContain('Confirm every court and time slot below');
  expect(release).toContain('A hold is not final booking confirmation');
  expect(release).not.toContain('09123456789');
  expect(await page.locator('#qr-summary-release .show-browser').allTextContents()).toEqual(['Show Browser A','Show Browser B']);
  await page.locator('#qr-summary-release .show-browser').nth(1).click();
  await page.waitForFunction(()=>(window as any).fixtureFocusedBrowser?.workerId==='B');
  expect(await page.evaluate(()=>(window as any).fixtureFocusedBrowser)).toEqual({workerId:'B'});
  await page.locator('#qr-summary-release .show-browser-result').nth(1).filter({hasText:'Browser B is now in front'}).waitFor();
  expect(await page.locator('#qr-summary-release .show-browser-result').nth(1).innerText()).toContain('Browser B is now in front');
  await page.locator('[data-view="tests"]').click();
  await page.evaluate(()=>{const w=window as any;w.fixtureState.workflow='test';w.fixturePublish(w.fixtureState);});
  expect(await page.locator('#qr-summary-test').innerText()).toContain('Browser B · Second Fixture');
  expect(await page.locator('#test-headline').innerText()).toBe('CONFIRM BOOKING DETAILS BEFORE PAYING');
  expect(await page.locator('#test-detail').innerText()).toContain('Check the player, courts, date, every hourly slot, amount, and booking reference');
  await mkdir('.local',{recursive:true});await page.screenshot({path:'.local/ui-qr-status.png'});
  await page.close();
});

it('shows every bot browser, brings one forward, and closes them all from the status bar',async()=>{
  const page=await renderer({browserHealth:{A:true,B:true,C:false,D:false,E:false,F:false,G:false,H:false}});
  await page.evaluate(()=>{const w=window as any;w.thirsty.closeBotBrowsers=async()=>{w.fixtureClosed=(w.fixtureClosed??0)+1;};});
  expect(await page.locator('#browser-strip .browser-dot').allTextContents()).toEqual(['A','B','C','D','E','F','G','H']);
  expect(await page.locator('#browser-strip .browser-dot.open').allTextContents()).toEqual(['A','B']);
  await page.locator('#browser-strip .browser-dot',{hasText:'B'}).click();
  await page.waitForFunction(()=>(window as any).fixtureFocusedBrowser?.workerId==='B');
  await page.locator('#close-browsers').click();
  await page.waitForFunction(()=>(window as any).fixtureClosed===1);
  await page.locator('[data-view="tools"]').click();
  expect(await page.locator('#browser-list .browser-row').count()).toBe(8);
  expect(await page.locator('#browser-list .browser-row.open').count()).toBe(2);
  // An armed release cannot lose its browsers.
  await page.evaluate(()=>{const w=window as any;w.fixtureState.scheduledRelease={releaseMs:Date.now()+60000,targetDate:'2026-09-24'};w.fixtureState.operation='scheduled';w.fixturePublish(w.fixtureState);});
  expect(await page.locator('#close-browsers').isDisabled()).toBe(true);
  expect(await page.locator('#close-browsers-tools').isDisabled()).toBe(true);
  await page.close();
});

it('shows the live release slot watch with exact change times',async()=>{
  const hours=Array.from({length:16},(_,i)=>`${String(i+8).padStart(2,'0')}:00`);
  const releaseMs=Date.parse('2026-09-24T00:00:00.000Z');
  const cells=[1,2,3,4,5,6,7].flatMap(court=>hours.map(hour=>({court,hour,state:court===7&&hour==='18:00'?'TAKEN':'OPEN',record:court===7&&hour==='18:00',...(court===7&&hour==='18:00'?{changedSinceReleaseMs:790}:{})})));
  const timeline=[{seq:2,court:0,hour:'',kind:'published',openCount:112,takenCount:0,observedAt:'2026-09-24T00:00:00.290Z',sinceReleaseMs:290,windowMs:null},
    {seq:3,court:7,hour:'18:00',kind:'state',from:'OPEN',to:'TAKEN',observedAt:'2026-09-24T00:00:00.790Z',sinceReleaseMs:790,windowMs:500}];
  const page=await renderer({slotWatch:{id:'w1',date:'2026-09-26',releaseMs,status:'watching',startedAt:'2026-09-23T23:59:00.000Z',endsAtMs:releaseMs+900000,polls:3,failedPolls:0,
    lastPollAt:'2026-09-24T00:00:00.790Z',lastLatencyMs:40,dateReleased:true,cells,timeline,logPath:'C:\\bot\\.local\\slot-watch\\2026-09-26_w1.ndjson'}});
  expect(await page.locator('#status-watch-text').innerText()).toContain('Watching · 3 reads');
  await page.locator('#status-watch').click();
  expect(await page.locator('#view-slots').isVisible()).toBe(true);
  const taken=page.locator('#slot-watch-matrix td.slot-taken');
  expect(await taken.count()).toBe(1);
  expect(await taken.getAttribute('title')).toContain('Court 7 · 6:00 PM · Taken / unavailable · public booking record · last change +0.790 s after release');
  expect(await page.locator('#slot-watch-matrix td.slot-open small').count()).toBe(0);
  const rows=await page.locator('#slot-watch-timeline .slot-event').allInnerTexts();
  expect(rows[0]).toContain('Schedule published');
  expect(rows[1]).toContain('+0.790 s');
  expect(rows[1]).toContain('Open → Taken / unavailable');
  expect(await page.locator('#stop-slot-watch').isVisible()).toBe(true);
  expect(await page.locator('#watch-next-release').isVisible()).toBe(false);
  await page.close();
});

it('hides an expired payment hold from the QR summary instead of showing it as active',async()=>{
  const qrHandoffs=[
    {checkout:'A',status:'qr-ready',courts:[7],date:'2026-09-24',startTime:'10:00',endTime:'11:00',amount:1200,verifiedAt:'2026-09-22T00:00:03.000Z',holdExpiresAt:new Date(Date.now()-1000).toISOString()}
  ];
  const playerStatus={primary:true,extended:false,third:false,fourth:false,
    primaryDetails:{fullName:'Primary Fixture',email:'primary@example.invalid',phone:'09123456789'}};
  const page=await renderer({headline:'PAYMENT HOLD ACTIVE',detail:'A previous payment hold is recorded.',qrHandoffs,playerStatus,workflow:'test'});
  await page.locator('[data-view="tests"]').click();
  await page.evaluate(()=>{const w=window as any;w.fixturePublish(w.fixtureState);});
  expect(await page.locator('#qr-summary-test').isVisible()).toBe(false);
  expect(await page.locator('#test-headline').innerText()).not.toBe('CONFIRM BOOKING DETAILS BEFORE PAYING');
  await page.close();
});
