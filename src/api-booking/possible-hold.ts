import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BookingPlan } from './types.js';
import { observedResponse } from './two-hour-reservation.js';
import type { CheckoutHttpResponse } from './browser-session-transport.js';
import type { ApiStageFields } from '../ui-events.js';

export interface PossibleHold { key:string; date:string; courts:number[]; startTime:string; endTime:string;
  amount:number|null; holdExpiresAt:string; bookingIds:string[]; bookingNumbers:string[]; code:string }

/** Private operator evidence only; never a verified/paid state or a retry permit. */
export function possibleHoldFields(response:CheckoutHttpResponse,plan:BookingPlan):ApiStageFields|null {
  if(response.status!==200)return null;
  let raw:unknown;try{raw=JSON.parse(response.body);}catch{return null;}
  const seen=observedResponse(raw,'CHECKOUT_RESPONSE_NOT_YET_VERIFIED');
  if(!seen.success||!seen.bookingIds.length||!seen.holdExpiresAt.length)return null;
  return {date:plan.targetDate,wing:plan.wing??'MANGO',court:plan.courts[0]!.court,...(plan.courts[1]?{courtB:plan.courts[1].court}:{}),
    startTime:plan.startTime,durationHours:plan.durationHours,bookingId:seen.bookingIds[0],bookingNo:seen.bookingNumbers[0],
    holdExpiresAt:seen.holdExpiresAt.reduce((a,b)=>Date.parse(a)<Date.parse(b)?a:b),price:seen.transactionAmount,code:'CHECKOUT_RESPONSE_NOT_YET_VERIFIED'};
}

/** Restart-safe read-only view of unresolved creation evidence, including expired
 * deadlines. Passing a deadline never reclassifies UNKNOWN as authoritatively expired. */
export async function readPossibleHolds(root:string):Promise<PossibleHold[]> {
  const base=join(root,'.local/api-booking/api-first-journals'),result:PossibleHold[]=[];
  const visit=async(path:string):Promise<void>=>{
    let entries;try{entries=await readdir(path,{withFileTypes:true});}catch{return;}
    for(const entry of entries) {
      if(entry.isSymbolicLink())continue;
      const file=join(path,entry.name);
      if(entry.isDirectory()){await visit(file);continue;}
      if(!/^[a-f0-9]{64}\.json$/.test(entry.name))continue;
      try {
        const r=JSON.parse(await readFile(file,'utf8')),o=r.observedResponse,a=r.attempt;
        if(r.state!=='unknown'||a?.executionMode==='OFFLINE_INTERCEPTED'||o?.success!==true||!Array.isArray(o.bookingIds)||!o.bookingIds.length||
          !Array.isArray(o.holdExpiresAt)||!o.holdExpiresAt.length||o.holdExpiresAt.some((v:unknown)=>typeof v!=='string'||!Number.isFinite(Date.parse(v))))continue;
        result.push({key:r.key,date:a.targetDate,courts:a.courtIds,startTime:a.hourlyBoundaries[0].startTime,endTime:a.hourlyBoundaries.at(-1).endTime,
          amount:typeof o.transactionAmount==='number'?o.transactionAmount:null,holdExpiresAt:[...o.holdExpiresAt].sort()[0],
          bookingIds:o.bookingIds,bookingNumbers:o.bookingNumbers??[],code:r.failureCode??'UNKNOWN'});
      }catch{/* Invalid journals remain blocked by lifecycle checks; never rewritten here. */}
    }
  };
  await visit(base);return result.sort((a,b)=>b.holdExpiresAt.localeCompare(a.holdExpiresAt));
}
