import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { adaptiveMaxAgeMs, classifyActionableObservation, isActionableEvidenceFitness } from './api-booking/precision-phase3.js';
import type { CriticalPathRow, Bounded } from './api-booking/critical-path.js';
import type { ProviderTraceRecord, ProviderResponseFallback } from './api-booking/checkout-provider-trace.js';
import type { ReleaseForensicsSummary } from './release-forensics.js';
import { findObserverLog, readObserverLog } from './release-forensics.js';
import { deriveTimeline, targetEvidence, type AvailabilityObservation, type BookingObservation, type SlotTimelineEntry } from './slot-evidence.js';

type Line=Record<string,unknown>;
const round=(value:number)=>Math.round(value*100)/100;
const median=(values:Array<number|null>)=>{const sorted=values.filter((value):value is number=>value!==null&&Number.isFinite(value)).sort((a,b)=>a-b);if(!sorted.length)return null;const middle=Math.floor(sorted.length/2);return round(sorted.length%2?sorted[middle]!:(sorted[middle-1]!+sorted[middle]!)/2);};
const range=(values:Array<number|null>)=>{const usable=values.filter((value):value is number=>value!==null&&Number.isFinite(value));return usable.length?{min:round(Math.min(...usable)),max:round(Math.max(...usable))}:{min:null,max:null};};
const readJson=<T>(path:string):T|undefined=>{try{return JSON.parse(readFileSync(path,'utf8')) as T;}catch{return undefined;}};
const readLines=(path:string):Line[]=>{try{return readFileSync(path,'utf8').split('\n').flatMap(line=>{try{const value=JSON.parse(line) as unknown;return value&&typeof value==='object'&&!Array.isArray(value)?[value as Line]:[];}catch{return[];}});}catch{return[];}};
const atomic=(path:string,content:string)=>{mkdirSync(dirname(path),{recursive:true,mode:0o700});const temporary=`${path}.tmp`;writeFileSync(temporary,content,{encoding:'utf8',mode:0o600});renameSync(temporary,path);};

export type MovementConfidence='HIGH'|'MEDIUM'|'LOW'|'AMBIGUOUS';
export interface MovementCluster {court:number;hours:string[];direction:'OPEN_TO_UNAVAILABLE'|'UNAVAILABLE_TO_OPEN';beforeSeq:number;afterSeq:number;windowMs:[number,number];confidence:MovementConfidence;wording:string}
export interface BlanketRange {courts:number[];start:string;end:string;cells:number;beforeSeq:number;afterSeq:number;windowMs:[number,number];confidence:MovementConfidence;direction?:MovementCluster['direction']}
export interface MovementForensics {blankets:BlanketRange[];broadMovements?:Array<{direction:MovementCluster['direction'];courts:number[];cells:number;beforeSeq:number;afterSeq:number;windowMs:[number,number]}>;clusters:MovementCluster[];distribution:{oneHour:number;twoHour:number;threeHour:number;fourPlus:number;ambiguous:number}}

const adjacent=(a:string,b:string)=>Number(b.slice(0,2))===Number(a.slice(0,2))+1;
const confidenceFor=(entries:SlotTimelineEntry[],availability:readonly AvailabilityObservation[]):MovementConfidence=>{
  if(entries.some(entry=>entry.overlapping))return 'LOW';
  const observation=availability.find(value=>value.seq===entries[0]?.after.seq),cache=observation?.cache;
  if(cache?.status==='MISS'&&(cache.ageS??0)===0)return 'HIGH';
  if((cache?.status==='HIT'||cache?.status==='STALE')&&Number.isSafeInteger(cache.ageS)&&cache.ageS!>=0)return 'MEDIUM';
  return 'LOW';
};

