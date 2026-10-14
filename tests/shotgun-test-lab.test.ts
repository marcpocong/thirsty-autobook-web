import { describe,it,expect } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { fixturePlan } from '../scripts/dual-wing-fixtures.js';
import { simulatedPending,offlineCandidatePlan,validateLabRequest,type LabResult,type LabScenario } from '../src/shotgun-test-lab.js';
import { compileDualWingPlan } from '../src/dual-wing-plan.js';
import { prooflessRequest } from '../src/api-booking/proofless-checkout.js';
import { validatePublicCheckoutResponse } from '../src/api-booking/public-checkout.js';
import { assertLabSlotEvidence } from '../src/lab-slot-evidence.js';
import { ShotgunLabService } from '../ui/shotgun-lab-service.js';
const root=resolve('.');
async function child(scenario:LabScenario,objective:'ANY_ONE'|'ONE_PER_WING'='ANY_ONE') {
  const base=join(root,'.local/shotgun-test-lab/tests');await mkdir(base,{recursive:true});
  const directory=await mkdtemp(join(base,'case-'));
  const file=join(directory,'input.json');await writeFile(file,JSON.stringify({plan:fixturePlan(['MANGO','BUKO'],objective),scenario,countdownSeconds:8}));
  await new Promise<void>((done,fail)=>{const worker=spawn(process.execPath,['--import','tsx',join(root,'src/shotgun-test-lab-child.ts'),file,directory],{cwd:root,stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});let error:string|undefined,stderr='';worker.stderr?.on('data',chunk=>{stderr+=String(chunk);});
    worker.on('message',(m:unknown)=>{error=(m as {error?:string}).error??error;});worker.on('error',fail);worker.on('exit',code=>code===0?done():fail(Error(error??stderr.slice(-3000)??'LAB_TEST_CHILD_FAILED')));});
  return JSON.parse(await readFile(join(directory,'result.json'),'utf8')) as LabResult;
}
describe('intercepted lab safety and exact provider fixtures',()=>{
  it('builds independently validated Buko identity and activity metadata, retaining the live proofless refusal',()=>{
    const c=compileDualWingPlan(fixturePlan()).phase3!.candidates[1]!,p=offlineCandidatePlan(c);
    const customer={clientId:'00000000-0000-4000-8000-000000000001',customerId:'00000000-0000-4000-8000-000000000002',customerEmail:'offline@example.invalid',customerPhone:'09000000000',customerFirstName:'Offline',customerLastName:'Fixture'};
    expect(()=>prooflessRequest(p,customer)).toThrow('BUKO_PROOFLESS_NOT_ENABLED');
    const request=prooflessRequest(p,customer,'OFFLINE_INTERCEPTED');expect(request.items[0]?.activityKey).toBe('pickleball');expect(request.items[0]?.date).toBe('2026-10-21');
    const raw=simulatedPending(request,1);expect(validatePublicCheckoutResponse(raw,request as never,p,new Date()).bookingIds).toHaveLength(2);
    raw.bookings[0]!.space_id='wrong-wing';expect(()=>validatePublicCheckoutResponse(raw,request as never,p,new Date())).toThrow();
  });
  it('refuses missing, future, stale, partial or nonpublished slot evidence',()=>{
    const t=fixturePlan().targets[0]!,now=Date.now();const current={...t,priceAuthority:{...t.priceAuthority,kind:'TARGET_DATE_PUBLISHED' as const,capturedAt:new Date(now).toISOString()}};
    expect(()=>assertLabSlotEvidence(current,now)).not.toThrow();
    for(const bad of [{...current,priceAuthority:{...current.priceAuthority,capturedAt:new Date(now-15001).toISOString()}},{...current,priceAuthority:{...current.priceAuthority,capturedAt:new Date(now+1).toISOString()}},{...current,priceAuthority:{...current.priceAuthority,perHour:[]}},t])expect(()=>assertLabSlotEvidence(bad,now)).toThrow('UNKNOWN');
  });
  it('refuses invalid test countdown without inventing a production release',()=>{expect(()=>validateLabRequest({plan:fixturePlan(),scenario:'ALL_REJECTED',countdownSeconds:0})).toThrow('LAB_REQUEST_INVALID');});
  it('saves and reopens only a separate planning wrapper',async()=>{const base=join(root,'.local/shotgun-test-lab/tests');await mkdir(base,{recursive:true});const directory=await mkdtemp(join(base,'save-'));const service=new ShotgunLabService(directory,process.execPath),p=fixturePlan();await service.save(p);expect(await service.load()).toEqual(p);await expect(readFile(join(directory,'config.local.json'))).rejects.toMatchObject({code:'ENOENT'});});
});
describe('real isolated Chrome → production scheduler and dispatcher',()=>{
  it('completes independent wing objectives and suppresses later alternatives',async()=>{
    const r=await child('BOTH_SUCCESS','ONE_PER_WING');expect(r.label).toBe('OFFLINE / INTERCEPTED');expect(r.initiated).toBe(2);expect(r.omitted).toBe(6);expect(r.wings.every(w=>w.complete&&w.holds===1)).toBe(true);expect(r.outcomes.every(o=>o.state!=='QR_READY')).toBe(true);
  },60000);
  for(const scenario of ['UNKNOWN','PAYMENT_IN_PROGRESS','THROTTLE','WRONG_WING'] as const)it(`${scenario} stops both wings before later submissions`,async()=>{
    const r=await child(scenario,'ONE_PER_WING');expect(r.initiated).toBe(1);expect(r.wings.every(w=>!w.complete)).toBe(true);expect(r.omitted).toBe(7);
  },60000);
  for(const scenario of ['FIRST_SUCCESS','LATER_SUCCESS','MANGO_SUCCESS','BUKO_SUCCESS','TWO_IN_FLIGHT_SUCCESS','PREPARE_FAILED','WORKER_UNAVAILABLE','MISSED_TRIGGER','ALL_REJECTED'] as const)it(`${scenario} records the selected production-dispatch behavior`,async()=>{
    const r=await child(scenario,scenario==='MANGO_SUCCESS'||scenario==='BUKO_SUCCESS'?'ONE_PER_WING':'ANY_ONE');
    if(scenario==='FIRST_SUCCESS')expect(r.initiated).toBe(1);
    if(scenario==='LATER_SUCCESS')expect(r.initiated).toBe(3);
    if(scenario==='MANGO_SUCCESS'||scenario==='BUKO_SUCCESS'){expect(r.wings.find(w=>w.wing===scenario.split('_')[0])?.complete).toBe(true);expect(r.wings.filter(w=>w.complete)).toHaveLength(1);expect(r.initiated).toBe(5);}
    if(scenario==='TWO_IN_FLIGHT_SUCCESS')expect(r.wings.reduce((n,w)=>n+w.holds,0)).toBe(2);
    if(scenario==='PREPARE_FAILED'||scenario==='WORKER_UNAVAILABLE'){expect(r.preparation.some(p=>!p.ready)).toBe(true);expect(r.omitted).toBe(4);}
    if(scenario==='MISSED_TRIGGER'){expect(r.missedDeadlines).toBeGreaterThan(0);expect(r.omitted).toBe(4);}
    if(scenario==='ALL_REJECTED'){expect(r.initiated).toBe(8);expect(r.wings.every(w=>!w.complete)).toBe(true);}
  },60000);
  it('preserves an isolated prior hold and refuses duplicate, stale and missing evidence before preparation',async()=>{
    for(const scenario of ['PREVIOUS_HOLD','DUPLICATE_TARGET','STALE_AVAILABILITY','MISSING_AVAILABILITY'] as const){const r=await child(scenario);expect(r.initiated).toBe(0);expect(r.warnings.join(' ')).toContain('PREFLIGHT_REFUSED');}
  },60000);
});
