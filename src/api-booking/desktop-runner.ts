import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants as osConstants, getPriority, setPriority } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { chromium, type Browser, type Page } from 'playwright';
import { z } from 'zod';
import { ONDA_URL, VENUE, loadConfig, planFingerprint, releaseMsForTargetDate } from '../config.js';
import { consensusState, NETWORK_CLOCK_MAX_AGE_MS, queryGoogleClockConsensus, readNetworkClock, recordClockEvidence, writeNetworkClockState } from '../network-clock.js';
import { adoptConsensus, DEFAULT_SPIN_TAIL_MS, RELEASE_CLOCK_ROUNDS, TrustedReleaseClock } from '../release-clock.js';
import { releaseTriggerMs } from '../release-offset.js';
import { armedNothingFired, armPrecisionRace, disarmUnfired, dispatchArmedPrecisionRace, type ArmedAttempt, type ArmedPrecisionRace } from './armed-dispatch.js';
import { classifyTargetEvidence, readPreReleaseEvidence } from './pre-release-evidence.js';
import { freezePrecisionRace, precisionAttemptSet, precisionTargetPlan, reducePrecisionOutcome, PRECISION_UNSENT_STATES,
  validatePrecisionTargets, VerifiedHoldQrError, classifyPrecisionDispatchError,
  type PrecisionAttempt, type PrecisionAttemptState, type PrecisionTarget } from './precision-race.js';
import { authorizePrecision, candidateWirePlan, precisionCandidateId, PrecisionSession, classifyActionableObservation, pricedPrecisionPlan, adaptiveMaxAgeMs,
  adaptiveFitness, freshestAvailabilityObservation, isActionableEvidenceFitness, shouldContinueAdaptiveRun, type AvailabilityObservation } from './precision-phase3.js';
import { runAdaptiveAttempt, type AdaptiveSelection } from './adaptive-attempt.js';
import { browserIdentity, verifyDedicatedChromeAsync } from '../browser.js';
import { emitUiEvent, type ApiStageFields } from '../ui-events.js';
import { discoverApiAvailability } from './availability-engine.js';
import { THIRSTY_PICKLE_FACILITY_ID } from './live-availability-provider.js';
import { OndaBrowserAvailabilityProvider } from './browser-availability-provider.js';
import { assertWingNormalRequest } from '../wing-normal-booking.js';
import { assertQrOrderSummary } from './qr-order-summary.js';
import { parseAvailability } from './availability-parser.js';
import { DurableSubmissionJournal } from './durable-submission-journal.js';
import { loadLocalCheckoutCustomer } from './local-customer.js';
import { assertActiveCustomersValid, resolveActiveCustomers } from './customer-identity.js';
import { submitCalendarFreeTwoHourCheckout } from './calendar-free-checkout.js';
import { officialCheckoutUrl } from './checkout-restoration.js';
import type { AvailabilitySnapshot, BookingPlan, BookingPreferences } from './types.js';
import { OndaBrowserSessionTransport, type BrowserTransportObservation, type CheckoutHttpResponse } from './browser-session-transport.js';
import { ProviderTraceSet, type CdpSessionLike } from './checkout-provider-trace.js';
import { CriticalPathRecorder, warmUpCriticalPath, type CriticalPathRow } from './critical-path.js';
import { ReleaseCriticalLockdown } from '../release-lockdown.js';
import { calibrateRendererClock, calibrateRendererClockAdaptive, sampleRendererClock } from './renderer-clock.js';
import { rendererDispatchEnabled } from './renderer-dispatch.js';
import { calendarFreeSecurityContext } from './calendar-free-security-context.js';
import { firstUnjournaledAvailableCandidate } from './candidate-journal.js';
import { standardCheckoutChunks } from './extended-checkout.js';
import { observedResponse, standardPlanJournalKeys } from './two-hour-reservation.js';
import { checkoutDiagnostic } from './checkout-diagnostics.js';
import { ApiRunProgressLog } from './run-progress-log.js';
import { ApiAutomationLock } from './api-automation-lock.js';
import { assertApiReleaseFresh } from './api-release.js';
import { canReleaseApiLockAfterParallelFailure } from './api-lock-outcome.js';
import { normalWorkerIds, requiredWorkerIds, type WorkerId } from '../workers.js';
import { showWorkerPage } from '../browser-window.js';
import { preflightProoflessWire, prooflessCourtHourStatuses, prooflessReleasePlan, resolveProoflessReleasePlan, submitDirectCheckout } from './proofless-checkout.js';
import { WirePayloadError } from './wire-payload-check.js';
import { describeTierStatus, type PrewarmTask, type TierStatus } from './prewarm-scheduler.js';
import {exactPrewarmLeadMs} from './prewarm-feasibility.js';
import { securityPrepHistory } from '../security-prep-history.js';
import { currentMachineIdentity } from '../fanout-capacity.js';
import {deriveShotgunTopology,logicalTargetId,shotgunCriticalInterval} from '../shotgun.js';
import { predictionError, predictReopenings, RESCUE_CONTEXT_REUSE_MS, RESCUE_PREWARM_MAX_PER_RELEASE, rescuePrewarmDue, type ReopenPrediction } from './reopen-prediction.js';
import { readPublicBookingRecords } from './public-bookings.js';
import {API_SECURITY_PREWARM_LEAD_MS,safeApiFailureCode} from './run-observability.js';
import { availabilityObservation, diagnosticLaneForWorker, RunDiagnostics, safeDiagnosticCode,
  type DiagnosticAttemptType, type DiagnosticCorrelation, type DiagnosticOperation } from './run-diagnostics.js';

const preferencesSchema = z.object({ wing: z.enum(['MANGO','BUKO']).optional(), strategy: z.enum(['standard', 'extended']), date: z.iso.date(), start: z.string().regex(/^(0[89]|1\d|2[0-3]):00$/),
  duration: z.number().int().min(1).max(6), courtCount: z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4),z.literal(5),z.literal(6),z.literal(7)]), maximum: z.number().optional(),
  priority: z.array(z.number().int().min(1).max(7)).min(1),
  fallbackStarts: z.array(z.string().regex(/^(0[89]|1\d|2[0-3]):00$/)),
  exact: z.array(z.array(z.number().int().min(1).max(7))).optional(),
  workers: z.array(z.enum(['A','B','C','D','E','F','G','H'])).min(1).max(8).optional() }).strict();