/** Read-only co-movement analysis. Exact matching transition intervals are grouped; no identity or actor is inferred. */
export function analyzeMovementForensics(availability:readonly AvailabilityObservation[],bookings:readonly BookingObservation[]=[]):MovementForensics{
  const state=deriveTimeline(availability,bookings,10_000).filter((entry):entry is SlotTimelineEntry&{kind:'state';from:'OPEN'|'UNAVAILABLE';to:'OPEN'|'UNAVAILABLE'}=>
    entry.kind==='state'&&entry.from!==undefined&&entry.to!==undefined);
  const groups=new Map<string,typeof state>();
  for(const entry of state){const direction=entry.to==='UNAVAILABLE'?'OPEN_TO_UNAVAILABLE':'UNAVAILABLE_TO_OPEN';const key=`${entry.court}/${direction}/${entry.before?.seq??0}/${entry.after.seq}`;groups.set(key,[...(groups.get(key)??[]),entry]);}
  const clusters:MovementCluster[]=[];
  for(const entries of groups.values()){
    const sorted=[...entries].sort((a,b)=>a.hour.localeCompare(b.hour));let current:typeof entries=[];
    const flush=()=>{if(!current.length)return;const first=current[0]!,last=current.at(-1)!,confidence=current.length>=4?'AMBIGUOUS':confidenceFor(current,availability);
      clusters.push({court:first.court,hours:current.map(value=>value.hour),direction:first.to==='UNAVAILABLE'?'OPEN_TO_UNAVAILABLE':'UNAVAILABLE_TO_OPEN',
        beforeSeq:first.before?.seq??0,afterSeq:first.after.seq,windowMs:[first.before?.requestOffsetMs??first.after.requestOffsetMs,first.after.responseOffsetMs],confidence,
        wording:current.length===1?'This hour moved independently in the recorded observations.':`These ${current.length} adjacent hours changed in the same sampled interval; cause and booking session are unknown.`});current=[];};
    for(const entry of sorted){if(current.length&&!adjacent(current.at(-1)!.hour,entry.hour))flush();current.push(entry);}flush();
  }
  const cross=new Map<string,SlotTimelineEntry[]>();for(const entry of state){const key=`${entry.to}/${entry.before?.seq??0}/${entry.after.seq}`;cross.set(key,[...(cross.get(key)??[]),entry]);}
  const broadMovements=[...cross.values()].filter(entries=>new Set(entries.map(e=>e.court)).size>=3).map(entries=>({
    direction:entries[0]!.to==='OPEN'?'UNAVAILABLE_TO_OPEN' as const:'OPEN_TO_UNAVAILABLE' as const,
    courts:[...new Set(entries.map(e=>e.court))].sort(),cells:entries.length,beforeSeq:entries[0]!.before?.seq??0,
    afterSeq:entries[0]!.after.seq,windowMs:[entries[0]!.before?.requestOffsetMs??entries[0]!.after.requestOffsetMs,entries[0]!.after.responseOffsetMs] as [number,number]}));
  const blankets:BlanketRange[]=[];
  for(const entries of cross.values()){
    const byCourt=new Map<number,Set<string>>();for(const entry of entries)(byCourt.get(entry.court)??(byCourt.set(entry.court,new Set()),byCourt.get(entry.court)!)).add(entry.hour);
    if(byCourt.size!==7)continue;const common=[...byCourt.get(1)!].filter(hour=>[...byCourt.values()].every(hours=>hours.has(hour))).sort();
    let run:string[]=[];const flush=()=>{if(run.length<2){run=[];return;}const sample=entries.find(value=>value.hour===run[0])!;blankets.push({direction:sample.to==='OPEN'?'UNAVAILABLE_TO_OPEN':'OPEN_TO_UNAVAILABLE',courts:[1,2,3,4,5,6,7],start:run[0]!,end:`${String(Number(run.at(-1)!.slice(0,2))+1).padStart(2,'0')}:00`,cells:run.length*7,beforeSeq:sample.before?.seq??0,afterSeq:sample.after.seq,
      windowMs:[sample.before?.requestOffsetMs??sample.after.requestOffsetMs,sample.after.responseOffsetMs],confidence:confidenceFor(entries.filter(value=>run.includes(value.hour)),availability)});run=[];};
    for(const hour of common){if(run.length&&!adjacent(run.at(-1)!,hour))flush();run.push(hour);}flush();
  }
  const distribution={oneHour:0,twoHour:0,threeHour:0,fourPlus:0,ambiguous:clusters.filter(value=>value.confidence==='AMBIGUOUS').length};
  for(const cluster of clusters){if(cluster.hours.length===1)distribution.oneHour++;else if(cluster.hours.length===2)distribution.twoHour++;else if(cluster.hours.length===3)distribution.threeHour++;else distribution.fourPlus++;}
  return {blankets,broadMovements,clusters,distribution};
}

