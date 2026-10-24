import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readArchiveIndex, scanJournals } from '../journal-archive.js';
import type { BookingPlan } from './types.js';
import { observedResponse } from './two-hour-reservation.js';
import type { CheckoutHttpResponse } from './browser-session-transport.js';
import type { ApiStageFields } from '../ui-events.js';

export interface PossibleHold { key:string; date:string; courts:number[]; startTime:string; endTime:string;
  amount:number|null; holdExpiresAt:string; bookingIds:string[]; bookingNumbers:string[]; code:string;
  archivePath?:string; dismissible?:boolean; archived?:boolean }

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
  const result:PossibleHold[]=[];
  const [records,archive]=await Promise.all([scanJournals(root),readArchiveIndex(root)]);
  for(const record of records) {
      if(!record.path.startsWith('.local/api-booking/api-first-journals/')||record.state!=='unknown'||record.offline)continue;
      try {
        const bytes=await readFile(join(root,record.path)),digest=createHash('sha256').update(bytes).digest('hex');
        const r=JSON.parse(bytes.toString('utf8')),o=r.observedResponse,a=r.attempt;
        if(r.state!=='unknown'||a?.executionMode==='OFFLINE_INTERCEPTED'||o?.success!==true||!Array.isArray(o.bookingIds)||!o.bookingIds.length||
          !Array.isArray(o.holdExpiresAt)||!o.holdExpiresAt.length||o.holdExpiresAt.some((v:unknown)=>typeof v!=='string'||!Number.isFinite(Date.parse(v))))continue;
        if(typeof r.key!=='string'||!/^[a-f0-9]{64}$/.test(r.key)||!/^\d{4}-\d{2}-\d{2}$/.test(a.targetDate)||
          !Array.isArray(a.courtIds)||!a.courtIds.length||a.courtIds.some((v:unknown)=>!Number.isInteger(v)||Number(v)<1||Number(v)>7)||
          !Array.isArray(a.hourlyBoundaries)||!a.hourlyBoundaries.length||a.hourlyBoundaries.some((v:{startTime?:unknown;endTime?:unknown})=>
            !v||typeof v.startTime!=='string'||!/^\d{2}:00$/.test(v.startTime)||typeof v.endTime!=='string'||!/^\d{2}:00$/.test(v.endTime))||
          o.bookingIds.length>12||o.bookingIds.some((v:unknown)=>typeof v!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(v))||
          !Array.isArray(o.bookingNumbers)||o.bookingNumbers.some((v:unknown)=>typeof v!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(v)))continue;
        result.push({key:r.key,date:a.targetDate,courts:a.courtIds,startTime:a.hourlyBoundaries[0].startTime,endTime:a.hourlyBoundaries.at(-1).endTime,
          amount:typeof o.transactionAmount==='number'?o.transactionAmount:null,holdExpiresAt:[...o.holdExpiresAt].sort()[0],
          bookingIds:o.bookingIds,bookingNumbers:o.bookingNumbers??[],code:r.failureCode??'UNKNOWN',
          archivePath:record.path,dismissible:record.eligible,
          // A changed record resurfaces. Archival affects presentation only: every hold is still returned to safety checks.
          archived:record.eligible&&archive.entries.some(e=>e.path===record.path&&e.sha256===digest)});
      }catch{/* Invalid journals remain blocked by lifecycle checks; never rewritten here. */}
  }
  return result.sort((a,b)=>b.holdExpiresAt.localeCompare(a.holdExpiresAt));
}
