import {describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import {defaultObjective,withStrategy,enumerateTargets,compileObjective} from '../src/booking-objective.js';
import {validateLabRequest,type LabResult,type LabScenario} from '../src/shotgun-test-lab.js';
import {pendingFixture,fakeRecoveryPage,fixtureNow} from './helpers/pending-hold-fixture.js';
import {recoverPendingHold} from '../src/api-booking/pending-hold-recovery.js';
import {validateProviderHold} from '../src/api-booking/provider-hold-verification.js';
import {DurableSubmissionJournal} from '../src/api-booking/durable-submission-journal.js';
import {classifyPrecisionDispatchError} from '../src/api-booking/precision-race.js';
import {SubmissionDispatchError} from '../src/api-booking/submission-errors.js';
import {classifyFailure} from '../src/preparation-failure.js';

const nowMs=Date.parse('2026-11-02T17:00:00Z'),root=resolve('.');
function objective(courts=[5,6,7,4]){
  const o=withStrategy(defaultObjective(nowMs,'NEXT_RELEASE'),'SHOTGUN');
  o.wings.MANGO={...o.wings.MANGO,bookingDate:'2026-11-05',courts:courts.map((court,i)=>({court,priority:i+1})),minimum:1,ideal:courts.length,startTimes:['19:00'],durationHours:3};
  o.wings.BUKO.enabled=false;o.price={maxPerCheckout:2100,maxTotal:2100*courts.length*2};
  const ids=enumerateTargets(o).targets.map(t=>t.id),count=courts.length*2;
  o.shotgun={budget:count,allocationMode:'CUSTOM',timingMode:'CUSTOM',windowStartMs:-(count-1)*120,windowEndMs:0,
    customOffsetsMs:Array.from({length:count},(_,i)=>i===count-1?0:-(count-1-i)*120),customAssignments:[...ids,...ids],limitToIdeal:true,
    timingCapacityOverride:false,allowStandbyConsumption:false,presetId:'FULLY_CUSTOM',source:'CUSTOM'};
  return o;
}
async function lab(scenario:LabScenario,courts?:number[]){
  const base=join(root,'.local/booking-test-lab/four-court-qualification');await mkdir(base,{recursive:true});
  const directory=await mkdtemp(join(base,`${scenario}-`)),file=join(directory,'input.json');
  await writeFile(file,JSON.stringify({objective:objective(courts),scenario,countdownSeconds:8,nowMs}));
  await new Promise<void>((done,fail)=>{
    const child=spawn(process.execPath,['--report-on-fatalerror',`--report-directory=${directory}`,'--import','tsx','src/booking-test-lab-child.ts',file,directory],{cwd:root,stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});
    let stderr='';child.stderr?.on('data',b=>{stderr+=b;});child.on('error',fail);child.on('close',(code,signal)=>{
      void writeFile(join(directory,'exit.json'),JSON.stringify({code,signal,stderr})).then(()=>code===0?done():fail(Error(stderr||`child exit ${code}`)));
    });
  });
  return JSON.parse(await readFile(join(directory,'result.json'),'utf8')) as LabResult;
}
describe('four-court exact eight-child production fixture qualification',()=>{
  it('never offers a blind retry after an access stop, including when no lock remains',()=>{
    for(const lockPresent of [false,true])expect(classifyFailure('SHOTGUN_PROVIDER_ACCESS_STOP',{operation:'run',lockPresent})).toMatchObject({category:'PROVIDER_ACCESS_DENIED',retrySafe:false,recovery:{action:'OPEN_ACTIVITY'}});
  });
  it('preserves exact release, priorities, worker assignments, prices and 120 ms literal spacing',()=>{
    const o=objective(),c=compileObjective(o,{nowMs});expect(c.problems).toEqual([]);
    expect(c.cohorts[0]!.releaseAt).toBe('2026-11-03T00:00:00.000Z');
    const p=validateLabRequest({objective:o,scenario:'ALL_REJECTED',countdownSeconds:8,nowMs});
    expect(p.phase3.wave1.map(a=>({worker:a.workerId,court:p.phase3.candidates[a.candidateIndex]!.court,offsets:a.fanOutOffsetsMs}))).toEqual([
      {worker:'A',court:5,offsets:[-840,-360]},{worker:'B',court:6,offsets:[-720,-240]},
      {worker:'C',court:7,offsets:[-600,-120]},{worker:'D',court:4,offsets:[-480,0]}]);
    expect(p.topology.tabsPerWorker).toEqual({A:2,B:2,C:2,D:2});expect(p.topology.minimumSpacingMs).toBe(120);
    expect(p.phase3.budgets).toMatchObject({total:8,wave2:0,rescue:0});expect(p.phase3.standby).toEqual([]);
  });
  for(const scenario of ['ALL_REJECTED','DATE_UNAVAILABLE','BOTH_SUCCESS','NO_PROVIDER_PERSISTENCE','ACCESS_DENIED','THROTTLE','TWO_IN_FLIGHT_SUCCESS','UNKNOWN','MISSED_TRIGGER'] as const){
    it(scenario,async()=>{
      const r=await lab(scenario);expect(r.planned).toBe(8);expect(r.initiated+r.omitted).toBe(8);expect(r.environment).toBe('OFFLINE_SIMULATION');
      expect(r.authorized).toBe(8);
      if(scenario==='ALL_REJECTED'||scenario==='DATE_UNAVAILABLE'){expect(r.initiated).toBe(8);expect(r.objectiveOutcome.holds).toBe(0);}
      if(scenario==='BOTH_SUCCESS'){expect(r.objectiveOutcome.distinctCourts).toBe(4);expect(r.objectiveOutcome.status).toBe('IDEAL');expect(r.initiated).toBe(4);}
      if(scenario==='NO_PROVIDER_PERSISTENCE'){expect(r.initiated).toBe(4);expect(r.objectiveOutcome.holds).toBe(0);expect(r.outcomes.filter(o=>o.state==='UNKNOWN')).toHaveLength(4);}
      if(scenario==='ACCESS_DENIED'||scenario==='THROTTLE'||scenario==='UNKNOWN'){expect(r.initiated).toBe(1);expect(r.omitted).toBe(7);}
      if(scenario==='ACCESS_DENIED')expect(r.outcomes.slice(1).every(o=>o.code==='SHOTGUN_PROVIDER_ACCESS_STOP')).toBe(true);
      if(scenario==='DATE_UNAVAILABLE')expect(r.httpResponses.every(h=>h.status===400)).toBe(true);
      if(scenario==='NO_PROVIDER_PERSISTENCE'){expect(r.providerConfirmed).toBe(0);expect(r.httpResponses.every(h=>h.status===200)).toBe(true);}
      if(scenario==='TWO_IN_FLIGHT_SUCCESS'){expect(r.initiated).toBe(8);expect(r.objectiveOutcome.distinctCourts).toBe(2);expect(r.maximumInFlight).toBeGreaterThan(1);expect(r.inFlightAtConfirmation.some(n=>n>0)).toBe(true);}
      if(scenario==='MISSED_TRIGGER'){expect(r.missedDeadlines).toBeGreaterThan(0);expect(r.omitted).toBeGreaterThan(0);}
      if(scenario!=='MISSED_TRIGGER'){expect(r.missedDeadlines).toBe(0);expect(r.timing.max!).toBeLessThanOrEqual(50);}
    },90000);
  }
  it('scales to A–G / fourteen children using the same compiler and dispatcher',async()=>{
    const r=await lab('ALL_REJECTED',[5,6,7,4,3,2,1]);expect(r.planned).toBe(14);expect(r.initiated).toBe(14);expect(r.missedDeadlines).toBe(0);
  },120000);
  it('keeps duplicate and UNKNOWN barriers across restart, without dispatch',async()=>{
    for(const s of ['PREVIOUS_HOLD','DUPLICATE_TARGET','APP_RESTART_RETAINED_UNKNOWN'] as const){const r=await lab(s);expect(r.initiated).toBe(0);expect(r.warnings.join(' ')).toContain('PREFLIGHT_REFUSED');}
  },60000);
  it('validates every exact three-hour provider group and QR, then recovers all four after restart without creation',async()=>{
    const base=join(root,'.local/booking-test-lab/four-court-qualification');await mkdir(base,{recursive:true});const directory=await mkdtemp(join(base,'recovery-'));
    const fixtures=await Promise.all(([5,6,7,4] as const).map((court,i)=>pendingFixture(directory,(['A','B','C','D'] as const)[i],court,false,undefined,false,{date:'2026-11-05',start:'19:00',maximum:2100})));
    for(const f of fixtures){
      expect(validateProviderHold(f.provider,{plan:f.plan,bookings:f.raw.bookings,customer:f.identity.customer,legacyIdentity:false},fixtureNow)).toBe('ACTIVE');
      const wrong=structuredClone(f.provider);wrong.data.groupBookings[1]!.spaceId=fixtures.find(x=>x!==f)!.plan.courts[0]!.spaceId;
      expect(()=>validateProviderHold(wrong,{plan:f.plan,bookings:f.raw.bookings,customer:f.identity.customer,legacyIdentity:false},fixtureNow)).toThrow('PROVIDER_IDENTITY_MISMATCH');
      for(let restart=0;restart<2;restart++){
        const page=fakeRecoveryPage(f),state=await recoverPendingHold(page.page,f.directory,{identity:f.identity,now:()=>fixtureNow,claimRoot:join(directory,'claims')});
        expect(state.qr).toBe('QR_READY');expect(f.submissions()).toBe(1);expect(await readFile(f.journalPath,'utf8')).toBe(f.journalBefore);
      }
      await expect(new DurableSubmissionJournal(f.directory).begin(f.key)).rejects.toThrow('DUPLICATE_LOGICAL_BOOKING_BLOCKED');
    }
  });
  it.each([401,403])('retains ambiguous HTTP %s as UNKNOWN while requiring an access stop',async status=>{
    const diagnostic={status,category:'http-rejection' as const,contentKind:'html' as const,responseSource:'unknown' as const,errorHint:'access' as const};
    expect(await classifyPrecisionDispatchError(new SubmissionDispatchError('ONDA_HTTP_STATUS_INVALID',true,diagnostic,false),async()=> 'unknown')).toEqual({state:'UNKNOWN',code:'SHOTGUN_PROVIDER_ACCESS_STOP'});
  });
});
