import { ApiAutomationLock } from './api-booking/api-automation-lock.js';
import { DualWingPlanSchema } from './dual-wing-plan-schema.js';
import { exactReleaseTarget } from './release-target.js';
import { assertLabSlotEvidence } from './lab-slot-evidence.js';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { launchOfflineChrome, closeOfflineChrome, findChrome, syntheticSecurityPreparation, cpuSnapshot, busyPercent, type OfflineChrome } from '../scripts/bench-support.js';
import { compileDualWingPlan, type DualWingPlan, type DualWingTarget } from './dual-wing-plan.js';
import { compileObjective, evaluateObjectiveOutcome, type BookingObjective, type ObjectiveQuota } from './booking-objective.js';
import { evaluateCapability } from './capability-matrix.js';
import { assertVerifiedRelease } from './wing-release-policy.js';
import { raceQuota, type RaceObjective } from './api-booking/precision-race.js';
import type { SmartPhase3 } from './precision-simple.js';
import { freemem, totalmem } from 'node:os';
import { exactShotgunTopology, assertShotgunSchedule } from './shotgun-timing.js';
import { freezePrecisionRace, type PrecisionTarget } from './api-booking/precision-race.js';
import { armPrecisionRace, dispatchArmedPrecisionRace } from './api-booking/armed-dispatch.js';
import { prooflessReleasePlan, type ProoflessCheckoutRequest } from './api-booking/proofless-checkout.js';
import { DurableSubmissionJournal } from './api-booking/durable-submission-journal.js';
import { OndaBrowserSessionTransport } from './api-booking/browser-session-transport.js';
import { TrustedReleaseClock } from './release-clock.js';
import { CriticalPathRecorder } from './api-booking/critical-path.js';
import { FACILITY_ID, courtBySpace, type Wing } from './court-registry.js';
import type { BookingPlan } from './api-booking/types.js';
import type { WorkerId } from './workers.js';

export const LAB_SCENARIOS = ['ALL_REJECTED','FIRST_SUCCESS','SECOND_TARGET_SUCCESS','LATER_SUCCESS','MANGO_SUCCESS','BUKO_SUCCESS','BOTH_SUCCESS','UNKNOWN','PAYMENT_IN_PROGRESS','THROTTLE','PREPARE_FAILED','WORKER_UNAVAILABLE','MISSED_TRIGGER','TWO_IN_FLIGHT_SUCCESS','PREVIOUS_HOLD','DUPLICATE_TARGET','WRONG_WING','STALE_AVAILABILITY','MISSING_AVAILABILITY',
  'BROWSER_CLOSED','APP_RESTART_RETAINED_UNKNOWN','UNSUPPORTED_RELEASE_POLICY','SLOW_SECURITY','SECURITY_STALL','STOP_BEFORE_DISPATCH'] as const;
export type LabScenario = typeof LAB_SCENARIOS[number];
/** Legacy dual-wing planning wrapper, or the exact Booking Setup objective (preferred). */
export type LabRequest = {plan:DualWingPlan;scenario:LabScenario;countdownSeconds:number} | {objective:BookingObjective;cohortIndex?:number;scenario:LabScenario;countdownSeconds:number;nowMs?:number};
export interface LabResult {
  label:'OFFLINE / INTERCEPTED'; environment:'OFFLINE_SIMULATION'; strategy:'SHOTGUN'|'PRECISION'; runId:string; scenario:LabScenario; objective:string;
  planned:number;initiated:number;omitted:number;missedDeadlines:number;compressedPairs:number;
  /** Configured trigger → local Chrome request initiation. Never provider receipt. */ timing:{p50:number|null;p95:number|null;max:number|null}; cpuBusyPercent:number|null; memoryUsedPercent:number;
  preparation:Array<{attemptId:string;ready:boolean;durationMs?:number;code?:string}>;
  wings:Array<{wing:string;planned:number;initiated:number;holds:number;distinctCourts:number;ideal:number|null;complete:boolean}>;
  outcomes:Array<{targetId:string;wing:string;date:string;court:number;worker:string;offsetMs:number;state:string;code?:string}>;
  objectiveOutcome:ReturnType<typeof evaluateObjectiveOutcome>;
  warnings:string[]; topologyFingerprint:string; triggerAt:string; authorizationFingerprint:string;
}
interface LabTarget {id:string;wing:Wing;spaceId:string;bookingDate:string;court:number;start:string;durationHours:number}
interface PreparedLab {targets:LabTarget[];phase3:SmartPhase3;topology:ReturnType<typeof exactShotgunTopology>;raceObjective:RaceObjective;quota:ObjectiveQuota;strict:boolean;
  strategy:'SHOTGUN'|'PRECISION';objectiveLabel:string;warnings:string[];authorizationFingerprint:string;duplicateRefused:()=>boolean;firstTarget:DualWingTarget;compiled?:ReturnType<typeof compileDualWingPlan>}
