import { describe, expect, it } from 'vitest';
import { authorizePrecision, precisionCandidateId, pricedPrecisionPlan, type CandidateInput } from '../../src/api-booking/precision-phase3.js';
import { selectPhase3FreezeTargets, assertPhase3ShotgunSelection } from '../../src/api-booking/phase3-freeze-selection.js';
import { assertScheduledAvailabilityAccess, type PreReleaseEvidence } from '../../src/api-booking/pre-release-evidence.js';
import { dispatchPrecisionRace, freezePrecisionRace } from '../../src/api-booking/precision-race.js';
import { reduceLiveRun } from '../../ui/live-run.js';
import type { LiveRunView } from '../../ui/types.js';
import { UiEventSchema } from '../../src/ui-events.js';
import { classifyFailure } from '../../src/preparation-failure.js';
import { mkdtemp, mkdir, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { armPrecisionRace, disarmUnfired } from '../../src/api-booking/armed-dispatch.js';

const date='2026-11-05', releaseMs=Date.parse('2026-11-03T00:00:00Z');
function authorization(override=false) {
  const candidates:CandidateInput[]=[5,6,7,4].map((court,index)=>({court,start:'19:00',durationHours:3,priority:index+1,
    permissions:{wave1:true,wave2:false,rescue:false},rateEvidence:{date,actionable:true,perHour:[700,700,700],status:'VENUE_SCHEDULE',source:'fixture',capturedAt:'2026-11-02T00:00:00Z'},
    ...(override&&court===7?{publicEvidence:{evidence:'PUBLIC_BOOKING_PRESENT',override:'OPERATOR_OVERRIDE_PUBLIC_CONFLICT' as const}}:{})}));
  return authorizePrecision({date,releaseMs,candidates,wave1:candidates.map((c,i)=>({workerId:(['A','B','C','D'] as const)[i]!,
    candidateId:precisionCandidateId(date,c),fanOutOffsetsMs:[-840+i*120,-360+i*120]})),standby:[],budgets:{total:8,wave2:0,rescue:0},
    concurrentWave2:false,rescueEnabled:false,authorizedAt:'2026-11-02T23:43:17Z'});
}
const evidence=(courts=[7]):Pick<PreReleaseEvidence,'blocks'|'failedCourts'|'dateState'>=>({
  blocks:courts.flatMap(court=>[19,20,21].map(hour=>({court,startTime:`${hour}:00`,endTime:`${hour+1}:00`}))),failedCourts:[],dateState:'UNRELEASED'});
function children(selection:ReturnType<typeof selectPhase3FreezeTargets>) {
  return selection.filter(s=>!s.excluded).flatMap(({assignment:a,candidate:c})=>(a.fanOutOffsetsMs??[a.releaseOffsetMs??0]).map(offset=>({
    target:{court:c.court,start:c.start,end:c.end,durationHours:c.durationHours,targetKey:c.logicalKey,workerId:a.workerId,assumedAmount:c.expectedAmount,releaseOffsetMs:offset},
    plan:pricedPrecisionPlan(c,date,c.rateEvidence.perHour),dispatchTimingPolicy:'SHOTGUN_STRICT' as const})));
}

describe('freeze conflict isolation using the saved four-court release',()=>{
  it('replays Court 7 conflict and dispatches the six other saved children at their literal offsets',async()=>{
    const saved=authorization(),before=JSON.stringify(saved),selection=selectPhase3FreezeTargets(saved,evidence(),date),actual=children(selection);
    expect(selection.filter(s=>s.excluded).map(s=>s.assignment.workerId)).toEqual(['C']);
    assertPhase3ShotgunSelection(selection,actual);
    const frozen=freezePrecisionRace(date,releaseMs,actual),sent:Array<[string,number,number]>=[];
    let now=releaseMs-60_000;
    const result=await dispatchPrecisionRace(frozen,{now:()=>now,waitUntil:async at=>{await new Promise(r=>setTimeout(r,0));now=Math.max(now,at);},
      prewarm:async()=>undefined,prewarmLeadMs:15_000,dispatch:async attempt=>{
        sent.push([attempt.target.workerId,attempt.target.court,attempt.target.releaseOffsetMs??0]);return {state:'REJECTED'};}});
    expect(sent.sort((a,b)=>a[2]-b[2])).toEqual([['A',5,-840],['B',6,-720],['D',4,-480],['A',5,-360],['B',6,-240],['D',4,0]]);
    expect(result.map(r=>r.state)).toEqual(Array(6).fill('REJECTED'));
    expect(frozen.attempts.every(a=>a.fanOutCount===2)).toBe(true);
    expect(JSON.stringify(saved)).toBe(before);
  });
  it('keeps all eight without a conflict and does not treat UNKNOWN as a public conflict',()=>{
    for(const e of [evidence([]),{blocks:[],failedCourts:[7],dateState:'UNKNOWN' as const}]){
      const selection=selectPhase3FreezeTargets(authorization(),e,date);expect(children(selection)).toHaveLength(8);
      expect(selection.some(s=>s.excluded)).toBe(false);assertPhase3ShotgunSelection(selection,children(selection));
    }
  });
  it('arms only the surviving six with real local one-use permits and creates no journal for Court 7',async()=>{
    const saved=authorization(),selection=selectPhase3FreezeTargets(saved,evidence(),date),actual=children(selection);
    assertPhase3ShotgunSelection(selection,actual);
    const base=resolve('.local/booking-test-lab/freeze-conflict');await mkdir(base,{recursive:true});
    const directory=await mkdtemp(join(base,'six-survivors-'));
    const frozen=freezePrecisionRace(date,releaseMs,actual),customer={clientId:'fixture-client',customerId:'fixture-customer',
      customerEmail:'fixture@example.invalid',customerPhone:'09123456789',customerFirstName:'Fixture',customerLastName:'Player'};
    const armed=await armPrecisionRace(frozen,{customerFor:()=>customer,journalRoot:directory,releaseMs,now:()=>releaseMs-120_000});
    expect(armed.attempts).toHaveLength(6);
    expect(armed.attempts.map(a=>a.target.workerId)).toEqual(['A','A','B','B','D','D']);
    expect((await readdir(directory)).sort()).toEqual(selection.filter(s=>!s.excluded).map(s=>s.candidate.logicalKey).sort());
    expect(armed.attempts.every(a=>a.state==='armed')).toBe(true);
    await disarmUnfired(armed,'OFFLINE_FIXTURE_COMPLETE',()=>releaseMs-120_000);
  });
  it('supports several conflicting targets, refuses all-conflicted, and preserves explicit conflict overrides',()=>{
    const multiple=selectPhase3FreezeTargets(authorization(),evidence([5,7]),date);
    expect(children(multiple).map(c=>c.target.workerId)).toEqual(['B','B','D','D']);assertPhase3ShotgunSelection(multiple,children(multiple));
    const all=selectPhase3FreezeTargets(authorization(),evidence([4,5,6,7]),date);
    expect(()=>assertPhase3ShotgunSelection(all,[])).toThrow('PHASE3_PUBLIC_CONFLICT_ALL_TARGETS');
    const override=selectPhase3FreezeTargets(authorization(true),evidence(),date);
    expect(override.find(s=>s.assignment.workerId==='C')).toMatchObject({excluded:false,override:true});assertPhase3ShotgunSelection(override,children(override));
  });
  it('still rejects missing or extra surviving children, changed targets, reassigned workers and rewritten offsets',()=>{
    const selection=selectPhase3FreezeTargets(authorization(),evidence(),date),actual=children(selection);
    for(const rows of [actual.slice(1),[...actual,actual[0]!],actual.map((c,i)=>i?c:{...c,target:{...c.target,workerId:'C' as const}}),
      actual.map((c,i)=>i?c:{...c,target:{...c.target,targetKey:'different'}}),actual.map((c,i)=>i?c:{...c,target:{...c.target,court:7}}),
      actual.map((c,i)=>i?c:{...c,target:{...c.target,assumedAmount:1}}),actual.map((c,i)=>i?c:{...c,target:{...c.target,releaseOffsetMs:-600}})])
      expect(()=>assertPhase3ShotgunSelection(selection,rows)).toThrow('SHOTGUN_FROZEN_PLAN_INCOMPLETE');
    expect(classifyFailure('SHOTGUN_FROZEN_PLAN_INCOMPLETE',{operation:'run'}).category).toBe('PLAN_FINGERPRINT_MISMATCH');
    expect(classifyFailure('PHASE3_PUBLIC_CONFLICT_ALL_TARGETS',{operation:'run'}).category).toBe('INVALID_PLAN');
  });
  it('access restrictions remain hard stops before selection',()=>{
    for(const classification of ['AVAILABILITY_AUTH_REQUIRED','AVAILABILITY_ACCESS_DENIED','AVAILABILITY_RATE_LIMITED'] as const)
      expect(()=>assertScheduledAvailabilityAccess({availabilityFailure:{code:'FIXTURE',classification}})).toThrow(classification);
  });
  it('renders both excluded children as provably unsent and names the retained six separately',()=>{
    const candidates=new Map(),id='a'.repeat(64);let view:LiveRunView|null=null;
    const reduce=(stage:string,fields:Record<string,unknown>={})=>{view=reduceLiveRun(view,UiEventSchema.parse({type:'apiStage',stage,elapsedMs:0,...fields}) as Parameters<typeof reduceLiveRun>[1],candidates);};
    reduce('RUN_STARTED');reduce('PHASE3_WAVE1_EXCLUDED',{workerId:'C',court:7,candidateId:id,code:'PUBLIC_BOOKING_CONFLICT_AT_FREEZE'});
    for(const [fanOutIndex,releaseOffsetMs] of [-600,-120].entries())reduce('PHASE3_WAVE1_UNSENT',{workerId:'C',court:7,candidateId:id,
      fanOutIndex,fanOutCount:2,releaseOffsetMs,state:'NOT_DISPATCHED',code:'PUBLIC_BOOKING_CONFLICT_AT_FREEZE'});
    reduce('PHASE3_FREEZE_SELECTION',{authorizedCount:8,attemptCount:6,unsentCount:2});
    expect(view!.parents[0]!.children.map(c=>c.state)).toEqual(['NOT_DISPATCHED','NOT_DISPATCHED']);
    expect(view!.notes.join(' ')).toContain('Court 7');expect(view!.notes.join(' ')).toContain('6 retained, 2 skipped');
  });
});
