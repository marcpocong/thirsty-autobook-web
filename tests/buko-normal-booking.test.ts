import { describe, expect, it } from 'vitest';
import { availabilityFixture } from './availability-fixture.js';
import { BUKO_SPACE_IDS, MANGO_SPACE_IDS, FACILITY_ID } from '../src/court-registry.js';
import { assertWingNormalRequest } from '../src/wing-normal-booking.js';
import { parseAvailability } from '../src/api-booking/availability-parser.js';
import { planBooking } from '../src/api-booking/booking-planner.js';
import { buildStandardPublicCheckoutRequest, validatePublicCheckoutResponse } from '../src/api-booking/public-checkout.js';
import { selectedStandardHours, standardPlanJournalKeys } from '../src/api-booking/two-hour-reservation.js';
import { DurableSubmissionJournal } from '../src/api-booking/durable-submission-journal.js';
import { standardCheckoutChunks } from '../src/api-booking/extended-checkout.js';
import { prooflessRequest, prooflessReleasePlan } from '../src/api-booking/proofless-checkout.js';
import { assertQrOrderSummary } from '../src/api-booking/qr-order-summary.js';
import { TestBookingSchema } from '../src/booking-plan.js';
import type { BookingPreferences } from '../src/api-booking/types.js';
import { expectedPreparationFingerprint } from '../src/prepared-context.js';
import { commandSpec } from '../ui/processes.js';

// Synthetic fixture matching the public shape observed in the authorized Buko
// UI checkout. No live proof, customer, booking ID or checkout token is retained.
const date='2026-10-14',now=new Date('2026-10-14T00:00:00Z');
const preferences:BookingPreferences={wing:'BUKO',mode:'standard',targetDate:date,durationHours:1,
  preferredStartTimes:['16:00'],fallbackStartTimes:[],courtPriority:[4],fallbackCourts:[],exactCourts:[[4]],courtCount:1,maximumTotalPrice:700,currency:'PHP'};
