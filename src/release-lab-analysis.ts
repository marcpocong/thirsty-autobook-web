import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { adaptiveMaxAgeMs, classifyActionableObservation, isActionableEvidenceFitness } from './api-booking/precision-phase3.js';
import type { CriticalPathRow } from './api-booking/critical-path.js';
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
export interface BlanketRange {courts:number[];start:string;end:string;cells:number;beforeSeq:number;afterSeq:number;windowMs:[number,number];confidence:MovementConfidence}
export interface MovementForensics {blankets:BlanketRange[];clusters:MovementCluster[];distribution:{oneHour:number;twoHour:number;threeHour:number;fourPlus:number;ambiguous:number}}

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
        wording:current.length===1?'This hour moved independently in the recorded observations.':`These ${current.length} adjacent hours moved together and are consistent with one grouped hold; public evidence does not establish a booking session.`});current=[];};
    for(const entry of sorted){if(current.length&&!adjacent(current.at(-1)!.hour,entry.hour))flush();current.push(entry);}flush();
  }
  const cross=new Map<string,SlotTimelineEntry[]>();for(const entry of state.filter(value=>value.to==='UNAVAILABLE')){const key=`${entry.before?.seq??0}/${entry.after.seq}`;cross.set(key,[...(cross.get(key)??[]),entry]);}
  const blankets:BlanketRange[]=[];
  for(const entries of cross.values()){
    const byCourt=new Map<number,Set<string>>();for(const entry of entries)(byCourt.get(entry.court)??(byCourt.set(entry.court,new Set()),byCourt.get(entry.court)!)).add(entry.hour);
    if(byCourt.size!==7)continue;const common=[...byCourt.get(1)!].filter(hour=>[...byCourt.values()].every(hours=>hours.has(hour))).sort();
    let run:string[]=[];const flush=()=>{if(run.length<2){run=[];return;}const sample=entries.find(value=>value.hour===run[0])!;blankets.push({courts:[1,2,3,4,5,6,7],start:run[0]!,end:`${String(Number(run.at(-1)!.slice(0,2))+1).padStart(2,'0')}:00`,cells:run.length*7,beforeSeq:sample.before?.seq??0,afterSeq:sample.after.seq,
      windowMs:[sample.before?.requestOffsetMs??sample.after.requestOffsetMs,sample.after.responseOffsetMs],confidence:confidenceFor(entries.filter(value=>run.includes(value.hour)),availability)});run=[];};
    for(const hour of common){if(run.length&&!adjacent(run.at(-1)!,hour))flush();run.push(hour);}flush();
  }
  const distribution={oneHour:0,twoHour:0,threeHour:0,fourPlus:0,ambiguous:clusters.filter(value=>value.confidence==='AMBIGUOUS').length};
  for(const cluster of clusters){if(cluster.hours.length===1)distribution.oneHour++;else if(cluster.hours.length===2)distribution.twoHour++;else if(cluster.hours.length===3)distribution.threeHour++;else distribution.fourPlus++;}
  return {blankets,clusters,distribution};
}

export interface ReleaseLabAttempt {runId:string;workerId:string;candidateId:string;court:number;start:string;end:string;durationHours:number;itemCount:number;configuredReleaseOffsetMs:number;
  nodeDispatchOffsetMs:number|null;browserRequestStartOffsetMs:number|null;requestObservedOffsetMs:number|null;networkDurationMs:number|null;providerWaitMs:number|null;
  httpStatus:number|null;result:string;verifiedHold:boolean;expectedAmount:number;cache:{status:string|null;ageS:number|null};xVercelId:string|null;edgeHint:{label:'UNVERIFIED_EDGE_HINT';epochMs:number}|null;protocol:string|null;connectionReused:boolean|null}
