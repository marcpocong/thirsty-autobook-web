import { existsSync, readFileSync } from 'node:fs';
import { cpus, freemem, totalmem } from 'node:os';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { BuildInfo } from './build-info.js';

export type ReadinessLevel='GOOD'|'DEGRADED'|'UNAVAILABLE';
export type ReleaseGateVerdict='READY'|'READY_WITH_WARNINGS'|'NOT_READY';
export interface ReadinessCheck {id:string;label:string;level:ReadinessLevel;hardBlock:boolean;detail:string}
export interface MachineHealth {measuredAt:string;cpuCount:number;memoryUsedPct:number;eventLoopP95Ms:number;processRssMb:number}
export interface ReleaseReadinessGate {verdict:ReleaseGateVerdict;measuredAt:string;checks:ReadinessCheck[];readyWorkers:string[];degradedWorkers:string[];unavailableWorkers:string[]}

export function createMachineHealthSampler(){
  const delay=monitorEventLoopDelay({resolution:10});delay.enable();
  return {sample:():MachineHealth=>{const total=totalmem(),memoryUsedPct=total?Math.round((1-freemem()/total)*1000)/10:100;
    const eventLoopP95Ms=Math.round(delay.percentile(95)/1e5)/10;delay.reset();
    return {measuredAt:new Date().toISOString(),cpuCount:cpus().length,memoryUsedPct,eventLoopP95Ms,processRssMb:Math.round(process.memoryUsage().rss/1024/1024)};},close:()=>delay.disable()};
}
export function readLastReleaseBuild(root:string):{gitSha:string;dirty:boolean|null;finishedAt:string;packaged:boolean}|null{
  try{const value=JSON.parse(readFileSync(join(root,'.local/build/last-release-build.json'),'utf8')) as Record<string,unknown>;
    return typeof value.gitSha==='string'&&typeof value.finishedAt==='string'&&typeof value.packaged==='boolean'?{gitSha:value.gitSha,dirty:typeof value.dirty==='boolean'?value.dirty:null,finishedAt:value.finishedAt,packaged:value.packaged}:null;}catch{return null;}
}
export function evaluateReleaseReadiness(input:{build:BuildInfo|null;testedBuild:{gitSha:string;dirty:boolean|null;finishedAt:string;packaged:boolean}|null;configValid:boolean;authorizationValid:boolean;
  clock:{synced:boolean;ageMs:number|null;uncertaintyMs:number|null;offsetMs:number|null};machine:MachineHealth;workers:Record<string,{connected:boolean;identityValid:boolean;securityReady:boolean;targetReady?:boolean;tabCount?:number;latencyP95Ms?:number|null}>;
  observer:{online:boolean;lastReadAgeMs:number|null;availabilityLatencyMs:number|null};fanOut:{compatible:boolean;stale:boolean;width:number}|null;prewarm:boolean}):ReleaseReadinessGate{
  const checks:ReadinessCheck[]=[];const add=(check:ReadinessCheck)=>checks.push(check);
  const buildMatch=!!input.build&&!!input.testedBuild&&input.build.gitSha===input.testedBuild.gitSha&&input.testedBuild.packaged;
  add({id:'build',label:'Build integrity',level:!input.build||!input.testedBuild?'UNAVAILABLE':buildMatch&&!input.build.dirty?'GOOD':'DEGRADED',hardBlock:false,
    detail:!input.build?'Running build metadata unavailable':!input.testedBuild?'No verified release build record':buildMatch?input.build.dirty?'SHA matches tested build, but source was dirty':`running/tested/packaged ${input.build.gitSha.slice(0,7)}`:'Running SHA does not match the last tested packaged build'});
  add({id:'config',label:'Configuration',level:input.configValid&&input.authorizationValid?'GOOD':'UNAVAILABLE',hardBlock:true,detail:input.configValid?(input.authorizationValid?'Saved Phase 3 compiles exactly':'Saved authorization does not compile'):'Configuration is invalid'});
  const clockGood=input.clock.synced&&input.clock.ageMs!==null&&input.clock.ageMs<=15*60_000&&input.clock.uncertaintyMs!==null&&input.clock.uncertaintyMs<=25;
  add({id:'clock',label:'Trusted clock',level:clockGood?'GOOD':input.clock.synced?'DEGRADED':'UNAVAILABLE',hardBlock:!input.clock.synced,
    detail:input.clock.synced?`offset ${input.clock.offsetMs?.toFixed(1)??'?'} ms · uncertainty ${input.clock.uncertaintyMs?.toFixed(1)??'?'} ms · age ${input.clock.ageMs===null?'?':Math.round(input.clock.ageMs/1000)+' s'}`:'No valid trusted clock'});
  const machineBad=input.machine.memoryUsedPct>=92||input.machine.eventLoopP95Ms>=50,machineWarn=input.machine.memoryUsedPct>=85||input.machine.eventLoopP95Ms>=20;
  add({id:'machine',label:'Machine',level:machineBad?'UNAVAILABLE':machineWarn?'DEGRADED':'GOOD',hardBlock:false,detail:`memory ${input.machine.memoryUsedPct}% · event-loop p95 ${input.machine.eventLoopP95Ms} ms · app RSS ${input.machine.processRssMb} MB`});
  const readyWorkers:string[]=[],degradedWorkers:string[]=[],unavailableWorkers:string[]=[];
  for(const [id,value] of Object.entries(input.workers).sort()){
    const level:ReadinessLevel=!value.connected||!value.identityValid?'UNAVAILABLE':!value.securityReady||value.targetReady===false||value.tabCount===0||(value.latencyP95Ms??0)>20?'DEGRADED':'GOOD';
    (level==='GOOD'?readyWorkers:level==='DEGRADED'?degradedWorkers:unavailableWorkers).push(id);
    add({id:`worker-${id}`,label:`Worker ${id}`,level,hardBlock:false,detail:!value.connected?'browser disconnected':!value.identityValid?'identity/profile not verified':!value.securityReady?'security preparation not ready':value.targetReady===false?'expected Onda target tab not found':value.tabCount===0?'no responsive tab':`connected · ${value.tabCount??'?'} tab(s) · probe ${value.latencyP95Ms?.toFixed(1)??'?'} ms`});
  }
  add({id:'observer',label:'Observer',level:input.observer.online?'GOOD':'DEGRADED',hardBlock:false,detail:input.observer.online?`online · latest read ${input.observer.lastReadAgeMs===null?'pending':Math.round(input.observer.lastReadAgeMs/1000)+' s ago'}`:'offline; Wave 2 and Rescue require new valid evidence'});
  add({id:'fanout',label:'Fan-out profile',level:input.fanOut?.compatible&&!input.fanOut.stale?'GOOD':input.fanOut?'DEGRADED':'UNAVAILABLE',hardBlock:false,detail:input.fanOut?`${input.fanOut.width} per target${input.fanOut.stale?' · stale':''}${input.fanOut.compatible?'':' · incompatible'}`:'Auto falls back to width 1'});
  add({id:'prewarm',label:'Prewarm',level:input.prewarm?'GOOD':'DEGRADED',hardBlock:false,detail:input.prewarm?'release preparation complete':'not yet prepared'});
  const hard=checks.some(value=>value.hardBlock&&value.level!=='GOOD'),warnings=checks.some(value=>value.level!=='GOOD');
  return {verdict:hard?'NOT_READY':warnings?'READY_WITH_WARNINGS':'READY',measuredAt:new Date().toISOString(),checks,readyWorkers,degradedWorkers,unavailableWorkers};
}
