import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import type {Page,Route} from 'playwright';
import type {WorkerId} from '../workers.js';
import type {CheckoutCustomer} from './two-hour-reservation.js';
import {CHECKOUT_RECOVERY_FILE,prepareCheckoutRecovery,validateCapturedCheckoutResponse,readCheckoutRecoveryRecord,assertRecoveryJournal,recoveryHash,recoveryIdentityBinding} from './checkout-recovery.js';
import {appendHoldVerification,type HoldVerification} from './pending-hold-state.js';
import {validateProviderHold} from './provider-hold-verification.js';
import {assertQrOrderSummary} from './qr-order-summary.js';
import {standardPlanJournalKeys} from './two-hour-reservation.js';
import {THIRSTY_PICKLE_FACILITY_ID} from './live-availability-provider.js';
import {acquireRecoveryClaim} from './recovery-claim.js';

export interface RecoveryIdentity {workerId:WorkerId;customer:CheckoutCustomer;profile:string;assertContext:()=>Promise<void>}
export interface RecoveryOptions {identity:RecoveryIdentity;now?:()=>Date;sleep?:(ms:number)=>Promise<void>;claimRoot?:string;
  onMilestone?:(state:HoldVerification)=>void;verifyOnly?:boolean;clockDomain?:'NODE_WALL'|'TRUSTED_NETWORK';sessionId?:string}
export type RecoveryPage=Pick<Page,'url'|'evaluate'|'goto'|'getByText'|'locator'|'route'|'unroute'|'bringToFront'>;
const safeCode=(e:unknown)=>e instanceof Error&&/^[A-Z][A-Z0-9_]{0,99}$/.test(e.message)?e.message:'RECOVERY_FAILED';
const bookingMutation=(url:string,method:string)=>{const p=new URL(url).pathname;
  const officialReadOnlyChecks=['/api/public/bookings/check-conflicts','/api/public/bookings/check-slot-conflicts'];
  if(method==='POST'&&officialReadOnlyChecks.includes(p))return false;
  return !['GET','HEAD'].includes(method)&&(p.startsWith('/api/bookings/')||p==='/api/bookings'||p.startsWith('/api/public/bookings/')||p==='/api/public/bookings');};

