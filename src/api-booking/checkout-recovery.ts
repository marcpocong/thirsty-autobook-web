import { mkdir, open, readFile } from 'node:fs/promises';
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
import { assertQrOrderSummary } from './qr-order-summary.js';

// A secret-bearing local recovery record, deliberately separate from sanitized
// diagnostics and durable submission journals. Never export or log its contents.
export const CHECKOUT_RECOVERY_FILE = 'checkout-recovery-private.json';
const MAX_BYTES = 256 * 1024;
const slotSchema = z.object({ court:z.number().int(), spaceId:z.string(), date:z.string(), bookingDate:z.string(),
  startTime:z.string(), endTime:z.string(), isAvailable:z.boolean(), isNightRate:z.boolean(), isNextDay:z.boolean(), currency:z.string(), price:z.number() });
const courtSchema = z.object({ court:z.number().int(), spaceId:z.string(), date:z.string(), startTime:z.string(), endTime:z.string(),
  durationMinutes:z.number(), price:z.number(), currency:z.string(), slots:z.array(slotSchema).min(1).max(3) });
const planSchema = z.object({ wing:z.enum(['MANGO','BUKO']).optional(), mode:z.literal('standard'), targetDate:z.string(),
  startTime:z.string(), endTime:z.string(), durationHours:z.number().int().min(1).max(3), courts:z.array(courtSchema).min(1).max(2),
  chunks:z.array(z.object({ startTime:z.string(), endTime:z.string(), durationHours:z.number(), courts:z.array(courtSchema).min(1).max(2), totalPrice:z.number() })).length(1),
  totalPrice:z.number(), currency:z.literal('PHP') });
const recordSchema = z.object({ version:z.literal(1), workerId:z.enum(WORKER_IDS), capturedAt:z.string().datetime(), plan:planSchema, response:z.unknown() });
const object = (v:unknown):Record<string,unknown> => v!==null && typeof v==='object' && !Array.isArray(v) ? v as Record<string,unknown> : {};
const scalar=(v:unknown)=>v===null||['string','number','boolean'].includes(typeof v)?v:null;
const fields = (v:unknown, keys:string[]) => Object.fromEntries(keys.filter(k=>k in object(v)).map(k=>[k,
  k==='bookingIds'&&Array.isArray(object(v)[k])&&(object(v)[k] as unknown[]).length<=12?(object(v)[k] as unknown[]).map(scalar):scalar(object(v)[k])]));
const bookingFields = ['id','booking_no','customer_id','space_id','facility_id','date','start_time','end_time','duration','rate','guest_count',
  'booking_status','payment_status','booking_session_id','hold_expires_at','checkoutToken'];
const sessionFields = ['requestSessionRef','bookingSessionId','facilityId','spaceId','date','startTime','endTime','durationHours','bookingIds'];

/** Persist before response validation, including an unsupported/malformed success shape.
 * No cookies, request headers, fingerprints, proofs, email, phone, or unrelated fields. */
export async function saveCheckoutRecovery(directory:string, response:CheckoutHttpResponse, plan:BookingPlan, workerId:WorkerId, now=new Date()):Promise<void> {
  if(response.status!==200)return;
  if(Buffer.byteLength(response.body,'utf8')>MAX_BYTES)throw Error('CHECKOUT_RECOVERY_RESPONSE_TOO_LARGE');
  let raw:Record<string,unknown>;
  try{raw=object(JSON.parse(response.body));}catch{return;}
  if(raw.success!==true)return;
  const projectArray=(value:unknown, keys:string[])=>Array.isArray(value)&&value.length<=12?value.map(v=>fields(v,keys)):null;
  const record={version:1,workerId,capturedAt:now.toISOString(),plan:planSchema.parse(plan),response:{success:raw.success,
    bookings:projectArray(raw.bookings,bookingFields),bookingSessions:projectArray(raw.bookingSessions,sessionFields),
    transaction:fields(raw.transaction,['id','reference','amount','status']),trustedTotalAmount:raw.trustedTotalAmount}};
  const text=JSON.stringify(record);
  if(Buffer.byteLength(text,'utf8')>MAX_BYTES)throw Error('CHECKOUT_RECOVERY_RESPONSE_TOO_LARGE');
  await mkdir(directory,{recursive:true,mode:0o700});
  const file=await open(join(directory,CHECKOUT_RECOVERY_FILE),'wx',0o600);
  try{await file.writeFile(text);await file.sync();}finally{await file.close();}
}

