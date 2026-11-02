/** Read-only preflight classification. Never changes a journal or authorizes a duplicate. */
export interface HoldNotice {
  date:string;courts:number[];startTime:string;endTime:string;holdExpiresAt:string;
  latestHoldExpiresAt?:string;wing?:string;dismissible?:boolean;
  providerResolution?:'EXPIRED'|'UNAVAILABLE'|'PAID';verificationInvalid?:boolean;
}
export interface HoldTarget {date:string;court:number;startTime:string;endTime:string;wing?:string}
const dateValid=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const minute=(s:string)=>/^(?:[01]\d|2[0-3]):00$/.test(s)?Number(s.slice(0,2))*60:s==='24:00'?1440:NaN;
const valid=(v:{date:string;startTime:string;endTime:string})=>dateValid(v.date)&&Number.isFinite(minute(v.startTime))&&minute(v.endTime)>minute(v.startTime);
export function assessHoldNotices(holds:readonly HoldNotice[],targets:readonly HoldTarget[],now:number){
  let blocking=0,historical=0,providerResolved=0;
  for(const h of holds){
    const complete=valid(h)&&h.courts.length>0&&h.courts.every(c=>Number.isInteger(c)&&c>=1&&c<=7)&&
      (!h.wing||['MANGO','BUKO'].includes(h.wing))&&targets.length>0&&targets.every(valid)&&Number.isFinite(now);
    // UNKNOWN original targets remain protected even after terminal provider evidence or archival.
    const overlap=targets.some(t=>(t.wing??'MANGO')===(h.wing??'MANGO')&&t.date===h.date&&h.courts.includes(t.court)&&
      minute(t.startTime)<minute(h.endTime)&&minute(t.endTime)>minute(h.startTime));
    if(!complete||h.verificationInvalid||overlap){blocking++;continue;}
    const expiry=Date.parse(h.latestHoldExpiresAt??h.holdExpiresAt);
    if(h.providerResolution&&(h.providerResolution!=='UNAVAILABLE'||Number.isFinite(expiry)&&expiry<=now)){providerResolved++;continue;}
    // Use the existing independently derived 24-hour quiet/history eligibility, never archival as permission.
    // An elapsed advertisement is not provider-confirmed expiry. Active, recent and malformed evidence blocks.
    if(h.dismissible===true&&Number.isFinite(expiry)&&expiry<=now){historical++;continue;}
    blocking++;
  }
  return {blocking,historical,providerResolved};
}