export interface ReleaseLabAttempt {runId:string;workerId:string;candidateId:string;court:number;start:string;end:string;durationHours:number;itemCount:number;configuredReleaseOffsetMs:number;
  attemptId?:string;childKey?:string|null;fanOutIndex?:number;fanOutCount?:number;schedulerFiredMs?:number|null;fetchInvokedMs?:Bounded|null;
  responseHeadersMs?:Bounded|null;responseCompleteMs?:Bounded|null;responseObservedMs?:number|null;rendererEnteredMs?:Bounded|null;
  resourceTiming?:CriticalPathRow['resourceTiming']|null;calibration?:CriticalPathRow['calibration'];wallToTrustedMs?:number|null;
  suppressionReason?:string|null;sent?:boolean|null;journalState?:string|null;
  nodeDispatchOffsetMs:number|null;browserRequestStartOffsetMs:number|null;requestObservedOffsetMs:number|null;networkDurationMs:number|null;providerWaitMs:number|null;
  httpStatus:number|null;result:string;verifiedHold:boolean;expectedAmount:number;cache:{status:string|null;ageS:number|null};xVercelId:string|null;edgeHint:{label:'UNVERIFIED_EDGE_HINT';epochMs:number}|null;protocol:string|null;connectionReused:boolean|null}
export interface GroupSummary {key:number;attemptCount:number;verifiedHolds:number;rejections:number;unknownOutcomes:number;unsentCount?:number;sentCount?:number;medianNetworkDurationMs:number|null;networkDurationRangeMs:{min:number|null;max:number|null};medianProviderWaitMs:number|null;providerWaitRangeMs:{min:number|null;max:number|null};medianBrowserRequestStartOffsetMs:number|null;interpretation:string}
export interface ReleaseLabSummary {version:1;generatedAt:string;run:{runId:string;targetDate:string;releaseMs:number;experimentKind:string;experimentLabel:string;buildProvenance:string|null;clock?:ReleaseForensicsSummary['clock']};matrix:Array<{workerId:string;court:number;start:string;end:string;durationHours:number;releaseOffsetMs:number;expectedAmount:number}>;attempts:ReleaseLabAttempt[];byDuration:GroupSummary[];byOffset:GroupSummary[];movement:MovementForensics;reopenOpportunities:Array<{candidateId:string;candidate:string;firstUsableOpeningMs:number|null;evidenceFitness:string;effectiveRepresentedAgeMs:number|null;rescueActed:boolean;reason:string}>;conclusions:Array<{class:'FACT'|'INFERENCE'|'HYPOTHESIS'|'UNKNOWN';text:string}>;reportPath:string;summaryPath:string}
export interface ReleaseLabDigest {runId:string;targetDate:string;generatedAt:string;experimentLabel:string;byDuration:GroupSummary[];byOffset:GroupSummary[];blanket:string|null;distribution:MovementForensics['distribution'];actionableReopenings:number;rescueAttempts:number;reportPath:string}

const grouped=(attempts:ReleaseLabAttempt[],pick:(value:ReleaseLabAttempt)=>number):GroupSummary[]=>[...new Set(attempts.map(pick))].sort((a,b)=>a-b).map(key=>{const rows=attempts.filter(value=>pick(value)===key),network=rows.map(value=>value.networkDurationMs),wait=rows.map(value=>value.providerWaitMs);
  return {key,attemptCount:rows.length,verifiedHolds:rows.filter(value=>value.verifiedHold).length,rejections:rows.filter(value=>value.result==='REJECTED').length,unknownOutcomes:rows.filter(value=>value.result==='UNKNOWN').length,
    unsentCount:rows.filter(value=>value.result==='NOT_DISPATCHED').length,sentCount:rows.filter(value=>value.sent===true).length,
    medianNetworkDurationMs:median(network),networkDurationRangeMs:range(network),medianProviderWaitMs:median(wait),providerWaitRangeMs:range(wait),medianBrowserRequestStartOffsetMs:median(rows.map(value=>value.browserRequestStartOffsetMs)),
    interpretation:rows.length<3?'Insufficient sample':rows.every(value=>value.result===rows[0]!.result)?'No detectable outcome difference in this sample':'Observed in this release; association does not establish causation'};});
