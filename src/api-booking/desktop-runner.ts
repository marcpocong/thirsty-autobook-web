import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { mkdir, open } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { chromium, type Browser, type Page } from 'playwright';
import { z } from 'zod';
import { ONDA_URL, VENUE, loadConfig, planFingerprint } from '../config.js';
import { browserIdentity, verifyDedicatedChromeAsync } from '../browser.js';
import { emitUiEvent } from '../ui-events.js';
import { discoverApiAvailability } from './availability-engine.js';
import { OndaLiveAvailabilityProvider, THIRSTY_PICKLE_FACILITY_ID } from './live-availability-provider.js';
import { parseAvailability, COURT_TO_SPACE_ID } from './availability-parser.js';
import { DurableSubmissionJournal } from './durable-submission-journal.js';
import { loadLocalCheckoutCustomer } from './local-customer.js';
import { submitCalendarFreeTwoHourCheckout } from './calendar-free-checkout.js';
import { officialCheckoutUrl } from './checkout-restoration.js';
import type { AvailabilitySnapshot, BookingPlan, BookingPreferences } from './types.js';
import { OndaBrowserSessionTransport, type CheckoutHttpResponse } from './browser-session-transport.js';
import { calendarFreeSecurityContext } from './calendar-free-security-context.js';
import { firstUnjournaledAvailableCandidate } from './candidate-journal.js';
import { standardCheckoutChunks } from './extended-checkout.js';
import { observedResponse, standardPlanJournalKeys } from './two-hour-reservation.js';
import { checkoutDiagnostic } from './checkout-diagnostics.js';
import { ApiRunProgressLog } from './run-progress-log.js';
import { ApiAutomationLock } from './api-automation-lock.js';
import { assertApiReleaseFresh } from './api-release.js';
import { canReleaseApiLockAfterParallelFailure } from './api-lock-outcome.js';
import { requiredWorkerIds, type WorkerId } from '../workers.js';
import { SubmissionDispatchError } from './submission-errors.js';
import { SPECIAL_SESSION_MODE, SPECIAL_SESSION_WORKERS, SPECIAL_SESSION_REQUIRED_WORKERS, specialSessionCourtAssignment,
  specialSessionPlans } from './special-session.js';
import { assertDirectDispatchWindow, chooseDirectCourt, DIRECT_COURT_PRIORITY, directPlan, submitDirectCheckout } from './special-direct-checkout.js';

const preferencesSchema = z.object({ strategy: z.enum(['standard', 'extended']), date: z.iso.date(), start: z.string().regex(/^(0[89]|1\d|2[0-3]):00$/),
  duration: z.number().int().min(1).max(6), courtCount: z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4),z.literal(5),z.literal(6),z.literal(7)]), maximum: z.number().optional(),
  priority: z.array(z.number().int().min(1).max(7)).min(1),
  fallbackStarts: z.array(z.string().regex(/^(0[89]|1\d|2[0-3]):00$/)),
  exact: z.array(z.array(z.number().int().min(1).max(7))).optional() }).strict();
const command = z.object({ mode: z.enum(['prepare', 'dry', 'live', 'live-now']), date: z.iso.date(),
  releaseMs: z.number().int().positive().optional(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  preferences: preferencesSchema.optional() }).strict().parse(JSON.parse(process.argv[2] ?? '{}'));
const abort = new AbortController();
process.on('message', message => { if ((message as { type?: string })?.type === 'abort') abort.abort(); });
const started = performance.now();
const SECURITY_PREWARM_LEAD_MS=8_000;
const SPECIAL_RELEASE_GUARD_MS=11_000;
const SPECIAL_VERSION_POLL_MS=1_000;
const SPECIAL_AVAILABILITY_POLL_MS=5_000;
const SPECIAL_SIGNAL_AVAILABILITY_POLL_MS=2_000;
const SPECIAL_SIGNAL_BURST_MS=15_000;
const SPECIAL_SIGNAL_BURST_POLL_MS=500;
const stamp = () => Math.round(performance.now() - started);
const progressLog = new ApiRunProgressLog(command.mode, command.date);
const stage = (name: string, extra: Record<string, string | number | boolean> = {}) => {
  const entry = progressLog.record(name, new Date().toISOString(), stamp(), extra);
  emitUiEvent({ type: 'apiStage', stage: name, at: entry.at, elapsedMs: entry.elapsedMs,
    sincePreviousMs: entry.sincePreviousMs, ...(name === 'RUN_STARTED' ? { runId: progressLog.runId } : {}), ...extra });
};
// High-frequency forensic evidence stays in the append-only local trace and
// does not flood the operator UI or Previous Runs activity list.
const trace = (name: string, extra: Record<string, string | number | boolean> = {}) =>
  progressLog.record(name, new Date().toISOString(), stamp(), extra);
stage('RUN_STARTED');
const ensureActive = () => { if (abort.signal.aborted) throw Error('USER_ABORT'); };
const pause = (ms: number) => new Promise<void>((done, fail) => {
  if(abort.signal.aborted){fail(Error('USER_ABORT'));return;}
  const onAbort=()=>{clearTimeout(timer);fail(Error('USER_ABORT'));};
  const timer=setTimeout(()=>{abort.signal.removeEventListener('abort',onAbort);done();},ms);
  abort.signal.addEventListener('abort',onAbort,{once:true});
});
const saveOnce = async (directory: string, filename: string, content: unknown) => {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = await open(join(directory, filename), 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(content)); await file.sync(); }
  finally { await file.close(); }
};
const sanitizedCheckoutCapture=(response:CheckoutHttpResponse)=>{
  let parsed:unknown;
  try{parsed=JSON.parse(response.body);}catch{}
  return {capturedAt:new Date().toISOString(),status:response.status,contentType:response.contentType,
    diagnostic:checkoutDiagnostic(response),observed:observedResponse(parsed,'RESPONSE_CAPTURED')};
};
const connectedBrowsers: Browser[] = [];
let liveLock:ApiAutomationLock|undefined,retainLiveLock=false,verifiedHold=false;
let latestVerifiedHoldExpiry:string|undefined;
let directTask:Promise<void>|undefined;
async function showWindow(page: import('playwright').Page): Promise<void> {
  const session = await page.context().newCDPSession(page);
  try {
    const { windowId, bounds } = await session.send('Browser.getWindowForTarget');
    if (bounds.windowState === 'minimized')
      await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  } finally { await session.detach(); }
  await page.bringToFront();
}
interface WorkerSession { workerId:WorkerId; browser: Browser; page: Page; port: number }
async function prepareWorker(workerId:WorkerId): Promise<WorkerSession> {
  const identity = browserIdentity(workerId);
  stage('PREPARING_BROWSER', { workerId });
  try { await verifyDedicatedChromeAsync(identity); }
  catch(error){
    if(!(error instanceof Error)||error.message!=='CDP_NOT_LISTENING')throw error;
    await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      resolve('scripts/start-onda-chrome.ps1'), '-Worker', workerId, '-Port', String(identity.port)],
    { cwd: process.cwd(), windowsHide: true, timeout: 30_000 });
    // The starter exits successfully only after verifying the new listener,
    // Chrome process, port, and exact dedicated profile.
  }
  const browser = await chromium.connectOverCDP(identity.cdpUrl);
  connectedBrowsers.push(browser);
  const context = browser.contexts()[0];
  if (!context) throw Error('API_BROWSER_CONTEXT_MISSING');
  const matchingPages = context.pages().filter(candidate => candidate.url() === ONDA_URL);
  const page = matchingPages[0] ?? await context.newPage();
  await Promise.all(matchingPages.slice(1).map(duplicate => duplicate.close().catch(() => undefined)));
  if (page.url() !== ONDA_URL) await page.goto(ONDA_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.getByTestId('public-booking-hero-title').first().waitFor({ state: 'visible', timeout: 45_000 });
  if ((await page.getByTestId('public-booking-hero-title').first().innerText()).trim() !== VENUE) throw Error('WRONG_VENUE');
  await showWindow(page);
  stage('BROWSER_READY', { workerId, port: identity.port });
  return { workerId, browser, page, port: identity.port };
}

