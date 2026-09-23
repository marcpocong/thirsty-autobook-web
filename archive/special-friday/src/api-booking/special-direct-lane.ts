// ARCHIVED with the Special Friday session. Extracted unchanged from the former
// src/api-booking/special-direct-checkout.ts; the shared proofless helpers it
// used now live in src/api-booking/proofless-checkout.ts.
import { COURT_TO_SPACE_ID } from './availability-parser.js';
import type { AvailabilitySnapshot, BookingPlan, AvailabilitySlot } from './types.js';
import { DIRECT_ASSUMED_EVENING_RATE } from './proofless-checkout.js';

export const DIRECT_COURT_PRIORITY=[5,4,3,2,1] as const;
export const DIRECT_BLOCKS=[
  {workerId:'E',startTime:'17:00',endTime:'20:00',durationHours:3},
  {workerId:'F',startTime:'20:00',endTime:'22:00',durationHours:2},
] as const;

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
