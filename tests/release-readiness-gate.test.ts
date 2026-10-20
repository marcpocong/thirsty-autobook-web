import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';
import {evaluateReleaseReadiness,readLastReleaseBuild} from '../src/release-readiness-gate.js';
import {savedPlanDate} from '../src/release-plan-date.js';

describe('tested release build record',()=>{
  it('reads the record written by scripts/release-build.mjs and returns null when absent or malformed',()=>{
    const root=mkdtempSync(join(tmpdir(),'thirsty-build-'));
    try{
      expect(readLastReleaseBuild(root)).toBeNull();
      mkdirSync(join(root,'.local/build'),{recursive:true});
      writeFileSync(join(root,'.local/build/last-release-build.json'),'{not json');expect(readLastReleaseBuild(root)).toBeNull();
      writeFileSync(join(root,'.local/build/last-release-build.json'),JSON.stringify({finishedAt:'2026-09-30T10:50:57.058Z',buildId:'cba6d30-x',gitSha:'c'.repeat(40),dirty:false,packaged:true,output:'installation',steps:[]}));
      expect(readLastReleaseBuild(root)).toEqual({gitSha:'c'.repeat(40),dirty:false,finishedAt:'2026-09-30T10:50:57.058Z',packaged:true});
    }finally{rmSync(root,{recursive:true,force:true});}
  });
});

type Input=Parameters<typeof evaluateReleaseReadiness>[0];
const worker=()=>({connected:true,identityValid:true,securityReady:true,targetReady:true,tabCount:2,latencyP95Ms:3 as number|null});
const base=():Input=>({build:{schema:'thirsty-build-info/v1' as const,kind:'installation' as const,gitSha:'a'.repeat(40),branch:'main',dirty:false,builtAt:'2026-09-30T00:00:00Z',packageVersion:'0.1.0',node:'v24',contentId:'b'.repeat(64),buildId:'x'},
  testedBuild:{gitSha:'a'.repeat(40),dirty:false,finishedAt:'2026-09-30T00:00:00Z',packaged:true},configValid:true,authorizationValid:true,
  clock:{synced:true,ageMs:1000,uncertaintyMs:2,offsetMs:1},machine:{measuredAt:'2026-09-30T00:00:00Z',cpuCount:8,memoryUsedPct:50,eventLoopP95Ms:2,processRssMb:200},
  workers:Object.fromEntries('ABCDEFG'.split('').map(id=>[id,worker()])),observer:{online:true,lastReadAgeMs:100,availabilityLatencyMs:20},fanOut:{compatible:true,stale:false,width:2},prewarm:true});
const check=(input:Input,id:string)=>evaluateReleaseReadiness(input).checks.find(value=>value.id===id)!;