const edgeHint=(vercelId:string|null)=>{const match=vercelId?.match(/-(\d{13})-[a-f0-9]+$/);return match?{label:'UNVERIFIED_EDGE_HINT' as const,epochMs:Number(match[1])}:null;};

export function buildReleaseLabSummary(input:{root:string;runId:string;forensics:ReleaseForensicsSummary;availability:AvailabilityObservation[];bookings:BookingObservation[];outputDirectory?:string}):ReleaseLabSummary|undefined{
  const raceDir=join(input.root,'.local/api-booking/precision-races'),freeze=readJson<any>(join(raceDir,`${input.runId}-phase3-freeze.json`));if(!freeze?.authorization)return undefined;
  const metadata=readJson<any>(join(raceDir,`${input.runId}-release-lab.json`)),auth=freeze.authorization,byId=new Map<string,any>(auth.candidates.map((value:any)=>[value.id,value]));
  const criticalLines=readLines(join(input.root,'.local/release-forensics',input.runId,'critical-path.ndjson'));
  const critical=criticalLines.filter(value=>value.schema==='critical-path/v1'&&typeof value.workerId==='string') as unknown as CriticalPathRow[];
  const wallToTrustedMs=criticalLines.find(value=>value.type==='header')?.wallToTrustedMs;
  const progress=readLines(join(input.root,'.local/api-booking/run-progress',`${input.runId}.ndjson`));
  const providerRows=readLines(join(input.root,'.local/release-forensics',input.runId,'provider-trace.ndjson'));
  const unique=<T>(values:T[]):T|undefined=>values.length===1?values[0]:undefined;
  const expanded=auth.wave1.flatMap((assignment:any)=>(assignment.fanOutOffsetsMs??[assignment.releaseOffsetMs??0]).map((offset:number,index:number)=>
    ({...assignment,offset,index,count:assignment.fanOutOffsetsMs?.length??1})));
  const attempts:ReleaseLabAttempt[]=expanded.map((assignment:any)=>{
    const candidate=byId.get(assignment.candidateId);if(!candidate)throw Error('RELEASE_LAB_CANDIDATE_MISSING');
    const childEvent=unique(progress.filter(row=>row.stage==='PHASE3_FAN_OUT_CHILD'&&row.workerId===assignment.workerId&&
      row.candidateId===candidate.id&&row.fanOutIndex===assignment.index));
    // Only an unambiguous child identity may cross the progress / critical-path boundary.
    const path=unique(critical.filter(row=>(row.meta?.workerId??row.workerId)===assignment.workerId&&
      (row.meta?.parentGoalId===undefined||row.meta.parentGoalId===candidate.id)&&
      (row.meta?.wave===undefined||row.meta.wave==='WAVE_1')&&
      (childEvent?.attemptId===undefined||row.meta?.attemptId===undefined||row.meta.attemptId===childEvent.attemptId)&&
      (row.meta?.fanOutIndex===assignment.index||assignment.count===1&&row.meta?.fanOutIndex===undefined)));
    const legacy=assignment.count===1?unique((input.forensics.phase3?.attempts??[]).filter(row=>row.workerId===assignment.workerId&&row.candidateId===candidate.id&&row.wave==='WAVE_1')):undefined;
    const legacyTarget=assignment.count===1?unique(input.forensics.targets.filter(row=>row.workerId===assignment.workerId&&row.court===candidate.court&&row.startTime===candidate.start&&row.endTime===candidate.end)):undefined;
    const attemptId=typeof childEvent?.attemptId==='string'?childEvent.attemptId:path?.meta?.attemptId??legacy?.attemptId??legacyTarget?.attemptId??
      unique(progress.filter(row=>row.stage==='PHASE3_WAVE1_STARTED'&&row.workerId===assignment.workerId&&row.candidateId===candidate.id&&
        (row.fanOutIndex===assignment.index||assignment.count===1)))?.attemptId as string|undefined;
    const event=(stage:string)=>attemptId?unique(progress.filter(row=>row.stage===stage&&row.attemptId===attemptId)):undefined;
    const settled=event('PHASE3_SETTLED')??event('PHASE3_WAVE1_UNSENT'),posted=event('CHECKOUT_HTTP_POST_INITIATED'),answered=event('CHECKOUT_RESPONSE_COMPLETED');
    const trace=attemptId?unique(providerRows.filter(row=>row.type==='provider-trace'&&row.attemptId===attemptId)) as unknown as ProviderTraceRecord|undefined:undefined;
    const fallback=attemptId?unique(providerRows.filter(row=>row.type==='response-fallback'&&row.attemptId===attemptId)) as unknown as ProviderResponseFallback|undefined:undefined;
    const journal=path&&freeze.wave1Freeze&&candidate.logicalKey?readJson<any>(join(input.root,'.local/api-booking/api-first-journals',candidate.logicalKey,'fan-out',freeze.wave1Freeze,path.workerId,`${candidate.logicalKey}.json`)):undefined;
    const final=String(path?.meta?.finalState??settled?.state??legacy?.state??legacyTarget?.finalState??'UNKNOWN');
    const unsent=['NOT_DISPATCHED','EXCLUDED_BEFORE_FREEZE','BROWSER_FAILED','IDENTITY_FAILED','JOURNAL_BLOCKED','PREWARM_FAILED','WINDOW_MISSED'].includes(final);
    const result=unsent?'NOT_DISPATCHED':final==='REJECTED'?'REJECTED':
      ['VERIFIED','QR_READY','HOLD_VERIFIED_QR_ATTENTION','VERIFIED_PENDING_HOLD','VERIFIED_PENDING_HOLD_QR_HANDOFF'].includes(final)?'VERIFIED':'UNKNOWN';
    const observedTransport=!!(posted||answered||trace||fallback)||typeof path?.browserRequestStartMs==='number'||
      typeof path?.requestObservedMs==='number'||typeof path?.meta?.httpStatus==='number'||typeof legacyTarget?.post.offsetMs==='number';
    const sent=unsent?false:observedTransport?true:null;
    return {runId:input.runId,workerId:assignment.workerId,candidateId:candidate.id,attemptId:attemptId??`unresolved-${assignment.workerId}-${assignment.index}`,
      childKey:path?.workerId??null,fanOutIndex:assignment.index,fanOutCount:assignment.count,court:candidate.court,start:candidate.start,end:candidate.end,durationHours:candidate.durationHours,itemCount:candidate.durationHours,
      configuredReleaseOffsetMs:assignment.offset,schedulerFiredMs:path?.schedulerFiredMs??null,nodeDispatchOffsetMs:path?.workerInvokedMs??null,
      rendererEnteredMs:path?.evaluateEnteredMs??null,fetchInvokedMs:path?.fetchInvokedMs??null,browserRequestStartOffsetMs:path?.browserRequestStartMs??null,
      requestObservedOffsetMs:path?.requestObservedMs??(typeof posted?.releaseLatenessMs==='number'?posted.releaseLatenessMs:legacy?.postOffsetMs??null),
      responseHeadersMs:path?.responseHeadersMs??null,responseCompleteMs:path?.responseCompleteMs??null,responseObservedMs:path?.responseObservedMs??null,
      resourceTiming:path?.resourceTiming??null,calibration:path?.calibration??null,wallToTrustedMs:typeof wallToTrustedMs==='number'?wallToTrustedMs:null,
      networkDurationMs:typeof answered?.networkDurationMs==='number'?answered.networkDurationMs:legacyTarget?.response.networkDurationMs??null,providerWaitMs:trace?.browser.waitMs??legacyTarget?.provider?.waitMs??null,
      httpStatus:unsent?null:path?.meta?.httpStatus??(typeof answered?.statusCode==='number'?answered.statusCode:trace?.response.status??fallback?.status??legacy?.statusCode??legacyTarget?.response.statusCode??null),
      result,verifiedHold:result==='VERIFIED',sent,suppressionReason:unsent?path?.meta?.finalCode??String(settled?.code??final):null,journalState:journal?.state??null,expectedAmount:candidate.expectedAmount,
      cache:{status:trace?.response.vercelCache??null,ageS:trace?.response.ageS??null},xVercelId:trace?.response.vercelId??fallback?.vercelId??null,
      edgeHint:edgeHint(trace?.response.vercelId??fallback?.vercelId??null),protocol:trace?.connection.protocol??null,connectionReused:trace?.connection.reused??null};
  });
  const matrix=attempts.map(row=>({attemptId:row.attemptId,workerId:row.workerId,court:row.court,start:row.start,end:row.end,durationHours:row.durationHours,
    releaseOffsetMs:row.configuredReleaseOffsetMs,expectedAmount:row.expectedAmount}));
  const movement=analyzeMovementForensics(input.availability,input.bookings),reopenOpportunities=auth.candidates.filter((candidate:any)=>candidate.permissions.rescue).map((candidate:any)=>{const evidence=targetEvidence(input.availability,input.bookings,{court:candidate.court,startTime:candidate.start,endTime:candidate.end}),opening=evidence.reopen?.after;
    if(!opening)return {candidateId:candidate.id,candidate:`Court ${candidate.court} ${candidate.start}–${candidate.end}`,firstUsableOpeningMs:null,evidenceFitness:'NONE',effectiveRepresentedAgeMs:null,rescueActed:false,reason:'No full reopening observed'};
    const observation=input.availability.find(value=>value.seq===opening.seq),fitness=observation?classifyActionableObservation(observation,observation.seq,auth.releaseMs,auth.releaseMs+observation.responseOffsetMs,adaptiveMaxAgeMs(observation.responseOffsetMs-observation.requestOffsetMs,2500)):null;
    const acted=(input.forensics.phase3?.attempts??[]).some(value=>value.candidateId===candidate.id&&value.wave==='RESCUE');return {candidateId:candidate.id,candidate:`Court ${candidate.court} ${candidate.start}–${candidate.end}`,firstUsableOpeningMs:opening.responseOffsetMs,evidenceFitness:fitness?.fitness??'UNKNOWN',effectiveRepresentedAgeMs:fitness?.ageMs??null,rescueActed:acted,reason:acted?'Rescue attempt recorded':fitness&&isActionableEvidenceFitness(fitness.fitness)?'Actionable reopening observed; no Rescue attempt recorded':'Reopening evidence was not actionable'};});
  const output=input.outputDirectory??join(input.root,'.local/release-lab',input.runId),summaryPath=join(output,'summary.json'),reportPath=join(output,'report.md');
  const buildInfo=[join(resolve(input.root,'..'),'BUILD-INFO.txt'),join(input.root,'BUILD-INFO.txt')].find(existsSync);const provenance=buildInfo?readFileSync(buildInfo,'utf8').split('\n').filter(line=>/^(Built|Source(?: Commit)?|Branch|Dirty):/.test(line)).join(' · '):null;
  return {version:1,generatedAt:new Date().toISOString(),run:{runId:input.runId,targetDate:auth.date,releaseMs:auth.releaseMs,experimentKind:metadata?.experiment?.kind??'UNLABELLED_PHASE3',experimentLabel:metadata?.experiment?.label??'Unlabelled Phase 3',buildProvenance:provenance,clock:input.forensics.clock},matrix,attempts,byDuration:grouped(attempts,value=>value.durationHours),byOffset:grouped(attempts,value=>value.configuredReleaseOffsetMs),movement,reopenOpportunities,
    conclusions:[{class:'FACT',text:`${attempts.length} Wave 1 attempts were joined from frozen authorization and sanitized traces.`},{class:'INFERENCE',text:'Matching adjacent transitions are movement clusters; public evidence does not establish a customer or booking session.'},{class:'HYPOTHESIS',text:'Duration or offset may correlate with provider latency, but this single-release report cannot establish a winning strategy.'},{class:'UNKNOWN',text:'The undocumented number inside x-vercel-id is retained only as UNVERIFIED_EDGE_HINT and is never used for strategy.'}],reportPath,summaryPath};
}

