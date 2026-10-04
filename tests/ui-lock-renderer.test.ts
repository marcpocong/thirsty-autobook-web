import {afterAll,beforeAll,expect,it} from 'vitest';
import {chromium,type Browser} from 'playwright';
import {mkdir} from 'node:fs/promises';
import {openRenderer,showRendererView} from './renderer-harness.js';
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
  return openRenderer(browser,{booking:booking(),browserHealth:{A:false,B:false},...extra},'release',{width:1060,height:760});
}

it('shows the five operator views with a wide grid and stacked narrow layout',async()=>{
  const page=await renderer();
  expect(await page.locator('nav [data-view]').allTextContents()).toEqual(['Next Release','Strategy','Live','History & Insights','Tools']);
  expect(await page.locator('#release-schedule').isVisible()).toBe(true);
  expect(await page.locator('#next-strategy').isVisible()).toBe(true);
  expect(await page.locator('#booking-method').isVisible()).toBe(false);
  await mkdir('.local',{recursive:true});await page.screenshot({path:'.local/ui-redesign-release.png'});
  await showRendererView(page,'strategy');
  // Normal setup is Goal → Known schedule → Preset → Suggested plan → Review; raw fields sit under Advanced overrides.
  for(const id of ['#strategy-goal','#strategy-schedule','#strategy-preset','#strategy-suggested','#strategy-review'])expect(await page.locator(id).isVisible()).toBe(true);
  expect(await page.locator('#booking-method').isVisible()).toBe(false);
  await page.locator('#strategy-advanced > summary').click();
  expect(await page.locator('#booking-method').isVisible()).toBe(true);
  expect(await page.locator('#court-order').isVisible()).toBe(true);
  expect(await page.locator('#fallback-time').isVisible()).toBe(true);
  await showRendererView(page,'tests');
  expect(await page.locator('.test-date-card').isVisible()).toBe(true);
  expect(await page.locator('#test-date').isVisible()).toBe(true);
  expect(await page.locator('#test-plan-summary').isVisible()).toBe(true);
  expect(await page.locator('#test-main-action').innerText()).toBe('Prepare');
  expect(await page.locator('#full-date,#practice-date,#dual-date').first().isVisible()).toBe(false);
  expect(await page.locator('#test-booking').isVisible()).toBe(false);
  await showRendererView(page,'live');
  expect(await page.locator('#live-attempts-card').isVisible()).toBe(true);
  expect(await page.locator('#slot-watch-card').isVisible()).toBe(true);
  await showRendererView(page,'history');
  await page.locator('.history-forensics').evaluate(element=>element.setAttribute('open',''));
  expect(await page.locator('.activity').isVisible()).toBe(true);
  expect(await page.locator('.run-history').isVisible()).toBe(true);
  expect(await page.locator('#release-lab-card').isVisible()).toBe(true);
  expect(await page.locator('#activity-resize-handle').count()).toBe(0);
  const runsHeight=await page.locator('.run-history').evaluate(e=>e.getBoundingClientRect().height);
  const activityHeight=await page.locator('.activity').evaluate(e=>e.getBoundingClientRect().height);
  expect(activityHeight).toBe(runsHeight);
  expect(activityHeight).toBeGreaterThan(350);
  await page.screenshot({path:'.local/ui-redesign-runs.png'});
  expect(await page.locator('#advanced').getAttribute('open')).toBeNull();
  await page.setViewportSize({width:640,height:760});
  expect(await page.locator('#view-history').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length)).toBe(1);
  await page.close();
});

it('returns from Live to the main release page while a release run is active',async()=>{
  const page=await renderer({operation:'full'});
  await showRendererView(page,'live');
  expect(await page.locator('#view-live').isVisible()).toBe(true);
  await showRendererView(page,'release');
  expect(await page.locator('#view-release').isVisible()).toBe(true);
  expect(await page.locator('#main-action').isDisabled()).toBe(true);
  await showRendererView(page,'strategy');
  expect(await page.locator('#view-release').isVisible()).toBe(true);
  await page.close();
});

