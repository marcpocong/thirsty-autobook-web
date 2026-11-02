import type {BookingPlan} from './types.js';
import type {CheckoutCustomer} from './two-hour-reservation.js';
import {canonicalCheckoutTime,ondaCheckoutBoundary} from './public-checkout.js';
import {courtBySpace} from '../court-registry.js';

const obj=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const equalMoney=(v:unknown,n:number)=>
  (typeof v==='number'||typeof v==='string'&&/^\d+(?:\.\d{1,2})?$/.test(v))&&Number.isFinite(Number(v))&&Math.round(Number(v)*100)===Math.round(n*100);
const fail=(code:string):never=>{throw Error(code);};
const serviceDate=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.000)?(?:Z|\+00:00))?$/.test(v)&&
  Number.isFinite(Date.parse(v))?v.slice(0,10):null;
export interface ProviderExpectation {
  plan:BookingPlan;bookings:Array<Record<string,unknown>>;customer:CheckoutCustomer;legacyIdentity:boolean;
}
/** Onda can remove aggregate/session rows after expiry. This is terminal-only eligibility, never active-hold proof. */
export function expiredHourlyGroupId(raw:unknown,expected:ProviderExpectation,now:Date):string|null{
  const d=obj(obj(raw).data);
  if(expected.plan.courts.length!==1||expected.bookings.length<2||expected.bookings.length>3||
    expected.bookings.some(b=>typeof b.hold_expires_at!=='string'||!Number.isFinite(Date.parse(b.hold_expires_at))||Date.parse(b.hold_expires_at)>now.getTime())||
    d.bookingStatus!=='expired'||d.paymentStatus!=='expired'||d.canResumeCheckout!==false||
    !Array.isArray(d.bookingSessions)||d.bookingSessions.length!==0||
    d.groupBookings!==undefined&&(!Array.isArray(d.groupBookings)||d.groupBookings.length!==0)||
    typeof d.bookingGroupId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(d.bookingGroupId))return null;
  return d.bookingGroupId;
}
/** Validate each actual hourly GET independently; never manufacture an aggregate provider response. */
export function assertExpiredProviderHour(raw:unknown,expected:ProviderExpectation,original:Record<string,unknown>,groupId:string,now:Date):void{
  if(expiredHourlyGroupId(raw,expected,now)!==groupId||
    validateProviderHold(raw,{...expected,bookings:[original]},now)!=='EXPIRED')fail('PROVIDER_PARTIAL_HOURLY_GROUP');
}
/** Official GET /api/public/bookings/{id} shape observed in Onda's court-v2 frontend.
 * A grant status is never passed here as proof. No endpoint, token or contact is returned.
 */
export function validateProviderHold(raw:unknown,expected:ProviderExpectation,now:Date):'ACTIVE'|'PAID'|'EXPIRED'{
  const root=obj(raw),d=obj(root.data),{plan,bookings,customer}=expected;
  if(root.success!==true||!Object.keys(d).length)fail('PROVIDER_RESPONSE_INVALID');
  const first=bookings[0]!;
  if(d.id!==first.id||d.bookingNo!==first.booking_no||d.customerId!==first.customer_id)fail('PROVIDER_IDENTITY_MISMATCH');
  if(expected.legacyIdentity){
    if(typeof d.customerEmail!=='string'||d.customerEmail.trim().toLowerCase()!==customer.customerEmail.trim().toLowerCase()||
      typeof d.customerPhone!=='string'||d.customerPhone.replace(/\D/g,'').slice(-10)!==customer.customerPhone.replace(/\D/g,'').slice(-10)||
      typeof d.customerFirstName!=='string'||d.customerFirstName.trim()!==customer.customerFirstName.trim()||
      typeof d.customerLastName!=='string'||d.customerLastName.trim()!==customer.customerLastName.trim())fail('LEGACY_CUSTOMER_BINDING_UNVERIFIED');
  }
  const rows=Array.isArray(d.groupBookings)&&d.groupBookings.length?d.groupBookings.map(obj):[d];
  if(rows.length<bookings.length)fail('PROVIDER_PARTIAL_HOURLY_GROUP');
  if(rows.length!==bookings.length||new Set(rows.map(b=>b.id)).size!==bookings.length)fail('PROVIDER_IDENTITY_MISMATCH');
  if(!equalMoney(d.checkoutTotal,plan.totalPrice))fail('PROVIDER_AMOUNT_MISMATCH');
  for(const b of rows){
    const original=bookings.find(v=>v.id===b.id);if(!original)fail('PROVIDER_IDENTITY_MISMATCH');
    const o=original!;
    // The checkout contract permits facility_id to be absent on hourly rows;
    // its session already passed local facility validation. Independently require
    // the lookup facility to match the registered original court, never undefined.
    const facility=courtBySpace(String(o.space_id))?.facilityId;
    if(!facility||(o.facility_id!==undefined&&o.facility_id!==facility))fail('PROVIDER_IDENTITY_MISMATCH');
    if(b.bookingNo!==o.booking_no||(b.customerId??d.customerId)!==o.customer_id||
      (b.facilityId??d.facilityId)!==facility||b.spaceId!==o.space_id||
      serviceDate(b.date)!==o.date||(b.bookingDate!==undefined&&serviceDate(b.bookingDate)!==o.date)||canonicalCheckoutTime(b.startTime)!==canonicalCheckoutTime(o.start_time)||
      canonicalCheckoutTime(b.endTime)!==canonicalCheckoutTime(ondaCheckoutBoundary(String(o.end_time)))||
      !equalMoney(b.rate,Number(o.rate))||
      typeof (b.holdExpiresAt??d.holdExpiresAt)!=='string'||Date.parse(String(b.holdExpiresAt??d.holdExpiresAt))!==Date.parse(String(o.hold_expires_at))||
      (b.bookingSessionId!==undefined&&b.bookingSessionId!==o.booking_session_id))fail('PROVIDER_IDENTITY_MISMATCH');
  }
  const states=rows.map(b=>({booking:b.bookingStatus??d.bookingStatus,payment:b.paymentStatus??d.paymentStatus}));
  if(d.paymentStatus==='paid'&&['confirmed','completed'].includes(String(d.bookingStatus))&&states.every(s=>s.payment==='paid'&&['confirmed','completed'].includes(String(s.booking))))return 'PAID';
  if(states.every(s=>['expired','cancelled'].includes(String(s.booking))))return 'EXPIRED';
  if(states.some(s=>s.booking!=='pending'||s.payment!=='pending'))fail('PROVIDER_PARTIAL_OR_UNRESOLVED_STATUS');
  if(d.bookingStatus!=='pending'||d.paymentStatus!=='pending'||d.canResumeCheckout!==true)fail('PROVIDER_CANNOT_RESUME');
  if(rows.some(b=>Date.parse(String(b.holdExpiresAt??d.holdExpiresAt))<=now.getTime()))return 'EXPIRED';
  return 'ACTIVE';
}
