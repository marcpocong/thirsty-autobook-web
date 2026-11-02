import { describe, expect, it } from 'vitest';
import { buildStandardPublicCheckoutRequest } from '../src/api-booking/public-checkout.js';
import { prooflessReleasePlan, prooflessRequest } from '../src/api-booking/proofless-checkout.js';
import { FACILITY_ID } from '../src/court-registry.js';
const customer={clientId:'offline-client',customerId:'offline-customer',customerEmail:'offline@example.invalid',customerPhone:'09000000000',customerFirstName:'Offline',customerLastName:'Parity'};
describe('Normal / Shotgun wire identity parity (offline, no provider acceptance claim)',()=>{
  it.each([[1,'08:00',1],[2,'19:00',2],[7,'21:00',3]] as const)('preserves exact court %s, %s and %s hours; only fresh slot proofs differ', (court,start,durationHours)=>{
    const plan=prooflessReleasePlan({mode:'standard',targetDate:'2026-11-04',durationHours,preferredStartTimes:[start],fallbackStartTimes:[],
      courtPriority:[court],fallbackCourts:[],courtCount:1,exactCourts:[[court]],maximumTotalPrice:3000,currency:'PHP'});
    const proofs=plan.courts.flatMap(c=>c.slots.map((s,i)=>({spaceId:s.spaceId,date:s.date,startTime:s.startTime,endTime:s.endTime,
      availabilityProof:`offline-proof-${i}`,requestedAt:'2026-11-02T02:00:00Z',receivedAt:'2026-11-02T02:00:00Z'})));
    const normal=buildStandardPublicCheckoutRequest(plan,customer,FACILITY_ID,proofs),shotgun=prooflessRequest(plan,customer);
    expect({...normal,items:normal.items.map(item=>({...item,availabilityProof:null}))}).toEqual(shotgun);
    expect(shotgun.items.map(item=>item.endTime)).toEqual(normal.items.map(item=>item.endTime));
  });
});
