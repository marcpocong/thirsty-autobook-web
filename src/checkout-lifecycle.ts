import { open, readFile, rename, unlink } from 'node:fs/promises';
import type { CheckoutStage } from './safety.js';

export async function atomicJson(path:string,value:unknown){
  const temporary=`${path}.${process.pid}.tmp`;
  const file=await open(temporary,'w');
  try{await file.writeFile(JSON.stringify(value));await file.sync();}finally{await file.close();}
  await rename(temporary,path);
}
export function lifecycleWriter(path:string,identity:{pid:number;runID:string}){
  return async(stage:CheckoutStage)=>{
    const current=JSON.parse(await readFile(path,'utf8'));
    if(current.pid!==identity.pid||current.runID!==identity.runID)throw Error('LOCK_REPLACED');
    await atomicJson(path,{...current,stage});
  };
}
export async function removeOwnedRecord(path:string,pid:number,runID:string){
  const current=JSON.parse(await readFile(path,'utf8'));
  if(current.pid!==pid||current.runID!==runID)throw Error('LOCK_REPLACED');
  await unlink(path);
}
