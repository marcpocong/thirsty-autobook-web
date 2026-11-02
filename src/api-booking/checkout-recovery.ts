import { readFile } from 'node:fs/promises';
import {createHash} from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import type { CheckoutHttpResponse } from './browser-session-transport.js';
import type { BookingPlan } from './types.js';
import { prooflessRequest } from './proofless-checkout.js';
import { validatePublicCheckoutResponse, type PublicCheckoutRequest } from './public-checkout.js';
import { officialCheckoutUrl } from './checkout-restoration.js';
import { WORKER_IDS, type WorkerId } from '../workers.js';
import { DurableSubmissionJournal } from './durable-submission-journal.js';
import { standardPlanJournalKeys } from './two-hour-reservation.js';
import { THIRSTY_PICKLE_FACILITY_ID } from './live-availability-provider.js';
import type { Page } from 'playwright';
import {publishPrivateJson} from './private-persistence.js';
import {appendHoldVerification} from './pending-hold-state.js';
import type {CheckoutCustomer} from './two-hour-reservation.js';
import {ProviderHoldUnconfirmedError,VerifiedHoldQrError} from './hold-confirmation-errors.js';

// A secret-bearing local recovery record, deliberately separate from sanitized
// diagnostics and durable submission journals. Never export or log its contents.
export const CHECKOUT_RECOVERY_FILE = 'checkout-recovery-private.json';
export const RECOVERY_VERIFICATION_VERSION=2;
const MAX_BYTES = 256 * 1024;
const slotSchema = z.object({ court:z.number().int(), spaceId:z.string(), date:z.string(), bookingDate:z.string(),
  startTime:z.string(), endTime:z.string(), isAvailable:z.boolean(), isNightRate:z.boolean(), isNextDay:z.boolean(), currency:z.string(), price:z.number() });
const courtSchema = z.object({ court:z.number().int(), spaceId:z.string(), date:z.string(), startTime:z.string(), endTime:z.string(),
  durationMinutes:z.number(), price:z.number(), currency:z.string(), slots:z.array(slotSchema).min(1).max(3) });
const planSchema = z.object({ wing:z.enum(['MANGO','BUKO']).optional(), mode:z.literal('standard'), targetDate:z.string(),
  startTime:z.string(), endTime:z.string(), durationHours:z.number().int().min(1).max(3), courts:z.array(courtSchema).min(1).max(2),
  chunks:z.array(z.object({ startTime:z.string(), endTime:z.string(), durationHours:z.number(), courts:z.array(courtSchema).min(1).max(2), totalPrice:z.number() })).length(1),
  totalPrice:z.number(), currency:z.literal('PHP') });
const recordSchema = z.object({ version:z.union([z.literal(1),z.literal(2)]), workerId:z.enum(WORKER_IDS), capturedAt:z.string().datetime(), plan:planSchema, response:z.unknown(),
  bodyHash:z.string().optional(),payloadHash:z.string().optional(),planHash:z.string().optional(),identityBinding:z.string().optional() });
export const recoveryHash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export function recoveryIdentityBinding(customer:CheckoutCustomer,profile:string):string{
  return recoveryHash(JSON.stringify([customer.clientId,customer.customerId,customer.customerEmail.trim().toLowerCase(),
    customer.customerPhone.replace(/\D/g,'').slice(-10),customer.customerFirstName.trim(),customer.customerLastName.trim(),profile]));
}
const object = (v:unknown):Record<string,unknown> => v!==null && typeof v==='object' && !Array.isArray(v) ? v as Record<string,unknown> : {};
const scalar=(v:unknown)=>v===null||['string','number','boolean'].includes(typeof v)?v:null;
const fields = (v:unknown, keys:string[]) => Object.fromEntries(keys.filter(k=>k in object(v)).map(k=>[k,
  k==='bookingIds'&&Array.isArray(object(v)[k])&&(object(v)[k] as unknown[]).length<=12?(object(v)[k] as unknown[]).map(scalar):scalar(object(v)[k])]));
const bookingFields = ['id','booking_no','customer_id','space_id','facility_id','date','start_time','end_time','duration','rate','guest_count',
  'booking_status','payment_status','booking_session_id','hold_expires_at','checkoutToken'];
const sessionFields = ['requestSessionRef','bookingSessionId','facilityId','spaceId','date','startTime','endTime','durationHours','bookingIds'];

/** Persist before response validation, including an unsupported/malformed success shape.
 * No cookies, request headers, fingerprints, proofs, email, phone, or unrelated fields. */