export interface GroupSummary {key:number;attemptCount:number;verifiedHolds:number;rejections:number;unknownOutcomes:number;medianNetworkDurationMs:number|null;networkDurationRangeMs:{min:number|null;max:number|null};medianProviderWaitMs:number|null;providerWaitRangeMs:{min:number|null;max:number|null};medianBrowserRequestStartOffsetMs:number|null;interpretation:string}
export interface ReleaseLabSummary {version:1;generatedAt:string;run:{runId:string;targetDate:string;releaseMs:number;experimentKind:string;experimentLabel:string;buildProvenance:string|null};matrix:Array<{workerId:string;court:number;start:string;end:string;durationHours:number;releaseOffsetMs:number;expectedAmount:number}>;attempts:ReleaseLabAttempt[];byDuration:GroupSummary[];byOffset:GroupSummary[];movement:MovementForensics;reopenOpportunities:Array<{candidateId:string;candidate:string;firstUsableOpeningMs:number|null;evidenceFitness:string;effectiveRepresentedAgeMs:number|null;rescueActed:boolean;reason:string}>;conclusions:Array<{class:'FACT'|'INFERENCE'|'HYPOTHESIS'|'UNKNOWN';text:string}>;reportPath:string;summaryPath:string}
export interface ReleaseLabDigest {runId:string;targetDate:string;generatedAt:string;experimentLabel:string;byDuration:GroupSummary[];byOffset:GroupSummary[];blanket:string|null;distribution:MovementForensics['distribution'];actionableReopenings:number;rescueAttempts:number;reportPath:string}

const grouped=(attempts:ReleaseLabAttempt[],pick:(value:ReleaseLabAttempt)=>number):GroupSummary[]=>[...new Set(attempts.map(pick))].sort((a,b)=>a-b).map(key=>{const rows=attempts.filter(value=>pick(value)===key),network=rows.map(value=>value.networkDurationMs),wait=rows.map(value=>value.providerWaitMs);
  return {key,attemptCount:rows.length,verifiedHolds:rows.filter(value=>value.verifiedHold).length,rejections:rows.filter(value=>value.result==='REJECTED').length,unknownOutcomes:rows.filter(value=>!['REJECTED','VERIFIED'].includes(value.result)).length,
    medianNetworkDurationMs:median(network),networkDurationRangeMs:range(network),medianProviderWaitMs:median(wait),providerWaitRangeMs:range(wait),medianBrowserRequestStartOffsetMs:median(rows.map(value=>value.browserRequestStartOffsetMs)),
    interpretation:rows.length<3?'Insufficient sample':rows.every(value=>value.result===rows[0]!.result)?'No detectable outcome difference in this sample':'Observed in this release; association does not establish causation'};});
const edgeHint=(vercelId:string|null)=>{const match=vercelId?.match(/-(\d{13})-[a-f0-9]+$/);return match?{label:'UNVERIFIED_EDGE_HINT' as const,epochMs:Number(match[1])}:null;};

