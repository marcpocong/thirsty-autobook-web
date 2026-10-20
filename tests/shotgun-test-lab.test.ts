import { describe,it,expect } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { fixturePlan } from '../scripts/dual-wing-fixtures.js';
import { simulatedPending,offlineCandidatePlan,validateLabRequest,type LabResult,type LabScenario } from '../src/shotgun-test-lab.js';
import { compileDualWingPlan } from '../src/dual-wing-plan.js';
import { prooflessRequest } from '../src/api-booking/proofless-checkout.js';
import { validatePublicCheckoutResponse } from '../src/api-booking/public-checkout.js';
import { assertLabSlotEvidence } from '../src/lab-slot-evidence.js';
import { BookingTestLabService as ShotgunLabService } from '../ui/booking-test-lab-service.js';
import { defaultObjective, enumerateTargets, withStrategy, type BookingObjective } from '../src/booking-objective.js';
const root=resolve('.');
async function child(scenario:LabScenario,objective:'ANY_ONE'|'ONE_PER_WING'='ANY_ONE') {
  const base=join(root,'.local/shotgun-test-lab/tests');await mkdir(base,{recursive:true});
  const directory=await mkdtemp(join(base,'case-'));
  const file=join(directory,'input.json');await writeFile(file,JSON.stringify({plan:fixturePlan(['MANGO','BUKO'],objective),scenario,countdownSeconds:8}));
  await new Promise<void>((done,fail)=>{const worker=spawn(process.execPath,['--import','tsx',join(root,'src/booking-test-lab-child.ts'),file,directory],{cwd:root,stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});let error:string|undefined,stderr='';worker.stderr?.on('data',chunk=>{stderr+=String(chunk);});
    worker.on('message',(m:unknown)=>{error=(m as {error?:string}).error??error;});worker.on('error',fail);worker.on('exit',code=>code===0?done():fail(Error(error||stderr.slice(-3000).trim()||`LAB_TEST_CHILD_EXIT ${code}`)));});
  return JSON.parse(await readFile(join(directory,'result.json'),'utf8')) as LabResult;
}
describe('intercepted lab safety and exact provider fixtures',()=>{
  it('builds independently validated Buko identity and activity metadata, retaining the live proofless refusal',()=>{
    const c=compileDualWingPlan(fixturePlan()).phase3!.candidates[1]!,p=offlineCandidatePlan(c);
    const customer={clientId:'00000000-0000-4000-8000-000000000001',customerId:'00000000-0000-4000-8000-000000000002',customerEmail:'offline@example.invalid',customerPhone:'09000000000',customerFirstName:'Offline',customerLastName:'Fixture'};
    expect(()=>prooflessRequest(p,customer)).toThrow('BUKO_PROOFLESS_NOT_ENABLED');
    const request=prooflessRequest(p,customer,'OFFLINE_INTERCEPTED');expect(request.items[0]?.activityKey).toBe('pickleball');expect(request.items[0]?.date).toBe('2026-10-21');
    const raw=simulatedPending(request,1);expect(validatePublicCheckoutResponse(raw,request as never,p,new Date()).bookingIds).toHaveLength(2);
    raw.bookings[0]!.space_id='wrong-wing';expect(()=>validatePublicCheckoutResponse(raw,request as never,p,new Date())).toThrow();
  });
  it('refuses missing, future, stale, partial or nonpublished slot evidence',()=>{
    const t=fixturePlan().targets[0]!,now=Date.now();const current={...t,priceAuthority:{...t.priceAuthority,kind:'TARGET_DATE_PUBLISHED' as const,capturedAt:new Date(now).toISOString()}};
    expect(()=>assertLabSlotEvidence(current,now)).not.toThrow();
    for(const bad of [{...current,priceAuthority:{...current.priceAuthority,capturedAt:new Date(now-15001).toISOString()}},{...current,priceAuthority:{...current.priceAuthority,capturedAt:new Date(now+1).toISOString()}},{...current,priceAuthority:{...current.priceAuthority,perHour:[]}},t])expect(()=>assertLabSlotEvidence(bad,now)).toThrow('UNKNOWN');
  });
  it('refuses invalid test countdown without inventing a production release',()=>{expect(()=>validateLabRequest({plan:fixturePlan(),scenario:'ALL_REJECTED',countdownSeconds:0})).toThrow('LAB_REQUEST_INVALID');});
  it('saves and reopens only a separate planning wrapper',async()=>{const base=join(root,'.local/shotgun-test-lab/tests');await mkdir(base,{recursive:true});const directory=await mkdtemp(join(base,'save-'));const service=new ShotgunLabService(directory,process.execPath),p=fixturePlan();await service.save(p);expect(await service.load()).toEqual(p);await expect(readFile(join(directory,'config.local.json'))).rejects.toMatchObject({code:'ENOENT'});});
});
describe('real isolated Chrome → production scheduler and dispatcher',()=>{
  it('completes independent wing objectives and suppresses later alternatives',async()=>{
    const r=await child('BOTH_SUCCESS','ONE_PER_WING');expect(r.label).toBe('OFFLINE / INTERCEPTED');expect(r.initiated).toBe(2);expect(r.omitted).toBe(6);expect(r.wings.every(w=>w.complete&&w.holds===1)).toBe(true);expect(r.outcomes.every(o=>o.state!=='QR_READY')).toBe(true);
  },60000);
  for(const scenario of ['UNKNOWN','PAYMENT_IN_PROGRESS','THROTTLE','WRONG_WING'] as const)it(`${scenario} stops both wings before later submissions`,async()=>{
    const r=await child(scenario,'ONE_PER_WING');expect(r.initiated).toBe(1);expect(r.wings.every(w=>!w.complete)).toBe(true);expect(r.omitted).toBe(7);
  },60000);
  for(const scenario of ['FIRST_SUCCESS','LATER_SUCCESS','MANGO_SUCCESS','BUKO_SUCCESS','TWO_IN_FLIGHT_SUCCESS','PREPARE_FAILED','WORKER_UNAVAILABLE','MISSED_TRIGGER','ALL_REJECTED'] as const)it(`${scenario} records the selected production-dispatch behavior`,async()=>{
    const r=await child(scenario,scenario==='MANGO_SUCCESS'||scenario==='BUKO_SUCCESS'?'ONE_PER_WING':'ANY_ONE');
    if(scenario==='FIRST_SUCCESS')expect(r.initiated).toBe(1);
    if(scenario==='LATER_SUCCESS')expect(r.initiated).toBe(3);
    if(scenario==='MANGO_SUCCESS'||scenario==='BUKO_SUCCESS'){expect(r.wings.find(w=>w.wing===scenario.split('_')[0])?.complete).toBe(true);expect(r.wings.filter(w=>w.complete)).toHaveLength(1);expect(r.initiated).toBe(5);}
    if(scenario==='TWO_IN_FLIGHT_SUCCESS')expect(r.wings.reduce((n,w)=>n+w.holds,0)).toBe(2);
    if(scenario==='PREPARE_FAILED'||scenario==='WORKER_UNAVAILABLE'){expect(r.preparation.some(p=>!p.ready)).toBe(true);expect(r.omitted).toBe(4);}
    if(scenario==='MISSED_TRIGGER'){expect(r.missedDeadlines).toBeGreaterThan(0);expect(r.omitted).toBe(4);}
    if(scenario==='ALL_REJECTED'){expect(r.initiated).toBe(8);expect(r.wings.every(w=>!w.complete)).toBe(true);}
  },60000);
  it('preserves an isolated prior hold and refuses duplicate, stale and missing evidence before preparation',async()=>{
    for(const scenario of ['PREVIOUS_HOLD','DUPLICATE_TARGET','STALE_AVAILABILITY','MISSING_AVAILABILITY'] as const){const r=await child(scenario);expect(r.initiated).toBe(0);expect(r.warnings.join(' ')).toContain('PREFLIGHT_REFUSED');}
  },60000);
});

