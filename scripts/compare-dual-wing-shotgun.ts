/** Offline comparator: exact shared compiler → existing production dispatcher benchmark. */
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fixturePlan } from './dual-wing-fixtures.js';
import { compileDualWingPlan } from '../src/dual-wing-plan.js';
const root=resolve(import.meta.dirname,'..'),out=resolve(process.argv[2]??join(root,'.local/dual-wing/comparison'));
const runs=Number(process.argv[3]??10);if(!Number.isInteger(runs)||runs<1||runs>100)throw Error('BENCH_ARGS_INVALID');
const cases=[
  {name:'mango-focused-8',wings:['MANGO'] as const},
  {name:'mango-diversified-8',wings:['MANGO','MANGO'] as const},
  {name:'buko-diversified-8',wings:['BUKO','BUKO'] as const},
  {name:'mixed-equal-8',wings:['MANGO','BUKO'] as const},
  {name:'mixed-weighted-8',wings:['MANGO','BUKO'] as const,weighted:true},
  {name:'mixed-one-per-wing-8',wings:['MANGO','BUKO'] as const,objective:'ONE_PER_WING' as const},
];
await mkdir(out,{recursive:true});
const results:unknown[]=[];
for(const spec of cases) {
  const plan=fixturePlan([...spec.wings],spec.objective??'ANY_ONE',spec.weighted?'PRIORITY_WEIGHTED':'EQUAL');
  const compiled=compileDualWingPlan(plan);if(!compiled.phase3||compiled.problems.length)throw Error(compiled.problems.join(' '));
  const directory=join(out,spec.name);await mkdir(directory,{recursive:true});
  const file=join(directory,'synthetic-plan.json');
  await writeFile(file,JSON.stringify({label:'OFFLINE / INTERCEPTED',objective:plan.objective,PRECISION_PHASE3:compiled.phase3,STRATEGY_V2:{shotgun:{enabled:true,exactSchedule:compiled.shotgun!.shots}}}));
  await new Promise<void>((done,fail)=>{
    const child=spawn(process.execPath,['--import','tsx',join(root,'scripts/benchmark-fanout-capacity.ts'),'--saved-plan',file,'--runs',String(runs),'--warmup','2','--prewarm-lead','6000','--prewarm-concurrency','4','--out',directory,'--scratch',join(root,'.local/shotgun-test-lab/benchmark',spec.name),'--label',spec.name,'--base-port','31544','--lockdown'],{cwd:root,stdio:'inherit',windowsHide:true});
    child.on('error',fail);child.on('exit',code=>code===0?done():fail(Error(`BENCH_FAILED:${spec.name}:${code}`)));
  });
  const timing=JSON.parse(await readFile(join(directory,'latest.json'),'utf8'));
  const summary=(await readdir(directory)).filter(f=>f.endsWith('-summary.json')).sort().at(-1)!;
  const profile=JSON.parse(await readFile(join(directory,summary),'utf8'));
  results.push({name:spec.name,plan,allocation:compiled.shotgun!.counts,timing,measurements:profile.widths[0],conditions:{runs,warmup:2,prewarmLeadMs:6000,prewarmConcurrency:4,security:'synthetic CPU 0 / wait 0',responses:'intercepted HTTP 409',dispatcher:'central',lockdown:true}});
  await writeFile(join(out,'comparison.json'),JSON.stringify(results,null,2));
}