const command = z.object({ mode: z.enum(['prepare', 'dry', 'audit', 'live', 'live-now']), date: z.iso.date(),
  checkoutMethod:z.enum(['proof-based','proofless']).optional(),clockOffsetMs:z.number().finite().optional(),releaseMs: z.number().int().positive().optional(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  shotgunAttestation: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  preferences: preferencesSchema.optional() }).strict().parse(JSON.parse(process.argv[2] ?? '{}'));
const abort = new AbortController();
const phase3Observations:AvailabilityObservation[]=[];
process.on('message', message => {
  if ((message as { type?: string })?.type === 'abort') abort.abort();
  const received=message as {type?:string;date?:string;releaseMs?:number;observation?:AvailabilityObservation};
  if(received?.type==='slotObservation'&&received.date===command.date&&received.releaseMs===command.releaseMs&&
    received.observation&&Number.isSafeInteger(received.observation.seq)&&
    received.observation.seq>0&&Number.isFinite(received.observation.requestOffsetMs)&&
    Number.isFinite(received.observation.responseOffsetMs)&&phase3Observations.length<1500)
    phase3Observations.push(received.observation);
});
const started = performance.now();
// The Google offset captured at arming is refreshed before release (T-10 min);
// every scheduling decision reads the latest value through nowMs().
let clockOffsetMs=command.clockOffsetMs??0;
let lastClockSyncAtMs:number|undefined=(()=>{const state=readNetworkClock();return state?Date.parse(state.synchronizedAt):undefined;})();
const nowMs=()=>Date.now()+clockOffsetMs;
const stamp = () => Math.round(performance.now() - started);
const progressLog = new ApiRunProgressLog(command.mode, command.date);
const diagnostics = new RunDiagnostics(progressLog, started);
// Typed from the UI schema: a field the UI would reject does not compile (October 18: workerGroupIndex was dropped).
const stage = (name: string, extra: ApiStageFields = {}) => {
  const entry = progressLog.record(name, new Date(nowMs()).toISOString(), stamp(), extra as Record<string, string | number | boolean>);
  emitUiEvent({ type: 'apiStage', stage: name, at: entry.at, elapsedMs: entry.elapsedMs,
    sincePreviousMs: entry.sincePreviousMs, ...(name === 'RUN_STARTED' ? { runId: progressLog.runId } : {}), ...extra });
};
// High-frequency forensic evidence stays in the append-only local trace and
// does not flood the operator UI or Previous Runs activity list.
const trace = (name: string, extra: Record<string, string | number | boolean> = {}) =>
  progressLog.recordDiagnostic(name, new Date(nowMs()).toISOString(), stamp(), extra);
stage('RUN_STARTED');
const ensureActive = () => { if (abort.signal.aborted) throw Error('USER_ABORT'); };
// Windows' default timer resolution (~15.6ms) makes setTimeout overshoot short
// waits by up to that much, which matters right at the release trigger instant.
// Below this threshold, spin on setImmediate (sub-ms scheduling) instead.
const SPIN_TAIL_MS = 20;
const pause = (ms: number) => new Promise<void>((done, fail) => {
  if(abort.signal.aborted){fail(Error('USER_ABORT'));return;}
  if(ms<=SPIN_TAIL_MS){
    const deadline=performance.now()+ms;
    const onAbort=()=>{abort.signal.removeEventListener('abort',onAbort);fail(Error('USER_ABORT'));};
    abort.signal.addEventListener('abort',onAbort,{once:true});
    const tick=()=>{
      if(abort.signal.aborted)return;
      if(performance.now()>=deadline){abort.signal.removeEventListener('abort',onAbort);done();return;}
      setImmediate(tick);
    };
    tick();
    return;
  }
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
  return {capturedAt:new Date(nowMs()).toISOString(),status:response.status,contentType:response.contentType,
    diagnostic:checkoutDiagnostic(response),observed:observedResponse(parsed,'RESPONSE_CAPTURED'),
    // Structure-first evidence of a rejection (sanitized in the transport); never the body text.
    ...(response.evidence?{evidence:response.evidence}:{})};
};
const connectedBrowsers: Browser[] = [];
let availabilityPage: Page | undefined;
let liveLock:ApiAutomationLock|undefined,retainLiveLock=false,verifiedHold=false;
let latestVerifiedHoldExpiry:string|undefined;
let persistedVerifiedHoldExpiry:string|undefined;
let finalDiagnosticCode='COMPLETED';
const persistLatestVerifiedHold=async()=>{
  if(!liveLock||!latestVerifiedHoldExpiry||latestVerifiedHoldExpiry===persistedVerifiedHoldExpiry)return;
  await liveLock.held(latestVerifiedHoldExpiry);
  persistedVerifiedHoldExpiry=latestVerifiedHoldExpiry;
};
interface WorkerSession { workerId:WorkerId; browser: Browser; page: Page; pages:readonly Page[]; port: number }
// Passive checkout provider trace (see checkout-provider-trace.ts). Attached in the background well
// before any POST, written only after every POST has settled; checkout never depends on it.
let providerTraces:ProviderTraceSet|undefined,providerTracesSaved=false;
// Critical-path telemetry (critical-path.ts): in-memory marks during dispatch; renderer clocks are
// calibrated and the file is written only after every POST has settled.
let criticalPath:CriticalPathRecorder|undefined,criticalPathPages=new Map<string,Page>(),criticalPathSaved=false,releaseLockdown:ReleaseCriticalLockdown|undefined,lockdownPriority:number|undefined;
const startCriticalPath=(clock:TrustedReleaseClock,releaseMs:number,pages:ReadonlyMap<string,Page>)=>{
  criticalPathPages=new Map(pages);criticalPathSaved=false;
  try{warmUpCriticalPath();}catch{/* telemetry only */}
  criticalPath=new CriticalPathRecorder(releaseMs,clock.monotonicDeadline(releaseMs),clock.offsetMs-clock.wallDisagreementMs(),[...pages.keys()]);
  releaseLockdown=new ReleaseCriticalLockdown(clock.monotonicDeadline(releaseMs));
  return criticalPath;
};
const enterReleaseLockdown=()=>{releaseLockdown?.enter();try{lockdownPriority=getPriority();setPriority(osConstants.priority.PRIORITY_HIGH);}catch{lockdownPriority=undefined;}};
const exitReleaseLockdown=()=>{releaseLockdown?.exit();if(lockdownPriority!==undefined){try{setPriority(lockdownPriority);}catch{}lockdownPriority=undefined;}
  const value=releaseLockdown;setImmediate(()=>{if(value){const summary=value.summary();stage('RELEASE_LOCKDOWN_COMPLETE',{deferred:summary.deferred,flushed:summary.flushed,
    workInFinal50Ms:summary.workInFinal50Ms,workInFinal20Ms:summary.workInFinal20Ms,workInFinal10Ms:summary.workInFinal10Ms});}});};
// Informational progress/UI lines (file append + IPC) raised inside the final second are queued until the POSTs have
// left. Never use this for journal, permit, gate or state writes; exact timings are already in the in-memory recorder.
const deferrableStage=(name:string,extra:ApiStageFields={})=>{
  const lockdown=releaseLockdown;if(lockdown?.state!=='RELEASE_CRITICAL_LOCKDOWN'){stage(name,extra);return;}
  const queuedAt=performance.now();lockdown.defer(()=>stage(name,{...extra,lockdownDeferredMs:Math.round(performance.now()-queuedAt)}));
};
const persistCriticalPath=async()=>{
  const recorder=criticalPath;
  if(!recorder||criticalPathSaved)return;
  criticalPathSaved=true;
  for(const workerId of recorder.workerIds()){
    const page=criticalPathPages.get(workerId);if(!page||page.isClosed())continue;
    try{recorder.calibration(workerId,calibrateRendererClock(await sampleRendererClock(page,8)));}catch{/* the row keeps Node-side marks only */}
  }
  try{
    const directory=resolve('.local/release-forensics',progressLog.runId);await mkdir(directory,{recursive:true,mode:0o700});
    const machine=currentMachineIdentity(),machineKey=JSON.stringify({cpuModel:machine.cpuModel,logicalCores:machine.logicalCores,totalMemGb:machine.totalMemGb,platform:machine.platform,osRelease:machine.osRelease});
    const browserVersion=[...criticalPathPages.values()].find(page=>!page.isClosed())?.context().browser()?.version(),runtimeKey=browserVersion?(browserVersion.startsWith('Chrome/')?browserVersion:`Chrome/${browserVersion}`):null;
    await writeFile(join(directory,'critical-path.ndjson'),recorder.toNdjson({runId:progressLog.runId,targetDate:command.date,mode:command.mode,generatedAt:new Date().toISOString(),machineKey,
      runtimeKey}),{mode:0o600,flag:'wx'});
    const rows=recorder.rows(),worst=(pick:(row:CriticalPathRow)=>number|null)=>{const values=rows.map(pick).filter((value):value is number=>value!==null);return values.length?Math.max(...values):-1;};
    stage('CRITICAL_PATH_SAVED',{workerCount:rows.length,maxPrePostMs:worst(row=>row.prePostMs),maxFetchInvokedMs:worst(row=>row.fetchInvokedMs?.ms??null),
      maxBrowserRequestStartMs:worst(row=>row.browserRequestStartMs),maxRequestObservedMs:worst(row=>row.requestObservedMs)});
  }catch{stage('CRITICAL_PATH_SAVED',{outcome:'FAILED'});}
};
/**
 * EXPERIMENTAL renderer-resident dispatch deps, only when ONDA_EXPERIMENTAL_RENDERER_DISPATCH=RENDERER_RESIDENT_V1.
 * Without the flag this returns {} and the dispatch is exactly the Node-triggered path.
 */
const experimentalRendererDispatch=(pageFor:(attempt:ArmedAttempt)=>Page|undefined,transportFor:(attempt:ArmedAttempt)=>OndaBrowserSessionTransport|undefined)=>
  rendererDispatchEnabled()?{rendererDispatch:{pageUrl:ONDA_URL,transportFor:(_worker:WorkerId,attempt:ArmedAttempt)=>transportFor(attempt),
    calibrate:async(attempt:ArmedAttempt)=>{const page=pageFor(attempt);if(!page)throw Error('RENDERER_PAGE_MISSING');
      return calibrateRendererClockAdaptive(page,{targetUncertaintyMs:1.5,maxSamples:32});},
    // Called inside the arm pass: in-memory now, logging on a later macrotask.
    onPlan:(event:{workerId:WorkerId;attemptId:string;mode:'renderer'|'node-fallback';code?:string;calibration?:import('./renderer-clock.js').RendererClockCalibration})=>{
      if(event.mode==='renderer'){criticalPath?.mode(event.attemptId,'renderer-experimental');criticalPath?.calibration(event.attemptId,event.calibration);}
      setImmediate(()=>stage('RENDERER_DISPATCH_PLAN',{workerId:event.workerId,attemptId:event.attemptId,outcome:event.mode==='renderer'?'RENDERER_ARMED':'NODE_FALLBACK',...(event.code?{code:event.code}:{}),
        ...(event.calibration?{uncertaintyMs:Math.round(event.calibration.uncertaintyMs*100)/100}:{})}));}}}:{};
const openTraceSession=(page:Page)=>()=>page.context().newCDPSession(page) as unknown as Promise<CdpSessionLike>;
/** One transport per browser tab: a worker's first tab is keyed by the worker ID, fan-out child i>0 by "W:i" (Fixed and Smart alike). */
const transportKeyOf=(workerId:WorkerId,fanOutIndex:number)=>fanOutIndex===0?workerId:`${workerId}:${fanOutIndex}`;
const persistProviderTraces=async()=>{
  await persistCriticalPath().catch(()=>undefined);
  if(!providerTraces||providerTracesSaved)return;
  providerTracesSaved=true;
  const path=await providerTraces.persist(resolve('.local/release-forensics',progressLog.runId));
  const records=providerTraces.records(),unavailable=providerTraces.statuses().filter(value=>value.status==='unavailable');
  trace('PROVIDER_TRACE_SAVED',{status:path?'SUCCESS':'FAILED',traceCount:records.length,traceComplete:records.filter(value=>value.complete).length,
    ...(unavailable.length?{traceUnavailable:unavailable.map(value=>`${value.workerId}:${value.code??'UNAVAILABLE'}`).join(',')}:{})});
};
async function prepareWorker(workerId:WorkerId,fanOutCount=1): Promise<WorkerSession> {
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
  const pages=matchingPages.slice(0,fanOutCount);
  while(pages.length<fanOutCount)pages.push(await context.newPage());
  await Promise.all(matchingPages.slice(fanOutCount).map(duplicate => duplicate.close().catch(() => undefined)));
  await Promise.all(pages.map(async page=>{
    if (page.url() !== ONDA_URL) await page.goto(ONDA_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.getByTestId('public-booking-hero-title').first().waitFor({ state: 'visible', timeout: 45_000 });
    if ((await page.getByTestId('public-booking-hero-title').first().innerText()).trim() !== VENUE) throw Error('WRONG_VENUE');
  }));
  const page=pages[0]!;
  await showWorkerPage(page,workerId);
  stage('BROWSER_READY', { workerId, port: identity.port });
  return { workerId, browser, page, pages:Object.freeze(pages), port: identity.port };
}

/** One read-only availability GET; every read lands in the trace with its exact 112-cell matrix. */
async function readAvailabilitySnapshot(date:string):Promise<AvailabilitySnapshot|undefined>{
  ensureActive();
  const requestedAt=performance.now();
  const finish=diagnostics.begin('availability','AVAILABILITY_REQUEST_STARTED',{},{});
  try{
    if(!availabilityPage)throw Error('AVAILABILITY_BROWSER_PREPARATION_REQUIRED');
    const provider=new OndaBrowserAvailabilityProvider(availabilityPage,{allowIncompleteRange:true});
    const envelope=await provider.getAvailability({startDate:date,endDate:date});
    const snapshot=parseAvailability(envelope.raw,{startDate:date,endDate:date,capturedAt:envelope.capturedAt,
      fixtureKind:envelope.fixtureKind,label:envelope.label,now:new Date(),maximumAgeMs:15_000,requireCompleteRange:false});
    finish('AVAILABILITY_REQUEST_COMPLETED',{...availabilityObservation(snapshot,date),status:'SUCCESS'});
    return snapshot;
  }catch(error){
    const code=error instanceof Error&&/^[A-Z][A-Z0-9_]{0,79}$/.test(error.message)
      ?error.message:'AVAILABILITY_READ_FAILED';
    trace('AVAILABILITY_SAMPLE_FAILED',{durationMs:Math.round(performance.now()-requestedAt),code});
    finish('AVAILABILITY_REQUEST_COMPLETED',{status:'FAILED',failureCategory:code,targetDatePresent:false,
      responseComplete:false,slotCount:0,availableCount:0});
    return;
  }
}
const readKnownCourtHourBlocks=(date:string)=>readPublicBookingRecords(date,
  {onCourt:(court,outcome)=>trace('PUBLIC_BOOKING_BLOCK_SAMPLE',{court,...outcome})});
/** One pre-release evidence checkpoint with bounded retries; failures stay failures. */
const readEvidence=(date:string,releaseMs:number,checkpoint:string,retry=true)=>readPreReleaseEvidence({date,releaseMs,
  readAvailability:()=>readAvailabilitySnapshot(date),readBookings:()=>readKnownCourtHourBlocks(date),now:nowMs,sleep:pause,
  ...(retry?{}:{retryDelaysMs:[]}),
  onRead:read=>stage('PRE_RELEASE_AUDIT_READ',{checkpoint,readSource:read.source,attemptNo:read.attempt,ok:read.ok,
    ...(read.failedCourts?.length?{failedCourts:read.failedCourts.join(',')}:{})})});
const sleepUntil=async(at:number)=>{while(nowMs()<at){ensureActive();await pause(Math.min(30_000,Math.max(1,at-nowMs())));}};
const tenth=(value:number)=>Math.round(value*10)/10;
async function refreshNetworkClock(checkpoint:string):Promise<boolean>{
  try{
    const consensus=await queryGoogleClockConsensus(),previous=clockOffsetMs;
    const state=writeNetworkClockState(consensusState(consensus));
    try{recordClockEvidence(consensus,checkpoint);}catch{/* sanitized evidence is best-effort */}
    clockOffsetMs=state.offsetMs;lastClockSyncAtMs=Date.parse(state.synchronizedAt);
    stage('NETWORK_CLOCK_REFRESHED',{checkpoint,offsetMs:Math.round(state.offsetMs),roundTripMs:Math.round(state.roundTripMs),
      deltaMs:Math.round(state.offsetMs-previous),sampleCount:consensus.sampleCount,spreadMs:tenth(consensus.spreadMs),uncertaintyMs:tenth(consensus.uncertaintyMs),
      ...(consensus.quality==='GOOD'?{}:{code:'CLOCK_CONSENSUS_DEGRADED'})});
    return true;
  }catch(error){stage('NETWORK_CLOCK_REFRESH_FAILED',{checkpoint,code:safeApiFailureCode(error,'NETWORK_CLOCK_SYNC_FAILED')});return false;}
}
/** Scheduled dispatch needs a Google sync no older than the arming threshold. */
function assertClockFresh(){
  if(command.clockOffsetMs===undefined)return;
  if(lastClockSyncAtMs===undefined||!Number.isFinite(lastClockSyncAtMs)||nowMs()-lastClockSyncAtMs>NETWORK_CLOCK_MAX_AGE_MS)
    throw Error('NETWORK_CLOCK_STALE');
}
/**
 * Near-release consensus for Precision (T-60 s and T-30 s). Each round samples every approved
 * Google NTP host; a GOOD round re-anchors the trusted clock on the monotonic clock, so the
 * final wait and the final no-early check use the same clock and a later wall-clock step cannot
 * move the release instant. A degraded or failed round keeps the previous clock; with no round
 * adopted the fresh T-10 min consensus is used, and a stale sync still fails closed.
 */
let releaseClock:TrustedReleaseClock|undefined;
async function prepareReleaseClock(releaseMs:number,initial:TrustedReleaseClock):Promise<TrustedReleaseClock>{
  let clock:TrustedReleaseClock|undefined=initial;
  for(const round of RELEASE_CLOCK_ROUNDS){
    const at=releaseMs-round.beforeMs;
    if(nowMs()>at+5_000)continue;
    await sleepUntil(at);
    try{
      const consensus=await queryGoogleClockConsensus({timeoutMs:1_000});
      try{recordClockEvidence(consensus,round.label);}catch{/* sanitized evidence is best-effort */}
      if(consensus.quality!=='GOOD'){
        stage('NETWORK_CLOCK_CONSENSUS_REJECTED',{checkpoint:round.label,code:'CLOCK_CONSENSUS_DEGRADED',sampleCount:consensus.sampleCount});continue;
      }
      const previous=clock??TrustedReleaseClock.fromOffset(clockOffsetMs,{method:'previous-sync',sampleCount:0});
      const adopted=adoptConsensus(previous,TrustedReleaseClock.fromOffset(consensus.offsetMs,{method:consensus.method,sampleCount:consensus.sampleCount,
        spreadMs:consensus.spreadMs,uncertaintyMs:consensus.uncertaintyMs,quality:consensus.quality}),releaseMs);
      clock=adopted.clock;
      if(!adopted.jumpRejected){clockOffsetMs=consensus.offsetMs;lastClockSyncAtMs=nowMs();}
      stage('NETWORK_CLOCK_CONSENSUS',{checkpoint:round.label,offsetMs:tenth(consensus.offsetMs),roundTripMs:tenth(consensus.minRoundTripMs),
        deltaMs:tenth(consensus.offsetMs-previous.offsetMs),sampleCount:consensus.sampleCount,spreadMs:tenth(consensus.spreadMs),
        uncertaintyMs:tenth(consensus.uncertaintyMs),...(adopted.jumpRejected?{code:'CLOCK_JUMP_REJECTED'}:{})});
    }catch(error){stage('NETWORK_CLOCK_CONSENSUS_FAILED',{checkpoint:round.label,code:safeApiFailureCode(error,'NETWORK_CLOCK_SYNC_FAILED')});}
  }
  assertClockFresh();
  return clock??TrustedReleaseClock.fromOffset(clockOffsetMs,{method:'t-10m-consensus',sampleCount:0});
}
/** The preparation window actually obtained, against the earliest trigger; a late start is called out explicitly. */
const prewarmWindowStage=(window:{plannedLeadMs:number;actualLeadMs:number;lateByMs:number;firstTriggerOffsetMs:number})=>
  stage('PREWARM_WINDOW',{prewarmLeadMs:Math.max(1,Math.round(window.plannedLeadMs)),leadBeforeTriggerMs:window.actualLeadMs,lateByMs:window.lateByMs,
    releaseOffsetMs:Math.max(-2000,Math.min(2000,window.firstTriggerOffsetMs)),...(window.lateByMs>1_000?{code:'PREWARM_LATE_START'}:{}),
    message:`Preparation started ${Math.round(window.actualLeadMs/1000)} s before the earliest trigger (planned ${Math.round(window.plannedLeadMs/1000)} s)${window.lateByMs>1_000?`; ${Math.round(window.lateByMs/1000)} s late`:''}.`});
async function refreshArmedClock(clock:TrustedReleaseClock,releaseMs:number):Promise<TrustedReleaseClock>{
  clock.adopt(await prepareReleaseClock(releaseMs,clock),releaseMs);
  // Keep the timing report and final lockdown anchored to the same refreshed clock as dispatch.
  if(criticalPath){criticalPath.releaseMono=clock.monotonicDeadline(releaseMs);criticalPath.wallToTrustedMs=clock.offsetMs-clock.wallDisagreementMs();}
  releaseLockdown=new ReleaseCriticalLockdown(clock.monotonicDeadline(releaseMs));
  return clock;
}
/** Resync at T-10 min (retry at T-5 min), never inside the final minutes before dispatch. */
async function refreshClockBeforeRelease(releaseMs:number){
  if(nowMs()<releaseMs-3*60_000){
    await sleepUntil(releaseMs-10*60_000);
    if(!await refreshNetworkClock('T-10M')&&nowMs()<releaseMs-5*60_000){await sleepUntil(releaseMs-5*60_000);await refreshNetworkClock('T-5M');}
  }
  assertClockFresh();
}

try {
  if (process.env.THIRSTY_API_INSTALLATION !== '1' && process.env.THIRSTY_API_TEST_INSTALLATION !== '1') throw Error('API_INSTALLATION_REQUIRED');
  const config = loadConfig();
  const requested = command.preferences;
  if (requested) assertWingNormalRequest({ ...requested, method: command.checkoutMethod === 'proofless' ? 'proofless' : 'api-first', mode: command.mode });
  // Precision Release: the saved plan authorizes 1-3 exact, independent one-court targets (never COURT_COUNT).
  const phase3=!requested&&config.RELEASE_STRATEGY==='precision'&&command.mode!=='audit'?config.PRECISION_PHASE3:undefined;
  const precisionTargets=!phase3&&!requested&&config.RELEASE_STRATEGY==='precision'&&command.mode!=='audit'
    ?validatePrecisionTargets(config.PRECISION_TARGETS,command.date,config.PRECISION_FAN_OUT):undefined;
  // A saved fan-out flag applies only to the Fixed Precision run itself. A Test or General run keeps
  // one tab and one transport per worker, keyed by worker ID.
  const precisionFanOut=!!precisionTargets&&config.PRECISION_FAN_OUT;
  if((precisionTargets||phase3)&&(config.BOOKING_METHOD!=='proofless'||command.checkoutMethod!=='proofless'||config.BOOKING_TYPE!=='standard'))
    throw Error('PRECISION_REQUIRES_PROOFLESS_STANDARD');
  // Operator Release Offset (release-offset.ts): moves only the pre-armed Proofless Direct trigger of a scheduled release.
  // General uses this plan-wide value; Precision sets one per attempt (frozen with the target).
  const releaseOffsetMs=!requested&&command.mode==='live'&&command.checkoutMethod==='proofless'?config.RELEASE_OFFSET_MS:0;
  stage('RUN_CONFIGURATION',{bookingMethod:config.BOOKING_METHOD,
    workerCount:precisionTargets?.length??(phase3?phase3.wave1.length+phase3.standby.length:requiredWorkerIds(config.BOOKING_TYPE,config.COURT_COUNT).length),
    prewarmLeadMs:API_SECURITY_PREWARM_LEAD_MS,
    ...(command.releaseMs?{releaseMs:command.releaseMs}:{}),...(releaseOffsetMs?{releaseOffsetMs}:{})});
  const scheduledTrigger=(releaseMs:number,triggerMs:number,workerId?:WorkerId)=>{
    if(triggerMs!==releaseMs)stage('RELEASE_OFFSET_SCHEDULED',{releaseMs,triggerMs,releaseOffsetMs:triggerMs-releaseMs,...(workerId?{workerId}:{})});
  };
  const strategy = requested?.strategy ?? config.BOOKING_TYPE;
  const duration = requested?.duration ?? config.DURATION_HOURS;
  const courtCount = requested?.courtCount ?? config.COURT_COUNT;
  // Live Shotgun capability (capability-matrix.ts): Mango scheduled release only, as an owner-attested pilot bound to this
  // exact plan fingerprint. An immediate current-slot burst and any Buko scheduled target stay refused.
  if(!command.preferences&&config.STRATEGY_V2?.shotgun?.enabled&&['live','live-now'].includes(command.mode)){
    if(command.mode==='live-now')throw Error('SHOTGUN_IMMEDIATE_BURST_BLOCKED');
    if(config.PRECISION_PHASE3?.candidates.some(candidate=>candidate.wing==='BUKO'))throw Error('BUKO_SCHEDULED_LIVE_BLOCKED');
    if(command.shotgunAttestation!==command.fingerprint)throw Error('SHOTGUN_LIVE_ATTESTATION_REQUIRED');
    stage('SHOTGUN_LIVE_PILOT_ATTESTED',{attempts:config.STRATEGY_V2.shotgun.exactSchedule.length});
  }
  if(command.mode==='audit'){
    availabilityPage=(await prepareWorker('A')).page;
    const [read,publicRecords]=await Promise.all([readAvailabilitySnapshot(command.date).then(snapshot=>({snapshot,observedAtMs:nowMs()})),readKnownCourtHourBlocks(command.date)]);
    const cells=prooflessCourtHourStatuses(read.snapshot,command.date,publicRecords.blocks,publicRecords.failedCourts,
      {releaseMs:command.releaseMs??releaseMsForTargetDate(config,command.date),observedAtMs:read.observedAtMs});
    for(const value of cells)trace('COURT_HOUR_STATUS',{court:value.court,hour:value.hour,status:value.status,source:value.source,...(value.price!==undefined?{price:value.price}:{})});
    emitUiEvent({type:'blockAudit',date:command.date,cells});stage('BLOCK_AUDIT_COMPLETE');
    throw Error('BLOCK_AUDIT_COMPLETE');
  }
  if (!command.preferences && !['api-first','proofless'].includes(config.BOOKING_METHOD)) throw Error('API_FIRST_METHOD_REQUIRED');
  if (strategy === 'standard' && (duration < 1 || duration > 3) ||
    strategy === 'extended' && (duration < 4 || duration > 6) || ![1,2,3,4,5,6,7].includes(courtCount))
    throw Error('API_FIRST_COURT_COUNT_UNSUPPORTED');
  if (!command.preferences && command.fingerprint !== planFingerprint(config)) throw Error('API_PLAN_CHANGED');
  if ((command.mode === 'live' || command.mode === 'live-now') && process.env.ONDA_API_FIRST_LIVE !== 'ARMED')
    throw Error('API_LIVE_NOT_ARMED');
  if (command.mode === 'live' && !command.releaseMs) throw Error('API_RELEASE_TIME_REQUIRED');
  const workerIds:WorkerId[]=phase3?[...phase3.wave1.map(value=>value.workerId),...phase3.standby]:precisionTargets?precisionTargets.map(target=>target.workerId):normalWorkerIds(strategy,courtCount,requested?.workers);
  // An armed Precision race tolerates one worker's browser or identity failure: that
  // attempt is recorded as not dispatched and the others stay eligible. Preparation
  // and the dry audit still require every configured worker, while the operator is present.
  const precisionLive=!!(precisionTargets||phase3)&&command.mode==='live';
  const unavailableWorkers=new Map<WorkerId,{state:'BROWSER_FAILED'|'IDENTITY_FAILED';code:string;duplicateOf?:WorkerId}>();
  if(command.mode==='live'||command.mode==='live-now')liveLock=await ApiAutomationLock.acquire(strategy,workerIds);
  // Customer identities of the workers THIS run needs: each binding valid and every Onda customer ID
  // unique (first worker in A-G order keeps a shared ID). General fails closed on any invalid identity;
  // Precision disables only the affected attempt, in preparation as well as at release.
  let customers:Partial<Record<WorkerId,ReturnType<typeof loadLocalCheckoutCustomer>>>|undefined;
  if(command.mode!=='dry'||precisionTargets||phase3){
    const identities=resolveActiveCustomers(workerIds);
    for(const identity of identities)if(!identity.ok)stage('CUSTOMER_IDENTITY_INVALID',{workerId:identity.worker,code:identity.code,
      ...(identity.duplicateOf?{duplicateOf:identity.duplicateOf}:{})});
    if(precisionTargets||phase3){
      for(const identity of identities)if(!identity.ok)unavailableWorkers.set(identity.worker,{state:'IDENTITY_FAILED',code:identity.code,
        ...(identity.duplicateOf?{duplicateOf:identity.duplicateOf}:{})});
      if(!identities.some(identity=>identity.ok))throw Error('PRECISION_NO_VALID_CUSTOMER_IDENTITY');
      customers=Object.fromEntries(identities.flatMap(identity=>identity.ok?[[identity.worker,identity.customer]]:[]));
    }else customers=assertActiveCustomersValid(identities);
    if(command.mode==='dry'&&!precisionTargets&&!phase3)customers=undefined;
  }
  // Arm-time wire self-check (wire-payload-check.ts): every Precision request this run may send is built with its
  // worker's real identity, serialized and validated now, long before release. A malformed request refuses the run
  // here instead of failing at release (2026-09-29: 28 × 400 "Invalid booking session time").
  if((precisionTargets||phase3)&&customers){
    const fallbackCustomer=Object.values(customers).find(Boolean);
    const wirePlans:Array<{plan:BookingPlan;workerId?:WorkerId}>=precisionTargets
      ?precisionAttemptSet(precisionTargets,command.date,precisionFanOut).map(({target,plan})=>({plan,workerId:target.workerId}))
      :phase3!.candidates.map((candidate,index)=>({plan:candidateWirePlan(command.date,candidate),workerId:phase3!.wave1.find(value=>value.candidateIndex===index)?.workerId}));
    try{
      for(const {plan,workerId} of wirePlans){const customer=(workerId&&customers[workerId])||fallbackCustomer;if(customer)preflightProoflessWire(plan,customer);}
    }catch(error){
      stage('WIRE_PAYLOAD_SELF_CHECK',{outcome:'FAILED',targetCount:wirePlans.length,code:safeApiFailureCode(error,'WIRE_PAYLOAD_SELF_CHECK_FAILED'),
        ...(error instanceof WirePayloadError?{message:error.detail.slice(0,240)}:{})});
      throw Error('WIRE_PAYLOAD_SELF_CHECK_FAILED');
    }
    stage('WIRE_PAYLOAD_SELF_CHECK',{outcome:'PASSED',targetCount:wirePlans.length});
  }
  // The dedicated profiles are independent. Wait for both checks to settle so
  // a failure in one browser cannot leave an unobserved preparation running.
  const smartTabs=new Map<WorkerId,number>((phase3?.wave1??[]).map(value=>[value.workerId,value.fanOutOffsetsMs?.length??1]));
  const fixedTabs=new Map<WorkerId,number>((precisionTargets??[]).map(value=>[value.workerId,value.fanOutReleaseOffsetsMs?.length??1]));
  const prepared=await Promise.allSettled(workerIds.map(worker=>prepareWorker(worker,precisionFanOut?fixedTabs.get(worker)??1:smartTabs.get(worker)??1)));
  prepared.forEach((result,index)=>stage('BROWSER_PREPARATION_OUTCOME',{workerId:workerIds[index]!,status:result.status,
    code:result.status==='fulfilled'?'COMPLETED':safeApiFailureCode(result.reason,'API_BROWSER_PREPARATION_FAILED')}));
  const failure=prepared.find((result):result is PromiseRejectedResult=>result.status==='rejected');
  if(failure&&!precisionLive)throw Error(safeApiFailureCode(failure.reason,'API_BROWSER_PREPARATION_FAILED'));
  prepared.forEach((result,index)=>{if(result.status==='rejected'&&!unavailableWorkers.has(workerIds[index]!))
    unavailableWorkers.set(workerIds[index]!,{state:'BROWSER_FAILED',code:safeApiFailureCode(result.reason,'API_BROWSER_PREPARATION_FAILED')});});
  const sessions=prepared.flatMap(result=>result.status==='fulfilled'?[result.value]:[]);
  if(!sessions.length)throw Error('API_BROWSER_PREPARATION_FAILED');
  availabilityPage=sessions[0]!.page;
  if (command.mode === 'prepare') { process.exitCode = 0; }
  else {
    if(command.mode==='live'||command.mode==='live-now'){
      process.env.ONDA_CALENDAR_FREE_CHECKOUT='APPROVED_ONE_SHOT';
      process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT='SUPERVISED_ONE_SHOT';
    }
    const responseCaptures=new Map<string,(response:CheckoutHttpResponse)=>Promise<void>>();
    const activeWaveContexts=new Map<WorkerId,{candidateId:string;wave:'WAVE_1'|'WAVE_2'|'RESCUE';evidenceSeq?:()=>number|undefined}>();
    const releaseTransports=new Map<string,OndaBrowserSessionTransport>();
    const activeAttemptContexts=new Map<string,DiagnosticCorrelation>();
    const activeTransportOperations=new Map<string,Array<(stage:string,extra?:Record<string,unknown>)=>void>>();
    const transportContext=(workerId:WorkerId,transportKey:string):DiagnosticCorrelation=>activeAttemptContexts.get(transportKey)??
      {workerId,lane:diagnosticLaneForWorker(workerId)};
    const beginTransport=(key:string,operation:DiagnosticOperation,stage:string,context:DiagnosticCorrelation,extra:Record<string,unknown>)=>{
      const end=diagnostics.begin(operation,stage,context,extra),queue=activeTransportOperations.get(key)??[];
      queue.push(end);activeTransportOperations.set(key,queue);
    };
    const endTransport=(key:string,stage:string,context:DiagnosticCorrelation,extra:Record<string,unknown>)=>{
      const queue=activeTransportOperations.get(key),end=queue?.shift();
      if(queue&&!queue.length)activeTransportOperations.delete(key);
      if(end)end(stage,extra);else diagnostics.observe(stage,context,extra);
    };
    const observeTransport=(workerId:WorkerId,transportKey:string,raw:BrowserTransportObservation)=>{
      criticalPath?.observeTransport(transportKey,raw);
      const context=transportContext(workerId,transportKey);
      // Release lateness on the final pre-POST gate and on the observed POST (network-corrected clock;
      // the anchored release clock once Precision has prepared it).
      const observation=(raw.event==='CHECKOUT_PRE_POST'||raw.event==='CHECKOUT_HTTP_POST_INITIATED')&&command.releaseMs
        ?{...raw,releaseLatenessMs:tenth((releaseClock?.nowMs()??nowMs())-command.releaseMs)} as unknown as BrowserTransportObservation:raw;
      // These fire between the release instant (or the experimental renderer arm) and the POST: time is captured now, bookkeeping runs afterwards.
      if(observation.event==='CHECKOUT_FUNCTION_ENTERED'||observation.event==='CHECKOUT_PRE_POST'||observation.event==='RENDERER_DISPATCH_ARMED'){
        diagnostics.observeDeferred(observation.event,context,observation);return;}
      if(observation.event==='SECURITY_PREPARATION_STARTED'){
        beginTransport(`${transportKey}:security:${observation.securitySource}`,'security',observation.event,context,observation);return;
      }
      if(observation.event==='SECURITY_PREPARATION_COMPLETED'){
        endTransport(`${transportKey}:security:${observation.securitySource}`,observation.event,context,observation);return;
      }
      if(observation.event==='SLOT_CHECK_STARTED'){
        beginTransport(`${transportKey}:slot`,'slotCheck',observation.event,context,observation);return;
      }
      if(observation.event==='SLOT_CHECK_COMPLETED'){
        endTransport(`${transportKey}:slot`,observation.event,context,observation);return;
      }
      if(observation.event==='CHECKOUT_HTTP_POST_INITIATED'){
        // This worker's POST has left its page. Once every traced POST has, the passive traces enable Network (later macrotask).
        if(config.STRATEGY_V2?.shotgun?.enabled)releaseLockdown?.defer(()=>providerTraces?.postInitiated(transportKey));else providerTraces?.postInitiated(transportKey);
        const waveContext=activeWaveContexts.get(workerId);
        // The effective evidence is read at the POST itself: the pre-POST gate may have rebased it.
        const evidenceSeq=waveContext?.evidenceSeq?.();
        if(waveContext)setImmediate(()=>deferrableStage('PHASE3_DISPATCH',{workerId,candidateId:waveContext.candidateId,
          wave:waveContext.wave,attemptId:context.attemptId??'unknown',...(evidenceSeq!==undefined?{evidenceSeq}:{})}));
        if(config.STRATEGY_V2?.shotgun?.enabled)releaseLockdown?.defer(()=>beginTransport(`${transportKey}:checkout`,'checkout',observation.event,context,observation));else beginTransport(`${transportKey}:checkout`,'checkout',observation.event,context,observation);return;
      }
      if(observation.event==='CHECKOUT_RESPONSE_COMPLETED'){
        endTransport(`${transportKey}:checkout`,observation.event,context,observation);return;
      }
      diagnostics.observe(observation.event,context,observation);
    };
    if(command.mode==='live'||command.mode==='live-now'&&command.checkoutMethod==='proofless')for(const session of sessions){
      const workerId=session.workerId;
      for(const [pageIndex,page] of session.pages.entries()){const transportKey=transportKeyOf(workerId,pageIndex);
      releaseTransports.set(transportKey,new OndaBrowserSessionTransport(page,
        ()=>calendarFreeSecurityContext(page)(),
        response=>responseCaptures.get(transportKey)?.(response)??Promise.reject(Error('CHECKOUT_RESPONSE_CAPTURE_MISSING')),
        {onHumanVerificationRequired:async()=>{
          await page.evaluate(id=>{document.title=`THIRSTY BOT ${id} - VERIFY HERE`;},`${workerId}-${pageIndex+1}`);
          await showWorkerPage(page,workerId);stage('HUMAN_VERIFICATION_REQUIRED',{workerId});
        },onHumanVerificationCompleted:async()=>{stage('HUMAN_VERIFICATION_COMPLETE',{workerId});}},
        observation=>observeTransport(workerId,transportKey,observation)));}
    }
    // Hoisted so the E/F adaptive lane can dispatch a proof-based attempt as
    // soon as its court is ready, through the exact same verified path as the
    // main A-D/G-H batch dispatched later.
    const makeAttempts=(plans:BookingPlan[],ids:readonly WorkerId[],availability:AvailabilitySnapshot,
      requestedAttemptType?:DiagnosticAttemptType)=>plans.map((chunkPlan,index)=>{
      const workerId=ids[index];if(!workerId)throw Error('API_CHECKOUT_WORKER_MISSING');
      const session=sessions.find(value=>value.workerId===workerId),customer=customers?.[workerId];
      if(!session||!customer)throw Error('API_CHECKOUT_WORKER_MISSING');
      const keys=standardPlanJournalKeys(chunkPlan,THIRSTY_PICKLE_FACILITY_ID);
      const directories=keys.map(key=>resolve('.local/api-booking/api-first-journals',key));
      const lane=diagnosticLaneForWorker(workerId);
      const attemptType=requestedAttemptType??'official';
      return {chunkPlan,workerId,session,customer,keys,directories,availability,lane,attemptType,
        attemptId:diagnostics.nextAttemptId(lane,workerId,attemptType),
        journals:directories.map(directory=>new DurableSubmissionJournal(directory))};
    });
    type Attempt=ReturnType<typeof makeAttempts>[number];
    const executeAttemptInner=async(attempt:Attempt)=>{
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
          await showWorkerPage(session.page,workerId); stage('HUMAN_VERIFICATION_REQUIRED', { workerId });
        },
        onHumanVerificationCompleted: async () => { stage('HUMAN_VERIFICATION_COMPLETE', { workerId }); } });
      } catch (error) {
        const code = error instanceof Error ? error.message : '';
        if (/TURNSTILE|SECURITY_CONTEXT|CHALLENGE/.test(code)) {
          await showWorkerPage(session.page,workerId); stage('HUMAN_VERIFICATION_REQUIRED', { workerId, code });
        }
        throw error;
      }
       verifiedHold=true;retainLiveLock=true;
       if(!latestVerifiedHoldExpiry||Date.parse(hold.holdExpiresAt)>Date.parse(latestVerifiedHoldExpiry))latestVerifiedHoldExpiry=hold.holdExpiresAt;
      const bookingTarget={...(chunkPlan.wing ? {wing:chunkPlan.wing} : {}),date:command.date,court:chunkPlan.courts[0]!.court,...(chunkPlan.courts[1]?{courtB:chunkPlan.courts[1].court}:{}),
        startTime:chunkPlan.startTime,durationHours:chunkPlan.durationHours};
      stage('PENDING_HOLD', { ...workerTiming(), ...bookingTarget, bookingId: hold.bookingIds[0]!, bookingNo: bookingNo ?? '',
        holdExpiresAt: hold.holdExpiresAt, price: chunkPlan.totalPrice });
      diagnostics.observe('DIAGNOSTIC_VERIFIED_HOLD',attempt,{...bookingTarget,price:chunkPlan.totalPrice});
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
      assertQrOrderSummary(body, chunkPlan);
      await session.page.locator('canvas').first().waitFor({state:'visible',timeout:20_000});
      await showWorkerPage(session.page,workerId);
      stage('OFFICIAL_QRPH_HANDOFF', { ...workerTiming(), ...bookingTarget, bookingId: hold.bookingIds[0]!, bookingNo,
        holdExpiresAt: hold.holdExpiresAt, price: chunkPlan.totalPrice });
      diagnostics.observe('DIAGNOSTIC_QR_HANDOFF',attempt,{...bookingTarget,price:chunkPlan.totalPrice});
      return hold;
    };
    const executeAttempt=async(attempt:Attempt)=>{
      activeAttemptContexts.set(attempt.workerId,attempt);
      diagnostics.observe('DIAGNOSTIC_ATTEMPT_STARTED',attempt,{court:attempt.chunkPlan.courts[0]!.court,
        startTime:attempt.chunkPlan.startTime,durationHours:attempt.chunkPlan.durationHours});
      try{
        const value=await executeAttemptInner(attempt);
        diagnostics.observe('DIAGNOSTIC_ATTEMPT_COMPLETED',attempt,{workerOutcome:'VERIFIED_HOLD'});
        return value;
      }catch(error){
        diagnostics.observe('DIAGNOSTIC_ATTEMPT_COMPLETED',attempt,{workerOutcome:'FAILED',
          failureCategory:safeDiagnosticCode(error,'CHECKOUT_ATTEMPT_FAILED')});
        throw error;
      }finally{if(activeAttemptContexts.get(attempt.workerId)?.attemptId===attempt.attemptId)activeAttemptContexts.delete(attempt.workerId);}
    };
    const makeProoflessAttempts=(plans:BookingPlan[],ids:readonly WorkerId[])=>plans.map((plan,index)=>{
      const workerId=ids[index];if(!workerId)throw Error('API_CHECKOUT_WORKER_MISSING');
      const session=sessions.find(value=>value.workerId===workerId),customer=customers?.[workerId],transport=releaseTransports.get(workerId);
      if(!session||!customer||!transport)throw Error('API_CHECKOUT_WORKER_MISSING');
      const keys=standardPlanJournalKeys(plan,THIRSTY_PICKLE_FACILITY_ID);
      const directories=keys.map(key=>resolve('.local/api-booking/api-first-journals',key));
      const lane=diagnosticLaneForWorker(workerId),attemptType='official' as const;
      return {plan,workerId,session,customer,transport,keys,directories,lane,attemptType,
        attemptId:diagnostics.nextAttemptId(lane,workerId,attemptType),
        journals:directories.map(directory=>new DurableSubmissionJournal(directory))};
    });
    type ProoflessAttempt=ReturnType<typeof makeProoflessAttempts>[number];
    type ProoflessBinding={correlation:DiagnosticCorrelation&{workerId:WorkerId;attemptId:string};transportKey:string;started:number;workerTiming:()=>{workerId:WorkerId;workerElapsedMs:number};captured:{token?:string;bookingNo?:string}};
    /** Before any send: binds the attempt's diagnostics correlation and its private response capture. */
    const bindProoflessAttempt=(value:{plan:BookingPlan;workerId:WorkerId;lane:ReturnType<typeof diagnosticLaneForWorker>;attemptType:DiagnosticAttemptType;attemptId:string;directory:string;transportKey?:string},
      startedStage='DIAGNOSTIC_ATTEMPT_STARTED'):ProoflessBinding=>{
      const {plan,workerId}=value,transportKey=value.transportKey??workerId,correlation={workerId,lane:value.lane,attemptType:value.attemptType,attemptId:value.attemptId};
      activeAttemptContexts.set(transportKey,correlation);
      diagnostics.observe(startedStage,correlation,{court:plan.courts[0]!.court,startTime:plan.startTime,durationHours:plan.durationHours});
      const captured:{token?:string;bookingNo?:string}={};
      responseCaptures.set(transportKey,async response=>{
        providerTraces?.captureFallback({workerId:transportKey,attemptId:value.attemptId,...activeWaveContexts.get(workerId)},response);
        await saveOnce(value.directory,'checkout-response-private.json',sanitizedCheckoutCapture(response));
        try{const parsed=JSON.parse(response.body) as {bookings?:Array<{booking_no?:string;checkoutToken?:string}>};
          captured.bookingNo=parsed.bookings?.[0]?.booking_no;captured.token=parsed.bookings?.[0]?.checkoutToken;}catch{}
      });
      const binding:ProoflessBinding={correlation,transportKey,started:performance.now(),captured,
        workerTiming:()=>({workerId,workerElapsedMs:Math.round(performance.now()-binding.started)})};
      return binding;
    };
    const unbindProoflessAttempt=(binding:ProoflessBinding)=>{
      if(activeAttemptContexts.get(binding.transportKey)?.attemptId===binding.correlation.attemptId)activeAttemptContexts.delete(binding.transportKey);
    };
    /** A validated pending booking: record it, then open the official QR page. A QR failure never reads as "no hold". */
    const completeVerifiedProoflessHold=async(binding:ProoflessBinding,session:WorkerSession,plan:BookingPlan,hold:Awaited<ReturnType<typeof submitDirectCheckout>>)=>{
      const {correlation,workerTiming}=binding,{workerId}=correlation,bookingNo=binding.captured.bookingNo,token=binding.captured.token;
      verifiedHold=true;retainLiveLock=true;
      if(!latestVerifiedHoldExpiry||Date.parse(hold.holdExpiresAt)>Date.parse(latestVerifiedHoldExpiry))latestVerifiedHoldExpiry=hold.holdExpiresAt;
      const bookingTarget={date:command.date,court:plan.courts[0]!.court,...(plan.courts[1]?{courtB:plan.courts[1].court}:{}),
        startTime:plan.startTime,durationHours:plan.durationHours};
      stage('PENDING_HOLD',{...workerTiming(),...bookingTarget,bookingId:hold.bookingIds[0]!,bookingNo:bookingNo??'',
        holdExpiresAt:hold.holdExpiresAt,price:plan.totalPrice});
      diagnostics.observe('DIAGNOSTIC_VERIFIED_HOLD',correlation,{...bookingTarget,price:plan.totalPrice});
      // From here the booking is real and validated; a QR page failure must never read as "no hold".
      try{
      if(!token||!bookingNo)throw Error('OFFICIAL_CHECKOUT_TOKEN_MISSING');
      const grant=await session.page.evaluate(async({bookingNo,token})=>{const url=new URL(`/api/public/bookings/booking-no/${encodeURIComponent(bookingNo)}`,location.origin);
        url.searchParams.set('checkoutToken',token);url.searchParams.set('grantCheckoutAccess','1');
        return (await fetch(url,{credentials:'include',cache:'no-store'})).status;},{bookingNo,token});
      if(grant!==200)throw Error('OFFICIAL_CHECKOUT_ACCESS_FAILED');
      await session.page.goto(officialCheckoutUrl(hold.bookingIds[0]!),{waitUntil:'domcontentloaded',timeout:45_000});
      await session.page.getByText('QRPH',{exact:true}).first().waitFor({state:'visible',timeout:20_000});
      const body=await session.page.locator('body').innerText();
      assertQrOrderSummary(body,plan);
      await session.page.locator('canvas').first().waitFor({state:'visible',timeout:20_000});
      await showWorkerPage(session.page,workerId);
      stage('OFFICIAL_QRPH_HANDOFF',{...workerTiming(),...bookingTarget,bookingId:hold.bookingIds[0]!,bookingNo,
        holdExpiresAt:hold.holdExpiresAt,price:plan.totalPrice});
      diagnostics.observe('DIAGNOSTIC_QR_HANDOFF',correlation,{...bookingTarget,price:plan.totalPrice});
      }catch(error){
        const code=safeApiFailureCode(error,'OFFICIAL_QR_HANDOFF_FAILED');
        stage('QR_HANDOFF_NEEDS_ATTENTION',{...workerTiming(),...bookingTarget,code,bookingId:hold.bookingIds[0]!,bookingNo:bookingNo??'',
          holdExpiresAt:hold.holdExpiresAt,price:plan.totalPrice});
        await showWorkerPage(session.page,workerId).catch(()=>undefined);
        throw new VerifiedHoldQrError(code,{bookingId:hold.bookingIds[0]!,...(bookingNo?{bookingNo}:{}),holdExpiresAt:hold.holdExpiresAt,amount:plan.totalPrice});
      }
      diagnostics.observe('DIAGNOSTIC_ATTEMPT_COMPLETED',correlation,{workerOutcome:'VERIFIED_HOLD'});
      return hold;
    };
    const executeProoflessAttempt=async(attempt:ProoflessAttempt,releaseMs?:number,dispatch:{requirePreparedContext?:boolean;beforePost?:()=>void;triggerMs?:number}={})=>{
      const {plan,workerId,session,customer,transport,directories,journals,lane,attemptType,attemptId}=attempt;
      const binding=bindProoflessAttempt({plan,workerId,lane,attemptType,attemptId,directory:directories[0]!});
      try{
        const hold=await submitDirectCheckout(plan,customer,transport,journals[0]!,releaseMs,journals.slice(1),nowMs,dispatch);
        return await completeVerifiedProoflessHold(binding,session,plan,hold);
      }catch(error){
        diagnostics.observe('DIAGNOSTIC_ATTEMPT_COMPLETED',binding.correlation,{workerOutcome:'FAILED',
          failureCategory:safeDiagnosticCode(error,'CHECKOUT_ATTEMPT_FAILED')});
        throw error;
      }finally{unbindProoflessAttempt(binding);}
    };
    const recordWarmFailures=(name:string,workers:readonly WorkerId[],results:readonly PromiseSettledResult<void>[],fallback:string)=>
      results.forEach((result,index)=>{if(result.status==='rejected')stage(name,{workerId:workers[index]!,status:'rejected',
        code:safeApiFailureCode(result.reason,fallback)});});
    let warmup:Promise<PromiseSettledResult<void>[]>|undefined;
    let warmupStartedAt:number|undefined;
    let warmupWorkers:readonly WorkerId[]=workerIds;
    const startWarmup=(workers:readonly WorkerId[]=workerIds)=>{
      if(warmup)return;
      warmupWorkers=[...workers];
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
      recordWarmFailures('SECURITY_PREWARM_FAILED',warmupWorkers,results,'SECURITY_PREWARM_FAILED');
      let failure=results.find((result):result is PromiseRejectedResult=>result.status==='rejected');
      if(failure&&retryOnce){
        const retryWorkers=warmupWorkers;
        warmup=undefined;warmupStartedAt=undefined;startWarmup(retryWorkers);results=await warmup!;
        recordWarmFailures('SECURITY_PREWARM_RETRY_FAILED',warmupWorkers,results,'SECURITY_PREWARM_FAILED');
        failure=results.find((result):result is PromiseRejectedResult=>result.status==='rejected');
      }
      if(failure)throw Error(safeApiFailureCode(failure.reason,'SECURITY_PREWARM_FAILED'));
    };
    /**
     * Security preparation for a release: without fan-out, every attempt prepares at once 15 s ahead (unchanged). With fan-out,
     * children prepare tier by tier (A0…G0 first, prewarm-scheduler.ts) with one preparation per browser at a time, and the lead
     * grows with the number of tiers at this installation's measured p95 preparation time (security-prep-history.ts).
     */
    const fanOutPrewarm=(attempts:readonly ArmedAttempt[])=>{
      const width=Math.max(1,...attempts.map(attempt=>attempt.attempt.fanOutCount));
      if(width<=1)return {prewarmLeadMs:API_SECURITY_PREWARM_LEAD_MS};
      const groups=new Set(attempts.map(attempt=>attempt.target.workerId)).size,history=securityPrepHistory('.',groups);
      const compatibleP95Ms=history.atConcurrency===groups?history.p95Ms:null,prepP95Ms=compatibleP95Ms??12_000,
        prewarmPolicy={concurrency:Math.max(1,groups),perGroupConcurrency:1,tierBarrierTimeoutMs:Math.max(4_000,Math.round(prepP95Ms*1.5))};
      const tasks:PrewarmTask[]=attempts.map((attempt,index)=>({id:attempt.attempt.id,tier:attempt.attempt.fanOutIndex,order:index,group:attempt.target.workerId}));
      const prewarmLeadMs=exactPrewarmLeadMs(tasks,prewarmPolicy,prepP95Ms);
      stage('PREWARM_PLAN',{prewarmLeadMs,fanOutCount:width,workerCount:groups,sampleCount:history.samples,
        ...(compatibleP95Ms!==null?{durationMs:Math.round(compatibleP95Ms)}:{})});
      let last='';
      return {prewarmLeadMs,prewarmPolicy,prewarmExpectedDurationMs:prepP95Ms,
        onPrewarmStatus:(status:TierStatus[])=>{const text=describeTierStatus(status);if(text===last)return;last=text;
          // Never write near the trigger; the release summary and per-child states are logged afterwards.
          setImmediate(()=>{if(!command.releaseMs||command.releaseMs-nowMs()>1_500)stage('PREWARM_TIER_STATUS',{message:text.slice(0,240)});});}};
    };
    /** Precision Release v1: sparse evidence checkpoints, a T-2 min freeze, then per-attempt independent dispatch. */
    const runPrecision=async(targets:ReturnType<typeof validatePrecisionTargets>)=>{
      const date=command.date,releaseMs=command.releaseMs??releaseMsForTargetDate(config,date);
      const states=new Map<string,PrecisionAttemptState>(),codes=new Map<string,string>();
      let completedAttempts:readonly PrecisionAttempt[]=[];
      const setState=(target:(typeof targets)[number],state:PrecisionAttemptState,code?:string,duplicateOf?:WorkerId,attemptId?:string)=>{
        const stateKey=attemptId??target.workerId;states.set(stateKey,state);if(code)codes.set(stateKey,code);
        stage('PRECISION_ATTEMPT_STATE',{workerId:target.workerId,court:target.court,startTime:target.start,endTime:target.end,
          durationHours:target.durationHours,attemptState:state,...(attemptId?{attemptId}:{}),...(code?{code}:{}),...(duplicateOf?{duplicateOf}:{})});
      };
      const fanOut=precisionFanOut;
      stage('PRECISION_RACE_CONFIGURED',{date,targetCount:targets.length,releaseMs,fanOut});
      for(const target of targets)stage('PRECISION_TARGET',{workerId:target.workerId,court:target.court,startTime:target.start,
        endTime:target.end,durationHours:target.durationHours,assumedPrice:target.assumedAmount});
      for(const target of targets){
        const unavailable=unavailableWorkers.get(target.workerId);
        if(unavailable)setState(target,unavailable.state,unavailable.code,unavailable.duplicateOf);
        else if(command.mode==='live'&&!releaseTransports.get(transportKeyOf(target.workerId,0)))
          setState(target,'BROWSER_FAILED','API_CHECKOUT_WORKER_MISSING');
      }
      const eligible=new Map<WorkerId,boolean>();
      const checkpoint=async(label:string)=>{
        const evidence=await readEvidence(date,releaseMs,label);
        stage('PRECISION_EVIDENCE_READ',{checkpoint:label,availabilityState:evidence.snapshot?evidence.dateState:'READ_FAILED',
          ok:!!evidence.snapshot&&!evidence.failedCourts.length,...(evidence.failedCourts.length?{failedCourts:evidence.failedCourts.join(',')}:{})});
        for(const target of targets){
          const result=classifyTargetEvidence(target,evidence,date);eligible.set(target.workerId,result.eligible);
          stage('PRECISION_TARGET_EVIDENCE',{checkpoint:label,workerId:target.workerId,court:target.court,startTime:target.start,
            endTime:target.end,evidence:result.evidence,eligible:result.eligible});
        }
      };
      const journalFor=(target:(typeof targets)[number])=>new DurableSubmissionJournal(resolve('.local/api-booking/api-first-journals',target.targetKey));
      const checkJournals=async()=>{
        for(const target of targets){
          if(states.has(target.workerId))continue;
          const disposition=await journalFor(target).recycleReusable(target.targetKey).catch(()=>'blocked' as const);
          if(disposition==='blocked')setState(target,'JOURNAL_BLOCKED','DUPLICATE_LOGICAL_BOOKING_BLOCKED');
          else if(disposition==='reused')stage('FINISHED_ATTEMPT_REUSABLE',{workerId:target.workerId});
        }
      };
      if(command.mode==='dry'){
        await checkpoint('PREPARE');
        const usable=targets.filter(target=>!states.has(target.workerId)&&eligible.get(target.workerId));
        stage('PRECISION_DRY_COMPLETE',{targetCount:targets.length,frozenCount:usable.reduce((sum,target)=>sum+(fanOut?target.fanOutReleaseOffsetsMs?.length??1:1),0)});
        if(!usable.length)throw Error('PRECISION_NO_ELIGIBLE_TARGET');
        return;
      }
      if(command.mode!=='live')throw Error('PRECISION_RELEASE_ONLY');
      if(nowMs()>releaseMs-20_000)throw Error('PRECISION_TOO_LATE_TO_FREEZE');
      await checkJournals();
      // Sparse, rate-respectful evidence; checkpoints already in the past are skipped.
      for(const [minutes,label] of [[60,'T-60M'],[30,'T-30M'],[10,'T-10M']] as const){
        const at=releaseMs-minutes*60_000;
        if(nowMs()>at+60_000)continue;
        await sleepUntil(at);await checkpoint(label);
      }
      await refreshClockBeforeRelease(releaseMs);
      await sleepUntil(releaseMs-2*60_000);
      if(nowMs()>releaseMs-20_000)throw Error('PRECISION_TOO_LATE_TO_FREEZE');
      await checkpoint('FREEZE');
      assertClockFresh();
      await checkJournals();
      const frozenTargets:PrecisionTarget[]=[];
      for(const target of targets){
        if(states.has(target.workerId))continue;
        if(!eligible.get(target.workerId)){setState(target,'EXCLUDED_BEFORE_FREEZE','TARGET_EVIDENCE_NOT_ELIGIBLE');continue;}
        frozenTargets.push(target);
      }
      const race=freezePrecisionRace(date,releaseMs,precisionAttemptSet(frozenTargets,date,fanOut));
      completedAttempts=race.attempts;
      const attemptDirectory=(attempt:PrecisionAttempt)=>attempt.fanOutCount>1
        ?resolve('.local/api-booking/api-first-journals',attempt.target.targetKey,'fan-out',race.fingerprint,attempt.id)
        :resolve('.local/api-booking/api-first-journals',attempt.target.targetKey);
      await saveOnce(resolve('.local/api-booking/precision-races'),`${progressLog.runId}-freeze.json`,{frozenAt:new Date(nowMs()).toISOString(),
        date,releaseMs,freezeHash:race.fingerprint,fanOut:race.fanOut,attempts:race.attempts.map(({id,target,fanOutIndex,fanOutCount})=>({attemptId:id,
          parentGoalId:target.targetKey,fanOutIndex,fanOutCount,workerId:target.workerId,court:target.court,
          start:target.start,end:target.end,targetKey:target.targetKey,releaseOffsetMs:target.releaseOffsetMs??0})),
        notDispatched:[...states].map(([workerId,state])=>({workerId,state,code:codes.get(workerId)??null}))});
      stage('PRECISION_FROZEN',{targetCount:targets.length,frozenCount:race.attempts.length});
      if(race.attempts.length){
        // Pre-release: bind diagnostics/response capture, then durably arm the lock, every journal and every one-shot.
        const transportKeyFor=(attempt:PrecisionAttempt)=>transportKeyOf(attempt.target.workerId,attempt.fanOutIndex);
        const sessionFor=(attempt:PrecisionAttempt)=>{const base=sessions.find(value=>value.workerId===attempt.target.workerId);if(!base)return undefined;
          return {...base,page:base.pages[attempt.fanOutIndex]??base.page};};
        const bindings=new Map(race.attempts.map(attempt=>{
          const workerId=attempt.target.workerId,lane=diagnosticLaneForWorker(workerId);
          return [attempt.id,bindProoflessAttempt({plan:attempt.plan,workerId,lane,attemptType:'official',attemptId:attempt.id,
            directory:attemptDirectory(attempt),transportKey:transportKeyFor(attempt)},'DIAGNOSTIC_ATTEMPT_ARMED')] as const;
        }));
        let armed:ArmedPrecisionRace;
        try{armed=await armPrecisionRace(race,{lock:liveLock,customerFor:worker=>customers![worker]!,
          journalRoot:resolve('.local/api-booking/api-first-journals'),releaseMs,now:nowMs});}
        catch(error){for(const binding of bindings.values())unbindProoflessAttempt(binding);throw error;}
        retainLiveLock=true;
        stage('PRECISION_ARMED',{frozenCount:race.attempts.length,unsentCount:armed.unarmed.length,releaseMs,fanOut:race.fanOut,
          parentGoalCount:new Set(race.attempts.map(attempt=>attempt.target.targetKey)).size});
        for(const attempt of armed.attempts)scheduledTrigger(releaseMs,attempt.triggerMs,attempt.target.workerId);
        for(const value of armed.unarmed){setState(value.attempt.target,value.state,value.code,undefined,value.attempt.id);unbindProoflessAttempt(bindings.get(value.attempt.id)!);}
        // T-2 min: passive DevTools sessions attach in the background with no domain enabled (no per-request cost).
        // Each enables Network only after its own POST has left; nothing on the release path waits for them.
        const traces=providerTraces=new ProviderTraceSet(progressLog.runId,'release',releaseMs,()=>(releaseClock?.nowMs()??nowMs())-releaseMs);
        for(const attempt of armed.attempts){
          const session=sessionFor(attempt.attempt),transportKey=transportKeyFor(attempt.attempt);
          if(session)traces.start({workerId:transportKey,attemptId:bindings.get(attempt.attempt.id)?.correlation.attemptId,
            court:attempt.target.court,startTime:attempt.target.start,endTime:attempt.target.end},openTraceSession(session.page));
        }
        // After the one-second dispatch window no POST can start: enable any trace whose request event was not seen.
        setTimeout(()=>traces.enableAll(),Math.max(0,armed.dispatchDeadlineMs+100-nowMs())).unref();
        try{
          releaseClock=TrustedReleaseClock.fromOffset(clockOffsetMs,{method:'prewarm-anchor',sampleCount:0});
          const recorder=startCriticalPath(releaseClock,releaseMs,new Map(armed.attempts.flatMap(attempt=>{
            const session=sessionFor(attempt.attempt);return session?[[attempt.attempt.id,session.page] as const]:[];})));
          // One critical-path row per child: the tab's transport observations are aliased onto its attempt ID.
          for(const attempt of armed.attempts){recorder.alias(transportKeyFor(attempt.attempt),attempt.attempt.id);
            recorder.describe(attempt.attempt.id,{parentGoalId:attempt.target.targetKey,workerId:attempt.target.workerId,fanOutIndex:attempt.attempt.fanOutIndex,
              fanOutCount:attempt.attempt.fanOutCount,configuredOffsetMs:attempt.triggerMs-releaseMs,wave:'WAVE_1'});}
          const outcome=await dispatchArmedPrecisionRace(armed,{clock:releaseClock,spinTailMs:DEFAULT_SPIN_TAIL_MS,
            refreshClock:()=>refreshArmedClock(releaseClock!,releaseMs),onPrewarmWindow:prewarmWindowStage,
            ...fanOutPrewarm(armed.attempts),
            isAborted:()=>abort.signal.aborted,sleep:pause,transportFor:(_worker,attempt)=>releaseTransports.get(transportKeyFor(attempt.attempt)),
            onWake:triggerMs=>{for(const attempt of armed.attempts)if(attempt.triggerMs===triggerMs)recorder.mark(attempt.attempt.id,'schedulerFired');releaseLockdown?.mark('scheduler-wake');},onMark:(_worker,name,attempt)=>{if(name==='transportCall'){recorder.mark(attempt.attempt.id,'workerInvoked');releaseLockdown?.mark(`transport:${attempt.attempt.id}`);}
              else if(name==='rendererArm')recorder.mark(attempt.attempt.id,'rendererArmSent');},
            ...experimentalRendererDispatch(attempt=>sessionFor(attempt.attempt)?.page,attempt=>releaseTransports.get(transportKeyFor(attempt.attempt))),
            prewarm:async attempt=>{
              const transport=releaseTransports.get(transportKeyFor(attempt.attempt));if(!transport)throw Error('API_CHECKOUT_WORKER_MISSING');
              stage('SECURITY_PREWARM_STARTED',{workerId:attempt.target.workerId});await transport.prepareCheckoutContext();
            },
            onVerifiedHold:async(attempt,hold)=>{
              const session=sessionFor(attempt.attempt)!;
              await completeVerifiedProoflessHold(bindings.get(attempt.attempt.id)!,session,attempt.plan,hold);
              return {state:'QR_READY'};
            },
            // Written only after every ready POST has been started (never on the path to a POST).
            afterFire:async()=>{await liveLock?.dispatching();stage('PRECISION_DISPATCHING',{frozenCount:race.attempts.length});},
            // HIGH (never REALTIME) only for the last second before release until the POSTs have left.
            onFinalApproach:enterReleaseLockdown,
            onReleaseWindowEnd:exitReleaseLockdown,
            onEvent:event=>{
              if(event.kind==='prewarm-ready'){recorder.describe(event.attemptId,{prewarmReadyMs:Math.round((releaseClock?.nowMs()??nowMs())-releaseMs)});
                deferrableStage('SECURITY_PREWARM_READY',{workerId:event.workerId,attemptId:event.attemptId,
                  ...(event.predictedReadyOffsetMs!==undefined?{predictedReadyOffsetMs:event.predictedReadyOffsetMs}:{}),...(event.actualReadyOffsetMs!==undefined?{actualReadyOffsetMs:event.actualReadyOffsetMs}:{}),
                  ...(event.predictionErrorMs!==undefined?{predictionErrorMs:event.predictionErrorMs}:{}),...(event.queueDelayMs!==undefined?{queueDelayMs:event.queueDelayMs}:{}),
                  ...(event.prepDurationMs!==undefined?{prepDurationMs:event.prepDurationMs}:{})});}
              // Informational only: an unready child is refused by armed-dispatch itself, not by this log line.
              else if(event.kind==='prewarm-failed')deferrableStage('SECURITY_PREWARM_FAILED',{workerId:event.workerId,attemptId:event.attemptId,code:event.code??'SECURITY_PREWARM_FAILED'});
              else if(event.kind==='prewarm-retry')deferrableStage('SECURITY_PREWARM_RETRY',{workerId:event.workerId,attemptId:event.attemptId});
              else if(event.kind==='dispatch-start'){const binding=bindings.get(event.attemptId),plan=race.attempts.find(value=>value.id===event.attemptId)?.plan;
                if(binding&&plan){binding.started=performance.now();
                  diagnostics.observe('DIAGNOSTIC_ATTEMPT_STARTED',binding.correlation,{court:plan.courts[0]!.court,startTime:plan.startTime,durationHours:plan.durationHours});}}
              else if(event.kind==='settled'){const binding=bindings.get(event.attemptId);if(binding){
                // A verified hold records its own completion; everything else (including a QR failure) is recorded here, as before.
                if(event.state!=='QR_READY')diagnostics.observe('DIAGNOSTIC_ATTEMPT_COMPLETED',binding.correlation,
                  {workerOutcome:'FAILED',failureCategory:event.code??'CHECKOUT_ATTEMPT_FAILED'});
                unbindProoflessAttempt(binding);}}
            }});
          if(outcome.afterFireError)stage('PRECISION_LOCK_DISPATCHING_FAILED',{code:outcome.afterFireError});
          for(const result of outcome.results){setState(result.attempt.target,result.state,result.code,undefined,result.attempt.id);
            recorder.describe(result.attempt.id,{finalState:result.state,...(result.code?{finalCode:result.code}:{})});}
          // Every attempt has settled: only now is the trace written.
          await persistProviderTraces().catch(()=>undefined);
        }catch(error){
          for(const binding of bindings.values())unbindProoflessAttempt(binding);
          // Reachable only before any POST started (abort, stale clock or another pre-release failure).
          // This live process still holds every unspent permit, so it can prove each attempt unsent.
          await disarmUnfired(armed,safeApiFailureCode(error,'ARMED_NOT_DISPATCHED'),nowMs).catch(()=>[]);
          if(armedNothingFired(armed)){
            for(const attempt of armed.attempts)setState(attempt.target,'NOT_DISPATCHED',safeApiFailureCode(error,'ARMED_NOT_DISPATCHED'),undefined,attempt.attempt.id);
            retainLiveLock=false;await liveLock?.release();liveLock=undefined;
          }
          throw error;
        }
      }
      await persistLatestVerifiedHold();
      const summaryStates=fanOut?targets.flatMap(target=>{const children=completedAttempts.filter(attempt=>attempt.target.workerId===target.workerId);
        return children.length?children.map(attempt=>states.get(attempt.id)??'NOT_DISPATCHED'):Array(target.fanOutReleaseOffsetsMs?.length??1).fill(states.get(target.workerId)??'NOT_DISPATCHED') as PrecisionAttemptState[];}):
        targets.map(target=>states.get(target.workerId)??'NOT_DISPATCHED');
      const summary=reducePrecisionOutcome(summaryStates);
      stage('PRECISION_OUTCOME',{outcome:summary.outcome,verifiedCount:summary.verifiedCount,unknownCount:summary.unknownCount,
        rejectedCount:summary.rejectedCount,unsentCount:summary.unsentCount,qrAttention:summary.qrAttention});
      // Release the lock only when nothing can have been held; otherwise keep it for review.
      if(summary.lockReleasable){retainLiveLock=false;await liveLock?.release();liveLock=undefined;}
      else retainLiveLock=true;
      if(!summary.achieved)throw Error(summary.outcome);
    };
    const runPhase3=async()=>{
      const draft=phase3!,releaseMs=command.releaseMs??releaseMsForTargetDate(config,command.date),date=command.date;
      const authorization=authorizePrecision({date,releaseMs,candidates:draft.candidates,
        wave1:draft.wave1.map(value=>({workerId:value.workerId,candidateId:precisionCandidateId(date,draft.candidates[value.candidateIndex]!),
          ...(value.fanOutOffsetsMs?{fanOutOffsetsMs:value.fanOutOffsetsMs}:value.releaseOffsetMs?{releaseOffsetMs:value.releaseOffsetMs}:{})})),
        standby:draft.standby,budgets:draft.budgets,concurrentWave2:draft.concurrentWave2,
        rescueEnabled:draft.rescueEnabled,authorizedAt:new Date(nowMs()).toISOString()});
      const session=new PrecisionSession(authorization),byId=new Map(authorization.candidates.map(value=>[value.id,value]));
      stage('PHASE3_AUTHORIZATION',{candidateCount:authorization.candidates.length,wave1Count:authorization.wave1.length,
        standbyCount:authorization.standby.length,maxWave2:authorization.budgets.wave2,maxRescue:authorization.budgets.rescue,
        maxTotal:authorization.budgets.total,fingerprint:authorization.fingerprint});
      for(const candidate of authorization.candidates)stage('PHASE3_CANDIDATE',{candidateId:candidate.id,court:candidate.court,
        startTime:candidate.start,endTime:candidate.end,durationHours:candidate.durationHours,priority:candidate.priority,
        amount:candidate.expectedAmount,rateStatus:candidate.rateEvidence.status,source:candidate.rateEvidence.source});
      if(authorization.warning)stage('PHASE3_DIVERSIFICATION_WARNING',{message:authorization.warning});
      if(command.mode==='dry'){
        stage('PHASE3_DRY_COMPLETE',{candidateCount:authorization.candidates.length,wave1Count:authorization.wave1.length});return;
      }
      if(command.mode!=='live'||nowMs()>releaseMs-20_000)throw Error('PRECISION_TOO_LATE_TO_FREEZE');
      await refreshClockBeforeRelease(releaseMs);
      await sleepUntil(releaseMs-2*60_000);
      assertClockFresh();
      for(const candidate of authorization.candidates){
        const journal=new DurableSubmissionJournal(resolve('.local/api-booking/api-first-journals',candidate.logicalKey));
        if(await journal.peekDisposition(candidate.logicalKey).catch(()=>'blocked' as const)==='blocked')
          throw Error('PHASE3_PRIOR_JOURNAL_UNRESOLVED');
      }
      // Freeze-time public evidence for immediate targets: a target that now shows a known public booking is left out
      // (visibly), unless the operator deliberately force-included it (OPERATOR_OVERRIDE_PUBLIC_CONFLICT), in which case it
      // is kept with a warning. A failed read is reported but never removes an operator-authorized target.
      const freezeEvidence=await readEvidence(date,releaseMs,'FREEZE');
      stage('PHASE3_EVIDENCE_READ',{checkpoint:'FREEZE',availabilityState:freezeEvidence.snapshot?freezeEvidence.dateState:'READ_FAILED',
        ok:!!freezeEvidence.snapshot&&!freezeEvidence.failedCourts.length,...(freezeEvidence.failedCourts.length?{failedCourts:freezeEvidence.failedCourts.join(',')}:{})});
      const conflictExcluded=new Set<string>();
      for(const assignment of authorization.wave1){
        const candidate=byId.get(assignment.candidateId)!,result=classifyTargetEvidence(candidate,freezeEvidence,date);
        const conflict=result.evidence==='PUBLIC_BOOKING_PRESENT'||result.evidence==='UNAVAILABLE_WITH_PUBLIC_BOOKING';
        if(conflict&&candidate.publicEvidence?.override==='OPERATOR_OVERRIDE_PUBLIC_CONFLICT')
          stage('PHASE3_OVERRIDE_KEPT',{workerId:assignment.workerId,candidateId:candidate.id,evidence:result.evidence,code:'OPERATOR_OVERRIDE_PUBLIC_CONFLICT'});
        else if(conflict){conflictExcluded.add(candidate.id);
          stage('PHASE3_WAVE1_EXCLUDED',{workerId:assignment.workerId,candidateId:candidate.id,evidence:result.evidence,code:'PUBLIC_BOOKING_CONFLICT_AT_FREEZE'});}
        else if(result.evidence==='UNKNOWN')stage('PHASE3_EVIDENCE_UNKNOWN',{workerId:assignment.workerId,candidateId:candidate.id,evidence:result.evidence});
      }
      const wave1:Array<Pick<PrecisionAttempt,'target'|'plan'|'dispatchTimingPolicy'>>=[];
      // Each immediate target's Release Offset(s) come from the saved plan (covered by the plan and authorization fingerprints).
      // A fan-out target becomes one independently tracked child per offset (fan-out index = offset order), each on its own tab.
      const wave1Offsets=new Map<WorkerId,number>(authorization.wave1.map(value=>[value.workerId,value.fanOutOffsetsMs?.[0]??value.releaseOffsetMs??0]));
      for(const assignment of authorization.wave1){
        const candidate=byId.get(assignment.candidateId)!;
        if(conflictExcluded.has(candidate.id))continue;
        if(unavailableWorkers.has(assignment.workerId)||!releaseTransports.has(transportKeyOf(assignment.workerId,0))){
          stage('PHASE3_WORKER_EXCLUDED',{workerId:assignment.workerId,candidateId:candidate.id});continue;
        }
        const journal=new DurableSubmissionJournal(resolve('.local/api-booking/api-first-journals',candidate.logicalKey));
        if(await journal.recycleReusable(candidate.logicalKey).catch(()=>'blocked' as const)==='blocked'){
          stage('PHASE3_JOURNAL_BLOCKED',{workerId:assignment.workerId,candidateId:candidate.id});continue;
        }
        const plan=pricedPrecisionPlan(candidate,date,candidate.rateEvidence.perHour);
        const offsets=assignment.fanOutOffsetsMs??[assignment.releaseOffsetMs??0];
        for(const [child,offset] of offsets.entries()){
          // A missing child tab removes only that child (provably unsent); the other children stay eligible.
          if(!releaseTransports.has(transportKeyOf(assignment.workerId,child))){
            stage('PHASE3_WORKER_EXCLUDED',{workerId:assignment.workerId,candidateId:candidate.id,fanOutIndex:child,code:'FAN_OUT_TAB_MISSING'});continue;
          }
          wave1.push({...(config.STRATEGY_V2?.shotgun?.enabled && config.STRATEGY_V2.shotgun.exactSchedule.some(s=>s.logicalTargetId===logicalTargetId(candidate)&&s.configuredOffsetMs===offset)?{dispatchTimingPolicy:'SHOTGUN_STRICT' as const}:{}),target:{court:candidate.court,start:candidate.start,durationHours:candidate.durationHours,
            end:candidate.end,workerId:assignment.workerId,targetKey:candidate.logicalKey,assumedAmount:candidate.expectedAmount,
            ...(offset?{releaseOffsetMs:offset}:{})},plan});
        }
        stage('PHASE3_WAVE1_PRICE',{workerId:assignment.workerId,candidateId:candidate.id,amount:candidate.expectedAmount,
          source:candidate.rateEvidence.source,rateStatus:candidate.rateEvidence.status,capturedAt:candidate.rateEvidence.capturedAt,
          ...(offsets.length>1?{fanOutCount:offsets.length}:{})});
      }
      if(config.STRATEGY_V2?.shotgun?.enabled){
        const required=authorization.wave1.reduce((n,a)=>n+(a.fanOutOffsetsMs?.length??1),0);
        if(wave1.length!==required)throw Error('SHOTGUN_TOPOLOGY_NOT_READY');
        for(const a of authorization.wave1){const browser=sessions.find(s=>s.workerId===a.workerId);
          if(!browser || browser.pages.length<(a.fanOutOffsetsMs?.length??1) || browser.pages.some(p=>p.isClosed()||p.url()!==ONDA_URL))throw Error('SHOTGUN_TOPOLOGY_NOT_READY');}
      }
      const savedObjective=config.STRATEGY_V2?.objective;
      const frozen=savedObjective?freezePrecisionRace(date,releaseMs,wave1,{objective:savedObjective.scope==='ANY_WING'?{scope:'ANY_WING',wings:Object.fromEntries(Object.entries(savedObjective.wings).map(([wing,q])=>[wing,q!.ideal])),overall:savedObjective.overall!.ideal}
        :{scope:'PER_WING',wings:Object.fromEntries(Object.entries(savedObjective.wings).map(([wing,q])=>[wing,q!.ideal]))}}):freezePrecisionRace(date,releaseMs,wave1);
      if(savedObjective)stage('PHASE3_OBJECTIVE_QUOTA',{scope:savedObjective.scope,mango:savedObjective.wings.MANGO?.ideal??0,buko:savedObjective.wings.BUKO?.ideal??0});
      const savedShotgun=config.STRATEGY_V2?.shotgun;
      const shotgunTopology=deriveShotgunTopology(frozen.attempts.map(value=>{const candidate=authorization.candidates.find(candidate=>candidate.logicalKey===value.target.targetKey)!;
        return {id:value.id,logicalTargetId:logicalTargetId(candidate),configuredOffsetMs:value.target.releaseOffsetMs??0};}),savedShotgun?.enabled?savedShotgun.exactSchedule:[]);
      const fanOutWidth=Math.max(1,...frozen.attempts.map(attempt=>attempt.fanOutCount));
      await saveOnce(resolve('.local/api-booking/precision-races'),`${progressLog.runId}-phase3-freeze.json`,
        {runId:progressLog.runId,frozenAt:new Date(nowMs()).toISOString(),authorization,wave1Freeze:frozen.fingerprint,
          shotgun:config.STRATEGY_V2?.shotgun?{enabled:config.STRATEGY_V2.shotgun.enabled,budget:config.STRATEGY_V2.shotgun.budget,
            selectedLogicalTargets:config.STRATEGY_V2.shotgun.selectedTargetIds,allocationMode:config.STRATEGY_V2.shotgun.allocationMode,
            counts:config.STRATEGY_V2.shotgun.counts,windowStartMs:config.STRATEGY_V2.shotgun.windowStartMs,windowEndMs:config.STRATEGY_V2.shotgun.windowEndMs,
            timingMode:config.STRATEGY_V2.shotgun.timingMode,customOffsetsMs:config.STRATEGY_V2.shotgun.customOffsetsMs,
            timingCapacityOverride:config.STRATEGY_V2.shotgun.timingCapacityOverride??config.STRATEGY_V2.shotgun.capacityOverride??false,
            allowStandbyConsumption:config.STRATEGY_V2.shotgun.allowStandbyConsumption??false,exactSchedule:config.STRATEGY_V2.shotgun.exactSchedule,
            groupAnchor:config.STRATEGY_V2.timingCalibration??null}:{enabled:false}});
      if(config.RELEASE_LAB){
        const createdAt=new Date(nowMs()).toISOString();
        await saveOnce(resolve('.local/api-booking/precision-races'),`${progressLog.runId}-release-lab.json`,{
          version:1,runId:progressLog.runId,authorizationFingerprint:authorization.fingerprint,createdAt,
          experiment:{...config.RELEASE_LAB,createdAt,rows:authorization.wave1.map(assignment=>{
            const candidate=byId.get(assignment.candidateId)!;
            return {workerId:assignment.workerId,candidateId:candidate.id,durationHours:candidate.durationHours,
              releaseOffsetMs:wave1Offsets.get(assignment.workerId)??0};
          })}
        });
        stage('RELEASE_LAB_FROZEN',{candidateCount:authorization.wave1.length,fingerprint:authorization.fingerprint});
      }
      stage('PHASE3_FROZEN',{candidateCount:authorization.candidates.length,wave1Count:wave1.length,
        fingerprint:authorization.fingerprint});
      // One binding per child attempt (keyed by the frozen attempt ID); each child captures its response in its own journal directory.
      const childDirectory=(attempt:PrecisionAttempt)=>attempt.fanOutCount>1
        ?resolve('.local/api-booking/api-first-journals',attempt.target.targetKey,'fan-out',frozen.fingerprint,attempt.id)
        :resolve('.local/api-booking/api-first-journals',attempt.target.targetKey);
      const candidateOf=(attempt:Pick<PrecisionAttempt,'target'>)=>authorization.candidates.find(value=>value.logicalKey===attempt.target.targetKey)!;
      const pageOf=(attempt:PrecisionAttempt)=>{const base=sessions.find(value=>value.workerId===attempt.target.workerId);return base?.pages[attempt.fanOutIndex]??base?.page;};
      const bindings=new Map(frozen.attempts.map(attempt=>{
        const workerId=attempt.target.workerId,lane=diagnosticLaneForWorker(workerId),candidate=candidateOf(attempt);
        activeWaveContexts.set(workerId,{candidateId:candidate.id,wave:'WAVE_1'});
        return [attempt.id,bindProoflessAttempt({plan:attempt.plan,workerId,lane,attemptType:'official',
          attemptId:diagnostics.nextAttemptId(lane,workerId,'official'),transportKey:transportKeyOf(workerId,attempt.fanOutIndex),
          directory:childDirectory(attempt)},'DIAGNOSTIC_ATTEMPT_ARMED')] as const;
      }));
      if(fanOutWidth>1)for(const attempt of frozen.attempts)stage('PHASE3_FAN_OUT_CHILD',{workerId:attempt.target.workerId,candidateId:candidateOf(attempt).id,
        attemptId:bindings.get(attempt.id)!.correlation.attemptId,fanOutIndex:attempt.fanOutIndex,fanOutCount:attempt.fanOutCount,releaseOffsetMs:attempt.target.releaseOffsetMs??0,...shotgunTopology.get(attempt.id)!});
      const armed=await armPrecisionRace(frozen,{lock:liveLock,customerFor:worker=>customers![worker]!,
        journalRoot:resolve('.local/api-booking/api-first-journals'),releaseMs,now:nowMs});
      retainLiveLock=true;
      for(const attempt of armed.attempts)scheduledTrigger(releaseMs,attempt.triggerMs,attempt.target.workerId);
      const traces=providerTraces=new ProviderTraceSet(progressLog.runId,'release',releaseMs,()=>(releaseClock?.nowMs()??nowMs())-releaseMs);
      for(const attempt of armed.attempts){const page=pageOf(attempt.attempt);
        if(page)traces.start({workerId:transportKeyOf(attempt.target.workerId,attempt.attempt.fanOutIndex),attemptId:bindings.get(attempt.attempt.id)?.correlation.attemptId,
          court:attempt.target.court,startTime:attempt.target.start,endTime:attempt.target.end},openTraceSession(page));}
      setTimeout(()=>traces.enableAll(),Math.max(0,armed.dispatchDeadlineMs+100-nowMs())).unref();
      // Standby security is genuine and refreshed separately. Its failure never blocks Wave 1.
      const standbyReady=(async()=>{await sleepUntil(releaseMs-30_000).catch(()=>undefined);
        if(abort.signal.aborted)return;
        await Promise.allSettled(authorization.standby.map(async workerId=>{
          const transport=releaseTransports.get(workerId);if(!transport)throw Error('API_CHECKOUT_WORKER_MISSING');
          try{await transport.prepareCheckoutContext();stage('PHASE3_STANDBY_READY',{workerId});}
          catch(error){stage('PHASE3_STANDBY_FAILED',{workerId,code:safeApiFailureCode(error,'SECURITY_PREWARM_FAILED')});}
        }));})();
      let newestSeq=0,securityRefreshMs=2500,wave1Fired=false,wave1Settled=false,adaptiveStopped=false;
      let providerStopCode:string|undefined;
      const receivedEvidence:AvailabilityObservation[]=[];
      const pending=new Set<Promise<unknown>>();
      // A newer Slot Watch read no longer ends the attempt by itself: each checkpoint re-evaluates the
      // newest read for the SAME candidate (adaptive-attempt.ts) and adopts it as the effective evidence.
      // Rescue V2: reopen predictions (reopen-prediction.ts) only PREPARE a Rescue worker before a likely reopening; a Rescue
      // send still needs a fresh unavailable -> open observation, selection, revalidation, reservation and the pre-POST gate.
      const rescueRanges=authorization.rescueEnabled?authorization.candidates.filter(value=>value.permissions.rescue)
        .map(value=>({id:value.id,court:value.court,start:value.start,durationHours:value.durationHours})):[];
      const predictions=new Map<string,ReopenPrediction>(),decodedReads=new Map<number,Map<string,string>>();
      let rescuePrewarms=0,rescuePreparing:WorkerId|undefined;
      const contextAge=(worker:WorkerId)=>releaseTransports.get(worker)?.preparedContextAgeMs();
      /** Workers with a usable prepared context are preferred for Wave 2 and Rescue. */
      const workerRank=(worker:WorkerId)=>{const age=contextAge(worker);return age!==undefined&&age>=0&&age<=RESCUE_CONTEXT_REUSE_MS?0:1;};
      const dispatchAdaptive=(selection:AdaptiveSelection,wave:'WAVE_2'|'RESCUE')=>{
        const {candidate,workerId}=selection;
        // Selection instant (telemetry: detection -> dispatch for Wave 2 and Rescue).
        stage('PHASE3_ADAPTIVE_SELECTED',{workerId,candidateId:candidate.id,wave,evidenceSeq:selection.evidenceSeq,contextReused:(contextAge(workerId)??Infinity)<=RESCUE_CONTEXT_REUSE_MS});
        const predicted=wave==='RESCUE'?predictions.get(candidate.id):undefined,observed=session.latest?.observation.responseOffsetMs;
        if(predicted&&observed!==undefined){const outcome=predictionError(predicted,observed);
          stage('RESCUE_PREDICTION_OUTCOME',{candidateId:candidate.id,workerId,errorMs:outcome.errorMs,ok:outcome.insideWindow,confidence:predicted.confidence,
            contextReused:(contextAge(workerId)??Infinity)<=RESCUE_CONTEXT_REUSE_MS});}
        const journal=new DurableSubmissionJournal(resolve('.local/api-booking/api-first-journals',candidate.logicalKey));
        const task=runAdaptiveAttempt(selection,wave,{session,date,now:nowMs,dispatchNow:()=>releaseClock?.nowMs()??nowMs(),
          newestSeq:()=>newestSeq,securityRefreshMs:()=>securityRefreshMs,aborted:()=>abort.signal.aborted||!!providerStopCode,verifiedHold:()=>verifiedHold,
          workerReady:()=>releaseTransports.has(workerId)&&!unavailableWorkers.has(workerId),
          prepareSecurity:async()=>{
            const started=performance.now();
            // An unused context prepared within the last minute (standby at T-30 s, or a Rescue prewarm before a predicted
            // reopening) is reused; the transport still refuses anything older than 120 s at the POST.
            try{await releaseTransports.get(workerId)!.prepareCheckoutContext(false,RESCUE_CONTEXT_REUSE_MS);securityRefreshMs=Math.max(securityRefreshMs,performance.now()-started);}
            catch(error){stage('PHASE3_SECURITY_FAILED',{workerId,candidateId:candidate.id,code:safeApiFailureCode(error,'SECURITY_PREWARM_FAILED')});throw error;}
          },
          journalReusable:async()=>{
            if(await journal.recycleReusable(candidate.logicalKey).catch(()=>'blocked' as const)!=='blocked')return true;
            stage('PHASE3_JOURNAL_BLOCKED',{workerId,candidateId:candidate.id});return false;
          },
          reserve:async({plan,prices,evidenceSeq,selectedEvidenceSeq})=>{
            const attempt=makeProoflessAttempts([plan],[workerId])[0]!;
            activeWaveContexts.set(workerId,{candidateId:candidate.id,wave,
              evidenceSeq:()=>session.attempts.find(value=>value.id===attempt.attemptId)?.evidenceSeq});
            traces.updateContext(workerId,{workerId,attemptId:attempt.attemptId,court:candidate.court,startTime:candidate.start,endTime:candidate.end});
            // evidenceSeq is the effective evidence at reservation; a later pre-POST rebase is logged as PHASE3_EVIDENCE_REBASED.
            await saveOnce(resolve('.local/api-booking/precision-races'),`${progressLog.runId}-${attempt.attemptId}.json`,
              {runId:progressLog.runId,authorizationFingerprint:authorization.fingerprint,candidateId:candidate.id,
                workerId,wave,evidenceSeq,selectedEvidenceSeq,prices,evaluatedAt:new Date(nowMs()).toISOString()});
            return {attemptId:attempt.attemptId,dispatch:beforePost=>executeProoflessAttempt(attempt,undefined,{requirePreparedContext:true,beforePost}).then(()=>undefined)};
          },
          classifyFailure:error=>classifyPrecisionDispatchError(error,async()=>{
            try{return (await journal.read(candidate.logicalKey)).state;}catch{return undefined;}}),
          failureCode:error=>safeApiFailureCode(error,'PHASE3_ADAPTIVE_FAILED'),
          event:(name,extra)=>stage(name,extra)});
        pending.add(task);void task.finally(()=>pending.delete(task));
      };
      const adaptiveLoop=(async()=>{
        while(!abort.signal.aborted&&!adaptiveStopped&&!providerStopCode&&nowMs()<releaseMs+15*60_000){
          if (!shouldContinueAdaptiveRun(authorization, { wave1Settled, wave1Fired, pending: pending.size })) break;
          // Slot Watch keeps collecting in its isolated process. Defer adaptive calculations, logs
          // and standby work until the strict initial-release timing interval has ended.
          if(config.STRATEGY_V2?.shotgun?.enabled && shotgunCriticalInterval(releaseMs,nowMs())){
            await pause(Math.min(250,Math.max(1,releaseMs+1000-nowMs()))).catch(()=>undefined);continue;
          }
          for(const observation of phase3Observations.splice(0)){
            receivedEvidence.push(observation);
            const operational=freshestAvailabilityObservation(receivedEvidence);
            newestSeq=operational?.seq??0;
            const latency=Math.max(0,observation.responseOffsetMs-observation.requestOffsetMs);
            const maxAge=adaptiveMaxAgeMs(latency,securityRefreshMs);
            const evidence=classifyActionableObservation(observation,newestSeq,releaseMs,nowMs(),maxAge);
            stage('PHASE3_EVIDENCE',{seq:observation.seq,fitness:evidence.fitness,cache:observation.cache?.status??'UNKNOWN',
              operational:operational?.seq===observation.seq});
            if(!operational)continue;
            const fresh=adaptiveFitness(operational,newestSeq,releaseMs,nowMs(),securityRefreshMs);
            session.observe(fresh);
            // Predictions are recomputed from every fresh-enough read after the first minute (off the release window).
            if(rescueRanges.length&&observation.responseOffsetMs>60_000)for(const prediction of predictReopenings(rescueRanges,receivedEvidence,{decoded:decodedReads})){
              const known=predictions.get(prediction.candidateId);
              if(known?.epochSeq===prediction.epochSeq&&known.windowEndMs===prediction.windowEndMs)continue;
              predictions.set(prediction.candidateId,prediction);
              stage('RESCUE_PREDICTION',{candidateId:prediction.candidateId,seq:prediction.epochSeq,predictedStartMs:prediction.windowStartMs,
                predictedEndMs:prediction.windowEndMs,confidence:prediction.confidence});
            }
            if(operational.seq!==observation.seq||!isActionableEvidenceFitness(fresh.fitness))continue;
            if(authorization.rescueEnabled&&pending.size===0)
              for(const choice of session.select('RESCUE',nowMs(),maxAge,{workerRank}))dispatchAdaptive(choice,'RESCUE');
          }
          const current=session.latest;
          if(current&&wave1Fired&&(authorization.concurrentWave2||wave1Settled)){
            const latency=Math.max(0,current.observation.responseOffsetMs-current.observation.requestOffsetMs);
            const maxAge=adaptiveMaxAgeMs(latency,securityRefreshMs);
            for(const choice of session.select('WAVE_2',nowMs(),maxAge,{workerRank}))dispatchAdaptive(choice,'WAVE_2');
          }
          // Rescue V2 prewarm: before a predicted window, prepare the worker Rescue would use first. Bounded per release; one
          // preparation at a time; never while an adaptive attempt is in flight; never after an UNKNOWN or a verified hold.
          if(predictions.size&&wave1Settled&&!rescuePreparing&&pending.size===0&&rescuePrewarms<RESCUE_PREWARM_MAX_PER_RELEASE&&!session.adaptiveBlocker('RESCUE')){
            const offset=nowMs()-releaseMs,worker=session.adaptiveWorkers('RESCUE',workerRank)[0];
            const next=worker?[...predictions.values()].find(value=>rescuePrewarmDue(value,offset,contextAge(worker))):undefined;
            if(worker&&next&&releaseTransports.has(worker)&&!unavailableWorkers.has(worker)){
              rescuePreparing=worker;rescuePrewarms++;
              stage('RESCUE_PREWARM',{workerId:worker,candidateId:next.candidateId,predictedStartMs:next.windowStartMs,predictedEndMs:next.windowEndMs,attemptNo:rescuePrewarms});
              const started=performance.now();
              void releaseTransports.get(worker)!.prepareCheckoutContext(true).then(
                ()=>stage('RESCUE_PREWARM_READY',{workerId:worker,candidateId:next.candidateId,durationMs:Math.round(performance.now()-started)}),
                error=>stage('RESCUE_PREWARM_FAILED',{workerId:worker,candidateId:next.candidateId,code:safeApiFailureCode(error,'SECURITY_PREWARM_FAILED')}))
                .finally(()=>{rescuePreparing=undefined;});
            }
          }
          if(verifiedHold||session.attempts.some(value=>value.state==='UNKNOWN'))break;
          await pause(25).catch(()=>undefined);
        }
        await Promise.allSettled([...pending]);
      })();
      try{
        releaseClock=TrustedReleaseClock.fromOffset(clockOffsetMs,{method:'prewarm-anchor',sampleCount:0});
        // Critical-path rows are per child attempt; each tab's transport observations are aliased onto its attempt.
        const recorder=startCriticalPath(releaseClock,releaseMs,new Map(armed.attempts.flatMap(attempt=>{
          const page=pageOf(attempt.attempt);return page?[[attempt.attempt.id,page] as const]:[];})));
        for(const attempt of armed.attempts){recorder.alias(transportKeyOf(attempt.target.workerId,attempt.attempt.fanOutIndex),attempt.attempt.id);
          recorder.describe(attempt.attempt.id,{parentGoalId:candidateOf(attempt.attempt).id,workerId:attempt.target.workerId,fanOutIndex:attempt.attempt.fanOutIndex,
            fanOutCount:attempt.attempt.fanOutCount,configuredOffsetMs:attempt.triggerMs-releaseMs,...shotgunTopology.get(attempt.attempt.id)!,wave:'WAVE_1'});}
        const transportOf=(attempt:ArmedAttempt)=>releaseTransports.get(transportKeyOf(attempt.target.workerId,attempt.attempt.fanOutIndex));
        const outcome=await dispatchArmedPrecisionRace(armed,{clock:releaseClock,spinTailMs:DEFAULT_SPIN_TAIL_MS,isAborted:()=>abort.signal.aborted,sleep:pause,
          refreshClock:()=>refreshArmedClock(releaseClock!,releaseMs),onPrewarmWindow:prewarmWindowStage,
          onObjectiveStop:reason=>{if(reason==='SHOTGUN_PROVIDER_THROTTLE_STOP'||reason==='SHOTGUN_PAYMENT_IN_PROGRESS_STOP')providerStopCode=reason;},
          ...fanOutPrewarm(armed.attempts),
          onWake:triggerMs=>{for(const attempt of armed.attempts)if(attempt.triggerMs===triggerMs)recorder.mark(attempt.attempt.id,'schedulerFired');releaseLockdown?.mark('scheduler-wake');},onMark:(_worker,name,attempt)=>{if(name==='transportCall'){recorder.mark(attempt.attempt.id,'workerInvoked');releaseLockdown?.mark(`transport:${attempt.attempt.id}`);}
            else if(name==='rendererArm')recorder.mark(attempt.attempt.id,'rendererArmSent');},
          ...experimentalRendererDispatch(attempt=>pageOf(attempt.attempt),transportOf),
          transportFor:(_worker,attempt)=>transportOf(attempt),prewarm:async attempt=>{
            const transport=transportOf(attempt);if(!transport)throw Error('API_CHECKOUT_WORKER_MISSING');
            const child=attempt.attempt,candidate=candidateOf(child);stage('SECURITY_PREWARM_STARTED',{workerId:attempt.target.workerId,candidateId:candidate.id,attemptId:bindings.get(child.id)!.correlation.attemptId,
              fanOutIndex:child.fanOutIndex,fanOutCount:child.fanOutCount,...shotgunTopology.get(child.id)!});
            await transport.prepareCheckoutContext();},
          onVerifiedHold:async(attempt,hold)=>{const base=sessions.find(value=>value.workerId===attempt.target.workerId)!;
            await completeVerifiedProoflessHold(bindings.get(attempt.attempt.id)!,{...base,page:pageOf(attempt.attempt)??base.page},attempt.plan,hold);return {state:'QR_READY'};},
          afterFire:async()=>{await liveLock?.dispatching();},
          onFinalApproach:enterReleaseLockdown,
          onReleaseWindowEnd:exitReleaseLockdown,
          onEvent:event=>{const binding=bindings.get(event.attemptId),child=frozen.attempts.find(value=>value.id===event.attemptId);
            if(event.kind==='prewarm-ready'){recorder.describe(event.attemptId,{prewarmReadyMs:Math.round((releaseClock?.nowMs()??nowMs())-releaseMs)});
              if(binding&&child)deferrableStage('SECURITY_PREWARM_READY',{workerId:event.workerId,candidateId:candidateOf(child).id,attemptId:binding.correlation.attemptId,
                fanOutIndex:child.fanOutIndex,fanOutCount:child.fanOutCount,
                ...(event.predictedReadyOffsetMs!==undefined?{predictedReadyOffsetMs:event.predictedReadyOffsetMs}:{}),...(event.actualReadyOffsetMs!==undefined?{actualReadyOffsetMs:event.actualReadyOffsetMs}:{}),
                ...(event.predictionErrorMs!==undefined?{predictionErrorMs:event.predictionErrorMs}:{}),...(event.queueDelayMs!==undefined?{queueDelayMs:event.queueDelayMs}:{}),
                ...(event.prepDurationMs!==undefined?{prepDurationMs:event.prepDurationMs}:{}),...shotgunTopology.get(child.id)!});}
            if(event.kind==='prewarm-failed'&&binding&&child)deferrableStage('SECURITY_PREWARM_FAILED',{workerId:event.workerId,candidateId:candidateOf(child).id,attemptId:binding.correlation.attemptId,code:event.code??'SECURITY_PREWARM_FAILED',
              fanOutIndex:child.fanOutIndex,fanOutCount:child.fanOutCount,...shotgunTopology.get(child.id)!});
            const fanOut:Record<string,number|string>=child?{...(child.fanOutCount>1?{fanOutIndex:child.fanOutIndex,fanOutCount:child.fanOutCount}:{}),...shotgunTopology.get(child.id)!}:{};
            if(event.kind==='dispatch-start'&&binding&&child){wave1Fired=true;const candidate=candidateOf(child);
              session.record({id:binding.correlation.attemptId,candidateId:candidate.id,workerId:event.workerId,wave:'WAVE_1',state:'IN_FLIGHT',...fanOut});
              stage('PHASE3_WAVE1_STARTED',{workerId:event.workerId,candidateId:candidate.id,wave:'WAVE_1',attemptId:binding.correlation.attemptId,
                court:candidate.court,startTime:candidate.start,endTime:candidate.end,amount:candidate.expectedAmount,...fanOut});}
            if(event.kind==='settled'&&binding){const attempt=session.attempts.find(value=>value.id===binding.correlation.attemptId);
              // A provably unsent child (refused before its transport sent anything) consumes no budget and never reads as UNKNOWN.
              if(attempt)attempt.state=event.state==='REJECTED'?'REJECTED':event.state==='QR_READY'||event.state==='HOLD_VERIFIED_QR_ATTENTION'?'VERIFIED':
                event.state&&PRECISION_UNSENT_STATES.has(event.state)?'NOT_DISPATCHED':'UNKNOWN';
              stage('PHASE3_SETTLED',{workerId:event.workerId,candidateId:attempt?.candidateId??(child?candidateOf(child).id:''),wave:'WAVE_1',
                attemptId:binding.correlation.attemptId,state:event.state??'UNKNOWN',...(event.code?{code:event.code}:{}),...fanOut});
              unbindProoflessAttempt(binding);}
          }});
        wave1Settled=true;
        stage('PHASE3_WAVE1_COMPLETE',{attemptCount:outcome.results.length,
          unsentCount:outcome.results.filter(result=>PRECISION_UNSENT_STATES.has(result.state)).length});
        for(const result of outcome.results)recorder.describe(result.attempt.id,{finalState:result.state,...(result.code?{finalCode:result.code}:{})});
        for(const result of outcome.results){const binding=bindings.get(result.attempt.id);
          if(!binding||!session.attempts.some(value=>value.id===binding.correlation.attemptId))
            stage('PHASE3_WAVE1_UNSENT',{workerId:result.attempt.target.workerId,candidateId:candidateOf(result.attempt).id,
              ...(binding?{attemptId:binding.correlation.attemptId}:{}),state:result.state,...(result.code?{code:result.code}:{}),
              fanOutIndex:result.attempt.fanOutIndex,fanOutCount:result.attempt.fanOutCount,...shotgunTopology.get(result.attempt.id)!});}
        await standbyReady;
        await adaptiveLoop;
        await persistLatestVerifiedHold();
        if(providerStopCode&&!verifiedHold){stage('PHASE3_PROVIDER_STOPPED',{code:providerStopCode});throw Error(providerStopCode);}
        await persistProviderTraces().catch(()=>undefined);
        stage('PHASE3_OUTCOME',{outcome:session.status,verifiedCount:session.attempts.filter(value=>value.state==='VERIFIED').length,
          unknownCount:session.attempts.filter(value=>value.state==='UNKNOWN').length,attemptCount:session.attempts.length,
          unsentCount:session.attempts.filter(value=>value.state==='NOT_DISPATCHED').length});
        if(session.status==='ALL_REJECTED_WAITING_FOR_REOPEN'||session.status==='NOTHING_DISPATCHED'){
          retainLiveLock=false;await liveLock?.release();liveLock=undefined;
        }
        if(session.status!=='OBJECTIVE_ACHIEVED'&&session.status!=='OBJECTIVE_ACHIEVED_EXTRA_HOLD')throw Error(session.status);
      }catch(error){adaptiveStopped=true;await disarmUnfired(armed,safeApiFailureCode(error,'ARMED_NOT_DISPATCHED'),nowMs).catch(()=>[]);
        await adaptiveLoop;
        await persistProviderTraces().catch(()=>undefined);throw error;}
    };
    if(phase3)await runPhase3();
    else if(precisionTargets)await runPrecision(precisionTargets);
    else {
    const preferences:BookingPreferences={wing:requested?.wing,mode:strategy,targetDate:command.date,durationHours:duration,
      preferredStartTimes:[requested?.start??config.START_TIME],fallbackStartTimes:requested?.fallbackStarts??config.FALLBACK_TIMES,
      courtPriority:requested?.priority??config.PREFERRED_COURTS,fallbackCourts:requested?[]:config.FALLBACK_COURTS,
      courtCount,exactCourts:requested?.exact,maximumTotalPrice:requested?.maximum??config.MAX_PRICE,currency:'PHP'};
    let primaryProoflessPlans:BookingPlan[]|undefined;
    let primaryProoflessAttempts:ProoflessAttempt[]|undefined;
    if(command.checkoutMethod==='proofless'){
      // A scheduled release starts this same warmup shortly before 08:00. An
      // immediate Proofless Test has no waiting window, so overlap genuine,
      // page-bound security acquisition with the read-only block audit and
      // journal checks instead of paying for it after dispatch is announced.
      if(command.mode==='live-now')startWarmup(workerIds);
      const auditReleaseMs=command.releaseMs??releaseMsForTargetDate(config,command.date);
      if(command.mode==='live'){
        stage('WAITING_FOR_BLOCK_AUDIT',{releaseMs:command.releaseMs!});
        await sleepUntil(command.releaseMs!-30*60_000);
      }
      // The immediate Test path sends the operator-confirmed cells, so it reads once for display only.
      const evidence=await readEvidence(command.date,auditReleaseMs,command.mode==='live'?'T-30M':command.mode==='dry'?'PREPARE':'TEST',command.mode!=='live-now');
      const blockAudit=prooflessCourtHourStatuses(evidence.snapshot,command.date,evidence.blocks,evidence.failedCourts,
        {releaseMs:auditReleaseMs,...(evidence.observedAtMs!==undefined?{observedAtMs:evidence.observedAtMs}:{})});
      for(const value of blockAudit)trace('COURT_HOUR_STATUS',{court:value.court,hour:value.hour,status:value.status,source:value.source,...(value.price!==undefined?{price:value.price}:{})});
      emitUiEvent({type:'blockAudit',date:command.date,cells:blockAudit});
      stage('PRE_RELEASE_AUDIT_RESULT',{availabilityState:evidence.snapshot?evidence.dateState:'READ_FAILED',ok:!!evidence.snapshot&&!evidence.failedCourts.length,
        ...(evidence.failedCourts.length?{failedCourts:evidence.failedCourts.join(',')}:{})});
      if(command.mode!=='live-now'){
        // Say why, instead of the generic "no unblocked configuration".
        if(!evidence.snapshot)throw Error('DIRECT_AVAILABILITY_READ_FAILED');
        if(evidence.dateState==='UNKNOWN')throw Error('DIRECT_TARGET_DATE_STATE_UNKNOWN');
      }
      const releasePlan=command.mode==='live-now'?prooflessReleasePlan(preferences):resolveProoflessReleasePlan(preferences,evidence.snapshot,evidence.blocks,evidence.failedCourts,
        {releaseMs:auditReleaseMs,...(evidence.observedAtMs!==undefined?{observedAtMs:evidence.observedAtMs}:{})});
      for(const court of releasePlan.courts){
        const target=classifyTargetEvidence({court:court.court,start:releasePlan.startTime,durationHours:releasePlan.durationHours},evidence,command.date);
        stage('PROOFLESS_TARGET_EVIDENCE',{court:court.court,startTime:releasePlan.startTime,durationHours:releasePlan.durationHours,
          evidence:target.evidence,eligible:target.eligible});
      }
      primaryProoflessPlans=standardCheckoutChunks(releasePlan);
      if(primaryProoflessPlans.length!==workerIds.length)throw Error('DIRECT_WORKER_PLAN_MISMATCH');
      if(command.mode!=='dry'){
        primaryProoflessAttempts=makeProoflessAttempts(primaryProoflessPlans,workerIds);
        // Wire self-check before release (wire-payload-check.ts); submitDirectCheckout re-checks the exact bytes it sends.
        try{for(const attempt of primaryProoflessAttempts)preflightProoflessWire(attempt.plan,attempt.customer);}
        catch(error){stage('WIRE_PAYLOAD_SELF_CHECK',{outcome:'FAILED',targetCount:primaryProoflessAttempts.length,
          ...(error instanceof WirePayloadError?{message:error.detail.slice(0,240)}:{})});throw Error('WIRE_PAYLOAD_SELF_CHECK_FAILED');}
        stage('WIRE_PAYLOAD_SELF_CHECK',{outcome:'PASSED',targetCount:primaryProoflessAttempts.length});
        for(const attempt of primaryProoflessAttempts)for(const [index,journal] of attempt.journals.entries()){
          const disposition=await journal.recycleReusable(attempt.keys[index]!);
          if(disposition==='blocked')throw Error('DUPLICATE_LOGICAL_BOOKING_BLOCKED');
          if(disposition==='reused')stage('FINISHED_ATTEMPT_REUSABLE',{workerId:attempt.workerId});
        }
      }
      stage('PRIMARY_PROOFLESS_PLAN_READY',{court:releasePlan.courts[0]!.court,
        ...(releasePlan.courts[1]?{courtB:releasePlan.courts[1].court}:{}),date:command.date,startTime:releasePlan.startTime,
        durationHours:releasePlan.durationHours,assumedPrice:releasePlan.totalPrice});
    }
    // Only the pre-planned Proofless Direct dispatch can use a Release Offset; a path that reads availability waits for release.
    const generalTriggerMs=command.mode==='live'?releaseTriggerMs(command.releaseMs!,primaryProoflessPlans?releaseOffsetMs:0):undefined;
    if (command.mode === 'live') {
      const releaseMs = command.releaseMs!, triggerMs = generalTriggerMs!;
      if (triggerMs <= nowMs()) throw Error('RELEASE_MISSED');
      await refreshClockBeforeRelease(releaseMs);
      if (triggerMs <= nowMs()) throw Error('RELEASE_MISSED');
      stage('WAITING_FOR_RELEASE', { releaseMs });
      scheduledTrigger(releaseMs,triggerMs);
      while (nowMs() < triggerMs) {
        ensureActive();const remaining=triggerMs-nowMs();if(remaining<=API_SECURITY_PREWARM_LEAD_MS)startWarmup();
        await pause(Math.min(500,Math.max(1,remaining),warmup?500:Math.max(1,remaining-API_SECURITY_PREWARM_LEAD_MS)));
      }
      assertApiReleaseFresh(releaseMs,nowMs(),triggerMs);stage('RELEASE_TRIGGERED');await finishWarmup();
    }
    ensureActive();
    let discovery:Awaited<ReturnType<typeof discoverApiAvailability>>|undefined;
    let checkoutPlans:BookingPlan[];
    if(primaryProoflessPlans){
      checkoutPlans=primaryProoflessPlans;
    }else{
      stage('FETCHING_AVAILABILITY');
      discovery = await discoverApiAvailability(new OndaBrowserAvailabilityProvider(availabilityPage,{wing:preferences.wing}), preferences);
      ensureActive();
      diagnostics.observe('RELEASE_AVAILABILITY_MATRIX',{},{...availabilityObservation(discovery.snapshot,command.date),
        durationMs:Math.round(discovery.timing.totalMs??0)});
      if(command.mode==='live')for(const value of prooflessCourtHourStatuses(discovery.snapshot,command.date))
        trace('COURT_HOUR_STATUS',{court:value.court,hour:value.hour,status:value.status,...(value.price!==undefined?{price:value.price}:{})});
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
      stage('CANDIDATE_READY', { ...(plan.wing ? {wing:plan.wing} : {}), date: command.date, court: plan.courts[0]!.court,
        ...(plan.courts[1] ? { courtB: plan.courts[1].court } : {}),startTime: plan.startTime,
        durationHours: duration,price: plan.totalPrice,availabilityMs: Math.round(discovery.timing.totalMs ?? 0) });
      checkoutPlans=standardCheckoutChunks(plan);
    }
    if (command.mode === 'dry') {
      // The dry path has no customer lookup, checkout security context, or submission permit.
      stage('DRY_RUN_COMPLETE');
    } else if(primaryProoflessPlans){
      ensureActive();
      const attempts=primaryProoflessAttempts!;
      // This does not submit anything. It only makes the already-started
      // security preparation a prerequisite for entering the dispatch state.
      // Failure therefore remains conclusively pre-dispatch and releases the
      // automation lock through the normal finally path.
      if(command.mode==='live-now')await finishWarmup();
      if(command.mode==='live-now'){
        // Immediate operator test (no release deadline): wait at most 3 s for the passive sessions to attach, then send
        // regardless. Each trace enables Network only after its POST has left, exactly as in a release.
        let referenceMs=nowMs();
        const traces=providerTraces=new ProviderTraceSet(progressLog.runId,'dispatch-start',null,()=>nowMs()-referenceMs);
        for(const attempt of attempts)traces.start({workerId:attempt.workerId,attemptId:attempt.attemptId,court:attempt.plan.courts[0]!.court,
          startTime:attempt.plan.startTime,endTime:attempt.plan.endTime},openTraceSession(attempt.session.page));
        await traces.ready(3_000);
        referenceMs=nowMs();traces.referenceMs=referenceMs;
      }
      await liveLock?.dispatching();retainLiveLock=true;
      stage('PRIMARY_PROOFLESS_DISPATCHING',{workerCount:attempts.length});
      const outcomes=await Promise.allSettled(attempts.map(attempt=>executeProoflessAttempt(attempt,command.releaseMs,{requirePreparedContext:command.mode==='live',
        ...(generalTriggerMs!==undefined?{triggerMs:generalTriggerMs}:{})})));
      await persistProviderTraces().catch(()=>undefined);
      attempts.forEach((attempt,index)=>{const outcome=outcomes[index]!;
        const code=outcome.status==='rejected'&&outcome.reason instanceof Error&&/^[A-Z][A-Z0-9_]{0,79}$/.test(outcome.reason.message)
          ?outcome.reason.message:outcome.status==='rejected'?'DIRECT_WORKER_FAILED':'COMPLETED';
        stage('PRIMARY_PROOFLESS_OUTCOME',{workerId:attempt.workerId,status:outcome.status,code,
          court:attempt.plan.courts[0]!.court,startTime:attempt.plan.startTime,durationHours:attempt.plan.durationHours});});
      await persistLatestVerifiedHold();
      const failures=outcomes.filter((outcome):outcome is PromiseRejectedResult=>outcome.status==='rejected');
      if(failures.length){
        if(!verifiedHold){
          const states=await Promise.all(attempts.flatMap(attempt=>attempt.journals.map((journal,index)=>
            journal.read(attempt.keys[index]!).then(record=>record.state).catch(()=> 'unknown' as const))));
          if(canReleaseApiLockAfterParallelFailure(false,failures.map(failure=>failure.reason),states,attempts.length)){
            retainLiveLock=false;await liveLock?.release();liveLock=undefined;
          }
        }
        throw failures[0]!.reason;
      }
    } else {
      ensureActive();
      const attempts=makeAttempts(checkoutPlans,workerIds,discovery!.snapshot);
      await liveLock?.dispatching();retainLiveLock=true;
      const outcomes=await Promise.allSettled(attempts.map(executeAttempt));
      attempts.forEach((attempt,index)=>{const outcome=outcomes[index]!;
        const code=outcome.status==='rejected'&&outcome.reason instanceof Error&&/^[A-Z][A-Z0-9_]{0,79}$/.test(outcome.reason.message)
          ?outcome.reason.message:outcome.status==='rejected'?'CHECKOUT_WORKER_FAILED':'COMPLETED';
        stage('WORKER_OUTCOME',{workerId:attempt.workerId,status:outcome.status,code,
          court:attempt.chunkPlan.courts[0]!.court,startTime:attempt.chunkPlan.startTime,durationHours:attempt.chunkPlan.durationHours});});
      // Persist the newest verified expiry only after every worker has settled,
      // so the durable lock can never expire earlier than an active hold.
      await persistLatestVerifiedHold();
      const failures=outcomes.filter((outcome):outcome is PromiseRejectedResult=>outcome.status==='rejected');
      if(failures.length){
        if(!verifiedHold){
          const states=await Promise.all(attempts.flatMap(attempt=>attempt.journals.map((journal,index)=>
            journal.read(attempt.keys[index]!).then(record=>record.state).catch(()=> 'unknown' as const))));
          if(canReleaseApiLockAfterParallelFailure(false,failures.map(failure=>failure.reason),states,attempts.length)){
            retainLiveLock=false;await liveLock?.release();liveLock=undefined;
          }
        }
        throw failures[0]!.reason;
      }
    }
    }
  }
} catch (error) {
  if(error instanceof Error&&error.message==='BLOCK_AUDIT_COMPLETE'){
    finalDiagnosticCode='BLOCK_AUDIT_COMPLETE';
  }else{
  const code = safeApiFailureCode(error,'API_FIRST_RUN_FAILED');
  finalDiagnosticCode=code;
  stage('FAILED', { code });
  process.exitCode = 1;
  }
 } finally {
   // This is also required on exceptional exits that bypass the normal summary
   // path: one worker may have created a verified hold before another worker
   // failed. Keep that latest expiry durable before closing browser transports.
   await persistLatestVerifiedHold().catch(()=>{retainLiveLock=true;});
  // Normally already written right after dispatch settled; this covers exceptional exits.
  await persistProviderTraces().catch(()=>undefined);
  // This process attaches to a browser owned by the desktop installation.
  // Closing a CDP attachment closes its transport; the independently launched Chrome windows stay open.
  await Promise.allSettled(connectedBrowsers.map(browser => browser.close()));
  if(liveLock&&!retainLiveLock)await liveLock.release().catch(()=>undefined);
  diagnostics.finish(finalDiagnosticCode,finalDiagnosticCode==='USER_ABORT');
  progressLog.record('PROCESS_EXIT', new Date(nowMs()).toISOString(), stamp(), { exitCode: process.exitCode ?? 0 });
  await progressLog.close();
  if (process.connected) process.disconnect();
}