const quotaFromRace=(objective:RaceObjective,wings:readonly Wing[]):ObjectiveQuota=>{const q=raceQuota(objective)!;
  return q.scope==='ANY_WING'?{scope:'ANY_WING',wings:Object.fromEntries(wings.map(w=>[w,{minimum:1,ideal:1}])),overall:{minimum:1,ideal:q.overall!}}
    :{scope:'PER_WING',wings:Object.fromEntries(wings.map(w=>[w,{minimum:1,ideal:q.wings[w]??1}]))};};
export function validateLabRequest(input:LabRequest):PreparedLab {
  if (!input || !LAB_SCENARIOS.includes(input.scenario) || !Number.isSafeInteger(input.countdownSeconds) || input.countdownSeconds<8 || input.countdownSeconds>30) throw Error('LAB_REQUEST_INVALID');
  if ('objective' in input) {
    // The exact Booking Setup plan: same compiler output the inspector shows. No second plan editor.
    const nowMs=input.nowMs??Date.now(),compiled=compileObjective(input.objective,{nowMs});
    if(compiled.mode!=='NEXT_RELEASE'||(compiled.strategy!=='SHOTGUN'&&compiled.strategy!=='PRECISION'))throw Error('LAB_BROWSER_STRATEGY_REQUIRED');
    if(compiled.problems.length)throw Error(`LAB_PLAN_INVALID: ${compiled.problems.join(' ')}`);
    const cohort=compiled.cohorts[input.cohortIndex??0],phase3=cohort?.smart?.phase3;
    if(!cohort||!phase3)throw Error('LAB_PLAN_INVALID: no compiled release cohort');
    const idOf=(c:SmartPhase3['candidates'][number])=>cohort.immediate.find(t=>t.spaceId===c.spaceId&&t.start===c.start&&t.bookingDate===c.bookingDate&&t.durationHours===c.durationHours)!.id;
    const schedule=cohort.smart?.shotgun?.shots??phase3.wave1.flatMap(a=>(a.fanOutOffsetsMs??[a.releaseOffsetMs??0]).map((configuredOffsetMs,shotIndex)=>({logicalTargetId:idOf(phase3.candidates[a.candidateIndex]!),shotIndex,configuredOffsetMs})));
    const topology=exactShotgunTopology(phase3,cohort.smart?.shotgun?.shots);
    if(cohort.smart?.shotgun)assertShotgunSchedule(topology,schedule);
    const quota=compiled.quota,ideal=(entries:ObjectiveQuota['wings'])=>Object.fromEntries(Object.entries(entries).map(([wing,q])=>[wing,q!.ideal]));
    const raceObjective:RaceObjective=quota.scope==='ANY_WING'?{scope:'ANY_WING',wings:ideal(quota.wings),overall:quota.overall!.ideal}:{scope:'PER_WING',wings:ideal(quota.wings)};
    const targets=cohort.immediate.map(t=>({id:t.id,wing:t.wing,spaceId:t.spaceId,bookingDate:t.bookingDate,court:t.court,start:t.start,durationHours:t.durationHours}));
    const first=cohort.immediate[0]!,rate=phase3.candidates.find(c=>c.spaceId===first.spaceId&&c.start===first.start)!.rateEvidence;
    return {targets,phase3,topology,raceObjective,quota,strict:compiled.strategy==='SHOTGUN',strategy:compiled.strategy,objectiveLabel:JSON.stringify(raceObjective),
      warnings:[...compiled.warnings,'Runs the exact compiled Booking Setup plan with the production freeze, arm and dispatch modules.',
        ...(compiled.strategy==='PRECISION'?['Precision backups and Reopen Rescue are not exercised offline; only immediate attempts are dispatched.']:[])],
      authorizationFingerprint:compiled.fingerprint,
      firstTarget:{...first,priority:1,priceAuthority:{source:'objective rate',capturedAt:new Date(nowMs).toISOString(),perHour:[...rate.perHour],kind:'OFFLINE_FIXTURE'}},
      duplicateRefused:()=>{const o=structuredClone(input.objective),g=o.wings[first.wing];g.courts=[...g.courts,{...g.courts[0]!}];return compileObjective(o,{nowMs}).problems.some(p=>p.includes('appear once'));}};
  }
  DualWingPlanSchema.parse(input.plan);
  const compiled=compileDualWingPlan(input.plan);
  if(input.plan.purpose==='CURRENT_SLOT_REHEARSAL')for(const target of input.plan.targets)if(target.priceAuthority.kind==='TARGET_DATE_PUBLISHED')assertLabSlotEvidence(target);
  if (!compiled.phase3 || !compiled.shotgun || compiled.problems.length) throw Error(`LAB_PLAN_INVALID: ${compiled.problems.join(' ')}`);
  const topology=exactShotgunTopology(compiled.phase3,compiled.shotgun.shots);assertShotgunSchedule(topology,compiled.shotgun.shots);
  const wings=[...new Set(input.plan.targets.map(t=>t.wing))];
  return {targets:compiled.targets,phase3:compiled.phase3,topology,raceObjective:input.plan.objective,quota:quotaFromRace(input.plan.objective,wings),strict:true,strategy:'SHOTGUN',
    objectiveLabel:typeof input.plan.objective==='string'?input.plan.objective:JSON.stringify(input.plan.objective),warnings:compiled.warnings,
    authorizationFingerprint:createHash('sha256').update(JSON.stringify(input.plan)).digest('hex'),firstTarget:input.plan.targets[0]!,compiled,
    duplicateRefused:()=>compileDualWingPlan({...input.plan,targets:[...input.plan.targets,input.plan.targets[0]!]}).problems.some(p=>p.includes('twice'))};
}
/** Exact Buko/Mango payload rehearsal, never a claim that a proofless provider method works. */
export function offlineCandidatePlan(candidate:NonNullable<ReturnType<typeof compileDualWingPlan>['phase3']>['candidates'][number]):BookingPlan {
  exactReleaseTarget(candidate);
  if(candidate.rateEvidence.date!==candidate.bookingDate||candidate.rateEvidence.perHour.length!==candidate.durationHours||candidate.rateEvidence.perHour.some(p=>!Number.isFinite(p)||p<=0))throw Error('LAB_PRICE_AUTHORITY_INVALID');
  const base=prooflessReleasePlan({mode:'standard',targetDate:candidate.bookingDate!,durationHours:candidate.durationHours,courtCount:1,
    preferredStartTimes:[candidate.start],fallbackStartTimes:[],courtPriority:[candidate.court],fallbackCourts:[],exactCourts:[[candidate.court]],maximumTotalPrice:Infinity,currency:'PHP'});
  const source=base.courts[0]!, prices=candidate.rateEvidence.perHour;
  const slots=source.slots.map((slot,index)=>({...slot,spaceId:candidate.spaceId!,price:prices[index]!}));
  const court={...source,spaceId:candidate.spaceId!,slots,price:prices.reduce((a,b)=>a+b,0)};
  return {...base,wing:candidate.wing,courts:[court],chunks:[{...base.chunks[0]!,courts:[court],totalPrice:court.price}],totalPrice:court.price};
}
/** Fixtures mirror the real validator's required evidence. They never navigate to a simulated QR. */
export function simulatedPending(request:ProoflessCheckoutRequest, serial:number, now=Date.now()) {
  const ids=request.items.map((_,i)=>`offline-${serial}-${i}`), first=request.items[0]!, session=`offline-session-${serial}`;
  return {success:true,bookings:request.items.map((item,i)=>({id:ids[i],booking_no:`offline-number-${serial}-${i}`,customer_id:request.customerId,
    space_id:item.spaceId,facility_id:item.facilityId,date:item.date,start_time:`${item.startTime}:00`,end_time:`${item.endTime}:00`,duration:60,
    rate:item.rate,guest_count:1,booking_status:'pending',payment_status:'pending',booking_session_id:session,hold_expires_at:new Date(now+600_000).toISOString()})),
    bookingSessions:[{requestSessionRef:'session_1',bookingSessionId:session,facilityId:first.facilityId,spaceId:first.spaceId,date:first.date,
      startTime:`${first.startTime}:00`,endTime:`${request.items.at(-1)!.endTime}:00`,durationHours:request.items.length,bookingIds:ids}],
    transaction:{id:`offline-transaction-${serial}`,reference:`offline-number-${serial}-0`,amount:request.items.reduce((a,b)=>a+b.chargedAmount,0),status:'pending'},
    trustedTotalAmount:request.items.reduce((a,b)=>a+b.chargedAmount,0)};
}
const percentile=(values:number[],q:number)=>values.length?[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*q)-1)]!:null;

