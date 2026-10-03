import {logicalTargetId} from '../shotgun.js';
import type {SmartPhase3} from '../precision-simple.js';
import {BASE_PREWARM_LEAD_MS,MAX_PREWARM_LEAD_MS,PREPARED_CONTEXT_FRESHNESS_MS,PREWARM_FALLBACK_DURATION_MS,
  decidePrewarmStarts,type PrewarmPolicy,type PrewarmTask} from './prewarm-scheduler.js';

export type PrewarmFeasibilityVerdict='READY'|'AT_RISK'|'NOT_FEASIBLE';
export type PrewarmAttemptVerdict='READY'|'AT_RISK'|'OMITTED';
export type PrewarmFeasibilityReason='PREWARM_CAPACITY_EXCEEDED'|'PREWARM_FRESHNESS_LIMIT'|'PREWARM_PROJECTED_OMISSION'|'PREWARM_WORKER_UNAVAILABLE'|'PREWARM_TRIGGER_TOO_EARLY';
export interface PrewarmFeasibilityAttempt {attemptId:string;workerId:string;logicalTargetId:string;tier:number;configuredOffsetMs:number;
  predictedPrepareStartMs:number|null;predictedPrepareReadyMs:number|null;triggerTimeMs:number;freshnessAtTriggerMs:number|null;
  verdict:PrewarmAttemptVerdict;reason?:PrewarmFeasibilityReason;}
export interface PrewarmFeasibilityResult {verdict:PrewarmFeasibilityVerdict;configuredWave1LogicalTargets:number;configuredWave1Attempts:number;
  preparationTaskCount:number;tiers:number;groups:number;prewarmLeadMs:number;preparationP95Ms:number;p95Source:'COMPATIBLE_MEASURED_HISTORY'|'FALLBACK';sampleCount:number;
  predictedPreparationStartMs:number;projectedReady:number;projectedAtRisk:number;projectedOmitted:number;limitingConstraints:PrewarmFeasibilityReason[];
  freshnessMarginMs:number;concurrency:{global:number;perGroup:number;tierBarrierTimeoutMs:number;stopStartingLeadMs:number};
  retryAssumption:{maxAttempts:number;retryCutoffLeadMs:number;forecastAssumesSuccessAttempt:number};attempts:PrewarmFeasibilityAttempt[];}

interface TimelineTask extends PrewarmTask {workerId:string;logicalTargetId:string;configuredOffsetMs:number;available:boolean}
interface TimelineEntry {start:number|null;ready:number|null;omitted?:PrewarmFeasibilityReason}

function simulate(tasks:readonly TimelineTask[],policy:PrewarmPolicy,startMs:number,durationMs:number,stopMs:number):Map<string,TimelineEntry>{
  const active=tasks.filter(task=>task.available),entries=new Map<string,TimelineEntry>(tasks.map(task=>[task.id,{start:null,ready:null,...(!task.available?{omitted:'PREWARM_WORKER_UNAVAILABLE' as const}:{})}]));
  const started=new Set<string>(),settled=new Set<string>(),tierStartedAt=new Map<number,number>(),inGroup=new Map<string,number>(),finishes=new Map<string,number>();
  let now=startMs,inFlight=0,guard=0;
  while(settled.size<active.length&&guard++<10000){
    const stopped=now>=stopMs;
    const decision=decidePrewarmStarts(active,policy,{started,settled,tierStartedAt,inGroup,inFlight,now,stopped});
    for(const task of decision.start){started.add(task.id);inFlight++;inGroup.set(task.group,(inGroup.get(task.group)??0)+1);if(!tierStartedAt.has(task.tier))tierStartedAt.set(task.tier,now);
      entries.set(task.id,{start:now,ready:now+durationMs});finishes.set(task.id,now+durationMs);}
    if(stopped){for(const task of active)if(!started.has(task.id)&&!settled.has(task.id))entries.set(task.id,{start:null,ready:null,omitted:'PREWARM_PROJECTED_OMISSION'});break;}
    const nextFinish=Math.min(...[...finishes.entries()].filter(([id])=>!settled.has(id)).map(([,at])=>at),Infinity);
    const next=Math.min(nextFinish,decision.nextWake??Infinity,stopMs);
    if(!Number.isFinite(next)){break;}now=Math.max(now,next);
    for(const [id,at] of finishes)if(!settled.has(id)&&at<=now){settled.add(id);inFlight--;const task=active.find(value=>value.id===id)!;inGroup.set(task.group,(inGroup.get(task.group)??1)-1);}
  }
  return entries;
}

export function exactPrewarmLeadMs(tasks:readonly PrewarmTask[],policy:PrewarmPolicy,prepDurationMs:number):number{
  if(Math.max(0,...tasks.map(task=>task.tier))===0)return BASE_PREWARM_LEAD_MS;
  const timeline=simulate(tasks.map(task=>({...task,workerId:task.group,logicalTargetId:task.id,configuredOffsetMs:0,available:true})),policy,0,prepDurationMs,Infinity);
  const finish=Math.max(0,...[...timeline.values()].map(value=>value.ready??0));
  return Math.min(MAX_PREWARM_LEAD_MS,Math.max(BASE_PREWARM_LEAD_MS,Math.ceil(finish*1.25+15_000)));
}

