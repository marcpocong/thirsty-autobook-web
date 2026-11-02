import {it,expect,vi} from 'vitest';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pendingFixture,fakeRecoveryPage,fixtureNow} from '../helpers/pending-hold-fixture.js';
import {openCheckoutRecovery} from '../../src/api-booking/checkout-recovery.js';
import {classifyPrecisionDispatchError,reducePrecisionOutcome} from '../../src/api-booking/precision-race.js';
import {ProviderHoldUnconfirmedError,VerifiedHoldQrError} from '../../src/api-booking/hold-confirmation-errors.js';
import {acquireRecoveryClaim} from '../../src/api-booking/recovery-claim.js';
import {CheckoutRecoveryQueue} from '../../src/api-booking/checkout-recovery-queue.js';

it.each(['404','busy','identity','wrong group','confirmed QR failure','confirmed QR'])('counts only independently confirmed checkout evidence: %s',async kind=>{
 const root=await mkdtemp(join(tmpdir(),'provider-outcome-'));
 try{
  const f=await pendingFixture(root),{page,mocks,element}=fakeRecoveryPage(f),claimRoot=join(root,'claims');
  const before=await readFile(f.journalPath),options={identity:f.identity,claimRoot};
  let release:(()=>Promise<void>)|undefined;
  if(kind==='404')mocks.evaluate.mockResolvedValue({status:404,body:null,retryAfterMs:null});
  if(kind==='busy')release=await acquireRecoveryClaim(claimRoot,'A');
  if(kind==='identity')options.identity={...f.identity,assertContext:async()=>{throw Error('RECOVERY_CUSTOMER_CHANGED');}};
  if(kind==='wrong group')f.provider.data.groupBookings[0]!.spaceId='foreign-court';
  if(kind==='confirmed QR failure')element.waitFor.mockRejectedValue(Error('QR_NOT_VISIBLE'));
  let result;
  try{await openCheckoutRecovery(page,f.directory,()=>fixtureNow,options);result={state:'QR_READY' as const};}
  catch(error){
   expect(error).toBeInstanceOf(kind==='confirmed QR failure'?VerifiedHoldQrError:ProviderHoldUnconfirmedError);
   result=await classifyPrecisionDispatchError(error,async()=> 'verified');
  }finally{await release?.();}
  const confirmed=kind.startsWith('confirmed');
  expect(result.state).toBe(confirmed?kind==='confirmed QR'?'QR_READY':'HOLD_VERIFIED_QR_ATTENTION':'UNKNOWN');
  expect(reducePrecisionOutcome([result.state])).toMatchObject({achieved:confirmed,verifiedCount:confirmed?1:0,lockReleasable:false});
  if(!confirmed)expect(mocks.goto).not.toHaveBeenCalled();
  expect(await readFile(f.journalPath)).toEqual(before);
  expect(f.submissions()).toBe(1); // fixture's initial synthetic response only; recovery cannot create another.
 }finally{await rm(root,{recursive:true,force:true});}
});

it('queues same-profile fan-out verification, allows other profiles, and continues after an unconfirmed response',async()=>{
 const q=new CheckoutRecoveryQueue(),events:string[]=[];let release!:()=>void;
 const blocked=new Promise<void>(r=>release=r);
 const first=q.run('A',async()=>{events.push('A1');await blocked;throw new ProviderHoldUnconfirmedError('PROVIDER_404_BEFORE_ADVERTISED_EXPIRY');});
 const caught=first.catch(e=>e);
 const second=q.run('A',async()=>{events.push('A2');return 2;});
 const other=q.run('B',async()=>{events.push('B');return 3;});
 await other;expect(events).toEqual(['A1','B']);release();
 expect(await caught).toBeInstanceOf(ProviderHoldUnconfirmedError);expect(await second).toBe(2);expect(events).toEqual(['A1','B','A2']);
});

it('does not turn an unconfirmed captured response into provably unsent when journal evidence is unavailable',async()=>{
 const result=await classifyPrecisionDispatchError(new ProviderHoldUnconfirmedError('RECOVERY_WORKER_BUSY'),async()=>undefined);
 expect(result).toEqual({state:'UNKNOWN',code:'RECOVERY_WORKER_BUSY'});
 expect(reducePrecisionOutcome([result.state])).toMatchObject({achieved:false,lockReleasable:false});
});