export async function saveCheckoutRecovery(directory:string, response:CheckoutHttpResponse, plan:BookingPlan, workerId:WorkerId, now=new Date(),
  identity?:{customer:CheckoutCustomer;profile:string;clockDomain?:'NODE_WALL'|'TRUSTED_NETWORK'}):Promise<void> {
  if(response.status!==200)return;
  if(Buffer.byteLength(response.body,'utf8')>MAX_BYTES)throw Error('CHECKOUT_RECOVERY_RESPONSE_TOO_LARGE');
  let raw:Record<string,unknown>;
  try{raw=object(JSON.parse(response.body));}catch{raw={};}
  const projectArray=(value:unknown, keys:string[])=>Array.isArray(value)&&value.length<=12?value.map(v=>fields(v,keys)):null;
  const savedPlan=planSchema.parse(plan);
  const projected={success:raw.success,
    bookings:projectArray(raw.bookings,bookingFields),bookingSessions:projectArray(raw.bookingSessions,sessionFields),
    transaction:fields(raw.transaction,['id','reference','amount','status']),trustedTotalAmount:raw.trustedTotalAmount};
  const record={version:2,workerId,capturedAt:now.toISOString(),plan:savedPlan,bodyHash:recoveryHash(response.body),
    payloadHash:recoveryHash(JSON.stringify(projected)),planHash:recoveryHash(JSON.stringify(savedPlan)),
    ...(identity?{identityBinding:recoveryIdentityBinding(identity.customer,identity.profile)}:{}),response:projected};
  const text=JSON.stringify(record);
  if(Buffer.byteLength(text,'utf8')>MAX_BYTES)throw Error('CHECKOUT_RECOVERY_RESPONSE_TOO_LARGE');
  await publishPrivateJson(join(directory,CHECKOUT_RECOVERY_FILE),record);
  await appendHoldVerification(directory,{at:now.toISOString(),responseHash:recoveryHash(text),local:'RESPONSE_CAPTURED',provider:'NOT_CHECKED',qr:'NOT_CHECKED',
    code:'RESPONSE_PERSISTED',contradiction:false,milestones:[{event:'RESPONSE_PERSISTED',at:now.toISOString(),clockDomain:identity?.clockDomain??'NODE_WALL',httpStatus:200}]});
}

/** Private loader; never return its contents through IPC, diagnostics or a CLI. */
export async function readCheckoutRecoveryRecord(directory:string){
  const text=await readFile(join(directory,CHECKOUT_RECOVERY_FILE),'utf8');
  if(Buffer.byteLength(text,'utf8')>MAX_BYTES)throw Error('CHECKOUT_RECOVERY_RESPONSE_TOO_LARGE');
  const record=recordSchema.parse(JSON.parse(text));
  if(record.version===2&&(!/^[a-f0-9]{64}$/.test(record.bodyHash??'')||record.payloadHash!==recoveryHash(JSON.stringify(record.response))||record.planHash!==recoveryHash(JSON.stringify(record.plan))))
    throw Error('CHECKOUT_RECOVERY_INTEGRITY_FAILED');
  return {record,responseHash:recoveryHash(text)};
}

/** Revalidate locally before any restoration request. Does not alter journals or send checkout. */
function validateSavedResponse(record:Awaited<ReturnType<typeof readCheckoutRecoveryRecord>>['record'],now:Date){
  const plan:BookingPlan=record.plan;
  // Validation needs request item identities, not contact data or availability proofs.
  const request=prooflessRequest(plan,{clientId:'recovery',customerId:'recovery',customerEmail:'recovery@example.invalid',customerPhone:'recovery',
    customerFirstName:'Recovery',customerLastName:'Validation'},'OFFLINE_INTERCEPTED');
  const hold=validatePublicCheckoutResponse(record.response,request as unknown as PublicCheckoutRequest,plan,now,plan.totalPrice);
  return {workerId:record.workerId,plan,hold};
}
export async function validateCapturedCheckoutResponse(directory:string,now:Date){
  return validateSavedResponse((await readCheckoutRecoveryRecord(directory)).record,now);
}
export async function prepareCheckoutRecovery(directory:string, now=new Date(),options:{allowMissingToken?:boolean}={}) {
  const {record}=await readCheckoutRecoveryRecord(directory),{plan,hold}=validateSavedResponse(record,now);
  const raw=object(record.response),booking=object((raw.bookings as unknown[])[0]);
  const token=booking.checkoutToken;
  if(!(options.allowMissingToken&&(token===undefined||token===null||token===''))&&(typeof token!=='string'||!/^[\x21-\x7e]{1,8192}$/.test(token)))throw Error('CHECKOUT_RECOVERY_TOKEN_MISSING');
  return {workerId:record.workerId,plan,hold,bookingNo:hold.bookingNumbers[0]!,token:typeof token==='string'&&token?token:undefined,url:officialCheckoutUrl(hold.bookingIds[0]!)};
}