export function buildReleaseLabSummary(input:{root:string;runId:string;forensics:ReleaseForensicsSummary;availability:AvailabilityObservation[];bookings:BookingObservation[]}):ReleaseLabSummary|undefined{
  const raceDir=join(input.root,'.local/api-booking/precision-races'),freeze=readJson<any>(join(raceDir,`${input.runId}-phase3-freeze.json`));if(!freeze?.authorization)return undefined;
  const metadata=readJson<any>(join(raceDir,`${input.runId}-release-lab.json`)),auth=freeze.authorization,byId=new Map<string,any>(auth.candidates.map((value:any)=>[value.id,value]));
  const critical=readLines(join(input.root,'.local/release-forensics',input.runId,'critical-path.ndjson')).filter(value=>value.schema==='critical-path/v1'&&typeof value.workerId==='string') as unknown as CriticalPathRow[];
  const offsets=new Map<string,number>((metadata?.experiment?.rows??[]).map((value:any)=>[value.workerId,value.releaseOffsetMs]));
  const matrix=auth.wave1.map((assignment:any)=>{const candidate=byId.get(assignment.candidateId)!;return {workerId:assignment.workerId,court:candidate.court,start:candidate.start,end:candidate.end,durationHours:candidate.durationHours,releaseOffsetMs:offsets.get(assignment.workerId)??0,expectedAmount:candidate.expectedAmount};});
  const attempts:ReleaseLabAttempt[]=auth.wave1.map((assignment:any)=>{const candidate=byId.get(assignment.candidateId)!,target=input.forensics.targets.find(value=>value.workerId===assignment.workerId),path=critical.find(value=>value.workerId===assignment.workerId),provider=target?.provider;
    const result=target?.finalState?.includes('REJECT')?'REJECTED':target?.finalState?.includes('VERIFIED')||target?.finalState?.includes('QR')?'VERIFIED':target?.finalState??'UNKNOWN';
    return {runId:input.runId,workerId:assignment.workerId,candidateId:candidate.id,court:candidate.court,start:candidate.start,end:candidate.end,durationHours:candidate.durationHours,itemCount:candidate.durationHours,
      configuredReleaseOffsetMs:offsets.get(assignment.workerId)??0,nodeDispatchOffsetMs:path?.workerInvokedMs??target?.post.offsetMs??null,browserRequestStartOffsetMs:path?.browserRequestStartMs??null,requestObservedOffsetMs:path?.requestObservedMs??null,
      networkDurationMs:target?.response.networkDurationMs??null,providerWaitMs:provider?.waitMs??null,httpStatus:target?.response.statusCode??null,result,verifiedHold:result==='VERIFIED',expectedAmount:candidate.expectedAmount,
      cache:{status:provider?.vercelCache??null,ageS:provider?.ageS??null},xVercelId:provider?.vercelId??null,edgeHint:edgeHint(provider?.vercelId??null),protocol:provider?.protocol??null,connectionReused:provider?.reused??null};});
  const movement=analyzeMovementForensics(input.availability,input.bookings),reopenOpportunities=auth.candidates.filter((candidate:any)=>candidate.permissions.rescue).map((candidate:any)=>{const evidence=targetEvidence(input.availability,input.bookings,{court:candidate.court,startTime:candidate.start,endTime:candidate.end}),opening=evidence.reopen?.after;
    if(!opening)return {candidateId:candidate.id,candidate:`Court ${candidate.court} ${candidate.start}–${candidate.end}`,firstUsableOpeningMs:null,evidenceFitness:'NONE',effectiveRepresentedAgeMs:null,rescueActed:false,reason:'No full reopening observed'};
    const observation=input.availability.find(value=>value.seq===opening.seq),fitness=observation?classifyActionableObservation(observation,observation.seq,auth.releaseMs,auth.releaseMs+observation.responseOffsetMs,adaptiveMaxAgeMs(observation.responseOffsetMs-observation.requestOffsetMs,2500)):null;
    const acted=(input.forensics.phase3?.attempts??[]).some(value=>value.candidateId===candidate.id&&value.wave==='RESCUE');return {candidateId:candidate.id,candidate:`Court ${candidate.court} ${candidate.start}–${candidate.end}`,firstUsableOpeningMs:opening.responseOffsetMs,evidenceFitness:fitness?.fitness??'UNKNOWN',effectiveRepresentedAgeMs:fitness?.ageMs??null,rescueActed:acted,reason:acted?'Rescue attempt recorded':fitness&&isActionableEvidenceFitness(fitness.fitness)?'Actionable reopening observed; no Rescue attempt recorded':'Reopening evidence was not actionable'};});
  const output=join(input.root,'.local/release-lab',input.runId),summaryPath=join(output,'summary.json'),reportPath=join(output,'report.md');
  const buildInfo=[join(input.root,'BUILD-INFO.txt'),join(resolve(input.root,'..'),'BUILD-INFO.txt')].find(existsSync);const provenance=buildInfo?readFileSync(buildInfo,'utf8').split('\n').filter(line=>/^(Built|Source(?: Commit)?|Branch|Dirty):/.test(line)).join(' · '):null;
  return {version:1,generatedAt:new Date().toISOString(),run:{runId:input.runId,targetDate:auth.date,releaseMs:auth.releaseMs,experimentKind:metadata?.experiment?.kind??'UNLABELLED_PHASE3',experimentLabel:metadata?.experiment?.label??'Unlabelled Phase 3',buildProvenance:provenance},matrix,attempts,byDuration:grouped(attempts,value=>value.durationHours),byOffset:grouped(attempts,value=>value.configuredReleaseOffsetMs),movement,reopenOpportunities,
    conclusions:[{class:'FACT',text:`${attempts.length} Wave 1 attempts were joined from frozen authorization and sanitized traces.`},{class:'INFERENCE',text:'Matching adjacent transitions are movement clusters; public evidence does not establish a customer or booking session.'},{class:'HYPOTHESIS',text:'Duration or offset may correlate with provider latency, but this single-release report cannot establish a winning strategy.'},{class:'UNKNOWN',text:'The undocumented number inside x-vercel-id is retained only as UNVERIFIED_EDGE_HINT and is never used for strategy.'}],reportPath,summaryPath};
}