async function readSpecialSnapshot(date:string):Promise<AvailabilitySnapshot|undefined>{
  ensureActive();
  const requestedAt=performance.now();
  try{
    const provider=new OndaLiveAvailabilityProvider({allowIncompleteRange:true});
    const envelope=await provider.getAvailability({startDate:date,endDate:date});
    const snapshot=parseAvailability(envelope.raw,{startDate:date,endDate:date,capturedAt:envelope.capturedAt,
      fixtureKind:envelope.fixtureKind,label:envelope.label,now:new Date(),maximumAgeMs:15_000,requireCompleteRange:false});
    trace('SPECIAL_AVAILABILITY_SAMPLE',{durationMs:Math.round(performance.now()-requestedAt),
      dateReturned:snapshot.returnedDates[date]===true,slotCount:snapshot.slots.length,
      availableCount:snapshot.slots.filter(slot=>slot.date===date&&slot.isAvailable).length});
    return snapshot;
  }catch(error){
    const code=error instanceof Error&&/^[A-Z][A-Z0-9_]{0,79}$/.test(error.message)
      ?error.message:'SPECIAL_AVAILABILITY_READ_FAILED';
    trace('SPECIAL_AVAILABILITY_SAMPLE',{durationMs:Math.round(performance.now()-requestedAt),
      dateReturned:false,slotCount:0,availableCount:0,code});
    return;
  }
}

async function readOndaVersion():Promise<string|undefined>{
  const requestedAt=performance.now();
  try{
    const response=await fetch('https://app.onda.fit/version.json',{headers:{Accept:'application/json'},
      redirect:'error',signal:AbortSignal.timeout(2500),cache:'no-store'});
    if(!response.ok||!response.headers.get('content-type')?.toLowerCase().includes('application/json')){
      trace('SPECIAL_VERSION_SAMPLE',{durationMs:Math.round(performance.now()-requestedAt),ok:false,status:response.status});return;
    }
    const value=await response.json() as {version?:unknown};
    const version=typeof value.version==='string'&&value.version.length<=160?value.version:undefined;
    trace('SPECIAL_VERSION_SAMPLE',{durationMs:Math.round(performance.now()-requestedAt),ok:!!version,
      status:response.status,...(version?{version}:{})});
    return version;
  }catch{trace('SPECIAL_VERSION_SAMPLE',{durationMs:Math.round(performance.now()-requestedAt),ok:false,status:0});return;}
}