describe('release readiness gate',()=>{
  it('reports READY only when every check is good',()=>{
    const result=evaluateReleaseReadiness(base());
    expect(result.verdict).toBe('READY');expect(result.readyWorkers).toEqual('ABCDEFG'.split(''));
  });

  it('warns for a degraded worker without silently excluding it',()=>{
    const input=base();input.workers.A!.securityReady=false;const result=evaluateReleaseReadiness(input);
    expect(result.verdict).toBe('READY_WITH_WARNINGS');expect(result.degradedWorkers).toEqual(['A']);expect(result.readyWorkers).not.toContain('A');
    expect(check(input,'worker-A')).toMatchObject({level:'DEGRADED',hardBlock:false,detail:'session not prepared for the saved plan'});
  });

  it('marks a worker with slow command latency degraded and names the measurement',()=>{
    const input=base();input.workers.F!.latencyP95Ms=24;
    expect(check(input,'worker-F')).toMatchObject({level:'DEGRADED',detail:expect.stringContaining('probe 24.0 ms')});
    expect(evaluateReleaseReadiness(input).degradedWorkers).toEqual(['F']);
  });

  it('marks a missing or unidentified worker unavailable as a warning, not a safety block',()=>{
    const input=base();input.workers.B!.connected=false;input.workers.C!.identityValid=false;const result=evaluateReleaseReadiness(input);
    expect(result.verdict).toBe('READY_WITH_WARNINGS');expect(result.unavailableWorkers).toEqual(['B','C']);
    expect(check(input,'worker-B').detail).toBe('browser disconnected');expect(check(input,'worker-C').detail).toBe('identity/profile not verified');
  });

  it('flags a worker without its Onda tab or any responsive tab',()=>{
    const input=base();input.workers.D!.targetReady=false;input.workers.E!.tabCount=0;
    expect(evaluateReleaseReadiness(input).degradedWorkers).toEqual(['D','E']);
  });

  it('hard-blocks an invalid saved authorization or missing trusted clock',()=>{
    const auth=base();auth.authorizationValid=false;expect(evaluateReleaseReadiness(auth).verdict).toBe('NOT_READY');
    const config=base();config.configValid=false;expect(check(config,'config')).toMatchObject({level:'UNAVAILABLE',hardBlock:true,detail:'Configuration is invalid'});
    const clock=base();clock.clock.synced=false;expect(evaluateReleaseReadiness(clock).verdict).toBe('NOT_READY');
  });

  it('warns for an old or uncertain trusted clock without blocking',()=>{
    const uncertain=base();uncertain.clock.uncertaintyMs=40;
    expect(check(uncertain,'clock')).toMatchObject({level:'DEGRADED',hardBlock:false});expect(evaluateReleaseReadiness(uncertain).verdict).toBe('READY_WITH_WARNINGS');
    const old=base();old.clock.ageMs=20*60_000;expect(check(old,'clock').level).toBe('DEGRADED');
  });

  it('flags a running build that is not the tested packaged build, a dirty build, or no record',()=>{
    const wrong=base();wrong.testedBuild!.gitSha='c'.repeat(40);
    expect(check(wrong,'build')).toMatchObject({level:'DEGRADED',detail:'Running SHA does not match the last tested packaged build'});
    const unpackaged=base();unpackaged.testedBuild!.packaged=false;expect(check(unpackaged,'build').level).toBe('DEGRADED');
    const dirty=base();dirty.build!.dirty=true;expect(check(dirty,'build').detail).toContain('dirty');
    const none=base();none.testedBuild=null;expect(check(none,'build')).toMatchObject({level:'UNAVAILABLE',hardBlock:false});
  });

  it('reports a stale, incompatible or missing fan-out profile and Auto width 1 fallback',()=>{
    const stale=base();stale.fanOut!.stale=true;expect(check(stale,'fanout')).toMatchObject({level:'DEGRADED',detail:'2 per target · stale'});
    const incompatible=base();incompatible.fanOut!.compatible=false;expect(check(incompatible,'fanout').detail).toContain('incompatible');
    const missing=base();missing.fanOut=null;expect(check(missing,'fanout')).toMatchObject({level:'UNAVAILABLE',detail:'Auto falls back to width 1'});
  });

  it('shows an offline observer as a warning and keeps adaptive waves fail-closed',()=>{
    const input=base();input.observer.online=false;
    expect(check(input,'observer')).toMatchObject({level:'DEGRADED',hardBlock:false,detail:expect.stringContaining('Wave 2 and Rescue require new valid evidence')});
    expect(evaluateReleaseReadiness(input).verdict).toBe('READY_WITH_WARNINGS');
  });

  it('grades machine pressure and missing prewarm as warnings',()=>{
    const busy=base();busy.machine.eventLoopP95Ms=25;expect(check(busy,'machine').level).toBe('DEGRADED');
    const severe=base();severe.machine.memoryUsedPct=95;expect(check(severe,'machine')).toMatchObject({level:'UNAVAILABLE',hardBlock:false});
    const cold=base();cold.prewarm=false;expect(check(cold,'prewarm').level).toBe('DEGRADED');
    expect(evaluateReleaseReadiness(severe).verdict).toBe('READY_WITH_WARNINGS');
  });
  it('grades exact Wave 1 preparation capacity and hard-blocks projected omissions',()=>{
    const good=base();good.prewarmFeasibility={verdict:'READY',configuredWave1LogicalTargets:2,configuredWave1Attempts:4,preparationTaskCount:4,tiers:2,groups:2,
      prewarmLeadMs:35_000,preparationP95Ms:8_000,p95Source:'COMPATIBLE_MEASURED_HISTORY',sampleCount:10,predictedPreparationStartMs:-35_000,
      projectedReady:4,projectedAtRisk:0,projectedOmitted:0,limitingConstraints:[],freshnessMarginMs:90_000,
      concurrency:{global:2,perGroup:1,tierBarrierTimeoutMs:12_000,stopStartingLeadMs:3_000},retryAssumption:{maxAttempts:2,retryCutoffLeadMs:7_000,forecastAssumesSuccessAttempt:1},attempts:[]};
    expect(check(good,'wave1-preparation-capacity')).toMatchObject({level:'GOOD',hardBlock:false});
    const risk=structuredClone(good);risk.prewarmFeasibility!.verdict='AT_RISK';risk.prewarmFeasibility!.projectedReady=3;risk.prewarmFeasibility!.projectedAtRisk=1;
    expect(evaluateReleaseReadiness(risk).verdict).toBe('READY_WITH_WARNINGS');
    const omitted=structuredClone(good);omitted.prewarmFeasibility!.verdict='NOT_FEASIBLE';omitted.prewarmFeasibility!.projectedReady=3;omitted.prewarmFeasibility!.projectedOmitted=1;
    expect(check(omitted,'wave1-preparation-capacity')).toMatchObject({level:'UNAVAILABLE',hardBlock:true});expect(evaluateReleaseReadiness(omitted).verdict).toBe('NOT_READY');
  });
});