export function phase3PrewarmTasks(phase3:SmartPhase3,availableWorkers?:ReadonlySet<string>):TimelineTask[]{
  return phase3.wave1.flatMap((assignment,assignmentIndex)=>{
    const candidate=phase3.candidates[assignment.candidateIndex]!,offsets=assignment.fanOutOffsetsMs??[assignment.releaseOffsetMs??0];
    return offsets.map((configuredOffsetMs,tier)=>({id:`${assignment.workerId}-${assignmentIndex}-${tier}`,workerId:assignment.workerId,
      logicalTargetId:logicalTargetId(candidate),tier,order:assignmentIndex*100+tier,group:assignment.workerId,configuredOffsetMs,
      available:!availableWorkers||availableWorkers.has(assignment.workerId)}));
  });
}

export function evaluatePrewarmFeasibility(input:{phase3:SmartPhase3;prepP95Ms:number|null;sampleCount?:number;availableWorkers?:ReadonlySet<string>;
  globalConcurrency?:number;perGroupConcurrency?:number;tierBarrierTimeoutMs?:number;stopStartingLeadMs?:number;preparedContextFreshnessMs?:number}):PrewarmFeasibilityResult{
  const tasks=phase3PrewarmTasks(input.phase3,input.availableWorkers),groups=new Set(tasks.map(task=>task.group)).size,tiers=Math.max(0,...tasks.map(task=>task.tier+1));
  const prepP95Ms=input.prepP95Ms!==null&&input.prepP95Ms>0?Math.ceil(input.prepP95Ms):PREWARM_FALLBACK_DURATION_MS;
  const policy:PrewarmPolicy={concurrency:Math.max(1,input.globalConcurrency??groups),perGroupConcurrency:Math.max(1,input.perGroupConcurrency??1),
    tierBarrierTimeoutMs:Math.max(0,input.tierBarrierTimeoutMs??Math.max(4_000,Math.round(prepP95Ms*1.5)))};
  const prewarmLeadMs=exactPrewarmLeadMs(tasks.filter(task=>task.available),policy,prepP95Ms);
  const firstTrigger=tasks.length?Math.min(...tasks.map(task=>task.configuredOffsetMs)):0,startMs=firstTrigger-prewarmLeadMs,stopLead=input.stopStartingLeadMs??3_000,stopMs=firstTrigger-stopLead;
  const timeline=simulate(tasks,policy,startMs,prepP95Ms,stopMs),freshnessLimit=input.preparedContextFreshnessMs??PREPARED_CONTEXT_FRESHNESS_MS;let freshnessMarginMs=freshnessLimit;
  const attempts:PrewarmFeasibilityAttempt[]=tasks.map(task=>{const value=timeline.get(task.id)!,trigger=task.configuredOffsetMs;
    const freshness=value.ready===null?null:trigger-value.ready;if(freshness!==null)freshnessMarginMs=Math.min(freshnessMarginMs,freshnessLimit-freshness);
    let verdict:PrewarmAttemptVerdict='READY',reason=value.omitted;
    if(reason)verdict='OMITTED';else if(value.ready!>trigger){verdict='OMITTED';reason='PREWARM_TRIGGER_TOO_EARLY';}
    else if(freshness!>freshnessLimit){verdict='OMITTED';reason='PREWARM_FRESHNESS_LIMIT';}
    else if(trigger-value.ready!<Math.max(1_000,Math.ceil(prepP95Ms*.1))||freshnessLimit-freshness!<15_000)verdict='AT_RISK';
    return {attemptId:task.id,workerId:task.workerId,logicalTargetId:task.logicalTargetId,tier:task.tier,configuredOffsetMs:task.configuredOffsetMs,
      predictedPrepareStartMs:value.start,predictedPrepareReadyMs:value.ready,triggerTimeMs:trigger,freshnessAtTriggerMs:freshness,verdict,...(reason?{reason}:{})};});
  const projectedReady=attempts.filter(value=>value.verdict==='READY').length,projectedAtRisk=attempts.filter(value=>value.verdict==='AT_RISK').length,projectedOmitted=attempts.filter(value=>value.verdict==='OMITTED').length;
  const limitingConstraints=[...new Set(attempts.flatMap(value=>value.reason?[value.reason]:[]))];if(projectedOmitted&&!limitingConstraints.includes('PREWARM_CAPACITY_EXCEEDED'))limitingConstraints.push('PREWARM_CAPACITY_EXCEEDED');
  return {verdict:projectedOmitted?'NOT_FEASIBLE':projectedAtRisk?'AT_RISK':'READY',configuredWave1LogicalTargets:new Set(tasks.map(task=>task.logicalTargetId)).size,
    configuredWave1Attempts:tasks.length,preparationTaskCount:tasks.length,tiers,groups,prewarmLeadMs,preparationP95Ms:prepP95Ms,
    p95Source:input.prepP95Ms!==null&&input.prepP95Ms>0?'COMPATIBLE_MEASURED_HISTORY':'FALLBACK',sampleCount:input.sampleCount??0,predictedPreparationStartMs:startMs,
    projectedReady,projectedAtRisk,projectedOmitted,limitingConstraints,freshnessMarginMs:Math.max(0,freshnessMarginMs),
    concurrency:{global:policy.concurrency,perGroup:policy.perGroupConcurrency,tierBarrierTimeoutMs:policy.tierBarrierTimeoutMs,stopStartingLeadMs:stopLead},
    retryAssumption:{maxAttempts:2,retryCutoffLeadMs:7_000,forecastAssumesSuccessAttempt:1},attempts};
}
