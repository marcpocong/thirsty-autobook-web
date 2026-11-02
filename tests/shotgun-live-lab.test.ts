import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShotgunLiveLabSchema, runShotgunLiveLab, productionRehearsalEngine, type ShotgunRehearsal } from '../src/shotgun-live-rehearsal.js';
import { assertLiveLabJournalEligibility, liveLabPostRefusal, guardLiveLabTransport } from '../src/shotgun-live-lab-safety.js';
import { prooflessReleasePlan } from '../src/api-booking/proofless-checkout.js';
import { TrustedReleaseClock } from '../src/release-clock.js';
import { DurableSubmissionJournal, consumeSubmissionPermit } from '../src/api-booking/durable-submission-journal.js';
import { SubmissionDispatchError } from '../src/api-booking/submission-errors.js';
const requests:ShotgunRehearsal[]=[1,2,3].map((court,i)=>({kind:'SHOTGUN_LIVE_REHEARSAL',date:'2026-11-04',wing:'MANGO',court,
  worker:['A','B','C'][i] as ShotgunRehearsal['worker'],start:'08:00',duration:1,maximum:600,attempts:1,payment:false}));
const lab={kind:'SHOTGUN_LIVE_LAB',requests,attempts:3,payment:false};
describe('independent-target production Shotgun Live Lab (offline)',()=>{
  it.each([
    {...lab,attempts:2},{...lab,requests:[requests[0],requests[0],requests[2]]},
    {...lab,requests:[requests[0],{...requests[1],court:1},requests[2]]},
    {...lab,requests:[requests[0],{...requests[1],date:'2026-11-05'},requests[2]]},
    {...lab,attempts:4,requests:[...requests,requests[0]]},
  ])('refuses mismatched budgets, shared browsers/courts/dates or unbounded fan-out',input=>{
    expect(ShotgunLiveLabSchema.safeParse(input).success).toBe(false);
  });
  it('refuses any mismatched plan before the production armer is called',async()=>{
    const arm=vi.fn(),deps={engine:{...productionRehearsalEngine,armPrecisionRace:arm},arm:{releaseMs:Date.now()+8000,now:Date.now},dispatch:{},securityFor:()=>({preparedContextAgeMs:()=>0})} as unknown as Parameters<typeof runShotgunLiveLab>[2];
    await expect(runShotgunLiveLab(lab,[],deps)).rejects.toThrow('SHOTGUN_REHEARSAL_PLAN_REFUSED');expect(arm).not.toHaveBeenCalled();
  });
  it('uses one real frozen race, real permits and strict dispatcher for independent A/B/C targets',async()=>{
    const root=await mkdtemp(join(tmpdir(),'live-lab-'));
    try{
      const plans=requests.map(r=>prooflessReleasePlan({mode:'standard',targetDate:r.date,durationHours:1,preferredStartTimes:[r.start],fallbackStartTimes:[],
        courtPriority:[r.court],fallbackCourts:[],exactCourts:[[r.court]],courtCount:1,maximumTotalPrice:r.maximum,currency:'PHP'}));
      const clock=TrustedReleaseClock.fromOffset(0,{method:'offline-live-lab',sampleCount:0}),releaseMs=Math.ceil(clock.nowMs()+5100),posts:string[]=[],calibrated:string[]=[],gated:string[]=[];
      const outcome=await runShotgunLiveLab(lab,plans,{securityFor:()=>({preparedContextAgeMs:()=>0}),
        arm:{releaseMs,journalRoot:root,now:()=>clock.nowMs(),customerFor:worker=>({clientId:`offline-${worker}`,customerId:`offline-${worker}`,customerEmail:`${worker}@example.invalid`,customerPhone:'000000000',customerFirstName:'Offline',customerLastName:worker})},
        dispatch:{clock,prewarmLeadMs:5000,isAborted:()=>false,prewarm:async()=>{},transportFor:worker=>guardLiveLabTransport({
          prepareStrictTiming:async()=>{calibrated.push(worker);},publicCheckoutProofless:async(body,permit,options)=>{
          expect(calibrated).toContain(worker);
          const r=requests.find(r=>r.worker===worker)!;
          consumeSubmissionPermit(permit,DurableSubmissionJournal.key(body.facilityId,body.items[0]!.spaceId,r.date,r.start,'09:00'));
          options?.beforePost?.();posts.push(worker);
          throw new SubmissionDispatchError('ONDA_HTTP_STATUS_INVALID',true,{status:400,category:'http-rejection',contentKind:'json',responseSource:'application',errorHint:'availability'},true);
        }},()=>gated.push(worker))}});
      expect(posts.sort()).toEqual(['A','B','C']);expect(outcome.results.map(r=>r.state)).toEqual(['REJECTED','REJECTED','REJECTED']);
      expect(calibrated.sort()).toEqual(['A','B','C']);expect(gated.sort()).toEqual(['A','B','C']);
      expect(outcome.results.every(r=>r.attempt.dispatchTimingPolicy==='SHOTGUN_STRICT')).toBe(true);
    }finally{await rm(root,{recursive:true,force:true});}
  },15000);
});
describe('live Lab final gates and protected journal review',()=>{
  it.each([
    [{nowMs:100,expiresMs:100,aborted:false,availabilityAgeMs:0},'REHEARSAL_AUTHORIZATION_EXPIRED'],
    [{nowMs:100,expiresMs:200,aborted:true,availabilityAgeMs:0},'USER_ABORT'],
    [{nowMs:100,expiresMs:200,aborted:false,availabilityAgeMs:15001},'LAB_AVAILABILITY_STALE'],
    [{nowMs:100,expiresMs:200,aborted:false,availabilityAgeMs:15000},null],
  ] as const)('checks expiry, Emergency Stop and current availability without I/O', (input,code)=>expect(liveLabPostRefusal(input)).toBe(code));
  it('blocks overlap across profiles regardless of advertised expiry, retains exact evidence, allows a different target',async()=>{
    const root=await mkdtemp(join(tmpdir(),'lab-unknown-')),path=join(root,'a'.repeat(64)+'.json');
    try{
      await writeFile(path,JSON.stringify({state:'unknown',attempt:{targetDate:'2026-11-04',courtIds:[1],hourlyBoundaries:[{startTime:'08:00',endTime:'09:00'}]},holdExpiresAt:'2020-01-01T00:00:00Z'}));
      const original=await readFile(path,'utf8');
      await expect(assertLiveLabJournalEligibility(root,[{...requests[0]!,worker:'G'}])).rejects.toThrow('LAB_OUTSTANDING_TARGET_CONFLICT');
      await expect(assertLiveLabJournalEligibility(root,[requests[1]!])).resolves.toBeUndefined();
      expect(await readFile(path,'utf8')).toBe(original);
      await mkdir(join(root,'fan-out'));await writeFile(join(root,'fan-out','b'.repeat(64)+'.json'),'{bad');
      await expect(assertLiveLabJournalEligibility(root,[requests[1]!])).rejects.toThrow('LAB_JOURNAL_SCAN_INCOMPLETE');
    }finally{await rm(root,{recursive:true,force:true});}
  });
});
