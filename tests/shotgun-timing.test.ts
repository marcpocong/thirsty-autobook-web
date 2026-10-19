import {describe,it,expect} from 'vitest';
import {exactShotgunTopology,assertShotgunPrewarm,assertShotgunTabs,assertShotgunSchedule,summarizeShotgunTiming,applicableShotgunTiming,shotgunMachineKey} from '../src/shotgun-timing.js';
import {EXPERIMENTAL_DENSE_CORE_20} from '../src/shotgun.js';
import {compileSmartPlan,confirmSmartRates,emptySmartDraft} from '../src/precision-simple.js';
import {quickShotgunSettings} from '../src/quick-shotgun.js';
import {evaluatePrewarmFeasibility} from '../src/api-booking/prewarm-feasibility.js';
import type {ChildSample} from '../src/fanout-capacity.js';
import type {ShotgunTimingReadiness} from '../src/shotgun-timing.js';
const date='2026-10-07';
const draft={...emptySmartDraft(),rates:confirmSmartRates(600,700,'VENUE_SCHEDULE',date,new Date()),immediate:[{court:7,start:'19:00',durationHours:3}]};
const compiled=compileSmartPlan({...draft,shotgun:quickShotgunSettings(draft,20)!},{targetDate:date,unavailable:new Set(),shotgunCapacity:{meaningfulSpacingMs:105}});
const plan=compiled.phase3!,topology=exactShotgunTopology(plan);
const forecast=evaluatePrewarmFeasibility({phase3:plan,prepP95Ms:1000,sampleCount:30,availableWorkers:new Set('ABCDEFG'),globalConcurrency:4});
const sample=(error=8):ChildSample=>({run:0,workerIndex:0,workerId:'A',fanOutIndex:0,fanOutCount:1,configuredOffsetMs:-500,schedulerWakeMs:-500,workerInvokedMs:-499,transportEnteredMs:-498,prePostMs:-497,evaluateEnteredMs:-494,fetchInvokedMs:-493,chromeStartMs:-500+error,requestEventMs:-490,responseMs:-470,state:'REJECTED',prewarmDurationMs:10,prewarmReadyMs:-15000});
const compatibility={machineKey:shotgunMachineKey(),buildKey:'build1',dispatcher:'central',chromeVersion:'Chrome/test'};
describe('exact Shotgun readiness',()=>{
  it('preserves compiled Dense Core 20 as 6/6/6/2 with independent saved offsets and tiers',()=>{
    expect(compiled.problems).toEqual([]);expect(Object.values(topology.tabsPerWorker)).toEqual([6,6,6,2]);expect(topology.shots.map(s=>s.configuredOffsetMs)).toEqual([...EXPERIMENTAL_DENSE_CORE_20]);
    expect(topology.shots.every(s=>s.fanOutIndex<6)).toBe(true);expect(topology.minimumSpacingMs).toBe(1);assertShotgunSchedule(topology,compiled.shotgun!.shots);
  });
  it('blocks any missing tab, unknown probe or mismatch between exact schedule and authorization',()=>{
    const probes=Object.fromEntries(Object.entries(topology.tabsPerWorker).map(([w,n])=>[w,{connected:true,targetReady:true,tabCount:n}]));
    expect(()=>assertShotgunTabs(topology,probes)).not.toThrow();probes.A!.tabCount=5;expect(()=>assertShotgunTabs(topology,probes)).toThrow('SHOTGUN_TOPOLOGY_NOT_READY');
    expect(()=>assertShotgunTabs(topology,{})).toThrow('SHOTGUN_TOPOLOGY_NOT_READY');expect(()=>assertShotgunSchedule(topology,compiled.shotgun!.shots.slice(1))).toThrow('SHOTGUN_TOPOLOGY_NOT_READY');
  });
  it('requires all READY, zero AT_RISK, zero omissions and matching count',()=>{
    expect(()=>assertShotgunPrewarm(forecast,20)).not.toThrow();
    for(const patch of [{projectedReady:19,projectedAtRisk:1},{projectedReady:19,projectedOmitted:1},{configuredWave1Attempts:19}])expect(()=>assertShotgunPrewarm({...forecast,...patch},20)).toThrow('SHOTGUN_PREWARM_NOT_FULLY_READY');
  });
  it('fingerprints workers, tiers, exact custom offsets and target identities',()=>{
    const change=structuredClone(plan);change.wave1[0]!.fanOutOffsetsMs![0]=-999;expect(exactShotgunTopology(change).fingerprint).not.toBe(topology.fingerprint);
    const worker=structuredClone(plan);worker.wave1[0]!.workerId='G';expect(exactShotgunTopology(worker).fingerprint).not.toBe(topology.fingerprint);
  });
  it('requires each exact saved tab exactly once per run and rejects nonfinite Chrome samples',()=>{
    const saved=exactShotgunTopology({candidates:[{court:7,start:'19:00',durationHours:3}],wave1:[{workerId:'A',candidateIndex:0,fanOutOffsetsMs:[-1000,-80,0]}]});
    const rows=saved.shots.map(shot=>({...sample(),workerId:shot.workerId,fanOutIndex:shot.fanOutIndex,fanOutCount:3,
      configuredOffsetMs:shot.configuredOffsetMs,chromeStartMs:shot.configuredOffsetMs+8}));
    expect(summarizeShotgunTiming(saved,rows,compatibility,1).status).toBe('READY');
    const variants=[
      [rows[0]!,rows[0]!,rows[2]!],
      rows.map((row,i)=>i===1?{...row,workerId:'B'}:row),
      rows.map((row,i)=>i===1?{...row,run:1}:row),
      rows.map((row,i)=>i===1?{...row,fanOutCount:2}:row),
      ...[NaN,Infinity,-Infinity].map(value=>rows.map((row,i)=>i===1?{...row,chromeStartMs:value}:row)),
    ];
    for(const variant of variants)expect(summarizeShotgunTiming(saved,variant,compatibility,1).status).toBe('FAILED');
    expect(summarizeShotgunTiming(saved,rows,compatibility,1.5).status).toBe('FAILED');
  });
  it('rejects malformed or contradictory READY calibration records for the exact saved topology',()=>{
    const tiny=exactShotgunTopology({candidates:[{court:7,start:'19:00',durationHours:3}],wave1:[{workerId:'A',releaseOffsetMs:-500,candidateIndex:0}]});
    const ready=summarizeShotgunTiming(tiny,[sample()],compatibility,1);
    const patches:Partial<ShotgunTimingReadiness>[]=[{p50:null},{p95:NaN},{max:Infinity},{max:80},{p50:-1},{p50:10,p95:8},
      {outsideTolerance:1},{omittedShots:1},{compressedPairs:1},{compressedPairs:-1},
      {runs:1.5},{runs:Infinity},{tabsPerWorker:{A:2}},{tabsPerWorker:{A:1,B:1}},
      {configuredMinimumSpacingMs:0},{predictedCompression:true}];
    expect(applicableShotgunTiming(ready,tiny,'build1')).toBe(true);
    for(const patch of patches)expect(applicableShotgunTiming({...ready,...patch},tiny,'build1')).toBe(false);
  });
  it('reports Chrome timing, omissions and compression without turning them into provider evidence',()=>{
    const tiny=exactShotgunTopology({candidates:[{court:7,start:'19:00',durationHours:3}],wave1:[{workerId:'A',releaseOffsetMs:-500,candidateIndex:0}]});
    const ready=summarizeShotgunTiming(tiny,[sample()],compatibility,1);expect(ready).toMatchObject({status:'READY',p50:8,p95:8,max:8,outsideTolerance:0,omittedShots:0});
    expect(summarizeShotgunTiming(tiny,[sample(80)],compatibility,1).status).toBe('FAILED');expect(summarizeShotgunTiming(tiny,[{...sample(),chromeStartMs:null}],compatibility,1).omittedShots).toBe(1);
    expect(summarizeShotgunTiming(tiny,[],compatibility,0).status).toBe('NOT_TESTED');
    expect(applicableShotgunTiming(ready,tiny,'build1')).toBe(true);expect(applicableShotgunTiming(ready,topology,'build1')).toBe(false);expect(applicableShotgunTiming(ready,tiny,'build2')).toBe(false);
    expect(applicableShotgunTiming({...ready,machineKey:'another'},tiny,'build1')).toBe(false);expect(applicableShotgunTiming({...ready,dispatcher:'renderer'},tiny,'build1')).toBe(false);
    expect(applicableShotgunTiming({...ready,testedAt:'2020-01-01'},tiny,'build1')).toBe(false);
    // Electron consumes evidence measured by the separate dispatcher executable. The caller must supply
    // that probed runtime identity; an unavailable or different runtime never makes a profile applicable.
    const dispatcherKey=JSON.stringify({...JSON.parse(shotgunMachineKey()),node:'v24.15.0'});
    const runnerProfile={...ready,machineKey:dispatcherKey};
    expect(applicableShotgunTiming(runnerProfile,tiny,'build1',Date.now(),'Chrome/test',dispatcherKey)).toBe(true);
    expect(applicableShotgunTiming(runnerProfile,tiny,'build1',Date.now(),'Chrome/test',null)).toBe(false);
    expect(applicableShotgunTiming(runnerProfile,tiny,'build1',Date.now(),'Chrome/test','other-runtime')).toBe(false);
  });
});

it('retains ordinary Precision policy beside selected Shotgun targets in a mixed saved plan',()=>{
  const mixed={candidates:[{court:7,start:'19:00',durationHours:3},{court:6,start:'19:00',durationHours:3}],wave1:[{workerId:'A',candidateIndex:0,fanOutOffsetsMs:[-500,0]},{workerId:'B',candidateIndex:1,releaseOffsetMs:-100}]};
  const schedule=[{logicalTargetId:'court-7:19:00:3h',configuredOffsetMs:-500},{logicalTargetId:'court-7:19:00:3h',configuredOffsetMs:0}];
  const t=exactShotgunTopology(mixed,schedule);expect(t.shots.map(s=>s.shotgun)).toEqual([true,true,false]);expect(()=>assertShotgunSchedule(t,schedule)).not.toThrow();
  expect(t.tabsPerWorker).toEqual({A:2,B:1});expect(t.minimumSpacingMs).toBe(500);
});