const metric=(value:number|null)=>value===null?'—':`${value.toFixed(1)} ms`;
export function releaseLabReport(summary:ReleaseLabSummary):string{return [
  '# Release Lab v1','',`Generated: ${summary.generatedAt}`,`Run: ${summary.run.runId}`,`Target date: ${summary.run.targetDate}`,`Release: ${new Date(summary.run.releaseMs).toISOString()}`,`Experiment: ${summary.run.experimentLabel} (${summary.run.experimentKind})`,`Build provenance: ${summary.run.buildProvenance??'Unavailable'}`,'',
  '## Experiment matrix','', '| Worker | Court | Time | Duration | Offset | Expected |','|---|---:|---|---:|---:|---:|',...summary.matrix.map(value=>`| ${value.workerId} | ${value.court} | ${value.start}–${value.end} | ${value.durationHours}h | ${value.releaseOffsetMs} ms | PHP ${value.expectedAmount} |`),'',
  '## Actual dispatch and provider outcome','', '| Worker | Duration | Configured offset | Browser start | Request observed | Provider wait | Network | HTTP | Outcome |','|---|---:|---:|---:|---:|---:|---:|---:|---|',...summary.attempts.map(value=>`| ${value.workerId} | ${value.durationHours}h | ${value.configuredReleaseOffsetMs} ms | ${metric(value.browserRequestStartOffsetMs)} | ${metric(value.requestObservedOffsetMs)} | ${metric(value.providerWaitMs)} | ${metric(value.networkDurationMs)} | ${value.httpStatus??'—'} | ${value.result} |`),'',
  'Provider/edge note: any parsed x-vercel-id timestamp is labelled `UNVERIFIED_EDGE_HINT`; it is undocumented, is not called Onda receive time, and never drives strategy.','',
  '## By duration','',...summary.byDuration.map(value=>`- ${value.key}h: ${value.attemptCount} attempts; ${value.verifiedHolds} verified; ${value.rejections} rejected; median network ${metric(value.medianNetworkDurationMs)}; median provider wait ${metric(value.medianProviderWaitMs)}. ${value.interpretation}.`),'',
  '## By configured offset','',...summary.byOffset.map(value=>`- ${value.key} ms: ${value.attemptCount} attempts; median browser start ${metric(value.medianBrowserRequestStartOffsetMs)}; median provider wait ${metric(value.medianProviderWaitMs)}. ${value.interpretation}.`),'',
  '## Blanket and movement forensics','',...(summary.movement.blankets.length?summary.movement.blankets.map(value=>`- Blanket-like region: Courts ${value.courts[0]}–${value.courts.at(-1)}, ${value.start}–${value.end}, ${value.cells} cells, transition reads #${value.beforeSeq}→#${value.afterSeq}, confidence ${value.confidence}.`):['- No blanket-like all-court transition met the detector rules.']),
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
