import {describe,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableSubmissionJournal} from '../../src/api-booking/durable-submission-journal.js';
import {SubmissionDispatchError} from '../../src/api-booking/submission-errors.js';
import type {OndaBrowserSessionTransport} from '../../src/api-booking/browser-session-transport.js';
import {DIRECT_ASSUMED_DAY_RATE,DIRECT_ASSUMED_EVENING_RATE,DIRECT_MAX_DISPATCH_LATENESS_MS,assertDirectDispatchWindow,prooflessCourtHourStatuses,prooflessReleasePlan,prooflessRequest,resolveProoflessReleasePlan,submitDirectCheckout} from '../../src/api-booking/proofless-checkout.js';
import {availabilityFixture} from '../availability-fixture.js';
import {parseAvailability} from '../../src/api-booking/availability-parser.js';
import {UiEventSchema} from '../../src/ui-events.js';

const date='2026-09-25';
/** A pending hold always expires in the future: the verifier rejects an already-expired hold. */
const holdExpiresAt=new Date(Date.now()+10*60_000).toISOString();
const customer={clientId:'client',customerId:'customer',customerEmail:'e@example.invalid',customerPhone:'09123456789',customerFirstName:'Fixture',customerLastName:'Player'};
const liveSnapshot=()=>parseAvailability(availabilityFixture(date),{startDate:date,endDate:date,
  capturedAt:'2026-09-23T00:00:00.000Z',fixtureKind:'synthetic',label:'direct',now:new Date('2026-09-23T00:00:00.000Z'),maximumAgeMs:1000});
/** One-court evening proofless plan, e.g. court 5 17:00-20:00. */
const eveningPlan=(start:string,hours:number)=>prooflessReleasePlan({mode:'standard',targetDate:date,durationHours:hours,
  preferredStartTimes:[start],fallbackStartTimes:[],courtPriority:[5],fallbackCourts:[],courtCount:1,maximumTotalPrice:Infinity,currency:'PHP'});

