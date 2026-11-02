import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ShotgunRehearsal } from './shotgun-live-rehearsal.js';
import type { DirectTransport } from './api-booking/proofless-checkout.js';

/** Keep the production transport's calibration and receiver while adding the Lab's final authority gate. */
export function guardLiveLabTransport(transport:DirectTransport,assertBeforePost:()=>void):DirectTransport{
  return {
    ...(transport.prepareStrictTiming?{prepareStrictTiming:()=>transport.prepareStrictTiming!()}:{}),
    publicCheckoutProofless:(body,permit,options={})=>transport.publicCheckoutProofless(body,permit,{
      ...options,beforePost:()=>{assertBeforePost();options.beforePost?.();},
    }),
  };
}

/** Pure, in-memory final gate. Availability age is elapsed monotonic time, not mixed epoch clocks. */
export function liveLabPostRefusal(input:{nowMs:number;expiresMs:number;aborted:boolean;availabilityAgeMs:number}):string|null{
  if(input.aborted)return 'USER_ABORT';
  if(!Number.isFinite(input.nowMs)||!Number.isFinite(input.expiresMs)||input.nowMs>=input.expiresMs)return 'REHEARSAL_AUTHORIZATION_EXPIRED';
  if(!Number.isFinite(input.availabilityAgeMs)||input.availabilityAgeMs<0||input.availabilityAgeMs>15_000)return 'LAB_AVAILABILITY_STALE';
  return null;
}

/** Cross-profile duplicate protection: passing an advertised deadline never releases UNKNOWN evidence. */
export async function assertLiveLabJournalEligibility(root:string,requests:ShotgunRehearsal[]){
  let count=0;
  async function walk(directory:string,depth:number):Promise<void>{
    if(depth>5)throw Error('LAB_JOURNAL_SCAN_INCOMPLETE');
    let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch(error){
      if(directory===root&&(error as NodeJS.ErrnoException).code==='ENOENT')return;throw Error('LAB_JOURNAL_SCAN_INCOMPLETE');}
    for(const entry of entries){
      if(++count>30_000||entry.isSymbolicLink())throw Error('LAB_JOURNAL_SCAN_INCOMPLETE');
      const path=join(directory,entry.name);
      if(entry.isDirectory()){await walk(path,depth+1);continue;}
      if(!/^[a-f0-9]{64}\.json$/.test(entry.name))continue;
      let record;try{record=JSON.parse(await readFile(path,'utf8'));}catch{throw Error('LAB_JOURNAL_SCAN_INCOMPLETE');}
      if(!['armed','dispatching','unknown','verified','rejected'].includes(record.state)||!record.attempt)throw Error('LAB_JOURNAL_SCAN_INCOMPLETE');
      if(record.state==='rejected')continue;
      const a=record.attempt;
      if(typeof a.targetDate!=='string'||!Array.isArray(a.courtIds)||!a.courtIds.length)
        throw Error('LAB_JOURNAL_SCAN_INCOMPLETE');
      for(const r of requests){
        if(a.targetDate!==r.date||!a.courtIds.includes(r.court))continue;
        if(!Array.isArray(a.hourlyBoundaries)||!a.hourlyBoundaries.length)throw Error('LAB_JOURNAL_SCAN_INCOMPLETE');
        const end=`${String(Number(r.start.slice(0,2))+r.duration).padStart(2,'0')}:00`;
        if(a.hourlyBoundaries.some((h:any)=>typeof h.startTime!=='string'||typeof h.endTime!=='string'||h.startTime<end&&h.endTime>r.start))
          throw Error('LAB_OUTSTANDING_TARGET_CONFLICT');
      }
    }
  }
  await walk(root,0);
}
