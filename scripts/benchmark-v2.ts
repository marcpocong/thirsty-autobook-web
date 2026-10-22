import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFile,execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { defaultObjective, withStrategy, compileObjective, savedMangoReleaseSetup } from '../src/booking-objective.js';

// Synthetic exact authorizations, never the operator's saved plan. The existing
// benchmark blocks all external networking and intercepts every checkout.
const args=process.argv.slice(2),option=(key:string,fallback:string)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1]??fallback;};
const runs=Number(option('--runs','5'));if(!Number.isInteger(runs)||runs<3||runs>20)throw Error('BENCH_RUNS_INVALID');
const out=resolve(option('--out','.local/v2-benchmarks'));await mkdir(out,{recursive:true});
const sourceHash=async()=>{const hash=createHash('sha256');for(const path of execFileSync('git',['ls-files','src','ui','scripts','package.json'],{encoding:'utf8'}).trim().split(/\r?\n/).sort()){hash.update(path);hash.update(await readFile(path));}return hash.digest('hex');};
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceFingerprint=await sourceHash();
const rows:unknown[]=[];
for(const budget of [2,4,6,8,12,20])for(const allocationMode of ['EQUAL','PRIORITY_WEIGHTED'] as const) {
  const objective=withStrategy(defaultObjective(Date.parse('2026-10-21T01:00:00Z'),'NEXT_RELEASE'),'SHOTGUN');
  objective.wings.BUKO.enabled=false;
  objective.wings.MANGO={...objective.wings.MANGO,bookingDate:'2026-10-24',courts:[{court:7,priority:1},{court:6,priority:2}],startTimes:['19:00'],durationHours:3,minimum:2,ideal:2};
  objective.shotgun={...objective.shotgun,budget,allocationMode,timingMode:'BALANCED',windowStartMs:-2000,windowEndMs:0,timingCapacityOverride:true};
  const compiled=compileObjective(objective,{nowMs:Date.parse('2026-10-21T01:00:00Z')}),saved=savedMangoReleaseSetup(compiled,'2026-10-24');
  if(!saved.setup)throw Error(`BENCH_PLAN_INVALID ${JSON.stringify([...compiled.problems,...saved.problems])}`);
  const label=`${budget}-${allocationMode.toLowerCase()}`,directory=join(out,label),planPath=join(out,`${label}.json`);
  await writeFile(planPath,JSON.stringify(saved.setup));
  const result=await promisify(execFile)(process.execPath,['--import','tsx','scripts/benchmark-fanout-capacity.ts','--saved-plan',planPath,
    '--target-date','2026-10-24','--runs',String(runs),'--warmup','1','--prewarm-lead','6000','--synthetic-prewarm','cpu:0,wait:100','--traces','--lockdown','--out',directory],
    {cwd:process.cwd(),windowsHide:true,timeout:300_000,maxBuffer:1024*1024});
  rows.push({budget,allocationMode,label,output:result.stdout.trim(),directory});
  if(await sourceHash()!==sourceFingerprint)throw Error('BENCH_SOURCE_CHANGED');
  await writeFile(join(out,'matrix.json'),JSON.stringify({label:'OFFLINE / INTERCEPTED · not live eligibility',runs,sourceCommit,sourceFingerprint,rows},null,2));
  console.log(`BENCH_COMPLETED ${label}`);
}