// ── Universal Booking Test Lab: the exact Booking Setup objective through the same production modules ──
function quotaObjective(ideal:number,strategy:'SHOTGUN'|'PRECISION'='SHOTGUN',budget=12):BookingObjective{
  const o=withStrategy(defaultObjective(Date.now(),'NEXT_RELEASE'),strategy);
  const goal=(wing:'MANGO'|'BUKO')=>({...o.wings[wing],enabled:true,minimum:1,ideal,courts:[1,2,3].map((court,i)=>({court,priority:i+1})),startTimes:['18:00'],durationHours:2});
  return {...o,wings:{MANGO:goal('MANGO'),BUKO:goal('BUKO')},shotgun:{...o.shotgun,budget,allocationMode:'EQUAL',timingMode:'AUTO'}};
}
async function objectiveChild(scenario:LabScenario,objective:BookingObjective) {
  const base=join(root,'.local/booking-test-lab/tests');await mkdir(base,{recursive:true});
  const directory=await mkdtemp(join(base,'case-'));
  const file=join(directory,'input.json');await writeFile(file,JSON.stringify({kind:'browser',request:{objective,scenario,countdownSeconds:8}}));
  await new Promise<void>((done,fail)=>{const worker=spawn(process.execPath,['--import','tsx',join(root,'src/booking-test-lab-child.ts'),file,directory],{cwd:root,stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});let error:string|undefined,stderr='';worker.stderr?.on('data',chunk=>{stderr+=String(chunk);});
    worker.on('message',(m:unknown)=>{error=(m as {error?:string}).error??error;});worker.on('error',fail);worker.on('exit',code=>code===0?done():fail(Error(error||stderr.slice(-3000).trim()||`LAB_TEST_CHILD_EXIT ${code}`)));});
  return JSON.parse(await readFile(join(directory,'result.json'),'utf8')) as LabResult;
}
describe('Booking Test Lab · exact objective, distinct-court quotas',()=>{
  it('fills a two-court quota in each wing and suppresses the rest per wing',async()=>{
    const r=await objectiveChild('BOTH_SUCCESS',quotaObjective(2));
    expect(r.environment).toBe('OFFLINE_SIMULATION');expect(r.strategy).toBe('SHOTGUN');expect(r.planned).toBe(12);
    for(const wing of r.wings){expect(wing.distinctCourts).toBe(2);expect(wing.complete).toBe(true);}
    expect(r.objectiveOutcome.status).toBe('IDEAL');expect(r.objectiveOutcome.counted).toBe(4);
    expect(r.initiated).toBeGreaterThanOrEqual(4);expect(r.omitted).toBeGreaterThan(0);
    // Holds beyond the ideal are recorded separately, never counted as courts.
    expect(r.objectiveOutcome.extraHolds).toBe(r.objectiveOutcome.holds-4);
  },90000);
  it('reports partial completion and keeps working toward the quota after one hold',async()=>{
    const r=await objectiveChild('FIRST_SUCCESS',quotaObjective(2));
    expect(r.objectiveOutcome.status).toBe('PARTIAL');expect(r.objectiveOutcome.distinctCourts).toBe(1);
    // Only the remaining attempt on the achieved court is suppressed; every other attempt still goes.
    expect(r.initiated).toBe(11);expect(r.omitted).toBe(1);
  },90000);
  it('runs Precision from the same objective without Shotgun strict timing',async()=>{
    const r=await objectiveChild('ALL_REJECTED',quotaObjective(1,'PRECISION'));
    expect(r.strategy).toBe('PRECISION');expect(r.missedDeadlines).toBe(0);expect(r.initiated).toBe(r.planned);
    expect(r.warnings.join(' ')).toMatch(/backups and Reopen Rescue are not exercised/);
  },90000);
  it('fails closed when a prepared worker browser closes before the trigger',async()=>{
    const r=await objectiveChild('BROWSER_CLOSED',quotaObjective(1,'SHOTGUN',6));
    expect(r.initiated).toBeLessThan(r.planned);expect(r.objectiveOutcome.holds).toBe(0);
  },90000);
  it('keeps UNKNOWN blocking after restart and refuses the unverified Buko release policy before any browser starts',async()=>{
    for(const scenario of ['APP_RESTART_RETAINED_UNKNOWN','UNSUPPORTED_RELEASE_POLICY','DUPLICATE_TARGET'] as const){
      const r=await objectiveChild(scenario,quotaObjective(1));expect(r.initiated).toBe(0);expect(r.warnings.join(' ')).toContain('PREFLIGHT_REFUSED');}
  },90000);
});