it('tests the saved plan with only the selected date changed',async()=>{
  const page=await renderer();
  await page.evaluate(()=>{const w=window as any;w.thirsty.resetPrepare=async(value:unknown)=>{w.fixturePreparation=value;};});
  await showRendererView(page,'tests');
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
  await showRendererView(page,'tests');
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
  expect(await page.locator('#main-action').innerText()).toBe('Arm Release');
  await page.evaluate(()=>{const w=window as any;w.fixtureState.scheduledRelease={releaseMs:Date.now()+60000,targetDate:'2026-09-24'};w.fixtureState.operation='scheduled';w.fixturePublish(w.fixtureState);});
  expect(await page.locator('#main-action').innerText()).toBe('Emergency Stop');
  await page.close();
});

it('keeps a retained hold visible while booking controls stay blocked',async()=>{
  const page=await renderer({lock:true});
  expect(await page.locator('#main-action').innerText()).toBe('Review Hold');
  expect(await page.locator('#lock-card').isVisible()).toBe(true);
  expect(await page.locator('#arm').isDisabled()).toBe(true);
  await showRendererView(page,'plan');
  expect(await page.locator('#duration').isEnabled()).toBe(true);
  expect(await page.locator('#save-booking').isEnabled()).toBe(true);
  await page.close();
});

it('offers Prepare New Run for a verified hold without dismissing the lock',async()=>{
  const page=await renderer({lock:true,canPrepareOverHold:true});
  await page.evaluate(()=>{const w=window as any;w.thirsty.resetPrepare=async(value:unknown)=>{w.fixturePreparation=value;};});
  expect(await page.locator('#main-action').innerText()).toBe('Prepare New Run');
  await showRendererView(page,'tests');
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
  await showRendererView(page,'tests');
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
  await showRendererView(page,'history');
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
  await showRendererView(page,'history');
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
  await showRendererView(page,'history');
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
  await showRendererView(page,'tests');
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
  await showRendererView(page,'tools');
  expect(await page.locator('#browser-list .browser-row').count()).toBe(8);
  expect(await page.locator('#browser-list .browser-row.open').count()).toBe(2);
  // An armed release cannot lose its browsers.
  await page.evaluate(()=>{const w=window as any;w.fixtureState.scheduledRelease={releaseMs:Date.now()+60000,targetDate:'2026-09-24'};w.fixtureState.operation='scheduled';w.fixturePublish(w.fixtureState);});
  expect(await page.locator('#close-browsers').isDisabled()).toBe(true);
  expect(await page.locator('#close-browsers-tools').isDisabled()).toBe(true);
  await page.close();
});