/** Revalidate locally before any restoration request. Does not alter journals or send checkout. */
export async function prepareCheckoutRecovery(directory:string, now=new Date()) {
  const text=await readFile(join(directory,CHECKOUT_RECOVERY_FILE),'utf8');
  if(Buffer.byteLength(text,'utf8')>MAX_BYTES)throw Error('CHECKOUT_RECOVERY_RESPONSE_TOO_LARGE');
  const record=recordSchema.parse(JSON.parse(text)),plan:BookingPlan=record.plan;
  // Validation needs request item identities, not contact data or availability proofs.
  const request=prooflessRequest(plan,{clientId:'recovery',customerId:'recovery',customerEmail:'recovery@example.invalid',customerPhone:'recovery',
    customerFirstName:'Recovery',customerLastName:'Validation'},'OFFLINE_INTERCEPTED');
  const hold=validatePublicCheckoutResponse(record.response,request as unknown as PublicCheckoutRequest,plan,now,plan.totalPrice);
  const raw=object(record.response),booking=object((raw.bookings as unknown[])[0]);
  if(typeof booking.checkoutToken!=='string'||!/^[\x21-\x7e]{1,8192}$/.test(booking.checkoutToken))throw Error('CHECKOUT_RECOVERY_TOKEN_MISSING');
  return {workerId:record.workerId,plan,hold,bookingNo:hold.bookingNumbers[0]!,token:booking.checkoutToken,url:officialCheckoutUrl(hold.bookingIds[0]!)};
}

/** Require the original durable attempt; recovery never marks it rejected/verified or recycles it. */
export async function assertRecoveryJournal(directory:string, recovery:Awaited<ReturnType<typeof prepareCheckoutRecovery>>):Promise<void> {
  const {plan}=recovery;
  const key=standardPlanJournalKeys(plan,THIRSTY_PICKLE_FACILITY_ID)[0]!;
  const record=await new DurableSubmissionJournal(directory).read(key);
  const expectedHours=plan.courts.flatMap(court=>court.slots.map(slot=>({startTime:slot.startTime,endTime:slot.endTime})));
  if(!['unknown','verified'].includes(record.state)||record.attempt.targetDate!==plan.targetDate||
    JSON.stringify(record.attempt.courtIds)!==JSON.stringify(plan.courts.map(court=>court.court))||
    JSON.stringify(record.attempt.hourlyBoundaries)!==JSON.stringify(expectedHours)||record.attempt.expectedBookingCount!==recovery.hold.bookingIds.length||
    record.attempt.maximumAmount!==plan.totalPrice)throw Error('CHECKOUT_RECOVERY_JOURNAL_MISMATCH');
  const ids=record.observedResponse?.bookingIds;
  if(!ids||ids.length!==recovery.hold.bookingIds.length||recovery.hold.bookingIds.some(id=>!ids.includes(id)))throw Error('CHECKOUT_RECOVERY_JOURNAL_MISMATCH');
}

/** Opens the existing checkout only after full local revalidation. No new reservation
 * is allowed; an incomplete/wrong QR summary fails instead of reporting success. */
export async function openCheckoutRecovery(page:Pick<Page,'evaluate'|'goto'|'getByText'|'locator'|'route'|'unroute'|'bringToFront'>,
  directory:string, now:()=>Date=()=>new Date()) {
  const recovery=await prepareCheckoutRecovery(directory,now());
  await assertRecoveryJournal(directory,recovery);
  const pattern='**/api/bookings/public-checkout**';
  await page.route(pattern,route=>route.abort());
  try {
    const status=await page.evaluate(async({bookingNo,token})=>{
      const url=new URL(`/api/public/bookings/booking-no/${encodeURIComponent(bookingNo)}`,location.origin);
      url.searchParams.set('checkoutToken',token);url.searchParams.set('grantCheckoutAccess','1');
      return (await fetch(url,{credentials:'include',cache:'no-store'})).status;
    },{bookingNo:recovery.bookingNo,token:recovery.token});
    if(status!==200)throw Error('OFFICIAL_CHECKOUT_ACCESS_FAILED');
    await page.goto(recovery.url,{waitUntil:'domcontentloaded',timeout:45_000});
    await page.getByText('QRPH',{exact:true}).first().waitFor({state:'visible',timeout:20_000});
    assertQrOrderSummary(await page.locator('body').innerText(),recovery.plan);
    await page.locator('canvas').first().waitFor({state:'visible',timeout:20_000});
    await prepareCheckoutRecovery(directory,now());
    await page.bringToFront();
    // Callers receive only the safe result, never the checkout access token.
    return {workerId:recovery.workerId,plan:recovery.plan,hold:recovery.hold};
  } finally {await page.unroute(pattern);}
}
