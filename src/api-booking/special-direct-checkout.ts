import { createHash } from 'node:crypto';
import { COURT_TO_SPACE_ID } from './availability-parser.js';
import { THIRSTY_PICKLE_FACILITY_ID } from './live-availability-provider.js';
import type { AvailabilitySnapshot, BookingPlan, AvailabilitySlot } from './types.js';
import { observedResponse, type CheckoutCustomer, type TwoHourCheckoutRequest } from './two-hour-reservation.js';
import type { PublicCheckoutRequest, VerifiedPublicCheckout } from './public-checkout.js';
import { validatePublicCheckoutResponse } from './public-checkout.js';
import type { OndaBrowserSessionTransport } from './browser-session-transport.js';
import { DurableSubmissionJournal } from './durable-submission-journal.js';
import { SubmissionDispatchError } from './submission-errors.js';

export const DIRECT_COURT_PRIORITY=[5,4,3,2,1] as const;
export const DIRECT_ASSUMED_EVENING_RATE=700;
export const DIRECT_MAX_DISPATCH_LATENESS_MS=1_000;
export const DIRECT_BLOCKS=[
  {workerId:'E',startTime:'17:00',endTime:'20:00',durationHours:3},
  {workerId:'F',startTime:'20:00',endTime:'22:00',durationHours:2},
] as const;
export type ProoflessCheckoutRequest=Omit<TwoHourCheckoutRequest,'items'>&{
  items:Array<Omit<TwoHourCheckoutRequest['items'][number],'availabilityProof'>&{availabilityProof:null}>;
};

export function assertDirectDispatchWindow(releaseMs:number,now=Date.now()):void{
  if(!Number.isSafeInteger(releaseMs)||releaseMs<=0||!Number.isFinite(now)||now<releaseMs||
    now-releaseMs>DIRECT_MAX_DISPATCH_LATENESS_MS)throw Error('DIRECT_RELEASE_WINDOW_MISSED');
}

export function chooseDirectCourt(snapshot?:AvailabilitySnapshot,blockedCourts:readonly number[]=[]):number|undefined{
  if(!snapshot||snapshot.returnedDates[snapshot.requestedDates[0]!]!==true)
    return DIRECT_COURT_PRIORITY.find(court=>!blockedCourts.includes(court));
  const date=snapshot.requestedDates[0]!;
  return DIRECT_COURT_PRIORITY.find(court=>!blockedCourts.includes(court)&&Array.from({length:5},(_,index)=>`${17+index}:00`).every(hour=>
    snapshot.slots.some(slot=>slot.court===court&&slot.date===date&&slot.startTime===hour&&slot.isAvailable&&slot.currency==='PHP')));
}

export function directPlan(date:string,court:number,workerId:'E'|'F',snapshot?:AvailabilitySnapshot):{plan:BookingPlan;rateSource:'FRIDAY_AVAILABILITY'|'UNVERIFIED_PRIOR_RATE'}{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!DIRECT_COURT_PRIORITY.includes(court as typeof DIRECT_COURT_PRIORITY[number]))throw Error('DIRECT_TARGET_INVALID');
  const block=DIRECT_BLOCKS.find(value=>value.workerId===workerId)!;
  const spaceId=COURT_TO_SPACE_ID[court as keyof typeof COURT_TO_SPACE_ID];
  const released=snapshot?.returnedDates[date]===true;
  const slots:AvailabilitySlot[]=Array.from({length:block.durationHours},(_,index)=>{
    const startTime=`${Number(block.startTime.slice(0,2))+index}:00`,endTime=`${Number(startTime.slice(0,2))+1}:00`;
    const observed=released?snapshot!.slots.find(slot=>slot.court===court&&slot.date===date&&slot.startTime===startTime&&slot.isAvailable&&slot.currency==='PHP'):undefined;
    if(released&&!observed)throw Error('DIRECT_SLOT_NOT_AVAILABLE');
    return observed??{court,spaceId,date,bookingDate:date,startTime,endTime,isAvailable:true,isNightRate:true,isNextDay:false,currency:'PHP',price:DIRECT_ASSUMED_EVENING_RATE};
  });
  const price=slots.reduce((sum,slot)=>sum+slot.price,0);
  const plannedCourt={court,spaceId,date,startTime:block.startTime,endTime:block.endTime,durationMinutes:block.durationHours*60,price,currency:'PHP',slots};
  const chunk={startTime:block.startTime,endTime:block.endTime,durationHours:block.durationHours,courts:[plannedCourt],totalPrice:price};
  return {plan:{mode:'standard',targetDate:date,startTime:block.startTime,endTime:block.endTime,durationHours:block.durationHours,courts:[plannedCourt],chunks:[chunk],totalPrice:price,currency:'PHP'},
    rateSource:released?'FRIDAY_AVAILABILITY':'UNVERIFIED_PRIOR_RATE'};
}

