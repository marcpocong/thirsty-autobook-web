import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShotgunRehearsalSchema, runShotgunLiveRehearsal, productionRehearsalEngine,
  prepareRehearsalSecurity, assertRehearsalSecurityReady } from '../src/shotgun-live-rehearsal.js';
import { prooflessReleasePlan } from '../src/api-booking/proofless-checkout.js';
import { consumeSubmissionPermit } from '../src/api-booking/durable-submission-journal.js';
import { TrustedReleaseClock } from '../src/release-clock.js';
import { assertQrOrderSummary } from '../src/api-booking/qr-order-summary.js';
import { reuseRehearsalSecurity } from '../src/shotgun-rehearsal-readiness.js';

const request = { kind: 'SHOTGUN_LIVE_REHEARSAL', date: '2026-11-03', wing: 'MANGO', court: 6, worker: 'B',
  start: '08:00', duration: 3, maximum: 1800, attempts: 1, payment: false } as const;
const plan = prooflessReleasePlan({ mode:'standard',targetDate:request.date,durationHours:3,preferredStartTimes:['08:00'],
  fallbackStartTimes:[],courtPriority:[6],fallbackCourts:[],courtCount:1,maximumTotalPrice:1800,currency:'PHP' });
const summary = 'November 3, 2026\n8:00 AM - 9:00 AM\nCourt 6: Mango Wing 🥭\n9:00 AM - 10:00 AM\nCourt 6: Mango Wing 🥭\n10:00 AM - 11:00 AM\nCourt 6: Mango Wing 🥭\nPending\nQRPH\n1,800.00';

describe('bounded production Shotgun rehearsal', () => {
  it.each([{attempts:2},{duration:4},{maximum:1801},{payment:true},{wing:'BUKO'},{extra:'unrecognized'}])('refuses expanded authority %j', change => {
    expect(ShotgunRehearsalSchema.safeParse({...request,...change}).success).toBe(false);
  });
  it('refuses another court or over-budget plan before arming anything', async () => {
    const arm = vi.fn(), engine = {...productionRehearsalEngine, armPrecisionRace:arm};
    const deps = {engine,arm:{releaseMs:Date.now()+6000,now:Date.now},dispatch:{}} as unknown as Parameters<typeof runShotgunLiveRehearsal>[2];
    await expect(runShotgunLiveRehearsal(request,{...plan,totalPrice:1801},deps)).rejects.toThrow('SHOTGUN_REHEARSAL_PLAN_REFUSED');
    await expect(runShotgunLiveRehearsal({...request,court:5},plan,deps)).rejects.toThrow('SHOTGUN_REHEARSAL_PLAN_REFUSED');
    expect(arm).not.toHaveBeenCalled();
  });
  it('uses the real freezer, armer and strict dispatcher: one B request with no live network', async () => {
    const directory = await mkdtemp(join(tmpdir(),'shotgun-rehearsal-'));
    try {
      const clock = TrustedReleaseClock.fromOffset(0,{method:'offline-rehearsal-test',sampleCount:0});
      const releaseMs = Math.ceil(clock.nowMs()+5100), calls:string[]=[];
      const customer={clientId:'offline-client',customerId:'offline-customer',customerEmail:'offline@example.invalid',customerPhone:'0000000000',customerFirstName:'Offline',customerLastName:'Test'};
      const result = await runShotgunLiveRehearsal(request,plan,{
        security:{preparedContextAgeMs:()=>0},
        arm:{journalRoot:directory,releaseMs,now:()=>clock.nowMs(),customerFor:worker=>{expect(worker).toBe('B');return customer;}},
        dispatch:{clock,prewarmLeadMs:5000,isAborted:()=>false,prewarm:async()=>{calls.push('prepare');},
          transportFor:worker=>({publicCheckoutProofless:async(body,permit,options)=>{
            expect(worker).toBe('B'); expect(body.items).toHaveLength(3);
            const key = (await import('../src/api-booking/durable-submission-journal.js')).DurableSubmissionJournal.key(body.facilityId,body.items[0]!.spaceId,request.date,'08:00','11:00');
            consumeSubmissionPermit(permit,key);options?.beforePost?.();calls.push('send');
            const ids=body.items.map((_,i)=>`offline-booking-${i}`);
            return {success:true,bookings:body.items.map((item,i)=>({id:ids[i],booking_no:`offline-number-${i}`,customer_id:body.customerId,space_id:item.spaceId,facility_id:item.facilityId,date:item.date,
              start_time:item.startTime,end_time:item.endTime,duration:60,rate:item.rate,guest_count:1,booking_status:'pending',payment_status:'pending',booking_session_id:'offline-session',hold_expires_at:new Date(Date.now()+600000).toISOString()})),
              bookingSessions:[{bookingSessionId:'offline-session',requestSessionRef:'session_1',facilityId:body.facilityId,spaceId:body.items[0]!.spaceId,date:request.date,startTime:'08:00',endTime:'11:00',durationHours:3,bookingIds:ids}],
              transaction:{id:'offline-transaction',reference:'offline-number-0',amount:1800,status:'pending'},trustedTotalAmount:1800};
          }}),onVerifiedHold:async()=>{calls.push('hold');return{state:'QR_READY'};}}});
      expect(calls).toEqual(['prepare','send','hold']);
      expect(result.results).toHaveLength(1);expect(result.results[0]?.state).toBe('QR_READY');
      expect(result.results[0]?.attempt.dispatchTimingPolicy).toBe('SHOTGUN_STRICT');
    } finally {await rm(directory,{recursive:true,force:true});}
  },15000);
});