/** Require the original durable attempt; recovery never marks it rejected/verified or recycles it. */
export async function assertRecoveryJournal(directory:string, recovery:Pick<Awaited<ReturnType<typeof prepareCheckoutRecovery>>,'plan'|'hold'>,
  options:{allowUnobservedResponse?:boolean}={}):Promise<void> {
  const {plan}=recovery;
  const key=standardPlanJournalKeys(plan,THIRSTY_PICKLE_FACILITY_ID)[0]!;
  const record=await new DurableSubmissionJournal(directory).read(key);
  const expectedHours=plan.courts.flatMap(court=>court.slots.map(slot=>({startTime:slot.startTime,endTime:slot.endTime})));
  if(!['unknown','verified'].includes(record.state)||record.attempt.targetDate!==plan.targetDate||
    JSON.stringify(record.attempt.courtIds)!==JSON.stringify(plan.courts.map(court=>court.court))||
    JSON.stringify(record.attempt.hourlyBoundaries)!==JSON.stringify(expectedHours)||record.attempt.expectedBookingCount!==recovery.hold.bookingIds.length||
    record.attempt.maximumAmount!==plan.totalPrice)throw Error('CHECKOUT_RECOVERY_JOURNAL_MISMATCH');
  const ids=record.observedResponse?.bookingIds;
  // A capture may have been flushed before browser loss or a later receipt/journal
  // write failed. Read-only provider verification may use that immutable capture
  // against this exact UNKNOWN intent. No IDs are backfilled and no permit is reused.
  if(ids===undefined&&record.state==='unknown'&&options.allowUnobservedResponse)return;
  if(!ids||ids.length!==recovery.hold.bookingIds.length||recovery.hold.bookingIds.some(id=>!ids.includes(id)))throw Error('CHECKOUT_RECOVERY_JOURNAL_MISMATCH');
}

/** Opens the existing checkout only after full local revalidation. No new reservation
 * is allowed; an incomplete/wrong QR summary fails instead of reporting success. */
export async function openCheckoutRecovery(page:Pick<Page,'url'|'evaluate'|'goto'|'getByText'|'locator'|'route'|'unroute'|'bringToFront'>,
  directory:string, now:()=>Date=()=>new Date(),options?:Omit<import('./pending-hold-recovery.js').RecoveryOptions,'now'|'identity'>&{identity?:import('./pending-hold-recovery.js').RecoveryIdentity}) {
  try {
  const {record}=await readCheckoutRecoveryRecord(directory);
  if(!options?.identity){
    const {assertCanonicalRecoveryRuntime}=await import('./recovery-runtime.js');await assertCanonicalRecoveryRuntime(process.cwd());
    const {browserIdentity,verifyDedicatedChromeAsync}=await import('../browser.js');
    const {loadLocalCheckoutCustomer}=await import('./local-customer.js');
    const browser=browserIdentity(record.workerId),customer=loadLocalCheckoutCustomer(record.workerId);
    options={...options,identity:{workerId:record.workerId,customer,profile:browser.expectedProfile,assertContext:async()=>{
      await verifyDedicatedChromeAsync(browser);
      if(recoveryIdentityBinding(loadLocalCheckoutCustomer(record.workerId),browser.expectedProfile)!==recoveryIdentityBinding(customer,browser.expectedProfile))throw Error('RECOVERY_CUSTOMER_CHANGED');
    }}};
  }
  const {recoverPendingHold}=await import('./pending-hold-recovery.js');
  const state=await recoverPendingHold(page,directory,{...options,identity:options.identity!,now});
  if(state.provider!=='PROVIDER_HOLD_CONFIRMED')throw new ProviderHoldUnconfirmedError(state.code);
  if(state.qr!=='QR_READY'){
    const recovery=await prepareCheckoutRecovery(directory,new Date(record.capturedAt),{allowMissingToken:true});
    const lookup=state.milestones.filter(m=>m.event==='PROVIDER_RESULT'&&m.operation==='LOOKUP'&&m.httpStatus===200).at(-1);
    const age=lookup?now().getTime()-Date.parse(lookup.at):Infinity;
    if(age<0||age>30_000||Date.parse(recovery.hold.holdExpiresAt)<=now().getTime())throw new ProviderHoldUnconfirmedError(state.code);
    throw new VerifiedHoldQrError(state.code,{bookingId:recovery.hold.bookingIds[0]!,bookingNo:recovery.bookingNo,holdExpiresAt:recovery.hold.holdExpiresAt,amount:recovery.plan.totalPrice});
  }
  const recovery=await prepareCheckoutRecovery(directory,now(),{allowMissingToken:true});
  return {workerId:recovery.workerId,plan:recovery.plan,hold:recovery.hold};
  }catch(error){
    if(error instanceof VerifiedHoldQrError||error instanceof ProviderHoldUnconfirmedError)throw error;
    const code=error instanceof Error&&/^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)?error.message:'CHECKOUT_PROVIDER_CONFIRMATION_FAILED';
    throw new ProviderHoldUnconfirmedError(code);
  }
}
