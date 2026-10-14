import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runShotgunLab, type LabRequest } from './shotgun-test-lab.js';
const inputPath=resolve(process.argv[2]??'');
const input=JSON.parse(await readFile(inputPath,'utf8')) as LabRequest;
const directory=resolve(process.argv[3]??'');
if(!directory.includes('shotgun-test-lab')||directory===process.cwd())throw Error('LAB_ISOLATION_REQUIRED');
await mkdir(directory,{recursive:true});
process.chdir(directory);
process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT='SUPERVISED_ONE_SHOT';
let stopped=false;
process.on('message',message=>{if(message==='stop')stopped=true;});
process.on('SIGTERM',()=>{stopped=true;});
try {
  const result=await runShotgunLab(input,{directory,runId:directory.split(/[\\/]/).at(-1)!,isAborted:()=>stopped,onPhase:phase=>process.send?.({phase})});
  await writeFile(resolve(directory,'result.json'),JSON.stringify(result,null,2));
  process.send?.({result});
} catch(error){process.stderr.write(`${(error as Error).message}\n`);process.send?.({error:(error as Error).message});process.exitCode=1;}
finally {process.disconnect?.();}