it('Shotgun hard-blocks incomplete exact tabs, failed timing and severe load without changing ordinary Precision warnings',()=>{
  const input=base();input.workers.A!.tabCount=1;input.machine.eventLoopP95Ms=80;
  expect(evaluateReleaseReadiness(input).verdict).toBe('READY_WITH_WARNINGS');
  input.shotgun={tabsPerWorker:{A:6,B:6,C:6,D:2},shotCount:20,timingStatus:'FAILED'};
  expect(evaluateReleaseReadiness(input).verdict).toBe('NOT_READY');
  expect(check(input,'shotgun-topology').hardBlock).toBe(true);expect(check(input,'shotgun-timing').hardBlock).toBe(true);expect(check(input,'machine').hardBlock).toBe(true);
});
it('live Shotgun treats a missing, expired or mismatched calibration as a hard block, never a warning',()=>{
  const input=base();
  for(const status of ['NOT_TESTED','EXPIRED','INCOMPATIBLE','AT_RISK','FAILED'] as const){
    input.shotgun={tabsPerWorker:{A:1,B:1},shotCount:2,timingStatus:status,timingReason:'fixture reason'};
    const timing=check(input,'shotgun-timing');
    expect(timing).toMatchObject({level:'UNAVAILABLE',hardBlock:true});expect(timing.detail).toContain('fixture reason');
    expect(evaluateReleaseReadiness(input).verdict).toBe('NOT_READY');
  }
  input.shotgun={tabsPerWorker:{A:1,B:1},shotCount:2};
  expect(check(input,'shotgun-timing')).toMatchObject({level:'UNAVAILABLE',hardBlock:true});
  input.shotgun={tabsPerWorker:{A:1,B:1},shotCount:2,timingStatus:'READY'};
  expect(check(input,'shotgun-timing')).toMatchObject({level:'GOOD',hardBlock:false});
});
it('a saved plan dated for an earlier release blocks the configuration check with the exact dates',()=>{
  const input=base();
  input.planDate=savedPlanDate({PRECISION_PHASE3:{candidates:[{rateEvidence:{date:'2026-10-22'}},{rateEvidence:{date:'2026-10-22'}}]}},'2026-10-23');
  expect(check(input,'config')).toMatchObject({level:'UNAVAILABLE',hardBlock:true});
  expect(check(input,'config').detail).toContain('Saved for 2026-10-22');expect(check(input,'config').detail).toContain('2026-10-23');
  input.planDate=savedPlanDate({PRECISION_PHASE3:{candidates:[{rateEvidence:{date:'2026-10-23'}}]}},'2026-10-23');
  expect(check(input,'config').level).toBe('GOOD');
  input.planDate=savedPlanDate({},'2026-10-23');
  expect(check(input,'config').level).toBe('GOOD');
});
