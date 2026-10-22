import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prooflessReleasePlan, prooflessRequest, submitDirectCheckout } from '../../src/api-booking/proofless-checkout.js';
import { saveCheckoutRecovery, prepareCheckoutRecovery, CHECKOUT_RECOVERY_FILE, assertRecoveryJournal, openCheckoutRecovery } from '../../src/api-booking/checkout-recovery.js';
import { DurableSubmissionJournal } from '../../src/api-booking/durable-submission-journal.js';
import { validatePublicCheckoutResponse, type PublicCheckoutRequest } from '../../src/api-booking/public-checkout.js';
import type { CheckoutHttpResponse, OndaBrowserSessionTransport } from '../../src/api-booking/browser-session-transport.js';

const now=new Date('2026-10-22T00:00:03Z');
const customer={clientId:'client',customerId:'customer',customerEmail:'private@example.invalid',customerPhone:'09123456789',customerFirstName:'Synthetic',customerLastName:'Guest'};
const plan=prooflessReleasePlan({mode:'standard',targetDate:'2026-10-24',durationHours:3,preferredStartTimes:['19:00'],fallbackStartTimes:[],
  courtPriority:[7],fallbackCourts:[],courtCount:1,maximumTotalPrice:2100,currency:'PHP'});
const request=prooflessRequest(plan,customer);
// Synthetic response: exact fields must match; the October 22 raw response was
// not retained, so this is deliberately not presented as a captured replay.
function response() {
  return {success:true,bookings:request.items.map((item,index)=>({id:`booking-${index}`,booking_no:`number-${index}`,customer_id:'resolved-customer',
    facility_id:item.facilityId,space_id:item.spaceId,date:item.date,start_time:`${item.startTime}:00`,end_time:`${item.endTime}:00`,duration:60,
    rate:700,guest_count:1,booking_status:'pending',payment_status:'pending',booking_session_id:`hourly-${index}`,hold_expires_at:'2026-10-22T00:10:02.058Z',
    checkoutToken:`private-access-${index}`,customer_email:customer.customerEmail,cookies:'DO-NOT-STORE'})),
    bookingSessions:request.items.map((item,index)=>({requestSessionRef:item.sessionRef,bookingSessionId:`hourly-${index}`,facilityId:item.facilityId,
      spaceId:item.spaceId,date:item.date,startTime:`${item.startTime}:00`,endTime:`${item.endTime}:00`,durationHours:1,bookingIds:[`booking-${index}`]})),
    transaction:{id:'transaction',reference:'number-0',amount:2100,status:'pending',secret:'DO-NOT-STORE'},trustedTotalAmount:2100};
}
const http=(raw:unknown,status=200)=>({status,contentType:'application/json',body:JSON.stringify(raw)}) as CheckoutHttpResponse;