const metric=(value:number|null)=>value===null?'—':`${value.toFixed(1)} ms`;
export function releaseLabReport(summary:ReleaseLabSummary):string{return [
  '# Release Lab v1','',`Generated: ${summary.generatedAt}`,`Run: ${summary.run.runId}`,`Target date: ${summary.run.targetDate}`,`Release: ${new Date(summary.run.releaseMs).toISOString()}`,`Experiment: ${summary.run.experimentLabel} (${summary.run.experimentKind})`,`Build provenance: ${summary.run.buildProvenance??'Unavailable'}`,'',
  '## Experiment matrix','', '| Worker | Court | Time | Duration | Offset | Expected |','|---|---:|---|---:|---:|---:|',...summary.matrix.map(value=>`| ${value.workerId} | ${value.court} | ${value.start}–${value.end} | ${value.durationHours}h | ${value.releaseOffsetMs} ms | PHP ${value.expectedAmount} |`),'',
  '## Actual dispatch and provider outcome','',
  '| Attempt | Worker | Court / time | Child (0-based) | Configured | Scheduler | Fetch | Browser start | Request observed | Headers | Body complete | Bookkeeping | Network | HTTP | Outcome / suppression |',
  '|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|',
  ...summary.attempts.map(value=>`| ${value.attemptId??'Unavailable'} | ${value.workerId} | ${value.court} / ${value.start}-${value.end} | ${value.fanOutIndex??0}/${value.fanOutCount??1} | ${value.configuredReleaseOffsetMs} ms | ${metric(value.schedulerFiredMs??null)} | ${metric(value.fetchInvokedMs?.ms??null)} | ${metric(value.browserRequestStartOffsetMs)} | ${metric(value.requestObservedOffsetMs)} | ${metric(value.responseHeadersMs?.ms??null)} | ${metric(value.responseCompleteMs?.ms??null)} | ${metric(value.responseObservedMs??null)} | ${metric(value.networkDurationMs)} | ${value.httpStatus??'Unavailable'} | ${value.result}${value.suppressionReason?` / ${value.suppressionReason}`:''} |`),'',
  'Timing provenance: scheduler/Node marks use the trusted monotonic release clock. Renderer entry, fetch, headers and body use per-child calibration; JSON retains bounds and uncertainty. Browser start maps the browser wall clock with wallToTrustedMs. ResourceTiming retains its separate origin. Bookkeeping can be deferred until T+1 s. Missing values are unavailable. These measurements do not establish packet departure or provider arrival; the transport gap remains unresolved.',
  `Accounting: ${summary.attempts.length} authorized children, ${summary.attempts.filter(v=>v.sent===true).length} observed sent, ${summary.attempts.filter(v=>v.result==='NOT_DISPATCHED').length} proven unsent, ${new Set(summary.attempts.map(v=>v.workerId)).size} logical workers.`, '',
  `Absolute clock evidence: adopted trusted-clock uncertainty ${summary.run.clock?.rounds.filter(r=>r.adopted).at(-1)?.uncertaintyMs??'unavailable'} ms; observer minus dispatch ${summary.run.clock?.observerMinusDispatchMs??'unavailable'} ms. Renderer calibration does not eliminate this uncertainty.`, '',
  'Provider/edge note: any parsed x-vercel-id timestamp is labelled `UNVERIFIED_EDGE_HINT`; it is undocumented, is not called Onda receive time, and never drives strategy.','',
  '## By duration','',...summary.byDuration.map(value=>`- ${value.key}h: ${value.attemptCount} attempts; ${value.verifiedHolds} verified; ${value.rejections} rejected; median network ${metric(value.medianNetworkDurationMs)}; median provider wait ${metric(value.medianProviderWaitMs)}. ${value.interpretation}.`),'',
  '## By configured offset','',...summary.byOffset.map(value=>`- ${value.key} ms: ${value.attemptCount} attempts; median browser start ${metric(value.medianBrowserRequestStartOffsetMs)}; median provider wait ${metric(value.medianProviderWaitMs)}. ${value.interpretation}.`),'',
  '## Blanket and movement forensics','', 'Date publication, availability movements and public occupied-cell appearances are separate observations. Sampled intervals do not establish exact backend transition times, simultaneous commits, ownership or venue action; causes remain unknown.', ...(summary.movement.broadMovements??[]).map(v=>`- Broad ${v.direction} observation: ${v.cells} cells across ${v.courts.length} courts, reads #${v.beforeSeq} to #${v.afterSeq}.`),...(summary.movement.blankets.length?summary.movement.blankets.map(value=>`- Blanket-like ${value.direction??'OPEN_TO_UNAVAILABLE'} region: Courts ${value.courts[0]}–${value.courts.at(-1)}, ${value.start}–${value.end}, ${value.cells} cells, transition reads #${value.beforeSeq}→#${value.afterSeq}, confidence ${value.confidence}.`):['- No blanket-like all-court transition met the detector rules.']),
  `- Cluster-size distribution: 1h ${summary.movement.distribution.oneHour}; 2h ${summary.movement.distribution.twoHour}; 3h ${summary.movement.distribution.threeHour}; 4+ ${summary.movement.distribution.fourPlus}; ambiguous ${summary.movement.distribution.ambiguous}.`,...summary.movement.clusters.map(value=>`- Court ${value.court} ${value.hours.join(', ')} (${value.direction}, ${value.confidence}): ${value.wording}`),'',
  '## Reopen opportunities','',...summary.reopenOpportunities.map(value=>`- ${value.candidate}: first usable opening ${value.firstUsableOpeningMs===null?'not observed':`+${value.firstUsableOpeningMs.toFixed(1)} ms`}; ${value.evidenceFitness}; effective represented age ${metric(value.effectiveRepresentedAgeMs)}; Rescue ${value.rescueActed?'acted':'did not act'} — ${value.reason}.`),'',
  '## Conclusions','',...summary.conclusions.map(value=>`- **${value.class}:** ${value.text}`),''].join('\n');}