function fixture(){const raw=availabilityFixture(date);for(const [n,id] of Object.entries(BUKO_SPACE_IDS))raw.data.slotsBySpace[id]=structuredClone(raw.data.slotsBySpace[MANGO_SPACE_IDS[Number(n) as keyof typeof MANGO_SPACE_IDS]]!).map(s=>({...s,pricing:{...s.pricing,amount:700},isNightRate:true}));return raw;}
function snapshot(){return parseAvailability(fixture(),{wing:'BUKO',startDate:date,endDate:date,capturedAt:now.toISOString(),now,maximumAgeMs:15000,fixtureKind:'synthetic',label:'SYNTHETIC BUKO NORMAL'});}
function plan(){return planBooking(snapshot(),preferences);}
const customer={clientId:'synthetic-client',customerId:'synthetic-customer',customerFirstName:'Offline',customerLastName:'Guest',customerEmail:'offline@example.invalid',customerPhone:'09000000000'};
function request(){const p=plan();return buildStandardPublicCheckoutRequest(p,customer,FACILITY_ID,p.courts.flatMap(c=>c.slots.map(s=>({...s,availabilityProof:'SYNTHETIC_NOT_LIVE',requestedAt:now.toISOString(),receivedAt:now.toISOString()}))));}
function reply(){const r=request(),item=r.items[0]!;return {success:true,bookings:[{id:'synthetic-booking',booking_no:'synthetic-number',customer_id:'synthetic-canonical-customer',space_id:item.spaceId,date:item.date,start_time:'16:00:00',end_time:'17:00:00',duration:60,rate:700,guest_count:1,activity_key:'pickleball',activity_label_snapshot:'Pickleball',booking_status:'pending',payment_status:'pending',booking_session_id:'synthetic-session',hold_expires_at:'2026-10-14T00:10:00Z'}],transaction:{id:'synthetic-transaction',reference:'synthetic-number',amount:700,status:'pending'},trustedTotalAmount:700,bookingSessions:[{bookingSessionId:'synthetic-session',requestSessionRef:'session_1',facilityId:FACILITY_ID,spaceId:item.spaceId,date:item.date,startTime:'16:00:00',endTime:'17:00:00',durationHours:1,bookingIds:['synthetic-booking']}]};}
const normal={wing:'BUKO' as const,method:'api-first',mode:'live-now',strategy:'standard',courtCount:1,exact:[[4]],fallbackStarts:[]};
describe('exact Buko Normal authorization and provider identities',()=>{
  it('keeps wing identity through planning, checkout chunks, proofs and journals',()=>{
    const p=plan();expect(p.wing).toBe('BUKO');expect(p.courts[0]?.spaceId).toBe(BUKO_SPACE_IDS[4]);expect(standardCheckoutChunks(p)[0]?.wing).toBe('BUKO');
    expect(selectedStandardHours(p)[0]?.spaceId).toBe(BUKO_SPACE_IDS[4]);expect(standardPlanJournalKeys(p,FACILITY_ID)).not.toContain(DurableSubmissionJournal.key(FACILITY_ID,MANGO_SPACE_IDS[4],date,'16:00','17:00'));
    expect(request().items[0]).toMatchObject({spaceId:BUKO_SPACE_IDS[4],facilityId:FACILITY_ID,startTime:'16:00',endTime:'17:00',rate:700,chargedAmount:700,activityKey:'pickleball',activityLabel:'Pickleball'});
  });
  it('validates the exact accepted one-hour shape with canonical customer handling',()=>{
    expect(validatePublicCheckoutResponse(reply(),request(),plan(),now)).toMatchObject({bookingIds:['synthetic-booking'],trustedTotalAmount:700});
  });
  it.each(['court','date','price','paid','expired'])('fails closed on wrong %s in a successful response',kind=>{
    const raw=reply();if(kind==='court')raw.bookings[0]!.space_id=MANGO_SPACE_IDS[4];if(kind==='date')raw.bookings[0]!.date='2026-10-15';if(kind==='price')raw.bookings[0]!.rate=600;if(kind==='paid')raw.bookings[0]!.payment_status='paid';if(kind==='expired')raw.bookings[0]!.hold_expires_at='2026-10-13T23:00:00Z';
    expect(()=>validatePublicCheckoutResponse(raw,request(),plan(),now)).toThrow();
  });
  it('refuses a Buko snapshot without explicit Buko authorization and any Mango substitution',()=>{
    expect(()=>planBooking(snapshot(),{...preferences,wing:undefined})).toThrow('BOOKING_WING_NOT_ENABLED');
    const s=snapshot();s.slots[0]!.spaceId=MANGO_SPACE_IDS[1];expect(()=>planBooking(s,preferences)).toThrow('BOOKING_WING_IDENTITY_MISMATCH');
    expect(()=>selectedStandardHours({...plan(),wing:undefined})).toThrow('STANDARD_PLAN_INVALID');
  });
  it.each([{mode:'live'},{method:'proofless'},{strategy:'extended'},{courtCount:2},{exact:undefined},{fallbackStarts:['17:00']}])('refuses unsupported Buko scope %j',override=>{
    expect(()=>assertWingNormalRequest({...normal,...override})).toThrow('BUKO_EXACT_NORMAL_PLAN_REQUIRED');
  });
  it('never builds a proofless Mango request from a Buko preference or plan',()=>{
    expect(()=>prooflessRequest(plan(),customer)).toThrow('BUKO_PROOFLESS_NOT_ENABLED');expect(()=>prooflessReleasePlan(preferences)).toThrow('BUKO_PROOFLESS_NOT_ENABLED');
  });
  it('includes the chosen wing in the preparation fingerprint',()=>{
    const input={workflow:'test' as const,method:'api-first' as const,request:{wing:'BUKO' as const,strategy:'standard' as const,date,start:'16:00',duration:1,courtCount:1 as const,priority:[4],fallbackStarts:[],exact:[[4]]}};
    expect(expectedPreparationFingerprint(input)).not.toBe(expectedPreparationFingerprint({...input,request:{...input.request,wing:'MANGO'}}));
    expect(TestBookingSchema.safeParse({method:input.method,request:input.request,authorizeTerms:true}).success).toBe(true);
    expect(TestBookingSchema.safeParse({method:'proofless',request:input.request,authorizeTerms:true}).success).toBe(false);
  });
  it('carries the exact Buko target through the UI launcher to every Normal runner mode',()=>{
    const previous=process.env.THIRSTY_API_INSTALLATION;
    process.env.THIRSTY_API_INSTALLATION='1';
    try{
      const preferences={wing:'BUKO' as const,strategy:'standard' as const,date,start:'16:00',duration:1,courtCount:1 as const,priority:[4],fallbackStarts:[],exact:[[4]]};
      for(const mode of ['prepare','dry','live-now'] as const){
        const spec=commandSpec({kind:'apiRun',mode,date,fingerprint:'a'.repeat(64),checkoutMethod:'proof-based',preferences},process.cwd(),process.execPath);
        expect(JSON.parse(spec.args.at(-1)!)).toMatchObject({mode,checkoutMethod:'proof-based',preferences});
        expect(spec.apiLive).toBe(mode==='live-now');
      }
    }finally{if(previous===undefined)delete process.env.THIRSTY_API_INSTALLATION;else process.env.THIRSTY_API_INSTALLATION=previous;}
  });
  it('requires matching court, wing, date, time and amount at QR',()=>{
    const text='Checkout QRPH Pending October 14, 2026 4:00 PM - 5:00 PM 🥥 Buko Wing: Court 4 ₱700.00';
    expect(()=>assertQrOrderSummary(text,plan())).not.toThrow();for(const wrong of [text.replace('🥥 Buko Wing: Court 4','Court 4: Mango Wing 🥭'),text.replace('October 14','October 15'),text.replace('4:00 PM','5:00 PM'),text.replace('700.00','600.00')])expect(()=>assertQrOrderSummary(wrong,plan())).toThrow('OFFICIAL_CHECKOUT_STATE_MISMATCH');
  });
});