describe('private checkout recovery',()=>{
  it.each(['complete','wrong hours','wrong amount','access denied','expired during navigation'])('restoration stops safely or verifies the existing QR: %s',async(kind)=>{
    const dir=await mkdtemp(join(tmpdir(),'checkout-open-recovery-'));
    try{
      const raw=response(),journal=new DurableSubmissionJournal(dir);
      const transport={publicCheckoutProofless:async()=>{await saveCheckoutRecovery(dir,http(raw),plan,'A',now);return raw;}} as unknown as OndaBrowserSessionTransport;
      await submitDirectCheckout(plan,customer,transport,journal,undefined,[],()=>now.getTime());
      const key=DurableSubmissionJournal.key(request.facilityId,plan.courts[0]!.spaceId,plan.targetDate,plan.startTime,plan.endTime);
      const before=await readFile(join(dir,`${key}.json`),'utf8');
      const body=`Court 7: Mango Wing October 24, 2026 ${kind==='wrong hours'?'7:00 PM - 8:00 PM':'7:00 PM - 10:00 PM'} Pending QRPH ${kind==='wrong amount'?'700.00':'2,100.00'}`;
      const page={route:vi.fn(),unroute:vi.fn(),evaluate:vi.fn(async()=>kind==='access denied'?403:200),goto:vi.fn(),
        getByText:vi.fn(()=>({first:()=>({waitFor:vi.fn()})})),locator:vi.fn(()=>({innerText:async()=>body,first:()=>({waitFor:vi.fn()})})),bringToFront:vi.fn()};
      let clockReads=0;
      const opened=openCheckoutRecovery(page as unknown as Parameters<typeof openCheckoutRecovery>[0],dir,
        ()=>kind==='expired during navigation'&&++clockReads>1?new Date('2026-10-22T00:11:00Z'):now);
      if(kind==='complete') {
        const result=await opened;
        expect(result).toMatchObject({hold:{trustedTotalAmount:2100}});
        expect(result).not.toHaveProperty('token');expect(page.bringToFront).toHaveBeenCalledOnce();
        expect(page.goto).toHaveBeenCalledWith(expect.stringContaining('bookingId=booking-0'),expect.anything());
      } else {await expect(opened).rejects.toThrow();expect(page.bringToFront).not.toHaveBeenCalled();}
      if(kind==='access denied')expect(page.goto).not.toHaveBeenCalled();
      expect(page.route).toHaveBeenCalledWith('**/api/bookings/public-checkout**',expect.any(Function));
      const route={abort:vi.fn()};await page.route.mock.calls[0]![1](route);expect(route.abort).toHaveBeenCalledOnce();
      expect(page.unroute).toHaveBeenCalledWith('**/api/bookings/public-checkout**');
      expect(await readFile(join(dir,`${key}.json`),'utf8')).toBe(before);
    }finally{await rm(dir,{recursive:true,force:true});}
  });

  it('does not create a recovery file from a rejected response',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'checkout-no-recovery-'));
    try{await saveCheckoutRecovery(dir,http({success:false},409),plan,'A',now);
      await expect(readFile(join(dir,CHECKOUT_RECOVERY_FILE))).rejects.toMatchObject({code:'ENOENT'});
    }finally{await rm(dir,{recursive:true,force:true});}
  });
  it('survives process-local state loss, retains all hourly sessions, and excludes unrelated/private contact fields',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'checkout-recovery-'));
    try{
      await saveCheckoutRecovery(dir,http(response()),plan,'A',now);
      const text=await readFile(join(dir,CHECKOUT_RECOVERY_FILE),'utf8');
      expect(text).not.toContain(customer.customerEmail);expect(text).not.toContain('DO-NOT-STORE');
      const recovered=await prepareCheckoutRecovery(dir,now);
      expect(recovered).toMatchObject({workerId:'A',token:'private-access-0',bookingNo:'number-0',hold:{trustedTotalAmount:2100,
        bookingIds:['booking-0','booking-1','booking-2'],sessionIds:['hourly-0','hourly-1','hourly-2']}});
      expect(recovered.url).toContain('bookingId=booking-0');
      await expect(saveCheckoutRecovery(dir,http(response()),plan,'A',now)).rejects.toMatchObject({code:'EEXIST'});
    }finally{await rm(dir,{recursive:true,force:true});}
  });

  it('preserves access on validation failure, retains the exact error, and leaves duplicate suppression active',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'checkout-invalid-recovery-'));
    try{
      const raw=response();raw.transaction.amount=1;
      const journal=new DurableSubmissionJournal(dir);
      let sends=0;
      const transport={publicCheckoutProofless:async()=>{sends++;await saveCheckoutRecovery(dir,http(raw),plan,'A',now);return raw;}} as unknown as OndaBrowserSessionTransport;
      await expect(submitDirectCheckout(plan,customer,transport,journal,undefined,[],()=>now.getTime())).rejects.toThrow('SUBMISSION_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED');
      const key=DurableSubmissionJournal.key(request.facilityId,plan.courts[0]!.spaceId,plan.targetDate,plan.startTime,plan.endTime);
      const record=await journal.read(key);
      expect(record).toMatchObject({state:'unknown',failureCode:'CHECKOUT_RESPONSE_INVALID',observedResponse:{validationCode:'CHECKOUT_RESPONSE_INVALID'}});
      expect(JSON.stringify(record)).not.toContain('private-access');
      expect(await readFile(join(dir,CHECKOUT_RECOVERY_FILE),'utf8')).toContain('private-access-0');
      await expect(prepareCheckoutRecovery(dir,now)).rejects.toThrow('CHECKOUT_RESPONSE_INVALID');
      await expect(submitDirectCheckout(plan,customer,transport,journal)).rejects.toThrow('DUPLICATE_LOGICAL_BOOKING_BLOCKED');
      expect(sends).toBe(1);
    }finally{await rm(dir,{recursive:true,force:true});}
  });

  it('recovers a verified hourly response against the original journal without modifying it',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'checkout-journal-recovery-'));
    try{
      const raw=response(),journal=new DurableSubmissionJournal(dir);
      const transport={publicCheckoutProofless:async()=>{await saveCheckoutRecovery(dir,http(raw),plan,'A',now);return raw;}} as unknown as OndaBrowserSessionTransport;
      await submitDirectCheckout(plan,customer,transport,journal,undefined,[],()=>now.getTime());
      const key=DurableSubmissionJournal.key(request.facilityId,plan.courts[0]!.spaceId,plan.targetDate,plan.startTime,plan.endTime);
      const before=await readFile(join(dir,`${key}.json`),'utf8');
      const recovery=await prepareCheckoutRecovery(dir,now);
      await assertRecoveryJournal(dir,recovery);
      expect(await readFile(join(dir,`${key}.json`),'utf8')).toBe(before);
      await expect(assertRecoveryJournal(dir,{...recovery,hold:{...recovery.hold,bookingIds:['other']}})).rejects.toThrow('CHECKOUT_RECOVERY_JOURNAL_MISMATCH');
    }finally{await rm(dir,{recursive:true,force:true});}
  });

  it.each(['expired','missing token','bad token','invalid session'])('refuses %s recovery',async(kind)=>{
    const dir=await mkdtemp(join(tmpdir(),'checkout-refused-recovery-'));
    try{
      const raw=response();
      if(kind==='missing token')raw.bookings[0]!.checkoutToken='';
      if(kind==='bad token')raw.bookings[0]!.checkoutToken='secret\nheader';
      if(kind==='invalid session')raw.bookingSessions[0]!.date='2026-10-25';
      await saveCheckoutRecovery(dir,http(raw),plan,'A',now);
      await expect(prepareCheckoutRecovery(dir,kind==='expired'?new Date('2026-10-22T00:10:03Z'):now)).rejects.toThrow();
    }finally{await rm(dir,{recursive:true,force:true});}
  });

  it.each([
    ['wrong session court',(raw:any)=>{raw.bookingSessions[0].spaceId='other';}],
    ['wrong session hours',(raw:any)=>{raw.bookingSessions[1].startTime='19:00:00';}],
    ['wrong session ref',(raw:any)=>{raw.bookingSessions[1].requestSessionRef='session_2';}],
    ['cross-linked bookings',(raw:any)=>{raw.bookingSessions[0].bookingIds=['booking-1'];}],
    ['duplicate session',(raw:any)=>{raw.bookingSessions[1].bookingSessionId=raw.bookingSessions[0].bookingSessionId;}],
    ['missing session',(raw:any)=>{raw.bookingSessions.pop();}],
    ['wrong booking time',(raw:any)=>{raw.bookings[1].start_time='19:00:00';}],
    ['mixed customers',(raw:any)=>{raw.bookings[1].customer_id='other-customer';}],
    ['expired hourly booking',(raw:any)=>{raw.bookings[1].hold_expires_at='2026-10-22T00:00:00Z';}],
    ['duplicate booking id',(raw:any)=>{raw.bookings[1].id=raw.bookings[0].id;}],
  ])('rejects hourly response: %s',(_label,mutate)=>{
    const raw=response();mutate(raw);
    expect(()=>validatePublicCheckoutResponse(raw,request as unknown as PublicCheckoutRequest,plan,now)).toThrow();
  });
});
