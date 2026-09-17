import type { BookingPlan, PlannedCourt } from './types.js';
import type { FreshSlotProof } from './slot-proofs.js';

export interface ResolvedGuestCustomer {
  clientId: string;
  customerId: string;
  customerFirstName: string;
  customerLastName: string;
  customerEmail: string;
  customerPhone: string;
}

export interface PublicCheckoutItem {
  spaceId: string;
  facilityId: string;
  date: string;
  startTime: string;
  endTime: string;
  duration: 60;
  rate: number;
  chargedAmount: number;
  guestCount: 1;
  promotionId: null;
  activityKey: null;
  activityLabel: null;
  sessionRef: 'session_1';
  availabilityProof: string;
}

export interface PublicCheckoutRequest extends ResolvedGuestCustomer {
  bookingType: 'online';
  facilityId: string;
  customerFirstName: string;
  customerLastName: string;
  usedCustomerMembershipId: null;
  userId: null;
  items: PublicCheckoutItem[];
}

export interface VerifiedPublicCheckout {
  bookingIds: string[];
  bookingNumbers: string[];
  sessionId: string;
  holdExpiresAt: string;
  transactionId: string;
  trustedTotalAmount: number;
}

export class PublicCheckoutValidationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PublicCheckoutValidationError';
  }
}

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const seconds = (time: string) => `${time}:00`;
const cents = (value: number) => Math.round(value * 100);
const sameAmount = (a: unknown, b: number) => typeof a === 'number' && Number.isFinite(a) && cents(a) === cents(b);
const fail = (code: string): never => { throw new PublicCheckoutValidationError(code); };
const requiredObject = (value: unknown, code: string): Record<string, unknown> => {
  const parsed = object(value);
  if (!parsed) throw new PublicCheckoutValidationError(code);
  return parsed;
};

function validCustomer(customer: ResolvedGuestCustomer): void {
  if (!Object.values(customer).every(nonempty) || Object.values(customer).some(value => /^<.*>$/.test(value)) ||
    Object.values(customer).some(value => /[\r\n]/.test(value))) fail('CHECKOUT_CUSTOMER_INVALID');
}

function standardCourt(plan: BookingPlan): PlannedCourt {
  if (plan.mode !== 'standard' || plan.durationHours < 1 || plan.durationHours > 3 || plan.courts.length !== 1 ||
    plan.chunks.length !== 1 || plan.chunks[0]?.courts.length !== 1 || plan.chunks[0].durationHours !== plan.durationHours)
    fail('CHECKOUT_PLAN_UNSUPPORTED');
  const court = plan.courts[0]!;
  if (court.slots.length !== plan.durationHours || court.durationMinutes !== plan.durationHours * 60 ||
    court.slots.some((slot, index) => !slot.isAvailable || slot.spaceId !== court.spaceId || slot.date !== court.date ||
      slot.bookingDate !== court.date || slot.currency !== 'PHP' || slot.startTime !== (index === 0 ? court.startTime : court.slots[index - 1]!.endTime)) ||
    cents(court.price) !== cents(court.slots.reduce((sum, slot) => sum + slot.price, 0)) || cents(plan.totalPrice) !== cents(court.price) ||
    plan.currency !== 'PHP') fail('CHECKOUT_PLAN_INVALID');
  return court;
}

/** Builds the observed public-checkout shape for standard, one-court, 1–3 hour plans. */
export function buildStandardPublicCheckoutRequest(
  plan: BookingPlan,
  customer: ResolvedGuestCustomer,
  facilityId: string,
  proofs: readonly FreshSlotProof[],
): PublicCheckoutRequest {
  if (!nonempty(facilityId)) fail('CHECKOUT_FACILITY_INVALID');
  validCustomer(customer);
  const court = standardCourt(plan);
  if (proofs.length !== court.slots.length) fail('AVAILABILITY_PROOF_MISSING');
  const items = court.slots.map((slot, index): PublicCheckoutItem => {
    const proof = proofs[index];
    if (!proof || proof.spaceId !== slot.spaceId || proof.date !== slot.date || proof.startTime !== slot.startTime || proof.endTime !== slot.endTime || !nonempty(proof.availabilityProof))
      fail('AVAILABILITY_PROOF_SLOT_MISMATCH');
    const validProof = proof!;
    return { spaceId: slot.spaceId, facilityId, date: slot.date, startTime: slot.startTime, endTime: slot.endTime,
      duration: 60, rate: slot.price, chargedAmount: slot.price, guestCount: 1, promotionId: null,
      activityKey: null, activityLabel: null, sessionRef: 'session_1', availabilityProof: validProof.availabilityProof };
  });
  return { bookingType: 'online', clientId: customer.clientId, customerId: customer.customerId,
    customerFirstName: customer.customerFirstName, customerLastName: customer.customerLastName,
    customerEmail: customer.customerEmail, customerPhone: customer.customerPhone, facilityId,
    usedCustomerMembershipId: null, userId: null, items };
}