it('shows the live release slot watch with request/response windows, observer health and the first published grid',async()=>{
  const hours=Array.from({length:16},(_,i)=>`${String(i+8).padStart(2,'0')}:00`);
  const releaseMs=Date.parse('2026-09-24T00:00:00.000Z');
  const target=(court:number,hour:string)=>court===7&&hour==='18:00';
  const cells=[1,2,3,4,5,6,7].flatMap(court=>hours.map(hour=>({court,hour,state:target(court,hour)?'TAKEN':'OPEN',record:target(court,hour),first:'OPEN',firstPrice:Number(hour.slice(0,2))>=16?700:600,
    ...(target(court,hour)?{changedSinceReleaseMs:790}:{})})));
  const r2={seq:2,requestOffsetMs:250,responseOffsetMs:290},r3={seq:3,requestOffsetMs:500,responseOffsetMs:790};
  const timeline=[{kind:'published',court:0,hour:'',openCount:112,unavailableCount:0,unknownCount:0,before:{seq:1,requestOffsetMs:-2000,responseOffsetMs:-1800},after:r2,overlapping:false},
    {kind:'state',court:7,hour:'18:00',from:'OPEN',to:'UNAVAILABLE',before:r2,after:r3,overlapping:false}];
  const page=await renderer({slotWatch:{id:'w1',date:'2026-09-26',releaseMs,status:'watching',startedAt:'2026-09-23T23:59:00.000Z',endsAtMs:releaseMs+900000,polls:3,failedPolls:0,
    inFlight:1,maxInFlight:6,notLaunched:0,publication:{lastUnpublished:{seq:1,requestOffsetMs:-2000,responseOffsetMs:-1800},firstPublished:r2,firstPublishedResponse:r2},current:r3,
    lastPollAt:'2026-09-24T00:00:00.790Z',lastLatencyMs:40,dateReleased:true,cells,timeline,logPath:'C:\\bot\\.local\\slot-watch\\2026-09-26_w1.ndjson'},
    releaseForensics:[{runId:'run-1',date:'2026-09-26',reference:'release',referenceMs:releaseMs,status:'final',generatedAt:'2026-09-24T00:15:01.000Z',
      firstPostOffsetMs:3.4,lastPostOffsetMs:5.1,firstPublished:r2,traceAvailable:true,outcome:'OBJECTIVE_NOT_ACHIEVED_ALL_REJECTED',
      targets:[{workerId:'A',court:3,startTime:'15:00',endTime:'18:00',postOffsetMs:3.4,firstPublishedState:'FULLY OPEN',statusCode:409,errorHint:'availability',finalState:'REJECTED',
        headersOffsetMs:17483.4,bodyOffsetMs:17544,protocol:'h2',reused:true}],reportPath:'C:\\bot\\.local\\release-forensics\\run-1\\report.txt'}]});
  expect(await page.locator('#status-watch-text').innerText()).toContain('Watching · 3 reads');
  await page.locator('#status-watch').click();
  expect(await page.locator('#view-live').isVisible()).toBe(true);
  const taken=page.locator('#slot-watch-matrix td.slot-taken');
  expect(await taken.count()).toBe(1);
  expect(await taken.getAttribute('title')).toBe('Court 7 · 6:00 PM · now: Unavailable · public booking record · first published: Open · PHP 700 · last change seen in a read answered +0.790 s after release');
  expect(await page.locator('#slot-watch-meta').innerText()).toContain('1 of 6');
  const facts=await page.locator('#slot-watch-summary').innerText();
  expect(facts).toContain('#2 req +0.250 s → resp +0.290 s');
  expect(facts).toContain('#1 req −2.000 s → resp −1.800 s');
  const rows=await page.locator('#slot-watch-timeline .slot-event').allInnerTexts();
  expect(rows[0]).toContain('Schedule published');
  expect(rows[1]).toContain('req +0.500 s');
  expect(rows[1]).toContain('Open → Unavailable');
  expect(rows[1]).toContain('between #2 req +0.250 s → resp +0.290 s and #3 req +0.500 s → resp +0.790 s');
  const text=await page.locator('#view-live').innerText();
  expect(text).not.toMatch(/venue block|bot hold|admin block|likely|how fast it was taken|Taken/);
  // The first published grid: court 7 at 6 PM was open then.
  await page.locator('#slot-matrix-mode button[data-mode="first"]').click();
  expect(await page.locator('#slot-watch-matrix td.slot-taken').count()).toBe(0);
  expect(await page.locator('#slot-matrix-mode button[data-mode="first"]').getAttribute('aria-pressed')).toBe('true');
  expect(await page.locator('#stop-slot-watch').isVisible()).toBe(true);
  expect(await page.locator('#watch-next-release').isVisible()).toBe(false);
  // Runs: concise forensic card; raw detail stays in the local report.
  await showRendererView(page,'history');
  await page.locator('.history-forensics').evaluate(element=>element.setAttribute('open',''));
  const card=page.locator('#release-forensics-list .forensic-item');
  expect(await card.count()).toBe(1);
  const summary=await card.locator('summary').innerText();
  expect(summary).toContain('FINAL');
  expect(summary).toContain('First POST +0.003 s · last POST +0.005 s · first published grid #2 req +0.250 s → resp +0.290 s · provider trace available');
  await card.locator('summary').click();
  expect(await card.locator('.forensic-target').innerText()).toBe('Worker A · Court 3 · 15:00–18:00 · POST +0.003 s · first published FULLY OPEN · HTTP 409 availability · headers +17.483 s · body +17.544 s · h2 reused');
  expect(await card.locator('.forensic-path').innerText()).toContain('release-forensics');
  await page.close();
});

