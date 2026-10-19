import { createHash } from 'node:crypto';
import { cpus, platform, release, totalmem } from 'node:os';
import { readFileSync } from 'node:fs';
import { stats, type ChildSample } from './fanout-capacity.js';
import { SHOTGUN_MAX_TRIGGER_LATENESS_MS, SHOTGUN_MEANINGFUL_SPACING_MS, logicalTargetId } from './shotgun.js';
import { PRECISION_MAX_FAN_OUT } from './workers.js';
import type { PrewarmFeasibilityResult } from './api-booking/prewarm-feasibility.js';

export interface ShotgunTopologyInput {
  candidates: readonly {court:number;start:string;durationHours:number;wing?:import('./court-registry.js').Wing;spaceId?:string;bookingDate?:string}[];
  wave1: readonly {workerId:string;candidateIndex:number;fanOutOffsetsMs?:readonly number[];releaseOffsetMs?:number}[];
}
export interface ShotgunTopology {
  shots:Array<{workerId:string;logicalTargetId:string;fanOutIndex:number;configuredOffsetMs:number;shotgun:boolean}>;
  tabsPerWorker:Record<string,number>; fingerprint:string; minimumSpacingMs:number|null;
}
/** Exact saved authorization, including worker, tab tier, target identity and every literal offset. Preparation only. */
export function exactShotgunTopology(plan:ShotgunTopologyInput,schedule?:readonly {logicalTargetId:string;configuredOffsetMs:number}[]):ShotgunTopology {
  const tabsPerWorker:Record<string,number>={};
  const shots=plan.wave1.flatMap(a=>{
    const candidate=plan.candidates[a.candidateIndex],offsets=a.fanOutOffsetsMs??[a.releaseOffsetMs??0];
    if(!candidate || !/^[A-G]$/.test(a.workerId) || tabsPerWorker[a.workerId] || offsets.length<1 || offsets.length>PRECISION_MAX_FAN_OUT || offsets.some(o=>!Number.isSafeInteger(o)||o < -2000 || o>0))throw Error('SHOTGUN_TOPOLOGY_NOT_READY');
    tabsPerWorker[a.workerId]=offsets.length;
    return offsets.map((configuredOffsetMs,fanOutIndex)=>({workerId:a.workerId,logicalTargetId:logicalTargetId(candidate),fanOutIndex,configuredOffsetMs,shotgun:schedule===undefined||schedule.some(s=>s.logicalTargetId===logicalTargetId(candidate)&&s.configuredOffsetMs===configuredOffsetMs)}));
  });
  if(!shots.length)throw Error('SHOTGUN_TOPOLOGY_NOT_READY');
  const ordered=shots.filter(s=>s.shotgun).map(s=>s.configuredOffsetMs).sort((a,b)=>a-b);
  const minimumSpacingMs=ordered.length>1?Math.min(...ordered.slice(1).map((v,i)=>v-ordered[i]!)):null;
  const fingerprint=createHash('sha256').update(JSON.stringify({version:1,tolerance:SHOTGUN_MAX_TRIGGER_LATENESS_MS,shots})).digest('hex');
  return {shots,tabsPerWorker,fingerprint,minimumSpacingMs};
}
export function assertShotgunSchedule(topology:ShotgunTopology,schedule:readonly {logicalTargetId:string;configuredOffsetMs:number}[]) {
  const signature=(values:readonly {logicalTargetId:string;configuredOffsetMs:number}[])=>values.map(v=>`${v.logicalTargetId}|${v.configuredOffsetMs}`).sort();
  if(JSON.stringify(signature(topology.shots.filter(s=>schedule.some(shot=>shot.logicalTargetId===s.logicalTargetId))))!==JSON.stringify(signature(schedule)))throw Error('SHOTGUN_TOPOLOGY_NOT_READY');
}
export function assertShotgunPrewarm(value:PrewarmFeasibilityResult|null|undefined,configured:number){
  if(!value || value.configuredWave1Attempts!==configured || value.projectedReady!==configured || value.projectedAtRisk!==0 || value.projectedOmitted!==0)throw Error('SHOTGUN_PREWARM_NOT_FULLY_READY');
}
export function assertShotgunTabs(topology:ShotgunTopology,probes:Record<string,{connected:boolean;targetReady:boolean;tabCount:number}|undefined>){
  for(const [worker,count] of Object.entries(topology.tabsPerWorker)){const probe=probes[worker];
    if(!probe?.connected || !probe.targetReady || probe.tabCount<count)throw Error('SHOTGUN_TOPOLOGY_NOT_READY');}
}
export function shotgunBrowserVersion(topology:ShotgunTopology,probes:Record<string,{chromeVersion?:string|null}|undefined>):string|null{
  const versions=Object.keys(topology.tabsPerWorker).map(w=>probes[w]?.chromeVersion);
  return versions.length && versions.every(v=>typeof v==='string' && v===versions[0])?versions[0]!:null;
}
export const shotgunMachineKey=()=>JSON.stringify({cpu:cpus()[0]?.model,cores:cpus().length,memory:Math.round(totalmem()/2**30),platform:platform(),os:release(),node:process.version});
export interface ShotgunTimingReadiness {
  schema:'shotgun-timing/v1';status:'READY'|'AT_RISK'|'FAILED'|'NOT_TESTED';shotCount:number;workerCount:number;tabsPerWorker:Record<string,number>;
  configuredMinimumSpacingMs:number|null;p50:number|null;p95:number|null;max:number|null;outsideTolerance:number;omittedShots:number;
  compressedPairs:number;predictedCompression:boolean;fingerprint:string;testedAt:string|null;machineKey:string;buildKey:string;dispatcher:string;chromeVersion:string|null;runs:number;
}
/** Local configured-trigger -> Chrome request-start only. No network/provider/booking guarantee. */
export function summarizeShotgunTiming(topology:ShotgunTopology,children:readonly ChildSample[],compatibility:{machineKey:string;buildKey:string;dispatcher:string;chromeVersion:string|null},runs:number):ShotgunTimingReadiness {
  const seen=new Set<string>();
  const validRuns=Number.isSafeInteger(runs)&&runs>0;
  const validRows=children.every(c=>{
    const shot=topology.shots.find(s=>s.workerId===c.workerId&&s.fanOutIndex===c.fanOutIndex&&s.configuredOffsetMs===c.configuredOffsetMs);
    const key=`${c.run}|${c.workerId}|${c.fanOutIndex}`;
    if(!validRuns||!Number.isSafeInteger(c.run)||c.run<0||c.run>=runs||!shot||c.fanOutCount!==topology.tabsPerWorker[c.workerId]||seen.has(key)||
      c.chromeStartMs!==null&&!Number.isFinite(c.chromeStartMs))return false;
    seen.add(key);return true;
  });
  const strictChildren=children.filter(c=>topology.shots.some(s=>s.shotgun&&s.workerId===c.workerId&&s.fanOutIndex===c.fanOutIndex&&s.configuredOffsetMs===c.configuredOffsetMs));
  const errors=strictChildren.flatMap(c=>c.chromeStartMs===null||!Number.isFinite(c.chromeStartMs)?[]:[c.chromeStartMs-c.configuredOffsetMs]),summary=stats(errors);
  const outsideTolerance=errors.filter(e=>e<0 || e>SHOTGUN_MAX_TRIGGER_LATENESS_MS).length,omittedShots=strictChildren.filter(c=>c.chromeStartMs===null||!Number.isFinite(c.chromeStartMs)).length;
  let compressedPairs=0;
  for(const run of new Set(children.map(c=>c.run))){const ordered=strictChildren.filter(c=>c.run===run && c.chromeStartMs!==null).sort((a,b)=>a.configuredOffsetMs-b.configuredOffsetMs);
    for(let i=1;i<ordered.length;i++){const a=ordered[i-1]!,b=ordered[i]!;if(b.configuredOffsetMs>a.configuredOffsetMs && b.chromeStartMs!-a.chromeStartMs!<Math.max(1,(b.configuredOffsetMs-a.configuredOffsetMs)/2))compressedPairs++;}}
  const complete=validRows&&validRuns&&children.length===runs*topology.shots.length;
  const predictedCompression=topology.minimumSpacingMs!==null && topology.minimumSpacingMs<SHOTGUN_MEANINGFUL_SPACING_MS;
  return {schema:'shotgun-timing/v1',status:!children.length?'NOT_TESTED':!complete||outsideTolerance||omittedShots?'FAILED':compressedPairs?'AT_RISK':'READY',
    shotCount:topology.shots.filter(s=>s.shotgun).length,workerCount:Object.keys(topology.tabsPerWorker).length,tabsPerWorker:topology.tabsPerWorker,
    configuredMinimumSpacingMs:topology.minimumSpacingMs,p50:summary.p50,p95:summary.p95,max:summary.max,outsideTolerance,omittedShots,compressedPairs,predictedCompression,
    fingerprint:topology.fingerprint,testedAt:children.length?new Date().toISOString():null,...compatibility,runs};
}
/** Stale, other-plan, dirty-build and experimental-dispatcher results cannot authorize the default path. */
export function applicableShotgunTiming(value:ShotgunTimingReadiness,topology:ShotgunTopology,buildKey:string,now=Date.now(),chromeVersion:string|null=value?.chromeVersion??null):boolean {
  if(!value||typeof value!=='object')return false;
  const counts=[value.outsideTolerance,value.omittedShots,value.compressedPairs];
  const metrics=[value.p50,value.p95,value.max];
  const measured=metrics.every(v=>typeof v==='number'&&Number.isFinite(v))&&value.p50! <= value.p95! && value.p95! <= value.max!;
  const absent=metrics.every(v=>v===null);
  const tabs=value.tabsPerWorker;
  const sameTabs=tabs&&typeof tabs==='object'&&!Array.isArray(tabs)&&Object.keys(tabs).length===Object.keys(topology.tabsPerWorker).length&&
    Object.entries(topology.tabsPerWorker).every(([worker,count])=>tabs[worker]===count);
  const cleanTiming=measured&&value.p50! >= 0 && value.max! <= SHOTGUN_MAX_TRIGGER_LATENESS_MS&&value.outsideTolerance===0&&value.omittedShots===0;
  if(!sameTabs||!counts.every(v=>Number.isSafeInteger(v)&&v>=0)||!Number.isSafeInteger(value.runs)||value.runs<=0||
    (!measured&&!absent)||value.configuredMinimumSpacingMs!==topology.minimumSpacingMs||
    value.predictedCompression!==(topology.minimumSpacingMs!==null&&topology.minimumSpacingMs<SHOTGUN_MEANINGFUL_SPACING_MS)||
    value.status==='READY'&&(!cleanTiming||value.compressedPairs!==0)||value.status==='AT_RISK'&&(!cleanTiming||value.compressedPairs===0))return false;
  return value.chromeVersion!==null && value.chromeVersion===chromeVersion && ['READY','AT_RISK','FAILED','NOT_TESTED'].includes(value.status) && value.shotCount===topology.shots.filter(s=>s.shotgun).length && value.workerCount===Object.keys(topology.tabsPerWorker).length && Number.isSafeInteger(value.outsideTolerance) && value.outsideTolerance>=0 && Number.isSafeInteger(value.omittedShots) && value.omittedShots>=0 && value.schema==='shotgun-timing/v1' && value.fingerprint===topology.fingerprint && value.machineKey===shotgunMachineKey() && value.buildKey===buildKey && !buildKey.includes('dirty') && value.dispatcher==='central' && value.testedAt!==null && now-Date.parse(value.testedAt)>=0 && now-Date.parse(value.testedAt)<=24*60*60_000 && value.runs>0;
}
export function readShotgunTiming(path:string,topology:ShotgunTopology,buildKey:string,chromeVersion:string|null=null):ShotgunTimingReadiness|null {
  try{const value=JSON.parse(readFileSync(path,'utf8')) as ShotgunTimingReadiness;return applicableShotgunTiming(value,topology,buildKey,Date.now(),chromeVersion)?value:null;}catch{return null;}
}