/** Independent reads/navigation only. No submission, permit consumption, journal mutation or payment operation is called. */
export async function recoverPendingHold(page:RecoveryPage,directory:string,options:RecoveryOptions){
  const now=options.now??(()=>new Date()),sleep=options.sleep??(ms=>new Promise(r=>setTimeout(r,ms)));
  const {record,responseHash}=await readCheckoutRecoveryRecord(directory);
  const id=options.identity;if(id.workerId!==record.workerId)throw Error('RECOVERY_WORKER_MISMATCH');
  const releaseClaim=await acquireRecoveryClaim(options.claimRoot??resolve('.local/api-booking/recovery-claims'),record.workerId);
  const milestones:HoldVerification['milestones']=[];
  let local:HoldVerification['local']='RESPONSE_CAPTURED',provider:HoldVerification['provider']='NOT_CHECKED',qr:HoldVerification['qr']='NOT_CHECKED';
  let code='RESPONSE_PERSISTED',contradiction=false,httpStatus:number|undefined,journalHash:string|undefined,guarded=false;
  const started=performance.now();
  const mark=(event:HoldVerification['milestones'][number]['event'],details:Pick<HoldVerification['milestones'][number],'httpStatus'|'operation'|'failure'>={})=>
    milestones.push({event,at:now().toISOString(),clockDomain:options.clockDomain??'NODE_WALL',durationMs:Math.max(0,performance.now()-started),durationDomain:'NODE_MONOTONIC',...details});
  const persist=async()=>{
    const sessionId=options.sessionId??process.env.THIRSTY_RECOVERY_SESSION;
    const state=await appendHoldVerification(directory,{at:now().toISOString(),responseHash,...(journalHash?{journalHash}:{}),
      ...(sessionId?{sessionId}:{}),local,provider,qr,code,contradiction,
      ...(httpStatus?{httpStatus}:{}),milestones:[...milestones]});
    try{options.onMilestone?.(state);}catch{/* observer cannot change recovery */}return state;
  };
  const guard=async(route:Route)=>{if(bookingMutation(route.request().url(),route.request().method()))await route.abort();else await route.fallback();};
  const pattern='**/api/**';
  try{
    // Validate at capture time first so elapsed advertisements remain distinguishable
    // from a fresh provider-confirmed expiry. No private file or old journal is rewritten.
    const validated=await validateCapturedCheckoutResponse(directory,new Date(record.capturedAt));
    await assertRecoveryJournal(directory,validated,{allowUnobservedResponse:true});
    const key=standardPlanJournalKeys(validated.plan,THIRSTY_PICKLE_FACILITY_ID)[0]!;
    journalHash=recoveryHash(await readFile(join(directory,`${key}.json`)));
    const assertImmutable=async()=>{
      if(recoveryHash(await readFile(join(directory,CHECKOUT_RECOVERY_FILE)))!==responseHash)throw Error('RECOVERY_RESPONSE_CHANGED');
      if(recoveryHash(await readFile(join(directory,`${key}.json`)))!==journalHash)throw Error('RECOVERY_JOURNAL_CHANGED');
    };
    local='LOCAL_RESPONSE_VALID';code='LOCAL_RESPONSE_VALID';mark('LOCAL_VALIDATED');await persist();
    const recovery=await prepareCheckoutRecovery(directory,new Date(record.capturedAt),{allowMissingToken:true});
    await id.assertContext();
    if(record.identityBinding&&record.identityBinding!==recoveryIdentityBinding(id.customer,id.profile))throw Error('RECOVERY_CUSTOMER_OR_PROFILE_CHANGED');
    const url=new URL(page.url());if(url.origin!=='https://app.onda.fit'||url.pathname!=='/book/thirsty-pickle')throw Error('RECOVERY_BROWSER_ORIGIN_INVALID');
    await assertImmutable();
    mark('IDENTITY_BOUND');await page.route(pattern,guard);guarded=true;
    type Read={status:number;body:unknown;retryAfterMs:number|null;failure?:'TIMEOUT'|'NETWORK'|'TOO_LARGE'};
    const read=async(kind:'ACCESS'|'LOOKUP'):Promise<Read>=>{
      for(let attempt=0;attempt<2;attempt++){
        mark(kind==='ACCESS'?'CHECKOUT_ACCESS':'PROVIDER_LOOKUP');
        code=kind==='ACCESS'?'CHECKOUT_ACCESS_REQUESTED':'PROVIDER_LOOKUP_REQUESTED';await persist();
        let result:Read;
        try{result=await page.evaluate(async({kind,bookingNo,bookingId,token})=>{
          const u=kind==='ACCESS'?new URL(`/api/public/bookings/booking-no/${encodeURIComponent(bookingNo)}`,location.origin):new URL(`/api/public/bookings/${encodeURIComponent(bookingId)}`,location.origin);
          if(kind==='ACCESS'&&token){u.searchParams.set('checkoutToken',token);u.searchParams.set('grantCheckoutAccess','1');}
          let response:Response,text:string;
          try{response=await fetch(u,{method:'GET',credentials:'include',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10_000)});text=await response.text();}
          catch(e){return {status:0,body:null,retryAfterMs:null,failure:e instanceof Error&&['TimeoutError','AbortError'].includes(e.name)?'TIMEOUT' as const:'NETWORK' as const};}
          if(text.length>256*1024)return {status:response.status,body:null,retryAfterMs:null,failure:'TOO_LARGE' as const};
          let body:unknown=null;try{body=JSON.parse(text);}catch{}
          const header=response.headers.get('retry-after');let retryAfterMs:number|null=null;
          if(header){const serverDate=response.headers.get('date');
            const delay=/^\d+$/.test(header)?Number(header)*1000:serverDate?Date.parse(header)-Date.parse(serverDate)+1000:NaN;
            if(Number.isFinite(delay)&&delay>=0)retryAfterMs=delay;}
          return {status:response.status,body,retryAfterMs};
        },{kind,bookingNo:recovery.bookingNo,bookingId:recovery.hold.bookingIds[0]!,token:recovery.token});}
        catch{mark('PROVIDER_RESULT',{operation:kind,failure:'TRANSPORT'});await persist();
          if(attempt===0){await sleep(250);continue;}throw Error('PROVIDER_READ_TIMEOUT_OR_TRANSPORT_FAILED');}
        httpStatus=result.status>=100?result.status:undefined;
        mark('PROVIDER_RESULT',{operation:kind,...(result.status>=100?{httpStatus:result.status}:{}),...(result.failure?{failure:result.failure}:{})});
        code=kind==='ACCESS'?'CHECKOUT_ACCESS_RESULT':'PROVIDER_LOOKUP_RESULT';await persist();
        if(result.failure){if(result.failure!=='TOO_LARGE'&&attempt===0){await sleep(250);continue;}
          throw Error(result.failure==='TIMEOUT'?'PROVIDER_READ_TIMEOUT':result.failure==='TOO_LARGE'?'PROVIDER_RESPONSE_TOO_LARGE':'PROVIDER_READ_TRANSPORT_FAILED');}
        if(attempt===0&&(result.status===429||result.status>=500)){
          // Never shorten Retry-After. A longer/unparseable throttle stays visible;
          // no timer schedules a hidden retry after the operator action ends.
          if(result.retryAfterMs!==null&&result.retryAfterMs>2000||result.status===429&&result.retryAfterMs===null)return result;
          await sleep(Math.max(result.retryAfterMs??250,250));continue;
        }
        return result;
      }
      throw Error('PROVIDER_READ_FAILED');
    };
    const checkStatus=(result:Read,access:boolean)=>{
      if(result.status===200)return;
      provider='UNKNOWN';
      if(result.status===404){contradiction=Date.parse(recovery.hold.holdExpiresAt)>now().getTime();
        if(!contradiction)provider='EXPIRED_OR_UNAVAILABLE';throw Error(contradiction?'PROVIDER_404_BEFORE_ADVERTISED_EXPIRY':'PROVIDER_NOT_FOUND_AFTER_ADVERTISED_EXPIRY');}
      if(result.status===410){provider='EXPIRED_OR_UNAVAILABLE';throw Error('PROVIDER_CHECKOUT_UNAVAILABLE');}
      throw Error(result.status===401?'PROVIDER_AUTHENTICATION_REQUIRED':result.status===403?'PROVIDER_ACCESS_DENIED':result.status===429?'PROVIDER_RATE_LIMITED':result.status>=500?'PROVIDER_SERVER_ERROR':access?'OFFICIAL_CHECKOUT_ACCESS_FAILED':'PROVIDER_LOOKUP_FAILED');
    };
    // A missing captured token does not authorize a replacement identity. The
    // existing authenticated profile may still expose the original booking via
    // the same GET used by Onda on page load. Otherwise authentication fails closed.
    if(recovery.token)checkStatus(await read('ACCESS'),true);
    const lookup=await read('LOOKUP');checkStatus(lookup,false);await assertImmutable();
    const state=validateProviderHold(lookup.body,{plan:recovery.plan,bookings:(record.response as {bookings:Record<string,unknown>[]}).bookings,
      customer:id.customer,legacyIdentity:!record.identityBinding},now());
    if(state==='PAID'){provider='PAYMENT_CONFIRMED';code='AUTHORITATIVE_PAYMENT_CONFIRMED';return await persist();}
    if(state==='EXPIRED'){provider='EXPIRED_OR_UNAVAILABLE';code='PROVIDER_HOLD_EXPIRED';return await persist();}
    provider='PROVIDER_HOLD_CONFIRMED';code='PROVIDER_HOLD_CONFIRMED';await persist();
    if(options.verifyOnly)return await persist();
    await id.assertContext();
    if(Date.parse(recovery.hold.holdExpiresAt)<=now().getTime())throw Error('HOLD_EXPIRED_DURING_RECOVERY');
    await page.goto(recovery.url,{waitUntil:'domcontentloaded',timeout:45_000});
    const current=new URL(page.url());if(current.origin!=='https://app.onda.fit'||current.pathname!=='/book/thirsty-pickle'||current.searchParams.get('bookingId')!==recovery.hold.bookingIds[0])throw Error('CHECKOUT_BOOKING_ID_MISMATCH');
    await page.getByText('QRPH',{exact:true}).first().waitFor({state:'visible',timeout:20_000});
    assertQrOrderSummary(await page.locator('body').innerText(),recovery.plan);mark('ORDER_VERIFIED');
    const qrElement=page.locator('canvas, img[alt="Payment QR code"]').filter({visible:true}).first();
    await qrElement.waitFor({state:'visible',timeout:20_000});
    const usable=await qrElement.evaluate(e=>e instanceof HTMLImageElement?e.complete&&e.naturalWidth>0&&e.naturalHeight>0:e instanceof HTMLCanvasElement&&e.width>0&&e.height>0);
    if(!usable)throw Error('QR_NOT_USABLE');
    if(Date.parse(recovery.hold.holdExpiresAt)<=now().getTime())throw Error('HOLD_EXPIRED_DURING_RECOVERY');
    await assertImmutable();
    await id.assertContext();
    qr='QR_READY';code='EXISTING_CHECKOUT_QR_READY';mark('QR_PRESENTED');await page.bringToFront();return await persist();
  }catch(error){code=safeCode(error);if(local!=='LOCAL_RESPONSE_VALID')local='UNKNOWN';
    if(provider!=='EXPIRED_OR_UNAVAILABLE')provider=provider==='PROVIDER_HOLD_CONFIRMED'?provider:'UNKNOWN';
    if(provider==='PROVIDER_HOLD_CONFIRMED')qr='FAILED';return await persist();
  }finally{
    if(guarded)try{await page.unroute(pattern,guard);}catch{/* leave the conservative mutation guard in place */}
    await releaseClaim();
  }
}
