import {describe,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableSubmissionJournal} from '../../src/api-booking/durable-submission-journal.js';
import {SubmissionDispatchError} from '../../src/api-booking/submission-errors.js';
import type {OndaBrowserSessionTransport} from '../../src/api-booking/browser-session-transport.js';
import {DIRECT_ASSUMED_EVENING_RATE,DIRECT_MAX_DISPATCH_LATENESS_MS,assertDirectDispatchWindow,chooseDirectCourt,directPlan,prooflessRequest,submitDirectCheckout} from '../../src/api-booking/special-direct-checkout.js';
import {SPECIAL_SESSION_WORKERS,specialSessionPlans} from '../../src/api-booking/special-session.js';
import {availabilityFixture} from '../availability-fixture.js';
import {parseAvailability} from '../../src/api-booking/availability-parser.js';
import {UiEventSchema} from '../../src/ui-events.js';

const date='2026-09-25';
const customer={clientId:'client',customerId:'customer',customerEmail:'e@example.invalid',customerPhone:'09123456789',customerFirstName:'Fixture',customerLastName:'Player'};
const liveSnapshot=()=>parseAvailability(availabilityFixture(date),{startDate:date,endDate:date,
  capturedAt:'2026-09-23T00:00:00.000Z',fixtureKind:'synthetic',label:'direct',now:new Date('2026-09-23T00:00:00.000Z'),maximumAgeMs:1000});

describe('Special Friday proofless lane',()=>{
  it('permits dispatch only at the release boundary, never early or substantially late',()=>{
    const release=Date.parse('2026-09-23T00:00:00.000Z');
    expect(()=>assertDirectDispatchWindow(release,release-1)).toThrow('DIRECT_RELEASE_WINDOW_MISSED');
    expect(()=>assertDirectDispatchWindow(release,release)).not.toThrow();
    expect(()=>assertDirectDispatchWindow(release,release+DIRECT_MAX_DISPATCH_LATENESS_MS)).not.toThrow();
    expect(()=>assertDirectDispatchWindow(release,release+DIRECT_MAX_DISPATCH_LATENESS_MS+1)).toThrow('DIRECT_RELEASE_WINDOW_MISSED');
  });
  it('keeps unverified rate distinct from an observed price in UI telemetry',()=>{
    const event=UiEventSchema.parse({type:'apiStage',stage:'DIRECT_LANE_PREPARED',elapsedMs:1,
      court:5,rateSource:'UNVERIFIED_PRIOR_RATE',assumedPrice:3500});
    expect(event).toHaveProperty('assumedPrice',3500);
    expect(event).not.toHaveProperty('price');
  });
  it('builds the two exact third-court chunks without inventing proofs',()=>{
    const e=directPlan(date,5,'E'),f=directPlan(date,5,'F');
    expect([e.plan.startTime,e.plan.endTime,f.plan.startTime,f.plan.endTime]).toEqual(['17:00','20:00','20:00','22:00']);
    expect([e.plan.totalPrice,f.plan.totalPrice]).toEqual([3*DIRECT_ASSUMED_EVENING_RATE,2*DIRECT_ASSUMED_EVENING_RATE]);
    expect(e.rateSource).toBe('UNVERIFIED_PRIOR_RATE');
    expect(prooflessRequest(e.plan,customer).items.map(item=>item.availabilityProof)).toEqual([null,null,null]);
  });
  it('gives the direct court priority over normal fallback assignment',()=>{
    const snapshot=liveSnapshot();
    for(const slot of snapshot.slots)if(slot.court===6||slot.court===7)slot.isAvailable=false;
    expect(chooseDirectCourt(snapshot)).toBe(5);
    const normal=specialSessionPlans(snapshot,SPECIAL_SESSION_WORKERS,undefined,[5])!;
    expect([...normal.values()].map(plan=>plan.courts[0]!.court)).toEqual([4,4,3,3]);
  });
  it('uses the next court when the public calendar already shows a block',()=>{
    expect(chooseDirectCourt(undefined,[5,4])).toBe(3);
    expect(chooseDirectCourt(undefined,[5,4,3,2,1])).toBeUndefined();
  });
  it('allows conclusive rejection but retains uncertain submissions without retry',async()=>{
    for(const [error,state] of [[new SubmissionDispatchError('DATE_NOT_AVAILABLE',true,undefined,true),'rejected'],
      [new SubmissionDispatchError('ONDA_TRANSPORT_FAILED',true),'unknown']] as const){
      const root=await mkdtemp(join(tmpdir(),'direct-checkout-test-'));
      try{
        const plan=directPlan(date,5,'E').plan,journal=new DurableSubmissionJournal(join(root,'journal'));
        const transport={publicCheckoutProofless:async()=>{throw error;}} as unknown as OndaBrowserSessionTransport;
        await expect(submitDirectCheckout(plan,customer,transport,journal)).rejects.toThrow();
        const key=DurableSubmissionJournal.key('5f8786bd-dc61-4509-b893-74cda8f783f7',plan.courts[0]!.spaceId,date,'17:00','20:00');
        expect((await journal.read(key)).state).toBe(state);
        await expect(submitDirectCheckout(plan,customer,transport,journal)).rejects.toThrow('DUPLICATE_LOGICAL_BOOKING_BLOCKED');
      }finally{await rm(root,{recursive:true,force:true});}
    }
  });
  it('verifies an exact pending hold and keeps an amount mismatch unknown',async()=>{
    for(const mismatch of [false,true]){
      const root=await mkdtemp(join(tmpdir(),'direct-response-test-'));
      try{
        const plan=directPlan(date,5,'F').plan,journal=new DurableSubmissionJournal(join(root,'journal'));
        const request=prooflessRequest(plan,customer),ids=request.items.map((_,index)=>`booking-${index}`);
        const response={success:true,bookings:request.items.map((item,index)=>({id:ids[index],booking_no:`number-${index}`,
          customer_id:customer.customerId,space_id:item.spaceId,facility_id:item.facilityId,date:item.date,
          start_time:`${item.startTime}:00`,end_time:`${item.endTime}:00`,duration:60,rate:item.rate,
          guest_count:1,booking_status:'pending',payment_status:'pending',booking_session_id:'session',
          hold_expires_at:'2026-09-25T02:05:00.000Z'})),
          bookingSessions:[{requestSessionRef:'session_1',bookingSessionId:'session',facilityId:request.facilityId,
            spaceId:request.items[0]!.spaceId,date,startTime:'20:00:00',endTime:'22:00:00',durationHours:2,bookingIds:ids}],
          transaction:{id:'transaction',reference:'number-0',amount:plan.totalPrice+(mismatch?100:0),status:'pending'},
          trustedTotalAmount:plan.totalPrice};
        const transport={publicCheckoutProofless:async()=>response} as unknown as OndaBrowserSessionTransport;
        if(mismatch)await expect(submitDirectCheckout(plan,customer,transport,journal)).rejects.toThrow('SUBMISSION_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED');
        else await expect(submitDirectCheckout(plan,customer,transport,journal)).resolves.toMatchObject({bookingIds:ids,trustedTotalAmount:plan.totalPrice});
        const key=DurableSubmissionJournal.key(request.facilityId,plan.courts[0]!.spaceId,date,'20:00','22:00');
        expect((await journal.read(key)).state).toBe(mismatch?'unknown':'verified');
      }finally{await rm(root,{recursive:true,force:true});}
    }
  });
});
