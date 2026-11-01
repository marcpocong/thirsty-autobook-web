import {readFile,readdir,unlink,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {WorkerId} from '../workers.js';
import {publishPrivateJson} from './private-persistence.js';

/** Conservative local claim set. Each contender publishes a complete immutable
 * identity BEFORE examining the others. A contender seeing another live/unknown
 * owner refuses; simultaneous contenders may both refuse, never both proceed.
 * A crash leaves its claim as evidence. Only a proven absent PID can be ignored;
 * reused/EPERM/unknown PIDs remain blocking. No stale-file unlink race is needed.
 */
export async function acquireRecoveryClaim(root:string,worker:WorkerId):Promise<()=>Promise<void>>{
  await mkdir(root,{recursive:true,mode:0o700});
  const owner=randomUUID(),path=join(root,`${worker}-${owner}.json`);
  await publishPrivateJson(path,{schema:1,worker,pid:process.pid,owner,at:new Date().toISOString()});
  const release=async()=>{await unlink(path).catch(()=>undefined);};
  try{
    for(const file of await readdir(root)){
      if(file===`${worker}-${owner}.json`||!file.startsWith(`${worker}-`)||!file.endsWith('.json'))continue;
      let value;try{value=JSON.parse(await readFile(join(root,file),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')continue;throw Error('RECOVERY_CLAIM_UNREADABLE');}
      if(value.schema!==1||value.worker!==worker||!Number.isInteger(value.pid)||value.pid<=0||typeof value.owner!=='string'||
        !/^[a-f0-9-]{36}$/.test(value.owner)||file!==`${worker}-${value.owner}.json`)throw Error('RECOVERY_CLAIM_UNREADABLE');
      let absent=false;try{process.kill(value.pid,0);}catch(e){absent=(e as NodeJS.ErrnoException).code==='ESRCH';}
      if(!absent)throw Error('RECOVERY_WORKER_BUSY');
    }
    return release;
  }catch(e){await release();throw e;}
}