describe('rehearsal readiness before arming',()=>{
  it('refuses stale prewarm context without starting a second acquisition',async()=>{
    const prepare=vi.fn();
    await expect(reuseRehearsalSecurity({preparedContextAgeMs:()=>15001,prepareCheckoutContext:prepare})).rejects.toThrow('REHEARSAL_SECURITY_NOT_READY');
    expect(prepare).not.toHaveBeenCalled();
  });
  it('reuses fresh prepared context with a conservative freshness guard',async()=>{
    const prepare=vi.fn(async()=>{});
    await reuseRehearsalSecurity({preparedContextAgeMs:()=>1000,prepareCheckoutContext:prepare});
    expect(prepare).toHaveBeenCalledExactlyOnceWith(false,20000);
  });
  it('waits for genuine preparation, surfaces the browser first, and never treats pending as ready',async()=>{
    const calls:string[]=[], states:string[]=[];
    let finish!:()=>void, age:number|undefined;
    const pending=new Promise<void>(resolve=>{finish=resolve;});
    const transport={preparedContextAgeMs:()=>age,prepareCheckoutContext:async()=>{calls.push('prepare');await pending;age=0;}};
    const ready=prepareRehearsalSecurity(transport,async()=>{calls.push('show');},state=>states.push(state));
    await Promise.resolve();await Promise.resolve();
    expect(calls).toEqual(['show','prepare']);expect(states).toEqual(['PREPARING']);
    expect(()=>assertRehearsalSecurityReady(transport)).toThrow('REHEARSAL_SECURITY_NOT_READY');
    finish();await ready;expect(states).toEqual(['PREPARING','READY']);
  });
  it('propagates verification failure without declaring readiness',async()=>{
    const states:string[]=[];
    await expect(prepareRehearsalSecurity({preparedContextAgeMs:()=>undefined,prepareCheckoutContext:async()=>{throw Error('ONDA_SECURITY_HELPER_TIMEOUT');}},async()=>{},state=>states.push(state)))
      .rejects.toThrow('ONDA_SECURITY_HELPER_TIMEOUT');
    expect(states).toEqual(['PREPARING','FAILED']);
  });
  it.each([undefined,NaN,-1,15001])('refuses an absent, invalid or stale context before freezing: %s',async age=>{
    const freeze=vi.fn(),engine={...productionRehearsalEngine,freezePrecisionRace:freeze};
    const deps={engine,security:{preparedContextAgeMs:()=>age},arm:{releaseMs:Date.now()+8000,now:Date.now},dispatch:{}} as unknown as Parameters<typeof runShotgunLiveRehearsal>[2];
    await expect(runShotgunLiveRehearsal(request,plan,deps)).rejects.toThrow('REHEARSAL_SECURITY_NOT_READY');
    expect(freeze).not.toHaveBeenCalled();
  });
  it('checks freshness again between freezing and durable arming',async()=>{
    const arm=vi.fn();let reads=0;
    const deps={engine:{...productionRehearsalEngine,armPrecisionRace:arm},security:{preparedContextAgeMs:()=>++reads===1?0:15001},
      arm:{releaseMs:Date.now()+8000,now:Date.now},dispatch:{}} as unknown as Parameters<typeof runShotgunLiveRehearsal>[2];
    await expect(runShotgunLiveRehearsal(request,plan,deps)).rejects.toThrow('REHEARSAL_SECURITY_NOT_READY');
    expect(arm).not.toHaveBeenCalled();
  });
});

describe('exact hourly official QR summary',()=>{
  it('accepts all three genuine-shaped hourly rows',()=>expect(()=>assertQrOrderSummary(summary,plan)).not.toThrow());
  it.each([
    summary.replace('9:00 AM - 10:00 AM\nCourt 6: Mango Wing 🥭\n',''),
    summary.replace('9:00 AM - 10:00 AM','8:00 AM - 9:00 AM'),
    summary.replace('9:00 AM - 10:00 AM','9:00 AM - 11:00 AM'),
    summary.replace('1,800.00','600.00'),summary.replace('November 3','November 4'),
    summary.replace('Court 6: Mango Wing 🥭','Court 5: Mango Wing 🥭'),
    summary+'\n11:00 AM - 12:00 PM\nCourt 6: Mango Wing 🥭',
  ])('rejects incomplete, duplicate, wrong or additional rows',body=>expect(()=>assertQrOrderSummary(body,plan)).toThrow('OFFICIAL_CHECKOUT_STATE_MISMATCH'));
});