/** Child-process only: cwd must be its fresh isolated run directory. No production
 * config, profiles, identities, holds, lock or journals are loaded. */
export async function runShotgunLab(input:LabRequest, options:{directory:string;runId:string;isAborted:()=>boolean;onPhase?:(phase:string)=>void;onTrace?:(step:string)=>void}):Promise<LabResult> {
  const prepared_=validateLabRequest(input),{phase3,topology}=prepared_,labTargets=prepared_.targets;
  if(process.cwd()!==options.directory)throw Error('LAB_ISOLATED_CWD_REQUIRED');
  const sessions:OfflineChrome[]=[];
  let lock:ApiAutomationLock|undefined;
  const prepared:LabResult['preparation']=[];
  const observed:Array<{wing:string;at:number;offset:number;targetId:string}>=[];
  const outcomes:LabResult['outcomes']=[];
  const waves=Object.keys(topology.tabsPerWorker);
  const endOf=(t:LabTarget|undefined)=>t?`${String(Number(t.start.slice(0,2))+t.durationHours).padStart(2,'0')}:00`:'';
  const summary=(triggerMs:number,fingerprint:string,cpu:number|null=null):LabResult=>{
    const ordered=[...observed].sort((a,b)=>a.offset-b.offset),lag=observed.map(o=>o.at-(triggerMs+o.offset));
    const objectiveOutcome=evaluateObjectiveOutcome(prepared_.quota,outcomes.map(o=>{const t=labTargets.find(x=>x.id===o.targetId);
      return {wing:o.wing as Wing,court:o.court,date:o.date,start:t?.start??'',end:endOf(t),state:o.state,...(o.code?{code:o.code}:{}),payment:'PENDING' as const};}));
    return {label:'OFFLINE / INTERCEPTED',environment:'OFFLINE_SIMULATION',strategy:prepared_.strategy,runId:options.runId,scenario:input.scenario,objective:prepared_.objectiveLabel,
      planned:topology.shots.length,initiated:observed.length,omitted:topology.shots.length-observed.length,
      missedDeadlines:outcomes.filter(o=>o.code==='SHOTGUN_TRIGGER_MISSED').length,
      compressedPairs:ordered.slice(1).filter((o,i)=>o.at-ordered[i]!.at<Math.max(1,(o.offset-ordered[i]!.offset)/2)).length,
      timing:{p50:percentile(lag,.5),p95:percentile(lag,.95),max:lag.length?Math.max(...lag):null},cpuBusyPercent:cpu,memoryUsedPercent:Math.round((1-freemem()/totalmem())*1000)/10,
      preparation:prepared,
      wings:(['MANGO','BUKO'] as const).filter(wing=>labTargets.some(t=>t.wing===wing)).map(wing=>{const per=objectiveOutcome.perWing.find(w=>w.wing===wing);
        return {wing,planned:topology.shots.filter(s=>labTargets.find(t=>t.id===s.logicalTargetId)?.wing===wing).length,initiated:observed.filter(o=>o.wing===wing).length,
          holds:outcomes.filter(o=>o.wing===wing&&o.state==='HOLD_VERIFIED_QR_ATTENTION').length,distinctCourts:per?.courts.length??0,ideal:per?.ideal??null,
          complete:prepared_.quota.scope==='PER_WING'?(per?.courts.length??0)>=(per?.ideal??1):objectiveOutcome.status==='IDEAL'};}),
      outcomes,objectiveOutcome,warnings:[...prepared_.warnings,'Security preparation is synthetic. Timing is configured trigger to local Chrome request initiation, not provider receipt or acceptance.'],
      topologyFingerprint:topology.fingerprint,triggerAt:new Date(triggerMs).toISOString(),authorizationFingerprint:fingerprint};};
  if(['PREVIOUS_HOLD','DUPLICATE_TARGET','STALE_AVAILABILITY','MISSING_AVAILABILITY','APP_RESTART_RETAINED_UNKNOWN','UNSUPPORTED_RELEASE_POLICY'].includes(input.scenario)) {
    // Run actual validation/refusal paths before creating browser workers.
    const first=prepared_.firstTarget,end=`${String(Number(first.start.slice(0,2))+first.durationHours).padStart(2,'0')}:00`;
    const key=DurableSubmissionJournal.key(FACILITY_ID,first.spaceId,first.bookingDate,first.start,end);
    if(input.scenario==='DUPLICATE_TARGET') {
      if(!prepared_.duplicateRefused())throw Error('LAB_DUPLICATE_GUARD_FAILED');
    } else if(input.scenario==='STALE_AVAILABILITY'||input.scenario==='MISSING_AVAILABILITY') {
      const target={...first,priceAuthority:{...first.priceAuthority,kind:'TARGET_DATE_PUBLISHED' as const,capturedAt:new Date(Date.now()-16000).toISOString(),...(input.scenario==='MISSING_AVAILABILITY'?{perHour:[]}: {})}};
      let refused=false;try{assertLabSlotEvidence(target);}catch{refused=true;}if(!refused)throw Error('LAB_EVIDENCE_GUARD_FAILED');
    } else if(input.scenario==='PREVIOUS_HOLD') {
      const journal=new DurableSubmissionJournal(join(options.directory,'simulated-retained-hold'));
      await journal.begin(key,new Date(),{attemptId:key,planFingerprint:key,targetDate:first.bookingDate,courtIds:[first.court],hourlyBoundaries:[],expectedBookingCount:1,maximumAmount:700,stage:'dispatching'});
      await journal.mark(key,'verified',new Date(),undefined,{success:true,bookingIds:['offline-previous'],bookingNumbers:['offline'],bookingSessionIds:['offline'],holdExpiresAt:[new Date(Date.now()+600000).toISOString()],validationCode:'OFFLINE_ONLY'});
      if((await journal.peekDisposition(key))!=='blocked')throw Error('LAB_RETAINED_HOLD_GUARD_FAILED');
    } else if(input.scenario==='APP_RESTART_RETAINED_UNKNOWN') {
      // Write an UNKNOWN record, then reopen the journal as a restarted application would: the same target stays refused.
      const directory=join(options.directory,'restart-journal'),before=new DurableSubmissionJournal(directory);
      await before.begin(key,new Date(),{executionMode:'OFFLINE_INTERCEPTED',attemptId:key,planFingerprint:key,targetDate:first.bookingDate,courtIds:[first.court],hourlyBoundaries:[],expectedBookingCount:1,maximumAmount:700,stage:'dispatching'});
      await before.mark(key,'unknown',new Date(),undefined,undefined,'OFFLINE_UNKNOWN_BEFORE_RESTART');
      const restarted=new DurableSubmissionJournal(directory);
      let refused=false;try{await restarted.begin(key);}catch(error){refused=(error as Error).message==='DUPLICATE_LOGICAL_BOOKING_BLOCKED';}
      if(!refused||(await restarted.peekDisposition(key))!=='blocked'||(await restarted.read(key)).state!=='unknown')throw Error('LAB_RESTART_GUARD_FAILED');
    } else if(input.scenario==='UNSUPPORTED_RELEASE_POLICY') {
      let refused=false;try{assertVerifiedRelease(first.bookingDate,'BUKO');}catch(error){refused=(error as Error).message==='WING_RELEASE_POLICY_UNVERIFIED';}
      if(!refused||evaluateCapability({wing:'BUKO',mode:'NEXT_RELEASE',strategy:'SHOTGUN',method:'PROOFLESS',courts:1}).live)throw Error('LAB_RELEASE_POLICY_GUARD_FAILED');
    }
    const result=summary(Date.now(),'preflight-refusal');result.warnings.push(`SIMULATED_PREFLIGHT_REFUSED: ${input.scenario}`);return result;
  }
  try {
    options.onPhase?.('Preparing isolated Chrome workers; all external networking blocked');
    for(const [index,worker] of waves.entries()) {
      if(options.isAborted())throw Error('LAB_STOPPED');
      const session=await launchOfflineChrome({chromium,chromePath:findChrome(undefined,chromium.executablePath()),scratch:options.directory,index,tabs:topology.tabsPerWorker[worker]!,basePort:30544,trace:step=>options.onTrace?.(step)});
      sessions.push(session);options.onPhase?.(`Isolated worker ${worker} launched`);
      // Context-wide interception additionally blocks every non-fixture route.
      await session.browser.contexts()[0]!.route('**/*',route=>route.abort());
      for(const [tab,page] of session.pages.entries()) {
        await page.unroute('https://app.onda.fit/**');
        const shot=topology.shots.find(s=>s.workerId===worker&&s.fanOutIndex===tab)!;
        await page.route('**/*',async route=>{
          const req=route.request();
          if(req.method()!=='POST'||req.url()!=='https://app.onda.fit/api/bookings/public-checkout'){await route.abort();return;}
          const request=req.postDataJSON() as ProoflessCheckoutRequest;
          const target=labTargets.find(t=>t.id===shot.logicalTargetId)!;
          if(request.items.some(item=>item.spaceId!==target.spaceId||item.date!==target.bookingDate)||courtBySpace(request.items[0]!.spaceId)?.wing!==target.wing)throw Error('LAB_PAYLOAD_IDENTITY_MISMATCH');
          const ordinal=observed.length+1;
          observed.push({wing:target.wing,at:req.timing().startTime,offset:shot.configuredOffsetMs,targetId:target.id});
          if(input.scenario==='TWO_IN_FLIGHT_SUCCESS')await new Promise(done=>setTimeout(done,800));
          let status=409,body:unknown={success:false,error:'Slot unavailable (offline fixture)'};
          const success=input.scenario==='FIRST_SUCCESS'&&ordinal===1||input.scenario==='SECOND_TARGET_SUCCESS'&&target.id===labTargets[1]?.id||input.scenario==='LATER_SUCCESS'&&ordinal===3||input.scenario==='MANGO_SUCCESS'&&target.wing==='MANGO'||input.scenario==='BUKO_SUCCESS'&&target.wing==='BUKO'||input.scenario==='BOTH_SUCCESS'||input.scenario==='TWO_IN_FLIGHT_SUCCESS'&&ordinal<=2||input.scenario==='WRONG_WING'&&ordinal===1;
          if(success){status=200;body=simulatedPending(request,ordinal);if(input.scenario==='WRONG_WING')(body as ReturnType<typeof simulatedPending>).bookings[0]!.space_id='wrong-wing-space';}
          if(ordinal===1&&input.scenario==='UNKNOWN'){status=200;body={success:true};}
          if(ordinal===1&&input.scenario==='THROTTLE'){status=429;body={success:false,error:'Too many requests'};}
          if(ordinal===1&&input.scenario==='PAYMENT_IN_PROGRESS')body={success:false,error:'Payment already in progress'};
          await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
        });
      }
    }
    // Browser closure after preparation: its attempts must fail closed, the rest proceed.
    // Closing every tab of the first worker removes its pages exactly as a closed window would; cleanup still owns the process.
    if(input.scenario==='BROWSER_CLOSED')await Promise.allSettled((sessions[0]?.pages??[]).map(page=>page.close()));
    const triggerMs=Date.now()+input.countdownSeconds*1000;
    const plans=phase3.wave1.flatMap(a=> {
      const candidate=phase3.candidates[a.candidateIndex]!,plan=offlineCandidatePlan(candidate);
      const target:PrecisionTarget={court:candidate.court,start:candidate.start,durationHours:candidate.durationHours,workerId:a.workerId,end:plan.endTime,assumedAmount:plan.totalPrice,
        targetKey:DurableSubmissionJournal.key(FACILITY_ID,candidate.spaceId!,candidate.bookingDate!,candidate.start,plan.endTime)};
      return (a.fanOutOffsetsMs??[a.releaseOffsetMs??0]).map(offset=>({target:{...target,releaseOffsetMs:offset},plan,...(prepared_.strict?{dispatchTimingPolicy:'SHOTGUN_STRICT' as const}:{})}));
    });
    const race=freezePrecisionRace(labTargets[0]!.bookingDate,triggerMs,plans,{executionMode:'OFFLINE_INTERCEPTED',objective:prepared_.raceObjective,authorizationFingerprint:prepared_.authorizationFingerprint});
    const clock=TrustedReleaseClock.fromOffset(0,{method:'offline-test-trigger-clock',sampleCount:0});
    const pageOf=(a:{target:PrecisionTarget;fanOutIndex:number})=>sessions[waves.indexOf(a.target.workerId)]!.pages[a.fanOutIndex]!;
    const recorder=new CriticalPathRecorder(triggerMs,clock.monotonicDeadline(triggerMs),clock.offsetMs-clock.wallDisagreementMs(),race.attempts.map(a=>a.id));
    const transports=new Map(race.attempts.map(a=>[a.id,new OndaBrowserSessionTransport(pageOf(a),syntheticSecurityPreparation(pageOf(a),0,0),async()=>{}, {},o=>recorder.observeTransport(a.id,o))]));
    lock=await ApiAutomationLock.acquire('standard',waves as WorkerId[]);
    const armed=await armPrecisionRace(race,{lock,journalRoot:join(options.directory,'journals'),releaseMs:triggerMs,now:()=>clock.nowMs(),customerFor:worker=>({
      clientId:`00000000-0000-4000-8000-${String(worker.charCodeAt(0)).padStart(12,'0')}`,customerId:`00000000-0000-4000-9000-${String(worker.charCodeAt(0)).padStart(12,'0')}`,
      customerEmail:`offline-${worker}@example.invalid`,customerPhone:'09000000000',customerFirstName:'Offline',customerLastName:'Fixture'})});
    const before=cpuSnapshot();
    options.onPhase?.(`OFFLINE countdown: ${input.countdownSeconds}s to test trigger; ${armed.attempts.length} frozen attempts`);
    // Accelerated release-boundary rehearsal (6 s lead instead of the measured production lead):
    //  SLOW_SECURITY  the first worker's genuine-path preparation takes half the lead and must still be ready in time;
    //  SECURITY_STALL it outlasts the whole lead and then fails, as a 36-60 s stall does against a 53 s production lead:
    //                 that attempt must stay unsent (strict deadline), the other worker proceeds;
    //  STOP_BEFORE_DISPATCH Emergency Stop 1.5 s before the trigger: every attempt unsent, nothing initiated.
    const isAborted=()=>options.isAborted()||input.scenario==='STOP_BEFORE_DISPATCH'&&clock.nowMs()>=triggerMs-1_500;
    const dispatched=dispatchArmedPrecisionRace(armed,{clock,prewarmLeadMs:6000,prewarmPolicy:{concurrency:4,perGroupConcurrency:1,tierBarrierTimeoutMs:Infinity},isAborted,
      transportFor:(_worker,a)=>transports.get(a.attempt.id)!,prewarm:async a=>{
        const started=performance.now();
        try {
          if(a.target.workerId===waves[0]&&['PREPARE_FAILED','WORKER_UNAVAILABLE'].includes(input.scenario))throw Error(input.scenario);
          if(a.target.workerId===waves[0]&&input.scenario==='SLOW_SECURITY')await new Promise(done=>setTimeout(done,3_000));
          if(a.target.workerId===waves[0]&&input.scenario==='SECURITY_STALL'){await new Promise(done=>setTimeout(done,Math.max(0,a.triggerMs-clock.nowMs()+1_500)));throw Error('ONDA_SECURITY_VERIFICATION_FAILED');}
          await transports.get(a.attempt.id)!.prepareCheckoutContext();
          if(a.target.workerId===waves[0]&&input.scenario==='MISSED_TRIGGER')await pageOf(a.attempt).evaluate(when=>{setTimeout(()=>{const end=performance.now()+200;while(performance.now()<end){}},Math.max(0,when-Date.now()-25));},a.triggerMs);
          prepared.push({attemptId:a.attempt.id,ready:true,durationMs:performance.now()-started});
        } catch(error){prepared.push({attemptId:a.attempt.id,ready:false,code:(error as Error).message});throw error;}
      },afterFire:()=>lock!.dispatching(),onVerifiedHold:async(_attempt,verified)=>{await lock!.held(verified.holdExpiresAt);return {state:'HOLD_VERIFIED_QR_ATTENTION'};}});
    // The production dispatcher rejects with USER_ABORT when stopped before anything was committed. In the Stop
    // rehearsal that is the expected result: every planned attempt is definitively unsent (never UNKNOWN or rejected).
    const result=await dispatched.catch((error:unknown)=>{
      if(input.scenario!=='STOP_BEFORE_DISPATCH'||(error as Error)?.message!=='USER_ABORT'||observed.length)throw error;
      return {results:race.attempts.map(attempt=>({attempt,state:'NOT_DISPATCHED',code:'USER_ABORT'}))};
    });
    for(const row of result.results) {
      const c=labTargets.find(t=>t.spaceId===row.attempt.plan.courts[0]!.spaceId&&t.bookingDate===row.attempt.plan.targetDate&&t.start===row.attempt.plan.startTime)!;
      outcomes.push({targetId:c.id,wing:c.wing,date:c.bookingDate,court:c.court,worker:row.attempt.target.workerId,offsetMs:row.attempt.target.releaseOffsetMs??0,state:row.state,...(row.code?{code:row.code}:{})});
    }
    // Independent browser request-start measurements, captured by the same recorder.
    const rows=new Map(recorder.rows().map(r=>[r.workerId,r]));
    for(const o of observed){const a=race.attempts.find(a=>a.target.releaseOffsetMs===o.offset&&a.plan.courts[0]!.spaceId===labTargets.find(t=>t.id===o.targetId)!.spaceId);const row=a&&rows.get(a.id);if(row?.browserRequestStartMs!==null&&row?.browserRequestStartMs!==undefined)o.at=triggerMs+row.browserRequestStartMs;}
    return summary(triggerMs,race.fingerprint,busyPercent(before,cpuSnapshot()));
  } finally {options.onPhase?.('Closing isolated Chrome workers');await Promise.allSettled(sessions.map(s=>closeOfflineChrome(s)));options.onPhase?.('Isolated Chrome workers closed');await lock?.release();}
}