export function prooflessRequest(plan:BookingPlan,customer:CheckoutCustomer):ProoflessCheckoutRequest{
  if(plan.mode!=='standard'||plan.courts.length!==1||plan.chunks.length!==1||plan.courts[0]!.slots.length!==plan.durationHours)throw Error('DIRECT_PLAN_INVALID');
  const court=plan.courts[0]!;
  if(plan.totalPrice!==court.slots.reduce((sum,slot)=>sum+slot.price,0))throw Error('DIRECT_PRICE_INVALID');
  return {clientId:customer.clientId,customerId:customer.customerId,customerEmail:customer.customerEmail,
    customerPhone:customer.customerPhone,customerFirstName:null,customerLastName:null,facilityId:THIRSTY_PICKLE_FACILITY_ID,
    bookingType:'online',usedCustomerMembershipId:null,userId:null,
    items:court.slots.map(slot=>({sessionRef:'session_1',facilityId:THIRSTY_PICKLE_FACILITY_ID,
      spaceId:slot.spaceId,date:slot.date,startTime:slot.startTime,endTime:slot.endTime,duration:60,
      rate:slot.price,chargedAmount:slot.price,guestCount:1,activityKey:null,activityLabel:null,promotionId:null,availabilityProof:null}))};
}

export async function submitDirectCheckout(plan:BookingPlan,customer:CheckoutCustomer,transport:OndaBrowserSessionTransport,
  journal:DurableSubmissionJournal,releaseMs?:number):Promise<VerifiedPublicCheckout>{
  const request=prooflessRequest(plan,customer),court=plan.courts[0]!;
  const key=DurableSubmissionJournal.key(THIRSTY_PICKLE_FACILITY_ID,court.spaceId,plan.targetDate,plan.startTime,plan.endTime);
  const fingerprint=createHash('sha256').update(JSON.stringify({court:court.court,date:plan.targetDate,start:plan.startTime,end:plan.endTime,price:plan.totalPrice,method:'direct-proofless'})).digest('hex');
  await journal.begin(key,new Date(),{attemptId:key,planFingerprint:fingerprint,targetDate:plan.targetDate,courtIds:[court.court],
    hourlyBoundaries:court.slots.map(slot=>({startTime:slot.startTime,endTime:slot.endTime})),
    expectedBookingCount:request.items.length,maximumAmount:plan.totalPrice,stage:'dispatching'});
  let permit;
  try{permit=await journal.claimSupervisedOneShot(key);}catch(error){await journal.mark(key,'rejected');throw error;}
  try{
    if(releaseMs!==undefined){try{assertDirectDispatchWindow(releaseMs);}catch{throw new SubmissionDispatchError('DIRECT_RELEASE_WINDOW_MISSED',false);}}
    const raw=await transport.publicCheckoutProofless(request,permit);
    // Response validation compares booking identities, amounts, dates and sessions; it does not inspect proof strings.
    let verified:VerifiedPublicCheckout;
    try{verified=validatePublicCheckoutResponse(raw,request as unknown as PublicCheckoutRequest,plan,new Date(),plan.totalPrice);}
    catch{await journal.mark(key,'unknown',new Date(),undefined,observedResponse(raw,'DIRECT_RESPONSE_VALIDATION_FAILED'),'DIRECT_RESPONSE_VALIDATION_FAILED');throw Error('SUBMISSION_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED');}
    await journal.mark(key,'verified',new Date(),undefined,observedResponse(raw,'CHECKOUT_RESPONSE_VERIFIED'));
    return verified;
  }catch(error){
    const dispatched=!(error instanceof SubmissionDispatchError)||error.dispatched;
    const rejected=error instanceof SubmissionDispatchError&&error.confirmedRejected;
    if(error instanceof Error&&error.message==='SUBMISSION_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED')throw error;
    await journal.mark(key,dispatched&&!rejected?'unknown':'rejected',new Date(),error instanceof SubmissionDispatchError?error.diagnostic:undefined,
      undefined,error instanceof SubmissionDispatchError?error.code:'DIRECT_CHECKOUT_FAILED').catch(()=>undefined);
    if(dispatched&&!rejected)throw Error('SUBMISSION_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED');
    throw error;
  }
}