/** Validates pending reservation evidence against the exact request and plan. */
export function validatePublicCheckoutResponse(
  raw: unknown,
  request: PublicCheckoutRequest,
  plan: BookingPlan,
  now: Date,
  maximumAmount?: number,
): VerifiedPublicCheckout {
  const court = standardCourt(plan);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail('CHECKOUT_CLOCK_INVALID');
  const root = requiredObject(raw, 'CHECKOUT_RESPONSE_INVALID');
  const bookingsValue = root.bookings, sessionsValue = root.bookingSessions, transaction = object(root.transaction);
  const total = request.items.reduce((sum, item) => sum + item.chargedAmount, 0);
  if (maximumAmount !== undefined && (!Number.isFinite(maximumAmount) || total > maximumAmount + 1e-7)) fail('CHECKOUT_MAXIMUM_PRICE_EXCEEDED');
  if (root.success !== true || !Array.isArray(bookingsValue) || bookingsValue.length !== request.items.length ||
    !Array.isArray(sessionsValue) || sessionsValue.length !== 1 || !transaction || transaction.status !== 'pending' ||
    !nonempty(transaction.id) || !sameAmount(transaction.amount, total) || !sameAmount(root.trustedTotalAmount, total))
    fail('CHECKOUT_RESPONSE_INVALID');
  const validTransaction = transaction!;
  const bookings = bookingsValue as unknown[], sessions = sessionsValue as unknown[];
  const session = requiredObject(sessions[0], 'CHECKOUT_SESSION_INVALID');
  const expectedStart = seconds(request.items[0]!.startTime), expectedEnd = seconds(request.items.at(-1)!.endTime);
  if (session.requestSessionRef !== 'session_1' || !nonempty(session.bookingSessionId) ||
    session.facilityId !== request.facilityId || session.spaceId !== court.spaceId || session.date !== court.date ||
    session.startTime !== expectedStart || session.endTime !== expectedEnd || session.durationHours !== plan.durationHours ||
    !Array.isArray(session.bookingIds) || session.bookingIds.length !== bookings.length) fail('CHECKOUT_SESSION_INVALID');
  const sessionBookingIds = session.bookingIds as unknown[];
  const bookingIds: string[] = [], bookingNumbers: string[] = [], keys = new Set<string>();
  let holdExpiresAt: string | undefined;
  for (const [index, rawBooking] of bookings.entries()) {
    const booking = object(rawBooking), item = request.items[index]!;
    if (!booking) fail('CHECKOUT_BOOKING_INVALID');
    const validBooking = booking!;
    if (!nonempty(validBooking.id) || !nonempty(validBooking.booking_no) || validBooking.booking_status !== 'pending' ||
      validBooking.payment_status !== 'pending' || validBooking.booking_session_id !== session.bookingSessionId ||
      validBooking.customer_id !== request.customerId || validBooking.space_id !== item.spaceId || validBooking.facility_id !== item.facilityId ||
      validBooking.date !== item.date || validBooking.start_time !== seconds(item.startTime) || validBooking.end_time !== seconds(item.endTime) ||
      validBooking.duration !== 60 || !sameAmount(validBooking.rate, item.rate) || validBooking.guest_count !== 1 ||
      !nonempty(validBooking.hold_expires_at) || !Number.isFinite(Date.parse(validBooking.hold_expires_at)) ||
      Date.parse(validBooking.hold_expires_at) <= now.getTime()) fail('CHECKOUT_BOOKING_INVALID');
    const key = `${validBooking.space_id}/${validBooking.date}/${validBooking.start_time}/${validBooking.end_time}`;
    if (!keys.add(key) || bookingIds.includes(validBooking.id as string) || bookingNumbers.includes(validBooking.booking_no as string) ||
      (holdExpiresAt !== undefined && holdExpiresAt !== validBooking.hold_expires_at)) fail('CHECKOUT_BOOKING_DUPLICATE');
    holdExpiresAt = validBooking.hold_expires_at as string;
    bookingIds.push(validBooking.id as string); bookingNumbers.push(validBooking.booking_no as string);
  }
  if (new Set(bookingIds).size !== bookingIds.length || new Set(bookingNumbers).size !== bookingNumbers.length ||
    new Set(sessionBookingIds).size !== bookingIds.length || bookingIds.some(id => !sessionBookingIds.includes(id)) ||
    validTransaction.reference !== bookingNumbers[0]) fail('CHECKOUT_GROUPING_INVALID');
  return { bookingIds, bookingNumbers, sessionId: session.bookingSessionId as string, holdExpiresAt: holdExpiresAt!,
    transactionId: validTransaction.id as string, trustedTotalAmount: root.trustedTotalAmount as number };
}