async function readKnownDirectCourtBlocks(date:string):Promise<number[]>{
  const results=await Promise.all(DIRECT_COURT_PRIORITY.map(async court=>{
    const spaceId=COURT_TO_SPACE_ID[court];
    try{
      const url=new URL('/api/public/spaces/bookings','https://app.onda.fit');
      url.searchParams.set('spaceIds',spaceId);url.searchParams.set('date',date);
      const response=await fetch(url,{headers:{Accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(2500)});
      if(!response.ok)return false;
      const value=await response.json() as {data?:Record<string,Array<{date?:string;startTime?:string;endTime?:string}>>};
      return (value.data?.[spaceId]??[]).some(booking=>booking.date===date&&
        typeof booking.startTime==='string'&&typeof booking.endTime==='string'&&
        booking.startTime.slice(0,5)<'22:00'&&booking.endTime.slice(0,5)>'17:00');
    }catch{trace('DIRECT_BLOCK_READ_FAILED',{court});return false;}
  }));
  return DIRECT_COURT_PRIORITY.filter((_,index)=>results[index]);
}

async function updateNotificationVisible(sessions:readonly WorkerSession[]):Promise<boolean>{
  const observations=await Promise.allSettled(sessions.map(async({page})=>
    await page.getByText('Update available',{exact:true}).first().isVisible().catch(()=>false)));
  return observations.some(result=>result.status==='fulfilled'&&result.value);
}

function plansInWorkerOrder(plans:Map<WorkerId,BookingPlan>,workers:readonly WorkerId[]):BookingPlan[]{
  return workers.map(worker=>{const plan=plans.get(worker);if(!plan)throw Error('SPECIAL_SESSION_PLAN_MISSING');return plan;});
}
try {
  if (process.env.THIRSTY_API_INSTALLATION !== '1' && process.env.THIRSTY_API_TEST_INSTALLATION !== '1') throw Error('API_INSTALLATION_REQUIRED');
  const config = loadConfig();
  const requested = command.preferences;
  const specialSession=!requested&&config.SESSION_MODE===SPECIAL_SESSION_MODE;
  stage('RUN_CONFIGURATION',{sessionMode:config.SESSION_MODE,bookingMethod:config.BOOKING_METHOD,
    workerCount:specialSession?SPECIAL_SESSION_REQUIRED_WORKERS.length:requiredWorkerIds(config.BOOKING_TYPE,config.COURT_COUNT).length,
    ...(command.releaseMs?{releaseMs:command.releaseMs}:{})});
  if(specialSession&&!['prepare','live'].includes(command.mode))throw Error('SPECIAL_SESSION_RELEASE_ONLY');
  if(specialSession&&new Date(`${command.date}T12:00:00Z`).getUTCDay()!==5)throw Error('SPECIAL_SESSION_TARGET_NOT_FRIDAY');
  const strategy = requested?.strategy ?? config.BOOKING_TYPE;
  const duration = requested?.duration ?? config.DURATION_HOURS;
  const courtCount = requested?.courtCount ?? config.COURT_COUNT;
  if (!command.preferences && config.BOOKING_METHOD !== 'api-first') throw Error('API_FIRST_METHOD_REQUIRED');
  if (strategy === 'standard' && (duration < 1 || duration > 3) ||
    strategy === 'extended' && (duration < 4 || duration > 6) || ![1,2,3,4,5,6,7].includes(courtCount))
    throw Error('API_FIRST_COURT_COUNT_UNSUPPORTED');
  if (!command.preferences && command.fingerprint !== planFingerprint(config)) throw Error('API_PLAN_CHANGED');
  if ((command.mode === 'live' || command.mode === 'live-now') && process.env.ONDA_API_FIRST_LIVE !== 'ARMED')
    throw Error('API_LIVE_NOT_ARMED');
  if (command.mode === 'live' && !command.releaseMs) throw Error('API_RELEASE_TIME_REQUIRED');
  const workerIds:WorkerId[]=specialSession?[...SPECIAL_SESSION_REQUIRED_WORKERS]:requiredWorkerIds(strategy,courtCount);
  if(command.mode==='live'||command.mode==='live-now')liveLock=await ApiAutomationLock.acquire(strategy,workerIds);
  const customers:Partial<Record<WorkerId,ReturnType<typeof loadLocalCheckoutCustomer>>>|undefined=command.mode==='dry'?undefined:
    Object.fromEntries(workerIds.map(worker=>[worker,loadLocalCheckoutCustomer(worker)]));
  // The dedicated profiles are independent. Wait for both checks to settle so
  // a failure in one browser cannot leave an unobserved preparation running.
  const prepared=await Promise.allSettled(workerIds.map(prepareWorker));
  const failure=prepared.find((result):result is PromiseRejectedResult=>result.status==='rejected');
  if(failure)throw failure.reason;
  const sessions=prepared.map(result=>{if(result.status!=='fulfilled')throw Error('API_BROWSER_PREPARATION_FAILED');return result.value;});
  if (command.mode === 'prepare') { process.exitCode = 0; }
  else {
    if(command.mode==='live'||command.mode==='live-now'){
      process.env.ONDA_CALENDAR_FREE_CHECKOUT='APPROVED_ONE_SHOT';
      process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT='SUPERVISED_ONE_SHOT';
    }
    const responseCaptures=new Map<WorkerId,(response:CheckoutHttpResponse)=>Promise<void>>();
    const releaseTransports=new Map<WorkerId,OndaBrowserSessionTransport>();
    if(command.mode==='live')for(const session of sessions){
      const workerId=session.workerId;
      releaseTransports.set(workerId,new OndaBrowserSessionTransport(session.page,
        ()=>calendarFreeSecurityContext(session.page)(),
        response=>responseCaptures.get(workerId)?.(response)??Promise.reject(Error('CHECKOUT_RESPONSE_CAPTURE_MISSING')),
        {onHumanVerificationRequired:async()=>{
          await session.page.evaluate(id=>{document.title=`THIRSTY BOT ${id} - VERIFY HERE`;},workerId);
          await showWindow(session.page);stage('HUMAN_VERIFICATION_REQUIRED',{workerId});
        },onHumanVerificationCompleted:async()=>{stage('HUMAN_VERIFICATION_COMPLETE',{workerId});}}));
    }
    let specialPlansAtTrigger:Map<WorkerId,BookingPlan>|undefined;
    let specialSnapshotAtTrigger:AvailabilitySnapshot|undefined;
    let specialTriggeredEarly=false;
    let warmup:Promise<PromiseSettledResult<void>[]>|undefined;
    let warmupStartedAt:number|undefined;
    const startWarmup=(workers:readonly WorkerId[]=workerIds)=>{
      if(warmup)return;
      warmupStartedAt=Date.now();
      stage('SECURITY_PREWARM_STARTED');
      warmup=Promise.allSettled(workers.map(async workerId=>{
        const transport=releaseTransports.get(workerId);if(!transport)throw Error('API_CHECKOUT_WORKER_MISSING');
        await transport.prepareCheckoutContext();stage('SECURITY_PREWARM_READY',{workerId});
      }));
    };
    const finishWarmup=async(retryOnce=false)=>{
      if(!warmup)return;
      let results=await warmup;
      let failure=results.find((result):result is PromiseRejectedResult=>result.status==='rejected');
      if(failure&&retryOnce){
        warmup=undefined;warmupStartedAt=undefined;startWarmup();results=await warmup!;
        failure=results.find((result):result is PromiseRejectedResult=>result.status==='rejected');
      }
      if(failure)throw failure.reason;
    };
    if (command.mode === 'live'&&specialSession) {
      const releaseMs = command.releaseMs!;
      if (releaseMs <= Date.now()) throw Error('RELEASE_MISSED');
      stage('WAITING_FOR_RELEASE', { releaseMs });
      const watchAt=releaseMs-10*60_000;
      while(Date.now()<watchAt){ensureActive();await pause(Math.min(30_000,watchAt-Date.now()));}
      stage('SPECIAL_AVAILABILITY_WATCHING');
      const [initialDirectSnapshot,knownBlocked]=await Promise.all([readSpecialSnapshot(command.date),readKnownDirectCourtBlocks(command.date)]);
      const directCourt=chooseDirectCourt(initialDirectSnapshot,knownBlocked);
      if(directCourt){
        const directPlans=(['E','F'] as const).map(workerId=>({workerId,...directPlan(command.date,directCourt,workerId,initialDirectSnapshot)}));
        const directTotal=directPlans.reduce((sum,item)=>sum+item.plan.totalPrice,0);
        stage('DIRECT_LANE_PREPARED',{court:directCourt,rateSource:directPlans[0]!.rateSource,
          ...(directPlans[0]!.rateSource==='UNVERIFIED_PRIOR_RATE'?{assumedPrice:directTotal}:{price:directTotal})});
        directTask=(async()=>{
          let directWarmup:Promise<PromiseSettledResult<void>[]>|undefined;
          const warmDirect=()=>directWarmup??=Promise.allSettled((['E','F'] as const).map(async worker=>{
            const transport=releaseTransports.get(worker);if(!transport)throw Error('DIRECT_WORKER_MISSING');
            await transport.prepareCheckoutContext();stage('DIRECT_SECURITY_READY',{workerId:worker});
          }));
          while(Date.now()<releaseMs){ensureActive();const remaining=releaseMs-Date.now();
            if(remaining<=SECURITY_PREWARM_LEAD_MS)startWarmup();
            if(remaining<=5_000)warmDirect();
            await pause(Math.min(250,Math.max(1,remaining),warmup?250:Math.max(1,remaining-SECURITY_PREWARM_LEAD_MS)));}
          assertApiReleaseFresh(releaseMs);
          if((await warmDirect()).some(result=>result.status==='rejected'))throw Error('DIRECT_SECURITY_PREWARM_FAILED');
          ensureActive();assertDirectDispatchWindow(releaseMs);
          await liveLock?.dispatching();retainLiveLock=true;
          stage('DIRECT_LANE_DISPATCHING',{court:directCourt,rateSource:directPlans[0]!.rateSource});
          const results=await Promise.allSettled(directPlans.map(async({workerId,plan})=>{
            const session=sessions.find(value=>value.workerId===workerId),customer=customers?.[workerId],transport=releaseTransports.get(workerId);
            if(!session||!customer||!transport)throw Error('DIRECT_WORKER_MISSING');
            const key=DurableSubmissionJournal.key(THIRSTY_PICKLE_FACILITY_ID,plan.courts[0]!.spaceId,command.date,plan.startTime,plan.endTime);
            const directory=resolve('.local/api-booking/api-first-journals',key);
            let token:string|undefined,bookingNo:string|undefined;
            responseCaptures.set(workerId,async response=>{
              await saveOnce(directory,'checkout-response-private.json',sanitizedCheckoutCapture(response));
              try{const value=JSON.parse(response.body) as {bookings?:Array<{booking_no?:string;checkoutToken?:string}>};
                bookingNo=value.bookings?.[0]?.booking_no;token=value.bookings?.[0]?.checkoutToken;}catch{}
            });
            const startedAt=performance.now();
            const hold=await submitDirectCheckout(plan,customer,transport,new DurableSubmissionJournal(directory),releaseMs);
            verifiedHold=true;retainLiveLock=true;
            if(!latestVerifiedHoldExpiry||Date.parse(hold.holdExpiresAt)>Date.parse(latestVerifiedHoldExpiry))latestVerifiedHoldExpiry=hold.holdExpiresAt;
            stage('PENDING_HOLD',{workerId,court:directCourt,date:command.date,startTime:plan.startTime,durationHours:plan.durationHours,
              bookingId:hold.bookingIds[0]!,bookingNo:bookingNo??'',holdExpiresAt:hold.holdExpiresAt,price:plan.totalPrice,
              workerElapsedMs:Math.round(performance.now()-startedAt)});
            if(!token||!bookingNo)throw Error('OFFICIAL_CHECKOUT_TOKEN_MISSING');
            const grant=await session.page.evaluate(async({bookingNo,token})=>{const url=new URL(`/api/public/bookings/booking-no/${encodeURIComponent(bookingNo)}`,location.origin);
              url.searchParams.set('checkoutToken',token);url.searchParams.set('grantCheckoutAccess','1');
              return (await fetch(url,{credentials:'include',cache:'no-store'})).status;},{bookingNo,token});
            if(grant!==200)throw Error('OFFICIAL_CHECKOUT_ACCESS_FAILED');
            await session.page.goto(officialCheckoutUrl(hold.bookingIds[0]!),{waitUntil:'domcontentloaded',timeout:45_000});
            await session.page.getByText('QRPH',{exact:true}).first().waitFor({state:'visible',timeout:20_000});
            const body=await session.page.locator('body').innerText();
            if(!body.includes('Pending')||!body.replaceAll(',','').includes(plan.totalPrice.toFixed(2)))throw Error('OFFICIAL_CHECKOUT_STATE_MISMATCH');
            await showWindow(session.page);
            stage('OFFICIAL_QRPH_HANDOFF',{workerId,court:directCourt,date:command.date,startTime:plan.startTime,
              durationHours:plan.durationHours,bookingId:hold.bookingIds[0]!,bookingNo,holdExpiresAt:hold.holdExpiresAt,
              price:plan.totalPrice,workerElapsedMs:Math.round(performance.now()-startedAt)});
            return hold;
          }));
          const successful=results.filter((result):result is PromiseFulfilledResult<import('./public-checkout.js').VerifiedPublicCheckout>=>result.status==='fulfilled');
          if(successful.length){const newest=successful.map(result=>result.value.holdExpiresAt).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]!;
            if(!latestVerifiedHoldExpiry||Date.parse(newest)>Date.parse(latestVerifiedHoldExpiry))latestVerifiedHoldExpiry=newest;}
          if(latestVerifiedHoldExpiry)await liveLock?.held(latestVerifiedHoldExpiry);
          results.forEach((result,index)=>stage('DIRECT_WORKER_OUTCOME',{workerId:directPlans[index]!.workerId,status:result.status,
            code:result.status==='fulfilled'?'COMPLETED':result.reason instanceof Error&&/^[A-Z][A-Z0-9_]{0,79}$/.test(result.reason.message)?result.reason.message:'DIRECT_WORKER_FAILED'}));
        })().catch(error=>{retainLiveLock=true;stage('DIRECT_LANE_FAILED',{code:error instanceof Error&&/^[A-Z][A-Z0-9_]{0,79}$/.test(error.message)?error.message:'DIRECT_LANE_FAILED'});});
      }else stage('DIRECT_LANE_SKIPPED',{code:'NO_THIRD_COURT_AVAILABLE'});
      let observedVersion=await readOndaVersion();
      let nextVersionAt=Date.now(),nextAvailabilityAt=Date.now();
      let releaseSignalSeen=false,signalBurstUntil=0;
      while (Date.now() < releaseMs) {
        ensureActive();
        const remaining=releaseMs-Date.now();
        // Do not let a final pre-release GET overlap and delay the official
        // release fetch. The live provider has a ten-second timeout.
        if(remaining<=SPECIAL_RELEASE_GUARD_MS){
          if(warmup&&warmupStartedAt!==undefined&&Date.now()-warmupStartedAt>90_000){
            await finishWarmup(true);warmup=undefined;warmupStartedAt=undefined;
          }
          startWarmup();await pause(Math.max(1,releaseMs-Date.now()));break;
        }
        const loopStarted=Date.now();
        const checkVersion=loopStarted>=nextVersionAt,checkAvailability=loopStarted>=nextAvailabilityAt;
        const [version,notification,snapshot]=await Promise.all([
          checkVersion?readOndaVersion():Promise.resolve(undefined),
          updateNotificationVisible(sessions),
          checkAvailability?readSpecialSnapshot(command.date):Promise.resolve(undefined),
        ]);
        const versionChanged=!!version&&!!observedVersion&&version!==observedVersion;
        if((versionChanged||notification)&&!releaseSignalSeen){
          releaseSignalSeen=true;signalBurstUntil=Date.now()+SPECIAL_SIGNAL_BURST_MS;
          stage(notification?'SPECIAL_UPDATE_NOTIFICATION_OBSERVED':'SPECIAL_VERSION_CHANGE_OBSERVED');
          startWarmup();
          if(!checkAvailability)nextAvailabilityAt=0;
        }
        if(version)observedVersion=version;
        if(checkVersion)nextVersionAt=loopStarted+SPECIAL_VERSION_POLL_MS;
        if(checkAvailability){
          const interval=!releaseSignalSeen?SPECIAL_AVAILABILITY_POLL_MS:
            Date.now()<signalBurstUntil?SPECIAL_SIGNAL_BURST_POLL_MS:SPECIAL_SIGNAL_AVAILABILITY_POLL_MS;
          nextAvailabilityAt=loopStarted+interval;
        }
        const plans=snapshot?specialSessionPlans(snapshot,SPECIAL_SESSION_WORKERS,undefined,directCourt?[directCourt]:[]):undefined;
        if(plans){specialPlansAtTrigger=plans;specialSnapshotAtTrigger=snapshot;specialTriggeredEarly=Date.now()<releaseMs;
          const assigned=specialSessionCourtAssignment(plans);
          stage(specialTriggeredEarly?'SPECIAL_EARLY_AVAILABILITY_READY':'SPECIAL_RELEASE_AVAILABILITY_READY',
            {date:command.date,court:assigned.earlyCourt,courtB:assigned.lateCourt,
              price:[...plans.values()].reduce((sum,plan)=>sum+plan.totalPrice,0)});break;}
        const nextCheck=Math.min(nextVersionAt,nextAvailabilityAt,releaseMs-SPECIAL_RELEASE_GUARD_MS);
        await pause(Math.min(250,Math.max(1,nextCheck-Date.now())));
      }
      if(!specialPlansAtTrigger){
        assertApiReleaseFresh(releaseMs);stage('RELEASE_TRIGGERED');await finishWarmup(true);
        for(const delay of [0,250,500,1000,2000]){
          if(delay)await pause(delay);
          const snapshot=await readSpecialSnapshot(command.date);
          const plans=snapshot?specialSessionPlans(snapshot,SPECIAL_SESSION_WORKERS,undefined,directCourt?[directCourt]:[]):undefined;
          if(plans){specialPlansAtTrigger=plans;specialSnapshotAtTrigger=snapshot;
            const assigned=specialSessionCourtAssignment(plans);stage('SPECIAL_RELEASE_AVAILABILITY_READY',
              {date:command.date,court:assigned.earlyCourt,courtB:assigned.lateCourt,
                price:[...plans.values()].reduce((sum,plan)=>sum+plan.totalPrice,0)});break;}
        }
        if(!specialPlansAtTrigger)throw Error('SPECIAL_SESSION_NOT_AVAILABLE');
      }
      // Availability can arrive before the ordinary eight-second prewarm
      // window. Finish all four security contexts before any branch dispatches.
      if(warmup&&warmupStartedAt!==undefined&&Date.now()-warmupStartedAt>90_000){
        await finishWarmup(true);warmup=undefined;warmupStartedAt=undefined;
      }
      startWarmup();await finishWarmup(true);
    } else if (command.mode === 'live') {
      const releaseMs = command.releaseMs!;
      if (releaseMs <= Date.now()) throw Error('RELEASE_MISSED');
      stage('WAITING_FOR_RELEASE', { releaseMs });
      while (Date.now() < releaseMs) {
        ensureActive();const remaining=releaseMs-Date.now();if(remaining<=SECURITY_PREWARM_LEAD_MS)startWarmup();
        await pause(Math.min(500,Math.max(1,remaining),warmup?500:Math.max(1,remaining-SECURITY_PREWARM_LEAD_MS)));
      }
      assertApiReleaseFresh(releaseMs);stage('RELEASE_TRIGGERED');await finishWarmup();
    }
    ensureActive();
    const preferences: BookingPreferences = { mode: strategy, targetDate: command.date,
      durationHours: duration, preferredStartTimes: [requested?.start ?? config.START_TIME],
      fallbackStartTimes: requested?.fallbackStarts ?? config.FALLBACK_TIMES,
      courtPriority: requested?.priority ?? config.PREFERRED_COURTS,
      fallbackCourts: requested ? [] : config.FALLBACK_COURTS, courtCount, exactCourts: requested?.exact,
      maximumTotalPrice: requested?.maximum ?? config.MAX_PRICE, currency: 'PHP' };
    let discovery:Awaited<ReturnType<typeof discoverApiAvailability>>|undefined;
    let checkoutPlans:BookingPlan[];
    if(specialSession){
      if(!specialPlansAtTrigger)throw Error('SPECIAL_SESSION_NOT_AVAILABLE');
      checkoutPlans=plansInWorkerOrder(specialPlansAtTrigger,SPECIAL_SESSION_WORKERS);
      const assigned=specialSessionCourtAssignment(specialPlansAtTrigger);
      stage('CANDIDATE_READY',{date:command.date,court:assigned.earlyCourt,courtB:assigned.lateCourt,startTime:'17:00',durationHours:5,
        price:checkoutPlans.reduce((sum,plan)=>sum+plan.totalPrice,0)});
    }else{
      stage('FETCHING_AVAILABILITY');
      discovery = await discoverApiAvailability(new OndaLiveAvailabilityProvider(), preferences);
      ensureActive();
      if (!discovery.candidates.length) throw Error('API_NO_AVAILABLE_CANDIDATE');
      const selected = command.mode === 'dry' ? { plan: discovery.candidates[0]! } :
        await firstUnjournaledAvailableCandidate(discovery.snapshot, preferences, THIRSTY_PICKLE_FACILITY_ID, async key => {
          const directory = resolve('.local/api-booking/api-first-journals', key);
          const disposition = await new DurableSubmissionJournal(directory).recycleReusable(key);
          if (disposition === 'reused') stage('FINISHED_ATTEMPT_REUSABLE');
          return disposition === 'blocked';
        });
      if (!selected) throw Error('API_NO_UNUSED_CANDIDATE');
      const plan = selected.plan;
      stage('CANDIDATE_READY', { date: command.date, court: plan.courts[0]!.court,
        ...(plan.courts[1] ? { courtB: plan.courts[1].court } : {}),startTime: plan.startTime,
        durationHours: duration,price: plan.totalPrice,availabilityMs: Math.round(discovery.timing.totalMs ?? 0) });
      checkoutPlans=standardCheckoutChunks(plan);
    }
    if (command.mode === 'dry') {
      // The dry path has no customer lookup, checkout security context, or submission permit.
      stage('DRY_RUN_COMPLETE');
    } else {
      ensureActive();
      const makeAttempts=(plans:BookingPlan[],ids:readonly WorkerId[],availability:AvailabilitySnapshot)=>plans.map((chunkPlan,index)=>{
        const workerId=ids[index];if(!workerId)throw Error('API_CHECKOUT_WORKER_MISSING');
        const session=sessions.find(value=>value.workerId===workerId),customer=customers?.[workerId];
        if(!session||!customer)throw Error('API_CHECKOUT_WORKER_MISSING');
        const keys=standardPlanJournalKeys(chunkPlan,THIRSTY_PICKLE_FACILITY_ID);
        const directories=keys.map(key=>resolve('.local/api-booking/api-first-journals',key));
        return {chunkPlan,workerId,session,customer,keys,directories,availability,
          journals:directories.map(directory=>new DurableSubmissionJournal(directory))};
      });
      let attempts=makeAttempts(checkoutPlans,specialSession?SPECIAL_SESSION_WORKERS:workerIds,specialSnapshotAtTrigger??discovery!.snapshot);
      type Attempt=(typeof attempts)[number];
      const verifiedHolds:Array<{holdExpiresAt:string}>=[];
      await liveLock?.dispatching();retainLiveLock=true;
      const executeAttempt=async(attempt:Attempt)=>{
        const {chunkPlan,workerId,session,customer,keys,directories,journals,availability}=attempt;
        ensureActive();
        const workerStarted=performance.now();
        const workerTiming=()=>({workerId,workerElapsedMs:Math.round(performance.now()-workerStarted)});
        const key = keys[0]!, directory = directories[0]!, journal = journals[0]!;
        let token: string | undefined, bookingNo: string | undefined;
        const capture = async (response: CheckoutHttpResponse) => {
          await saveOnce(directory, 'checkout-response-private.json', sanitizedCheckoutCapture(response));
          try {
            const value = JSON.parse(response.body) as { success?: boolean; bookings?: Array<{ id?: string; booking_no?: string; checkoutToken?: string }> };
            if (value.success === true && value.bookings?.length === chunkPlan.durationHours * chunkPlan.courts.length &&
              value.bookings[0]?.id && value.bookings[0]?.booking_no && value.bookings[0]?.checkoutToken) {
              token = value.bookings[0].checkoutToken; bookingNo = value.bookings[0].booking_no;
            }
          } catch { /* Raw response is in the private journal. */ }
        };
        if(command.mode==='live')responseCaptures.set(workerId,capture);
        stage('FRESH_VERIFICATION_AND_PROOFS', { workerId });
        let hold;
        try { hold = await submitCalendarFreeTwoHourCheckout({ page: session.page, plan: chunkPlan,
          availability,
          customer, approval: { courts: chunkPlan.courts.map(court => court.court), date: command.date,
            startTime: chunkPlan.startTime, endTime: chunkPlan.endTime,
            maximumAmount: chunkPlan.totalPrice, customerId: customer.customerId,
            approvalReference: `desktop-api-first-${workerId}-${key}` }, journal,
          additionalJournals: journals.slice(1), captureCheckoutResponse: capture,transport:releaseTransports.get(workerId),
          onPhase: phase => stage(phase, workerTiming()),
          onHumanVerificationRequired: async () => {
            await session.page.evaluate(id => { document.title = `THIRSTY BOT ${id} - VERIFY HERE`; }, workerId);
            await showWindow(session.page); stage('HUMAN_VERIFICATION_REQUIRED', { workerId });
          },
          onHumanVerificationCompleted: async () => { stage('HUMAN_VERIFICATION_COMPLETE', { workerId }); } });
        } catch (error) {
          const code = error instanceof Error ? error.message : '';
          if (/TURNSTILE|SECURITY_CONTEXT|CHALLENGE/.test(code)) {
            await showWindow(session.page); stage('HUMAN_VERIFICATION_REQUIRED', { workerId, code });
          }
          throw error;
        }
         verifiedHolds.push({holdExpiresAt:hold.holdExpiresAt});verifiedHold=true;retainLiveLock=true;
         if(!latestVerifiedHoldExpiry||Date.parse(hold.holdExpiresAt)>Date.parse(latestVerifiedHoldExpiry))latestVerifiedHoldExpiry=hold.holdExpiresAt;
        const bookingTarget={date:command.date,court:chunkPlan.courts[0]!.court,...(chunkPlan.courts[1]?{courtB:chunkPlan.courts[1].court}:{}),
          startTime:chunkPlan.startTime,durationHours:chunkPlan.durationHours};
        stage('PENDING_HOLD', { ...workerTiming(), ...bookingTarget, bookingId: hold.bookingIds[0]!, bookingNo: bookingNo ?? '',
          holdExpiresAt: hold.holdExpiresAt, price: chunkPlan.totalPrice });
        if (!token || !bookingNo) throw Error('OFFICIAL_CHECKOUT_TOKEN_MISSING');
        const grant = await session.page.evaluate(async ({ bookingNo, token }) => {
          const url = new URL(`/api/public/bookings/booking-no/${encodeURIComponent(bookingNo)}`, location.origin);
          url.searchParams.set('checkoutToken', token); url.searchParams.set('grantCheckoutAccess', '1');
          const response = await fetch(url, { credentials: 'include', cache: 'no-store' }); return response.status;
        }, { bookingNo, token });
        if (grant !== 200) throw Error('OFFICIAL_CHECKOUT_ACCESS_FAILED');
        await session.page.goto(officialCheckoutUrl(hold.bookingIds[0]!), { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await session.page.getByText('QRPH', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 });
        const body = await session.page.locator('body').innerText();
        if (!body.includes('Pending') || !body.replaceAll(',', '').includes(chunkPlan.totalPrice.toFixed(2)))
          throw Error('OFFICIAL_CHECKOUT_STATE_MISMATCH');
        await showWindow(session.page);
        stage('OFFICIAL_QRPH_HANDOFF', { ...workerTiming(), ...bookingTarget, bookingId: hold.bookingIds[0]!, bookingNo,
          holdExpiresAt: hold.holdExpiresAt, price: chunkPlan.totalPrice });
        return hold;
      };
      const conclusiveNoHold=async(attempt:Attempt,error:unknown)=>{
        const states=await Promise.all(attempt.journals.map((journal,index)=>
          journal.read(attempt.keys[index]!).then(record=>record.state).catch(()=>undefined)));
        if(states.some(Boolean))return states.length>0&&states.every(state=>state==='rejected');
        return error instanceof SubmissionDispatchError&&!error.dispatched;
      };
      let outcomes=await Promise.allSettled(attempts.map(executeAttempt));
      attempts.forEach((attempt,index)=>{const outcome=outcomes[index]!;
        const code=outcome.status==='rejected'&&outcome.reason instanceof Error&&/^[A-Z][A-Z0-9_]{0,79}$/.test(outcome.reason.message)
          ?outcome.reason.message:outcome.status==='rejected'?'SPECIAL_WORKER_FAILED':'COMPLETED';
        stage('SPECIAL_WORKER_OUTCOME',{workerId:attempt.workerId,attempt:'initial',status:outcome.status,code,
          court:attempt.chunkPlan.courts[0]!.court,startTime:attempt.chunkPlan.startTime,durationHours:attempt.chunkPlan.durationHours});});
      const finalByWorker=new Map<WorkerId,PromiseSettledResult<Awaited<ReturnType<typeof executeAttempt>>>>(
        attempts.map((attempt,index)=>[attempt.workerId,outcomes[index]!]));
      if(specialSession&&specialTriggeredEarly){
        const assignedCourts=specialSessionCourtAssignment(specialPlansAtTrigger!);
        const retryWorkers:WorkerId[]=[];
        for(const [index,outcome] of outcomes.entries())if(outcome?.status==='rejected'&&
          await conclusiveNoHold(attempts[index]!,outcome.reason))retryWorkers.push(attempts[index]!.workerId);
        if(retryWorkers.length){
          stage('SPECIAL_SAFE_RETRY_WAITING',{releaseMs:command.releaseMs!});
          warmup=undefined;warmupStartedAt=undefined;
          while(Date.now()<command.releaseMs!){ensureActive();const remaining=command.releaseMs!-Date.now();
            if(remaining<=SECURITY_PREWARM_LEAD_MS)startWarmup(retryWorkers);
            await pause(Math.min(500,Math.max(1,remaining),warmup?500:Math.max(1,remaining-SECURITY_PREWARM_LEAD_MS)));}
          assertApiReleaseFresh(command.releaseMs!);stage('RELEASE_TRIGGERED');await finishWarmup(true);
          let retryPlans=new Map<WorkerId,BookingPlan>();let retrySnapshot:AvailabilitySnapshot|undefined;
          for(const delay of [0,250,500,1000,2000]){
            if(delay)await pause(delay);const snapshot=await readSpecialSnapshot(command.date);if(!snapshot)continue;
            const plansForSnapshot=new Map<WorkerId,BookingPlan>();
            for(const workerId of retryWorkers){
              const plan=specialSessionPlans(snapshot,[workerId],assignedCourts)?.get(workerId);if(plan)plansForSnapshot.set(workerId,plan);
            }
            if(plansForSnapshot.size>retryPlans.size){retrySnapshot=snapshot;retryPlans=plansForSnapshot;}
            if(retryPlans.size===retryWorkers.length)break;
          }
          if(retrySnapshot&&retryPlans.size){
            const retryIds=retryWorkers.filter(worker=>retryPlans.has(worker));
            for(const workerId of retryIds){
              const prior=attempts.find(attempt=>attempt.workerId===workerId)!;
              for(const [index,journal] of prior.journals.entries()){
                const disposition=await journal.recycleReusable(prior.keys[index]!);
                if(disposition==='blocked')throw Error('SPECIAL_SESSION_RETRY_BLOCKED');
              }
            }
            const retryAttempts=makeAttempts(plansInWorkerOrder(retryPlans,retryIds),retryIds,retrySnapshot);
            attempts=[...attempts,...retryAttempts];
            const retried=await Promise.allSettled(retryAttempts.map(executeAttempt));
            retryAttempts.forEach((attempt,index)=>{const outcome=retried[index]!;
              const code=outcome.status==='rejected'&&outcome.reason instanceof Error&&/^[A-Z][A-Z0-9_]{0,79}$/.test(outcome.reason.message)
                ?outcome.reason.message:outcome.status==='rejected'?'SPECIAL_WORKER_FAILED':'COMPLETED';
              stage('SPECIAL_WORKER_OUTCOME',{workerId:attempt.workerId,attempt:'retry',status:outcome.status,code,
                court:attempt.chunkPlan.courts[0]!.court,startTime:attempt.chunkPlan.startTime,durationHours:attempt.chunkPlan.durationHours});});
            retryAttempts.forEach((attempt,index)=>finalByWorker.set(attempt.workerId,retried[index]!));
          }
        }
      }
      if(verifiedHolds.length){
        const holdExpiresAt=verifiedHolds.map(hold=>hold.holdExpiresAt).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]!;
        await liveLock?.held(holdExpiresAt);
      }
      outcomes=[...finalByWorker.values()];
      const failures=outcomes.filter((outcome):outcome is PromiseRejectedResult=>outcome.status==='rejected');
      if(specialSession)stage('SPECIAL_RUN_SUMMARY',{workerCount:outcomes.length,
        completedWorkers:outcomes.length-failures.length,failedWorkers:failures.length,verifiedHold});
      if(failures.length){
        if(!verifiedHold){
           const finalAttempts=(specialSession?SPECIAL_SESSION_WORKERS:workerIds).map(worker=>[...attempts].reverse().find(attempt=>attempt.workerId===worker)!).filter(Boolean);
          const safe=specialSession
            ?(await Promise.all(finalAttempts.map(attempt=>{const outcome=finalByWorker.get(attempt.workerId);
              return outcome?.status==='rejected'&&conclusiveNoHold(attempt,outcome.reason);}))).every(Boolean)
            :await (async()=>{const states=(await Promise.all(attempts.flatMap(attempt=>attempt.journals.map((journal,index)=>
              journal.read(attempt.keys[index]!).then(record=>record.state).catch(()=> 'unknown' as const)))));
              return canReleaseApiLockAfterParallelFailure(false,failures.map(failure=>failure.reason),states,attempts.length);})();
           if(safe&&!directTask){
            retainLiveLock=false;await liveLock?.release();liveLock=undefined;
          }
        }
        throw failures[0]!.reason;
      }
    }
  }
} catch (error) {
  const code = error instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.message)
    ? error.message : 'API_FIRST_RUN_FAILED';
  stage('FAILED', { code });
  process.exitCode = 1;
 } finally {
   if(directTask)await directTask;
  // This process attaches to a browser owned by the desktop installation.
  // Closing a CDP attachment closes its transport; the independently launched Chrome windows stay open.
  await Promise.allSettled(connectedBrowsers.map(browser => browser.close()));
  if(liveLock&&!retainLiveLock)await liveLock.release().catch(()=>undefined);
  progressLog.record('PROCESS_EXIT', new Date().toISOString(), stamp(), { exitCode: process.exitCode ?? 0 });
  progressLog.close();
  if (process.connected) process.disconnect();
}
