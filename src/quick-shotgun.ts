import { compileSmartPlan, SMART_WORKERS, type SmartDraft } from './precision-simple.js';
import { logicalTargetId, type ShotgunSettings } from './shotgun.js';
import { evaluatePrewarmFeasibility, type PrewarmFeasibilityResult } from './api-booking/prewarm-feasibility.js';
import { PRECISION_MAX_SENDS } from './workers.js';

export const primaryShotgunTarget = (draft: SmartDraft) => draft.immediate.map((slot,index)=>({slot,index}))
  .sort((a,b)=>(a.slot.priority??a.index+1)-(b.slot.priority??b.index+1)||a.index-b.index)[0]?.slot;
export function quickShotgunSettings(draft: SmartDraft, budget: number): ShotgunSettings | null {
  const primary=primaryShotgunTarget(draft); if(!primary)return null; const id=logicalTargetId(primary);
  return {enabled:true,budget,allocationMode:'CUSTOM',selectedTargetIds:[id],customCounts:{[id]:budget},windowStartMs:-1000,windowEndMs:0,
    timingMode:'DENSE_CORE',timingCapacityOverride:true,allowStandbyConsumption:true};
}
export const fullyReady = (value: PrewarmFeasibilityResult | null | undefined): boolean =>
  !!value && value.verdict==='READY' && value.projectedReady===value.configuredWave1Attempts && value.projectedAtRisk===0 && value.projectedOmitted===0;
/** Recalculate only the total send budget for the new Wave 1. Preserve explicit standby, Wave 2 and Rescue overrides. */
export function fitQuickShotgun(draft: SmartDraft, context: (budget:number)=>Parameters<typeof compileSmartPlan>[1],
  forecast:(phase3:NonNullable<ReturnType<typeof compileSmartPlan>['phase3']>)=>PrewarmFeasibilityResult|null) {
  let reason='No immediate target. Add a release target first.';
  for(let budget=Math.min(20,PRECISION_MAX_SENDS);budget>=1;budget--){
    const settings=quickShotgunSettings(draft,budget); if(!settings)break;
    const candidate={...structuredClone(draft),shotgun:settings};
    delete candidate.advanced.total;
    const compiled=compileSmartPlan(candidate,context(budget));
    if(!compiled.phase3||compiled.problems.length){reason=compiled.problems[0]??'Plan compilation failed.';continue;}
    const feasibility=forecast(compiled.phase3);
    if(feasibility && fullyReady(feasibility))return {fit:{settings,feasibility,compiled},reason:''};
    reason=feasibility?`${feasibility.verdict.replaceAll('_',' ')}: ${feasibility.projectedReady}/${feasibility.configuredWave1Attempts} READY, ${feasibility.projectedAtRisk} AT RISK, ${feasibility.projectedOmitted} omitted.`:'Preparation forecast unavailable.';
  }
  return {fit:null,reason};
}

/** Stable UI provenance signature. This marker never establishes readiness or authorizes execution. */
export function shotgunSettingsKey(settings:ShotgunSettings|undefined):string {
  if(!settings)return '';
  return JSON.stringify({enabled:settings.enabled,budget:settings.budget,allocationMode:settings.allocationMode,
    selectedTargetIds:settings.selectedTargetIds,customCounts:Object.entries(settings.customCounts??{}).sort(([a],[b])=>a.localeCompare(b)),
    windowStartMs:settings.windowStartMs,windowEndMs:settings.windowEndMs,timingMode:settings.timingMode,
    customOffsetsMs:settings.customOffsetsMs??[],timingCapacityOverride:settings.timingCapacityOverride??settings.capacityOverride??false,
    allowStandbyConsumption:settings.allowStandbyConsumption??false});
}

/** Exact-plan forecast, shared by editor and saved-strategy display; the existing arm gate remains authoritative. */
export function forecastPreparation(phase3:NonNullable<ReturnType<typeof compileSmartPlan>['phase3']>, unavailable:ReadonlySet<string>,
  prior?:Pick<PrewarmFeasibilityResult,'p95Source'|'preparationP95Ms'|'sampleCount'>|null):PrewarmFeasibilityResult {
  return evaluatePrewarmFeasibility({phase3,prepP95Ms:prior?.p95Source==='COMPATIBLE_MEASURED_HISTORY'?prior.preparationP95Ms:null,
    sampleCount:prior?.sampleCount??0,availableWorkers:new Set(SMART_WORKERS.filter(worker=>!unavailable.has(worker))),
    globalConcurrency:Math.max(1,new Set(phase3.wave1.map(value=>value.workerId)).size)});
}

/** Persistence may reorder object keys; compare values, including the literal compiled authorization. */
export function configurationFingerprint(value:unknown):string {
  const canonical=(input:unknown):unknown=>Array.isArray(input)?input.map(canonical):input!==null&&typeof input==='object'
    ?Object.fromEntries(Object.entries(input).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,canonical(v)])):input;
  return JSON.stringify(canonical(value));
}
