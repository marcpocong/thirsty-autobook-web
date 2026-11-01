import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {vi} from 'vitest';
import {prooflessReleasePlan,prooflessRequest,submitDirectCheckout} from '../../src/api-booking/proofless-checkout.js';
import {DurableSubmissionJournal} from '../../src/api-booking/durable-submission-journal.js';
import {saveCheckoutRecovery} from '../../src/api-booking/checkout-recovery.js';
import type {CheckoutHttpResponse,OndaBrowserSessionTransport} from '../../src/api-booking/browser-session-transport.js';
import type {WorkerId} from '../../src/workers.js';
import type {RecoveryPage,RecoveryIdentity} from '../../src/api-booking/pending-hold-recovery.js';

export const fixtureNow=new Date('2026-11-01T01:00:00Z');
export const fixtureCustomer={clientId:'client',customerId:'configured-customer',customerEmail:'fixture@example.invalid',customerPhone:'09123456789',customerFirstName:'Synthetic',customerLastName:'Guest'};
export async function pendingFixture(root:string,worker:WorkerId='A',court=7,legacy=false,tokenMode?:'missing'|'invalid'){
  const plan=prooflessReleasePlan({mode:'standard',targetDate:'2026-11-03',durationHours:3,preferredStartTimes:['08:00'],fallbackStartTimes:[],
    courtPriority:[court],fallbackCourts:[],courtCount:1,maximumTotalPrice:1800,currency:'PHP'});
  const request=prooflessRequest(plan,fixtureCustomer),expiry=new Date(fixtureNow.getTime()+600_000).toISOString();
  const raw={success:true,bookings:request.items.map((item,index)=>({id:`booking-${court}-${index}`,booking_no:`number-${court}-${index}`,customer_id:'resolved-customer',
    facility_id:item.facilityId,space_id:item.spaceId,date:item.date,start_time:item.startTime,end_time:item.endTime,duration:60,rate:item.rate,guest_count:1,
    booking_status:'pending',payment_status:'pending',booking_session_id:`session-${index}`,hold_expires_at:expiry,checkoutToken:`PRIVATE-${worker}-${index}`})),
    bookingSessions:request.items.map((item,index)=>({requestSessionRef:item.sessionRef,bookingSessionId:`session-${index}`,facilityId:item.facilityId,spaceId:item.spaceId,
      date:item.date,startTime:item.startTime,endTime:item.endTime,durationHours:1,bookingIds:[`booking-${court}-${index}`]})),
    transaction:{id:`transaction-${worker}`,reference:`number-${court}-0`,amount:1800,status:'pending'},trustedTotalAmount:1800};
  if(tokenMode)for(const b of raw.bookings)b.checkoutToken=tokenMode==='missing'?'':'unsafe\ntoken';
  const key=DurableSubmissionJournal.key(request.facilityId,plan.courts[0]!.spaceId,plan.targetDate,plan.startTime,plan.endTime);
  const directory=join(root,'.local/api-booking/api-first-journals',key);await mkdir(directory,{recursive:true});
  const identity:RecoveryIdentity={workerId:worker,customer:fixtureCustomer,profile:`dedicated-${worker}`,assertContext:vi.fn(async()=>{})};
  let submissions=0;
  const transport={publicCheckoutProofless:async()=>{submissions++;await saveCheckoutRecovery(directory,{status:200,body:JSON.stringify(raw)} as CheckoutHttpResponse,plan,worker,fixtureNow,
    legacy?undefined:{customer:identity.customer,profile:identity.profile});return raw;}} as unknown as OndaBrowserSessionTransport;
  await submitDirectCheckout(plan,fixtureCustomer,transport,new DurableSubmissionJournal(directory),undefined,[],()=>fixtureNow.getTime());
  const journalPath=join(directory,`${key}.json`),journalBefore=await readFile(journalPath,'utf8');
  const provider={success:true,data:{id:raw.bookings[0]!.id,bookingNo:raw.bookings[0]!.booking_no,customerId:'resolved-customer',facilityId:request.facilityId,
    checkoutTotal:1800,bookingStatus:'pending',paymentStatus:'pending',canResumeCheckout:true,holdExpiresAt:expiry,
    customerEmail:fixtureCustomer.customerEmail,customerPhone:fixtureCustomer.customerPhone,customerFirstName:fixtureCustomer.customerFirstName,customerLastName:fixtureCustomer.customerLastName,
    groupBookings:raw.bookings.map(b=>({id:b.id,bookingNo:b.booking_no,customerId:b.customer_id,facilityId:b.facility_id,spaceId:b.space_id,date:b.date,
      startTime:b.start_time,endTime:b.end_time,rate:b.rate,holdExpiresAt:b.hold_expires_at,bookingStatus:b.booking_status,paymentStatus:b.payment_status,bookingSessionId:b.booking_session_id}))}};
  const body=`November 3, 2026\n8:00 AM - 9:00 AM\nCourt ${court}: Mango Wing\n9:00 AM - 10:00 AM\nCourt ${court}: Mango Wing\n10:00 AM - 11:00 AM\nCourt ${court}: Mango Wing\nPending\nQRPH\nTotal\n1,800.00`;
  return {root,worker,plan,raw,key,directory,identity,journalPath,journalBefore,provider,body,expiry,submissions:()=>submissions};
}
export function fakeRecoveryPage(f:Awaited<ReturnType<typeof pendingFixture>>){
  let url='https://app.onda.fit/book/thirsty-pickle';
  const element={waitFor:vi.fn(async()=>{}),evaluate:vi.fn(async()=>true)};
  const page={url:()=>url,route:vi.fn(async()=>{}),unroute:vi.fn(async()=>{}),bringToFront:vi.fn(async()=>{}),
    evaluate:vi.fn(async(_code:unknown,args:{kind:string}):Promise<{status:number;body:unknown;retryAfterMs:number|null}>=>({status:200,body:args.kind==='ACCESS'?{success:true}:structuredClone(f.provider),retryAfterMs:null})),
    goto:vi.fn(async(u:string):Promise<void>=>{url=u;}),getByText:vi.fn(()=>({first:()=>element})),
    locator:vi.fn(()=>({innerText:vi.fn(async()=>f.body),filter:()=>({first:()=>element})}))};
  return {page:page as unknown as RecoveryPage,mocks:page,element,setUrl:(u:string)=>url=u};
}