export function persistReleaseLabSummary(summary:ReleaseLabSummary):ReleaseLabSummary{atomic(summary.summaryPath,JSON.stringify(summary,null,2)+'\n');atomic(summary.reportPath,releaseLabReport(summary));return summary;}
export function buildReleaseLabForRun(root:string,runId:string,forensics:ReleaseForensicsSummary):ReleaseLabSummary|undefined{
  const observerPath=findObserverLog(join(root,'.local/slot-watch'),forensics.date,forensics.referenceMs??-1),observer=observerPath?readObserverLog(observerPath):undefined;
  const summary=buildReleaseLabSummary({root,runId,forensics,availability:observer?.availability??[],bookings:observer?.bookings??[]});return summary?persistReleaseLabSummary(summary):undefined;
}
export const releaseLabDigest=(summary:ReleaseLabSummary):ReleaseLabDigest=>({runId:summary.run.runId,targetDate:summary.run.targetDate,generatedAt:summary.generatedAt,experimentLabel:summary.run.experimentLabel,byDuration:summary.byDuration,byOffset:summary.byOffset,
  blanket:summary.movement.blankets[0]?`${summary.movement.blankets[0].start}–${summary.movement.blankets[0].end} across ${summary.movement.blankets[0].courts.length} courts`:null,distribution:summary.movement.distribution,
  actionableReopenings:summary.reopenOpportunities.filter(value=>value.evidenceFitness.startsWith('ACTIONABLE_')).length,rescueAttempts:summary.reopenOpportunities.filter(value=>value.rescueActed).length,reportPath:summary.reportPath});
export function readReleaseLabHistory(directory:string,limit=8):ReleaseLabDigest[]{if(!existsSync(directory))return[];return readdirSync(directory).flatMap(name=>{const path=join(directory,name,'summary.json');return existsSync(path)?[{path,mtime:statSync(path).mtimeMs}]:[];}).sort((a,b)=>b.mtime-a.mtime).slice(0,limit).flatMap(({path})=>{const value=readJson<ReleaseLabSummary>(path);return value?.version===1?[releaseLabDigest(value)]:[];});}
