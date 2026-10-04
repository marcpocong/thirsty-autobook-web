import {describe,expect,it} from 'vitest';
import {evaluatePrewarmFeasibility,exactPrewarmLeadMs,phase3PrewarmTasks} from '../../src/api-booking/prewarm-feasibility.js';
import type {SmartPhase3} from '../../src/precision-simple.js';
import {MAX_PREWARM_LEAD_MS,type PrewarmPolicy} from '../../src/api-booking/prewarm-scheduler.js';

const candidate=(court:number,priority=1)=>({court,start:'22:00',durationHours:2,priority,permissions:{wave1:true,wave2:false,rescue:false},
  rateEvidence:{status:'CONFIRMED',perHour:700,source:'FIXTURE',capturedAt:'2026-10-03T00:00:00.000Z'},expectedAmount:1400});
const phase3=(widths:number[],offsets?:number[][]):SmartPhase3=>({version:1,candidates:widths.map((_,index)=>candidate(index%7+1,index+1)),
  wave1:widths.map((width,index)=>({workerId:String.fromCharCode(65+index) as never,candidateIndex:index,
    ...(width>1?{fanOutOffsetsMs:offsets?.[index]??Array.from({length:width},()=>0)}:{releaseOffsetMs:offsets?.[index]?.[0]??0})})),standby:[],
  budgets:{wave1:widths.reduce((sum,value)=>sum+value,0),wave2:0,rescue:0,total:widths.reduce((sum,value)=>sum+value,0)},concurrentWave2:false,rescueEnabled:false}) as unknown as SmartPhase3;
const ready=(plan:SmartPhase3,patch:Partial<Parameters<typeof evaluatePrewarmFeasibility>[0]>={})=>evaluatePrewarmFeasibility({phase3:plan,prepP95Ms:8_000,
  availableWorkers:new Set('ABCDEFG'),...patch});

describe('exact-plan prewarm feasibility',()=>{
  it('models one tier / one child per worker',()=>{const value=ready(phase3([1,1,1]));expect(value).toMatchObject({configuredWave1Attempts:3,tiers:1,groups:3,projectedReady:3,projectedOmitted:0,verdict:'READY'});});
  it('models two and six tiers',()=>{expect(ready(phase3([2,2])).tiers).toBe(2);expect(ready(phase3([6])).tiers).toBe(6);});
  it('models a logical Shotgun target split across workers and uneven allocations',()=>{const plan=phase3([6,4,2]);plan.wave1[1]!.candidateIndex=0;
    const value=ready(plan);expect(value.configuredWave1LogicalTargets).toBe(2);expect(value.configuredWave1Attempts).toBe(12);expect(value.groups).toBe(3);});
  it('uses the documented fallback only when compatible history is missing',()=>{expect(ready(phase3([2]),{prepP95Ms:null})).toMatchObject({preparationP95Ms:12_000,p95Source:'FALLBACK'});
    expect(ready(phase3([2]),{prepP95Ms:2_000,sampleCount:31})).toMatchObject({preparationP95Ms:2_000,p95Source:'COMPATIBLE_MEASURED_HISTORY',sampleCount:31});});
  it('grows for slow history and caps exact lead at 105 seconds',()=>{const fast=ready(phase3([4]),{prepP95Ms:2_000}),slow=ready(phase3([6]),{prepP95Ms:30_000});
    expect(slow.prewarmLeadMs).toBe(MAX_PREWARM_LEAD_MS);expect(slow.prewarmLeadMs).toBeGreaterThan(fast.prewarmLeadMs);});
  it('reports prepared-context freshness as a limiting constraint',()=>{const value=ready(phase3([1],[[0]]),{prepP95Ms:1,preparedContextFreshnessMs:5_000});
    expect(value).toMatchObject({projectedOmitted:1,verdict:'NOT_FEASIBLE'});expect(value.attempts[0]?.reason).toBe('PREWARM_FRESHNESS_LIMIT');});
  it('marks an unavailable worker without silently removing its configured task',()=>{const value=ready(phase3([1,1]),{availableWorkers:new Set(['A'])});
    expect(value).toMatchObject({configuredWave1Attempts:2,projectedOmitted:1,verdict:'NOT_FEASIBLE'});expect(value.attempts[1]).toMatchObject({reason:'PREWARM_WORKER_UNAVAILABLE'});});
  it('honours per-group concurrency 1 and a global limit below worker count',()=>{const plan=phase3([3,3,3]);const perGroup=ready(plan,{perGroupConcurrency:1}),global=ready(plan,{globalConcurrency:1});
    expect(perGroup.concurrency.perGroup).toBe(1);expect(global.concurrency.global).toBe(1);expect(global.prewarmLeadMs).toBeGreaterThanOrEqual(perGroup.prewarmLeadMs);});
  it('uses each child pre-release signed trigger',()=>{const value=ready(phase3([3],[[-2_000,-1_000,0]]));
    expect(value.attempts.map(item=>item.triggerTimeMs)).toEqual([-2_000,-1_000,0]);expect(value.predictedPreparationStartMs).toBe(-2_000-value.prewarmLeadMs);});
  it('projects omissions when the stop-starting cutoff exhausts capacity',()=>{const value=ready(phase3([6,6]),{prepP95Ms:30_000,globalConcurrency:1});
    expect(value.projectedOmitted).toBeGreaterThan(0);expect(value.limitingConstraints).toContain('PREWARM_CAPACITY_EXCEEDED');});
  it('represents the October 3 class: 8 configured, 6 prepared, primaries preserved, two lower-tier omissions',()=>{const value=ready(phase3([2,2,2,2]),{prepP95Ms:30_000,globalConcurrency:2});
    expect(value).toMatchObject({configuredWave1Attempts:8,projectedReady:6,projectedOmitted:2,verdict:'NOT_FEASIBLE'});
    expect(value.attempts.filter(item=>item.tier===0).every(item=>item.verdict==='READY')).toBe(true);
    expect(value.attempts.filter(item=>item.verdict==='OMITTED').every(item=>item.tier===1)).toBe(true);});
});

describe('shared scheduler policy',()=>{
  it('uses the same exact task topology and policy core for forecast lead and production inputs',()=>{const plan=phase3([3,2]),tasks=phase3PrewarmTasks(plan,new Set(['A','B']));
    const policy:PrewarmPolicy={concurrency:2,perGroupConcurrency:1,tierBarrierTimeoutMs:12_000};
    const value=ready(plan,{globalConcurrency:2,perGroupConcurrency:1,tierBarrierTimeoutMs:12_000});
    expect(value.prewarmLeadMs).toBe(exactPrewarmLeadMs(tasks,policy,8_000));
    expect(value.attempts.map(item=>[item.workerId,item.tier])).toEqual(tasks.map(task=>[task.workerId,task.tier]));});
});