/**
 * Release-boundary rehearsal of the exact saved two-court plan (Mango Court 7 → A, Court 6 → B, 19:00–22:00, both
 * required, two attempts at 0 ms) through the production freeze/arm/dispatch modules, real isolated Chrome and locally
 * intercepted checkouts. Time is accelerated (8 s countdown, 6 s lead); deadline semantics are the production ones.
 */
function twoCourtObjective():BookingObjective{
  const o=withStrategy(defaultObjective(Date.now(),'NEXT_RELEASE'),'SHOTGUN');o.wings.BUKO.enabled=false;
  o.wings.MANGO={...o.wings.MANGO,courts:[{court:7,priority:1},{court:6,priority:2}],startTimes:['19:00'],durationHours:3,minimum:2,ideal:2};
  const ids=enumerateTargets(o).targets.map(t=>t.id);
  o.shotgun={...o.shotgun,allocationMode:'CUSTOM',budget:2,timingMode:'CUSTOM',customOffsetsMs:[0,0],timingCapacityOverride:true,customCounts:{[ids[0]!]:1,[ids[1]!]:1}};
  return o;
}
async function rehearse(scenario:LabScenario){
  const base=join(root,'.local/shotgun-test-lab/tests');await mkdir(base,{recursive:true});
  const directory=await mkdtemp(join(base,'rehearsal-')),file=join(directory,'input.json');
  await writeFile(file,JSON.stringify({objective:twoCourtObjective(),scenario,countdownSeconds:8}));
  await new Promise<void>((done,fail)=>{const worker=spawn(process.execPath,['--import','tsx',join(root,'src/booking-test-lab-child.ts'),file,directory],{cwd:root,stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});let error:string|undefined,stderr='';worker.stderr?.on('data',chunk=>{stderr+=String(chunk);});
    worker.on('message',(m:unknown)=>{error=(m as {error?:string}).error??error;});worker.on('error',fail);worker.on('exit',code=>code===0?done():fail(Error(error||stderr.slice(-3000).trim()||`LAB_TEST_CHILD_EXIT ${code}`)));});
  return JSON.parse(await readFile(join(directory,'result.json'),'utf8')) as LabResult;
}
const byWorker=(r:LabResult,worker:string)=>r.outcomes.filter(o=>o.worker===worker);
describe('two-court release-boundary rehearsal (exact saved Mango 7/6 plan, intercepted)',()=>{
  it('compiles to exactly two strict Shotgun attempts on two browsers',()=>{
    const p=validateLabRequest({objective:twoCourtObjective(),scenario:'ALL_REJECTED',countdownSeconds:8});
    expect(p.strict).toBe(true);expect(p.topology.tabsPerWorker).toEqual({A:1,B:1});expect(p.topology.shots.map(s=>s.configuredOffsetMs)).toEqual([0,0]);
    expect(p.quota).toMatchObject({scope:'PER_WING',wings:{MANGO:{minimum:2,ideal:2}}});
  });
  it('success: both browsers prepare, both attempts are initiated and two distinct courts meet the quota',async()=>{
    const r=await rehearse('MANGO_SUCCESS');
    expect(r.planned).toBe(2);expect(r.initiated).toBe(2);expect(r.missedDeadlines).toBe(0);expect(r.preparation.every(p=>p.ready)).toBe(true);
    expect(r.wings[0]).toMatchObject({wing:'MANGO',holds:2,distinctCourts:2,complete:true});expect(r.objectiveOutcome.status).toBe('IDEAL');
    expect(r.timing.max!).toBeLessThanOrEqual(50);
  },60000);
  it('slow security preparation inside the lead still dispatches both attempts on time',async()=>{
    const r=await rehearse('SLOW_SECURITY');
    expect(r.initiated).toBe(2);expect(r.missedDeadlines).toBe(0);expect(r.preparation.every(p=>p.ready)).toBe(true);
    expect(Math.max(...r.preparation.map(p=>p.durationMs??0))).toBeGreaterThanOrEqual(3_000);
  },60000);
  it('a security stall that outlasts the lead fails closed for that attempt; the other worker still dispatches',async()=>{
    const r=await rehearse('SECURITY_STALL');
    // The dispatcher does not wait for the stalled preparation: A settles unsent at its strict deadline.
    expect(r.initiated).toBe(1);expect(r.preparation.filter(p=>p.ready)).toHaveLength(1);
    expect(byWorker(r,'A')).toEqual([expect.objectContaining({state:'NOT_DISPATCHED',code:'SHOTGUN_TRIGGER_MISSED'})]);
    expect(byWorker(r,'B')).toHaveLength(1);expect(r.objectiveOutcome.status).not.toBe('IDEAL');
  },60000);
  for(const scenario of ['BROWSER_CLOSED','PREPARE_FAILED'] as const)it(`${scenario}: one worker fails while the other is ready; nothing is sent for the failed worker`,async()=>{
    const r=await rehearse(scenario);
    expect(r.initiated).toBe(1);expect(byWorker(r,'B')).toHaveLength(1);
    expect(byWorker(r,'A').every(o=>!['IN_FLIGHT','REJECTED','UNKNOWN','HOLD_VERIFIED_QR_ATTENTION'].includes(o.state))).toBe(true);
  },60000);
  it('a late scheduled attempt is refused at its strict deadline, never sent late',async()=>{
    const r=await rehearse('MISSED_TRIGGER');
    expect(r.missedDeadlines).toBeGreaterThan(0);expect(r.initiated).toBeLessThan(2);
    expect(r.outcomes.filter(o=>o.code==='SHOTGUN_TRIGGER_MISSED').every(o=>o.worker==='A')).toBe(true);
  },60000);
  it('Emergency Stop before the trigger leaves every attempt unsent',async()=>{
    const r=await rehearse('STOP_BEFORE_DISPATCH');
    expect(r.initiated).toBe(0);expect(r.wings[0]!.holds).toBe(0);expect(r.preparation.every(p=>p.ready)).toBe(true);
    expect(r.outcomes.map(o=>[o.worker,o.state,o.code]).sort()).toEqual([['A','NOT_DISPATCHED','USER_ABORT'],['B','NOT_DISPATCHED','USER_ABORT']]);
  },60000);
  it('partial provider success: one verified hold is not the two-court objective',async()=>{
    const r=await rehearse('FIRST_SUCCESS');
    expect(r.wings[0]!.holds).toBe(1);expect(r.wings[0]!.complete).toBe(false);
    expect(r.objectiveOutcome.status).toBe('PARTIAL');
  },60000);
  for(const scenario of ['UNKNOWN','THROTTLE'] as const)it(`${scenario}: the uncertain or throttled result is kept as such and nothing is retried`,async()=>{
    const r=await rehearse(scenario);
    expect(r.initiated).toBeLessThanOrEqual(2);expect(r.wings[0]!.complete).toBe(false);
    if(scenario==='UNKNOWN'){expect(r.outcomes.some(o=>o.state==='UNKNOWN')).toBe(true);expect(r.objectiveOutcome.status).not.toBe('IDEAL');}
    expect(r.outcomes.every(o=>o.state!=='HOLD_VERIFIED_QR_ATTENTION')).toBe(true);
  },60000);
});
