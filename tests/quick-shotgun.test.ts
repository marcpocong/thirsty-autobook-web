import {describe,it,expect} from 'vitest';
import {fitQuickShotgun,fullyReady,primaryShotgunTarget,quickShotgunSettings,configurationFingerprint} from '../src/quick-shotgun.js';
import {emptySmartDraft,confirmSmartRates,compileSmartPlan,type SmartDraft} from '../src/precision-simple.js';
import {evaluatePrewarmFeasibility} from '../src/api-booking/prewarm-feasibility.js';
const date='2026-10-07';
const draft=():SmartDraft=>({...emptySmartDraft(),rates:confirmSmartRates(600,700,'VENUE_SCHEDULE',date,new Date()),immediate:[{court:7,start:'19:00',durationHours:3}]});
const context=()=>({targetDate:date,unavailable:new Set<string>(),shotgunCapacity:{meaningfulSpacingMs:40,recommendedBurstChildren:1,groupAnchorMs:0}});
const forecast=(p95:number)=>(phase3:NonNullable<ReturnType<typeof compileSmartPlan>['phase3']>)=>evaluatePrewarmFeasibility({phase3,prepP95Ms:p95,sampleCount:30,availableWorkers:new Set('ABCDEFG'),globalConcurrency:new Set(phase3.wave1.map(v=>v.workerId)).size});
describe('Quick Shotgun policy',()=>{
  it('compares persisted values independently of serialization order',()=>{expect(configurationFingerprint({b:2,a:[{z:3,y:4}]})).toBe(configurationFingerprint({a:[{y:4,z:3}],b:2}));expect(configurationFingerprint({a:-999})).not.toBe(configurationFingerprint({a:-1000}));});
  it('uses explicit priority and then immediate order, selecting only one target',()=>{
    const value=draft();value.immediate.push({court:6,start:'19:00',durationHours:3,priority:0});
    expect(primaryShotgunTarget(value)?.court).toBe(6);expect(quickShotgunSettings(value,20)?.selectedTargetIds).toHaveLength(1);
    delete value.immediate[1]!.priority;expect(primaryShotgunTarget(value)?.court).toBe(7);
  });
  it('proves maximal strict READY fit with the actual compiler and prewarm evaluator',()=>{
    const value=draft(),result=fitQuickShotgun(value,context,forecast(18000));expect(result.fit).not.toBeNull();
    const budget=result.fit!.settings.budget;expect(budget).toBe(5);expect(fullyReady(result.fit!.feasibility)).toBe(true);
    for(let n=budget+1;n<=20;n++){const compiled=compileSmartPlan({...value,shotgun:quickShotgunSettings(value,n)!},context());
      expect(compiled.problems).toEqual([]);expect(fullyReady(forecast(18000)(compiled.phase3!))).toBe(false);}
  });
  it('rejects AT_RISK even with zero omitted and continues downward',()=>{
    const value=draft(),compiled=compileSmartPlan({...value,shotgun:quickShotgunSettings(value,6)!},context());
    const risk=forecast(17500)(compiled.phase3!);expect(risk.projectedOmitted).toBe(0);expect(risk.projectedAtRisk).toBeGreaterThan(0);
    expect(fullyReady(risk)).toBe(false);expect(fitQuickShotgun(value,context,forecast(17500)).fit!.settings.budget).toBe(5);
  });
  it('rejects missing feasibility, inconsistent READY counts and no fully ready budget',()=>{
    expect(fullyReady(null)).toBe(false);expect(fitQuickShotgun(draft(),context,()=>null).fit).toBeNull();
    const good=fitQuickShotgun(draft(),context,forecast(12000)).fit!.feasibility;
    expect(fullyReady({...good,projectedReady:good.configuredWave1Attempts-1})).toBe(false);
    expect(fitQuickShotgun(draft(),context,forecast(200000)).fit).toBeNull();
  });
  it('blocks absent targets and unavailable workers',()=>{
    const value=draft();value.immediate=[];expect(fitQuickShotgun(value,context,forecast(12000)).fit).toBeNull();
    expect(fitQuickShotgun(draft(),()=>({...context(),unavailable:new Set('ABCDEFG')}),forecast(12000)).fit).toBeNull();
  });
  it('preserves unrelated advanced settings and rejects incompatible overrides',()=>{
    const value=draft();value.advanced={wave2:0,rescue:0};const before=structuredClone(value);
    expect(fitQuickShotgun(value,context,forecast(12000)).fit).not.toBeNull();expect(value).toEqual(before);
    value.advanced.total=0;expect(fitQuickShotgun(value,context,forecast(12000)).fit).not.toBeNull();expect(value.advanced.total).toBe(0);
    value.advanced.wave2=8;expect(fitQuickShotgun(value,context,forecast(12000)).fit).toBeNull();expect(value.advanced.wave2).toBe(8);
  });
});

it('Quick Wave 1 is exactly the fitted primary budget and preserves every other target as backup',()=>{
 const value=draft();value.immediate.push({court:6,start:'19:00',durationHours:3},{court:5,start:'20:00',durationHours:3});
 const before=structuredClone(value),fit=fitQuickShotgun(value,context,forecast(12000)).fit!;
 expect(fit).not.toBeNull();expect(fit.draft.immediate).toHaveLength(1);expect(fit.draft.backups).toEqual([...before.immediate.slice(1),...before.backups]);
 expect(fit.feasibility.configuredWave1Attempts).toBe(fit.settings.budget);
 expect(fit.compiled.phase3!.wave1.reduce((n,a)=>n+(a.fanOutOffsetsMs?.length??1),0)).toBe(fit.settings.budget);
 expect(value).toEqual(before);
});