it('hides an expired payment hold from the QR summary instead of showing it as active',async()=>{
  const qrHandoffs=[
    {checkout:'A',status:'qr-ready',courts:[7],date:'2026-09-24',startTime:'10:00',endTime:'11:00',amount:1200,verifiedAt:'2026-09-22T00:00:03.000Z',holdExpiresAt:new Date(Date.now()-1000).toISOString()}
  ];
  const playerStatus={primary:true,extended:false,third:false,fourth:false,
    primaryDetails:{fullName:'Primary Fixture',email:'primary@example.invalid',phone:'09123456789'}};
  const page=await renderer({headline:'PAYMENT HOLD ACTIVE',detail:'A previous payment hold is recorded.',qrHandoffs,playerStatus,workflow:'test'});
  await showRendererView(page,'tests');
  await page.evaluate(()=>{const w=window as any;w.fixturePublish(w.fixtureState);});
  expect(await page.locator('#qr-summary-test').isVisible()).toBe(false);
  expect(await page.locator('#test-headline').innerText()).not.toBe('CONFIRM BOOKING DETAILS BEFORE PAYING');
  await page.close();
});

it('shows Precision targets, the independent-attempt warning and per-target race status',async()=>{
  const precisionBooking=bookingView(ConfigSchema.parse({...defaultSetup,BOOKING_METHOD:'proofless',DURATION_HOURS:3,RELEASE_STRATEGY:'precision',
    PRECISION_TARGETS:[{court:7,start:'17:00',durationHours:3},{court:5,start:'17:00',durationHours:3}],
    PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'}));
  const page=await renderer({booking:precisionBooking,precision:{frozen:true,frozenCount:2,outcome:'OBJECTIVE_ACHIEVED',targets:[
    {workerId:'A',court:7,startTime:'17:00',endTime:'20:00',durationHours:3,evidence:'NO_PUBLIC_BOOKING_DATE_UNRELEASED',eligible:true,state:'QR_READY',bookingNo:'BK-1'},
    {workerId:'B',court:5,startTime:'17:00',endTime:'20:00',durationHours:3,evidence:'NO_PUBLIC_BOOKING_DATE_UNRELEASED',eligible:true,state:'PREWARM_FAILED'}]}});
  expect(await page.locator('#precision-panel').isVisible()).toBe(true);
  const table=await page.locator('#precision-table').innerText();
  expect(table).toContain('Worker A · Court 7 · 17:00–20:00');
  expect(table).toContain('No known booking · target date not yet published');
  expect(table).toContain('HOLD VERIFIED · QR READY');
  expect(table).toContain('NOT DISPATCHED — PREWARM FAILED');
  expect(await page.locator('#saved-plan-summary').innerText()).toContain('PRECISION RELEASE');
  await showRendererView(page,'plan');
  expect(await page.locator('#precision-strategy').inputValue()).toBe('precision');
  expect(await page.locator('#precision-setup').isVisible()).toBe(true);
  expect(await page.locator('#precision-row-1').isVisible()).toBe(true);
  expect(await page.locator('#precision-row-2').isVisible()).toBe(false);
  expect(await page.locator('#precision-court-1').inputValue()).toBe('5');
  expect(await page.locator('#court-order').isVisible()).toBe(true);
  expect(await page.locator('#booking-method').isDisabled()).toBe(true);
  expect(await page.locator('.precision-warning').innerText()).toBe('These are independent checkout attempts. More than one temporary QR hold may be created. Payment remains manual.');
  await page.close();
});

it('shows up to seven Precision rows (A-G) and a seven-worker status panel',async()=>{
  const seven=[1,2,3,4,5,6,7].map(court=>({court,start:'17:00',durationHours:3}));
  const precisionBooking=bookingView(ConfigSchema.parse({...defaultSetup,BOOKING_METHOD:'proofless',DURATION_HOURS:3,RELEASE_STRATEGY:'precision',PRECISION_TARGETS:seven,
    PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'}));
  const states=['QR_READY','REJECTED','PREWARM_FAILED','QR_READY','REJECTED','UNKNOWN','REJECTED'];
  const page=await renderer({booking:precisionBooking,precision:{frozen:true,frozenCount:6,outcome:'OBJECTIVE_ACHIEVED_UNRESOLVED_EXTRA_ATTEMPT',
    targets:seven.map((t,i)=>({workerId:'ABCDEFG'[i],court:t.court,startTime:'17:00',endTime:'20:00',durationHours:3,evidence:'NO_PUBLIC_BOOKING_DATE_UNRELEASED',eligible:true,state:states[i]}))}});
  const lines=await page.locator('#precision-table .precision-line').allInnerTexts();
  expect(lines).toHaveLength(7);
  expect(lines[6]).toContain('Worker G · Court 7 · 17:00–20:00');
  expect(lines[2]).toContain('NOT DISPATCHED — PREWARM FAILED');
  expect(lines[5]).toContain('UNKNOWN');
  expect(await page.locator('#saved-plan-summary').innerText()).toContain('Worker G · Court 7');
  await showRendererView(page,'plan');
  expect(await page.locator('#precision-count').inputValue()).toBe('7');
  expect(await page.locator('#precision-count option').count()).toBe(7);
  for(let i=0;i<7;i++)expect(await page.locator('#precision-row-'+i).isVisible()).toBe(true);
  expect(await page.locator('#precision-court-6').inputValue()).toBe('7');
  await page.locator('#precision-count').selectOption('4');
  expect(await page.locator('#precision-row-3').isVisible()).toBe(true);
  expect(await page.locator('#precision-row-4').isVisible()).toBe(false);
  expect(await page.locator('.precision-warning').innerText()).toBe('These are independent checkout attempts. More than one temporary QR hold may be created. Payment remains manual.');
  await page.close();
});

it('marks a duplicate-identity Precision worker as not dispatching while the others stay listed',async()=>{
  const precisionBooking=bookingView(ConfigSchema.parse({...defaultSetup,BOOKING_METHOD:'proofless',DURATION_HOURS:3,RELEASE_STRATEGY:'precision',
    PRECISION_TARGETS:[{court:7,start:'17:00',durationHours:3},{court:5,start:'17:00',durationHours:3},{court:3,start:'17:00',durationHours:3}],
    PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'}));
  const page=await renderer({booking:precisionBooking,identityIssues:['Worker B — customer identity invalid: duplicates Worker A. Worker B will not dispatch; the other valid Precision attempts remain usable.'],
    precision:{frozen:false,targets:[
      {workerId:'A',court:7,startTime:'17:00',endTime:'20:00',durationHours:3,evidence:'NO_PUBLIC_BOOKING_DATE_UNRELEASED',eligible:true},
      {workerId:'B',court:5,startTime:'17:00',endTime:'20:00',durationHours:3,state:'IDENTITY_FAILED',code:'DUPLICATE_ONDA_CUSTOMER_ID',duplicateOf:'A'},
      {workerId:'C',court:3,startTime:'17:00',endTime:'20:00',durationHours:3,evidence:'NO_PUBLIC_BOOKING_DATE_UNRELEASED',eligible:true}]}});
  const lines=await page.locator('#precision-table .precision-line').allInnerTexts();
  expect(lines[1]).toContain('NOT DISPATCHED — IDENTITY FAILED: duplicate Onda customer ID (duplicates Worker A)');
  expect(lines[0]).toContain('Awaiting release');
  expect(lines[2]).toContain('Awaiting release');
  expect(await page.locator('#precision-summary').innerText()).toContain('Worker B — customer identity invalid: duplicates Worker A');
  await page.close();
});