describe('Proofless checkout lane',()=>{
  it('permits dispatch only at the release boundary, never early or substantially late',()=>{
    const release=Date.parse('2026-09-23T00:00:00.000Z');
    expect(()=>assertDirectDispatchWindow(release,release-1)).toThrow('DIRECT_RELEASE_WINDOW_MISSED');
    expect(()=>assertDirectDispatchWindow(release,release)).not.toThrow();
    expect(()=>assertDirectDispatchWindow(release,release+DIRECT_MAX_DISPATCH_LATENESS_MS)).not.toThrow();
    expect(()=>assertDirectDispatchWindow(release,release+DIRECT_MAX_DISPATCH_LATENESS_MS+1)).toThrow('DIRECT_RELEASE_WINDOW_MISSED');
  });
  it('keeps an assumed proofless total distinct from an observed price in UI telemetry',()=>{
    const event=UiEventSchema.parse({type:'apiStage',stage:'PRIMARY_PROOFLESS_PLAN_READY',elapsedMs:1,
      court:5,assumedPrice:3500});
    expect(event).toHaveProperty('assumedPrice',3500);
    expect(event).not.toHaveProperty('price');
  });
  it('builds exact evening chunks at the assumed rate without inventing proofs',()=>{
    const early=eveningPlan('17:00',3),late=eveningPlan('20:00',2);
    expect([early.startTime,early.endTime,late.startTime,late.endTime]).toEqual(['17:00','20:00','20:00','22:00']);
    expect([early.totalPrice,late.totalPrice]).toEqual([3*DIRECT_ASSUMED_EVENING_RATE,2*DIRECT_ASSUMED_EVENING_RATE]);
    expect(prooflessRequest(early,customer).items.map(item=>item.availabilityProof)).toEqual([null,null,null]);
  });
  it('builds a deterministic primary release plan before target availability exists',()=>{
    const plan=prooflessReleasePlan({mode:'extended',targetDate:date,durationHours:5,preferredStartTimes:['15:00'],
      fallbackStartTimes:[],courtPriority:[7,6,5,4,3,2,1],fallbackCourts:[],courtCount:2,
      maximumTotalPrice:7_000,currency:'PHP'});
    expect(plan.chunks.map(chunk=>[chunk.startTime,chunk.endTime,chunk.courts.map(court=>court.court)])).toEqual([
      ['15:00','18:00',[7,6]],['18:00','20:00',[7,6]],
    ]);
    expect(plan.totalPrice).toBe(2*(DIRECT_ASSUMED_DAY_RATE+4*DIRECT_ASSUMED_EVENING_RATE));
    const checkouts=plan.chunks.map(chunk=>({mode:'standard' as const,targetDate:plan.targetDate,startTime:chunk.startTime,
      endTime:chunk.endTime,durationHours:chunk.durationHours,courts:chunk.courts,chunks:[chunk],totalPrice:chunk.totalPrice,currency:'PHP'}));
    expect(checkouts.flatMap(chunk=>prooflessRequest(chunk,customer).items).every(item=>item.availabilityProof===null)).toBe(true);
    expect(checkouts.map(chunk=>new Set(prooflessRequest(chunk,customer).items.map(item=>item.sessionRef)).size)).toEqual([2,2]);
  });
  it('rejects a saved maximum below the assumed direct total before dispatch',()=>{
    expect(()=>prooflessReleasePlan({mode:'standard',targetDate:date,durationHours:3,preferredStartTimes:['08:00'],
      fallbackStartTimes:[],courtPriority:[1],fallbackCourts:[],courtCount:1,maximumTotalPrice:1_799,currency:'PHP'}))
      .toThrow('DIRECT_PRICE_LIMIT_EXCEEDED');
  });
  it('logs an exact 112-cell status matrix without treating missing unreleased cells as open',()=>{
    const snapshot=liveSnapshot();
    snapshot.returnedDates[date]=false;snapshot.slots=[];
    const statuses=prooflessCourtHourStatuses(snapshot,date);
    expect(statuses).toHaveLength(112);
    expect(new Set(statuses.map(value=>value.status))).toEqual(new Set(['UNRELEASED']));
    expect(statuses[0]).toEqual({court:1,hour:'08:00',status:'UNRELEASED',source:'DATE_UNRELEASED'});
    expect(statuses.at(-1)).toEqual({court:7,hour:'23:00',status:'UNRELEASED',source:'DATE_UNRELEASED'});
  });
  it('overlays confirmed public booking records on an unreleased schedule',()=>{
    const snapshot=liveSnapshot();snapshot.returnedDates[date]=false;snapshot.slots=[];
    const statuses=prooflessCourtHourStatuses(snapshot,date,[{court:6,startTime:'17:30',endTime:'20:30'},{court:7,startTime:'19:00',endTime:'23:00'}]);
    expect(statuses.filter(value=>value.status==='BLOCKED').map(value=>[value.court,value.hour,value.source])).toEqual([
      [6,'17:00','PUBLIC_BOOKING'],[6,'18:00','PUBLIC_BOOKING'],[6,'19:00','PUBLIC_BOOKING'],[6,'20:00','PUBLIC_BOOKING'],
      [7,'19:00','PUBLIC_BOOKING'],[7,'20:00','PUBLIC_BOOKING'],[7,'21:00','PUBLIC_BOOKING'],[7,'22:00','PUBLIC_BOOKING'],
    ]);
    expect(statuses.find(value=>value.court===6&&value.hour==='16:00')).toMatchObject({status:'UNRELEASED',source:'DATE_UNRELEASED'});
  });
  it('uses the first saved fallback not explicitly blocked by the pre-release API audit',()=>{
    const snapshot=liveSnapshot();
    for(const slot of snapshot.slots)if(slot.court===7&&['08:00','09:00','10:00'].includes(slot.startTime))slot.isAvailable=false;
    const plan=resolveProoflessReleasePlan({mode:'standard',targetDate:date,durationHours:3,preferredStartTimes:['08:00'],fallbackStartTimes:['11:00'],
      courtPriority:[7,6,5,4,3,2,1],fallbackCourts:[],courtCount:2,maximumTotalPrice:Infinity,currency:'PHP'},snapshot);
    expect(plan.startTime).toBe('08:00');
    expect(plan.courts.map(court=>court.court)).toEqual([6,5]);
  });
  it('uses a fallback when advance public booking records block the preferred court',()=>{
    const snapshot=liveSnapshot();snapshot.returnedDates[date]=false;snapshot.slots=[];
    const plan=resolveProoflessReleasePlan({mode:'standard',targetDate:date,durationHours:3,preferredStartTimes:['17:00'],fallbackStartTimes:[],
      courtPriority:[7,6,5,4,3,2,1],fallbackCourts:[],courtCount:2,maximumTotalPrice:Infinity,currency:'PHP'},snapshot,
    [{court:7,startTime:'17:00',endTime:'20:00'}]);
    expect(plan.courts.map(court=>court.court)).toEqual([6,5]);
  });
  it('allows conclusive rejection but retains uncertain submissions without retry',async()=>{
    for(const [error,state] of [[new SubmissionDispatchError('DATE_NOT_AVAILABLE',true,undefined,true),'rejected'],
      [new SubmissionDispatchError('ONDA_TRANSPORT_FAILED',true),'unknown']] as const){
      const root=await mkdtemp(join(tmpdir(),'direct-checkout-test-'));
      try{
        const plan=eveningPlan('17:00',3),journal=new DurableSubmissionJournal(join(root,'journal'));
        const transport={publicCheckoutProofless:async()=>{throw error;}} as unknown as OndaBrowserSessionTransport;
        await expect(submitDirectCheckout(plan,customer,transport,journal)).rejects.toThrow();
        const key=DurableSubmissionJournal.key('5f8786bd-dc61-4509-b893-74cda8f783f7',plan.courts[0]!.spaceId,date,'17:00','20:00');
        expect((await journal.read(key)).state).toBe(state);
        await expect(submitDirectCheckout(plan,customer,transport,journal)).rejects.toThrow('DUPLICATE_LOGICAL_BOOKING_BLOCKED');
      }finally{await rm(root,{recursive:true,force:true});}
    }
  });
  it('rechecks an adaptive final guard after durable claim and before the POST',async()=>{
    const root=await mkdtemp(join(tmpdir(),'adaptive-final-guard-'));
    try{
      const plan=eveningPlan('17:00',3),journal=new DurableSubmissionJournal(join(root,'journal'));
      let sent=0,guarded=0;
      const transport={publicCheckoutProofless:async(_request:unknown,_permit:unknown,options:{beforePost?:()=>void})=>{
        options.beforePost?.();sent++;throw Error('POST_MUST_NOT_RUN');}} as unknown as OndaBrowserSessionTransport;
      await expect(submitDirectCheckout(plan,customer,transport,journal,undefined,[],Date.now,
        {requirePreparedContext:true,beforePost:()=>{if(++guarded===2)throw new SubmissionDispatchError('PHASE3_DISPATCH_GUARD_CLOSED',false);}}))
        .rejects.toThrow('PHASE3_DISPATCH_GUARD_CLOSED');
      const key=DurableSubmissionJournal.key('5f8786bd-dc61-4509-b893-74cda8f783f7',plan.courts[0]!.spaceId,date,'17:00','20:00');
      expect({sent,guarded,state:(await journal.read(key)).state}).toEqual({sent:0,guarded:2,state:'rejected'});
      expect(await journal.recycleReusable(key)).toBe('reused');
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it('verifies an exact pending hold and keeps an amount mismatch unknown',async()=>{
    for(const mismatch of [false,true]){
      const root=await mkdtemp(join(tmpdir(),'direct-response-test-'));
      try{
        const plan=eveningPlan('20:00',2),journal=new DurableSubmissionJournal(join(root,'journal'));
        const request=prooflessRequest(plan,customer),ids=request.items.map((_,index)=>`booking-${index}`);
        const response={success:true,bookings:request.items.map((item,index)=>({id:ids[index],booking_no:`number-${index}`,
          customer_id:customer.customerId,space_id:item.spaceId,facility_id:item.facilityId,date:item.date,
          start_time:`${item.startTime}:00`,end_time:`${item.endTime}:00`,duration:60,rate:item.rate,
          guest_count:1,booking_status:'pending',payment_status:'pending',booking_session_id:'session',
          hold_expires_at:holdExpiresAt})),
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
  it('verifies a two-court proofless hold and marks every court journal',async()=>{
    const root=await mkdtemp(join(tmpdir(),'direct-multicourt-test-'));
    try{
      const plan=prooflessReleasePlan({mode:'standard',targetDate:date,durationHours:3,preferredStartTimes:['08:00'],
        fallbackStartTimes:[],courtPriority:[1,2],fallbackCourts:[],courtCount:2,maximumTotalPrice:3_600,currency:'PHP'});
      const request=prooflessRequest(plan,customer),ids=request.items.map((_,index)=>`booking-${index}`);
      const sessionRefs=['session_1','session_2'] as const;
      const response={success:true,bookings:request.items.map((item,index)=>({id:ids[index],booking_no:`number-${index}`,
        customer_id:customer.customerId,space_id:item.spaceId,facility_id:item.facilityId,date:item.date,
        start_time:`${item.startTime}:00`,end_time:`${item.endTime}:00`,duration:60,rate:item.rate,guest_count:1,
        booking_status:'pending',payment_status:'pending',booking_session_id:`session-${item.sessionRef}`,
        hold_expires_at:holdExpiresAt})),
        bookingSessions:sessionRefs.map(ref=>{const items=request.items.map((item,index)=>({item,index})).filter(entry=>entry.item.sessionRef===ref);
          return {requestSessionRef:ref,bookingSessionId:`session-${ref}`,facilityId:request.facilityId,
            spaceId:items[0]!.item.spaceId,date,startTime:'08:00:00',endTime:'11:00:00',durationHours:3,
            bookingIds:items.map(entry=>ids[entry.index])};}),
        transaction:{id:'transaction',reference:'number-0',amount:plan.totalPrice,status:'pending'},trustedTotalAmount:plan.totalPrice};
      const transport={publicCheckoutProofless:async()=>response} as unknown as OndaBrowserSessionTransport;
      const journals=[new DurableSubmissionJournal(join(root,'one')),new DurableSubmissionJournal(join(root,'two'))];
      await expect(submitDirectCheckout(plan,customer,transport,journals[0]!,undefined,journals.slice(1)))
        .resolves.toMatchObject({bookingIds:ids,trustedTotalAmount:plan.totalPrice});
      const keys=plan.courts.map(court=>DurableSubmissionJournal.key('5f8786bd-dc61-4509-b893-74cda8f783f7',court.spaceId,date,'08:00','11:00'));
      expect(await Promise.all(journals.map((journal,index)=>journal.read(keys[index]!).then(record=>record.state))))
        .toEqual(['verified','verified']);
    }finally{await rm(root,{recursive:true,force:true});}
  });
});
