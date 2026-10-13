/** Offline only. Uses the existing isolated production-dispatcher benchmark;
 * never reads/saves operator configuration or invokes the live desktop runner.
 */
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { compileSmartPlan, confirmSmartRates, emptySmartDraft, type SmartDraft } from '../src/precision-simple.js';
import { EXPERIMENTAL_DENSE_CORE_20, logicalTargetId, shotgunOffsets } from '../src/shotgun.js';
import { exactShotgunTopology, assertShotgunSchedule, type ShotgunTimingReadiness } from '../src/shotgun-timing.js';

const root=resolve(import.meta.dirname,'..');
const out=resolve(process.argv[2]??join(root,'.local/shotgun-comparison'));
const runs=Number(process.argv[3]??10),warmup=2,prewarmLeadMs=1500;
if(!Number.isSafeInteger(runs)||runs<1||runs>100)throw Error('BENCH_ARGS_INVALID');
await mkdir(out,{recursive:true});
const target={court:7,start:'19:00',durationHours:3};
const cases=[
  {name:'dense-20',offsets:[...EXPERIMENTAL_DENSE_CORE_20]},
  ...[5,8,10,15].map(count=>({name:`wide-${count}`,offsets:shotgunOffsets(count,-2000,0)})),
  {name:'wide-8-round-robin',offsets:shotgunOffsets(8,-2000,0),roundRobin:4},
];
const comparisons=[];
for(const spec of cases){
  const count=spec.offsets.length,id=logicalTargetId(target);
  const draft:SmartDraft={...emptySmartDraft(),immediate:[target],backups:[],useBackupsImmediately:false,retryReopened:false,
    rates:confirmSmartRates(600,700,'VENUE_SCHEDULE','2026-10-16',new Date('2026-10-14T00:00:00Z')),
    advanced:{wave2:0,rescue:0},shotgun:{enabled:true,budget:count,allocationMode:'CUSTOM',selectedTargetIds:[id],customCounts:{[id]:count},
      windowStartMs:-2000,windowEndMs:0,timingMode:'CUSTOM',customOffsetsMs:spec.offsets,timingCapacityOverride:true,allowStandbyConsumption:true}};
  const compiled=compileSmartPlan(draft,{targetDate:'2026-10-16'});
  if(!compiled.phase3||compiled.problems.length||!compiled.shotgun)throw Error(`BENCH_PLAN_INVALID:${compiled.problems.join(',')}`);
  const phase3=structuredClone(compiled.phase3);
  // Explicit alternate topology for comparison. Same one logical target and
  // exact global triggers; maximum six children and one process per group.
  if('roundRobin' in spec){
    phase3.wave1=Array.from({length:spec.roundRobin},(_,worker)=>({workerId:String.fromCharCode(65+worker) as 'A'|'B'|'C'|'D',candidateIndex:0,
      fanOutOffsetsMs:spec.offsets.filter((_,index)=>index%spec.roundRobin===worker)}));
    phase3.standby=phase3.standby.filter(worker=>!phase3.wave1.some(a=>a.workerId===worker));
  }
  const schedule=compiled.shotgun.shots.map(({logicalTargetId,shotIndex,configuredOffsetMs})=>({logicalTargetId,shotIndex,configuredOffsetMs}));
  const topology=exactShotgunTopology(phase3,schedule);assertShotgunSchedule(topology,schedule);
  const directory=join(out,spec.name);await mkdir(directory,{recursive:true});
  const file=join(directory,'synthetic-plan.json');
  await writeFile(file,JSON.stringify({label:'SYNTHETIC OFFLINE COMPARISON; NOT OPERATOR AUTHORIZATION',PRECISION_PHASE3:phase3,
    STRATEGY_V2:{shotgun:{enabled:true,exactSchedule:schedule}}},null,2));
  process.stdout.write(`Starting ${spec.name}: ${JSON.stringify(topology.tabsPerWorker)}\n`);
  await new Promise<void>((done,fail)=>{const child=spawn(process.execPath,['--import','tsx',join(root,'scripts/benchmark-fanout-capacity.ts'),
    '--saved-plan',file,'--runs',String(runs),'--warmup',String(warmup),'--prewarm-lead',String(prewarmLeadMs),
    '--prewarm-concurrency','4','--out',directory,'--label',spec.name,'--lockdown'],{cwd:root,stdio:'inherit',windowsHide:true});
    child.on('error',fail);child.on('exit',code=>code===0?done():fail(Error(`BENCH_PROCESS_FAILED:${code}`)));});
  const timing=JSON.parse(await readFile(join(directory,'latest.json'),'utf8')) as ShotgunTimingReadiness;
  const summaryFile=(await readdir(directory)).filter(name=>name.endsWith('-summary.json')).sort().at(-1)!;
  const profile=JSON.parse(await readFile(join(directory,summaryFile),'utf8'));
  comparisons.push({name:spec.name,offsets:spec.offsets,topology:topology.tabsPerWorker,timing,measurements:profile.widths[0],
    conditions:{runs,warmup,prewarmLeadMs,prewarmConcurrency:4,dispatcher:'central',security:'synthetic cpu:0,wait:0',lockdown:true}});
  await writeFile(join(out,'comparison.json'),JSON.stringify(comparisons,null,2));
}
process.stdout.write(`Comparison saved: ${join(out,'comparison.json')}\n`);
