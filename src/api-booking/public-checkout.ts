import type { BookingPlan, PlannedCourt } from './types.js';
import type { FreshSlotProof } from './slot-proofs.js';
import { ondaWireBoundary } from '../time-range.js';
import { courtBySpace, FACILITY_ID } from '../court-registry.js';

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
  activityKey: null | 'pickleball';
  activityLabel: null | 'Pickleball';
  sessionRef: `session_${number}`;
  availabilityProof: string;
}

export interface PublicCheckoutRequest extends Omit<ResolvedGuestCustomer, 'customerFirstName' | 'customerLastName'> {
  bookingType: 'online';
  facilityId: string;
  customerFirstName: null;
  customerLastName: null;
  usedCustomerMembershipId: null;
  userId: null;
  items: PublicCheckoutItem[];
}

export interface VerifiedPublicCheckout {
  bookingIds: string[];
  bookingNumbers: string[];
  sessionId: string;
  sessionIds: string[];
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
const safeIdentifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const seconds = (time: string) => `${time}:00`;
/** Onda's checkout endpoint represents the end of the 23:00 hour as midnight, never as 24:00. */
export const ondaCheckoutBoundary = ondaWireBoundary;
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

function standardCourts(plan: BookingPlan): PlannedCourt[] {
  if (plan.wing !== undefined && !['MANGO','BUKO'].includes(plan.wing)) fail('CHECKOUT_WING_INVALID');
  if (plan.wing === 'BUKO' && plan.courts.length !== 1) fail('BUKO_EXACT_NORMAL_PLAN_REQUIRED');
  const chunk = plan.chunks[0];
  if (plan.mode !== 'standard' || plan.durationHours < 1 || plan.durationHours > 3 ||
    ![1, 2].includes(plan.courts.length) || plan.chunks.length !== 1 ||
    chunk?.courts.length !== plan.courts.length || chunk?.durationHours !== plan.durationHours)
    fail('CHECKOUT_PLAN_UNSUPPORTED');
  const validChunk = chunk!;
  const courts = plan.courts;
  if (courts.some(court => { const registered = courtBySpace(court.spaceId);
    return registered?.wing !== (plan.wing ?? 'MANGO') || registered.number !== court.court; })) fail('CHECKOUT_WING_IDENTITY_MISMATCH');
  if (new Set(courts.map(court => court.spaceId)).size !== courts.length ||
    courts.some((court, courtIndex) => validChunk.courts[courtIndex]?.spaceId !== court.spaceId ||
      court.date !== plan.targetDate || court.startTime !== plan.startTime || court.endTime !== plan.endTime ||
      court.slots.length !== plan.durationHours || court.durationMinutes !== plan.durationHours * 60 ||
      court.slots.some((slot, index) => !slot.isAvailable || slot.spaceId !== court.spaceId || slot.date !== court.date ||
        slot.bookingDate !== court.date || slot.currency !== 'PHP' ||
        slot.startTime !== (index === 0 ? court.startTime : court.slots[index - 1]!.endTime)) ||
      cents(court.price) !== cents(court.slots.reduce((sum, slot) => sum + slot.price, 0))) ||
    cents(plan.totalPrice) !== cents(courts.reduce((sum, court) => sum + court.price, 0)) || plan.currency !== 'PHP')
    fail('CHECKOUT_PLAN_INVALID');
  return courts;
}

/** Builds Onda's continuous-session public-checkout shape for one or two courts and 1–3 hours. */
export function buildStandardPublicCheckoutRequest(
  plan: BookingPlan,
  customer: ResolvedGuestCustomer,
  facilityId: string,
  proofs: readonly FreshSlotProof[],
): PublicCheckoutRequest {
  if (!nonempty(facilityId) || (plan.wing === 'BUKO' && facilityId !== FACILITY_ID)) fail('CHECKOUT_FACILITY_INVALID');
  validCustomer(customer);
  const courts = [...standardCourts(plan)].sort((a, b) =>
    a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.spaceId.localeCompare(b.spaceId));
  const slots = courts.flatMap(court => court.slots);
  if (proofs.length !== slots.length) fail('AVAILABILITY_PROOF_MISSING');
  let proofIndex = 0;
  const items = courts.flatMap((court, courtIndex) => court.slots.map((slot): PublicCheckoutItem => {
    const proof = proofs[proofIndex++];
    if (!proof || proof.spaceId !== slot.spaceId || proof.date !== slot.date || proof.startTime !== slot.startTime || proof.endTime !== slot.endTime || !nonempty(proof.availabilityProof))
      fail('AVAILABILITY_PROOF_SLOT_MISMATCH');
    const validProof = proof!;
    return { spaceId: slot.spaceId, facilityId, date: slot.date, startTime: slot.startTime, endTime: ondaCheckoutBoundary(slot.endTime),
      duration: 60, rate: slot.price, chargedAmount: slot.price, guestCount: 1, promotionId: null,
      activityKey: plan.wing === 'BUKO' ? 'pickleball' : null, activityLabel: plan.wing === 'BUKO' ? 'Pickleball' : null,
      sessionRef: `session_${courtIndex + 1}`, availabilityProof: validProof.availabilityProof };
  }));
  return { bookingType: 'online', clientId: customer.clientId, customerId: customer.customerId,
    customerFirstName: null, customerLastName: null,
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
  const courts = [...standardCourts(plan)].sort((a, b) =>
    a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.spaceId.localeCompare(b.spaceId));
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail('CHECKOUT_CLOCK_INVALID');
  const root = requiredObject(raw, 'CHECKOUT_RESPONSE_INVALID');
  const bookingsValue = root.bookings, sessionsValue = root.bookingSessions, transaction = object(root.transaction);
  const total = request.items.reduce((sum, item) => sum + item.chargedAmount, 0);
  if (root.success !== true || !Array.isArray(bookingsValue) || bookingsValue.length !== request.items.length ||
    !Array.isArray(sessionsValue) || ![courts.length, request.items.length].includes(sessionsValue.length) || !transaction || transaction.status !== 'pending' ||
    !nonempty(transaction.id) || !sameAmount(transaction.amount, total) || !sameAmount(root.trustedTotalAmount, total))
    fail('CHECKOUT_RESPONSE_INVALID');
  const validTransaction = transaction!;
  const bookings = bookingsValue as unknown[], sessions = sessionsValue as unknown[];
  const sessionIds: string[] = [];
  const sessionById = new Map<string, Record<string, unknown>>();
  const hourlySessions = sessions.length === request.items.length;
  for (const rawSession of sessions) {
    const session = requiredObject(rawSession, 'CHECKOUT_SESSION_INVALID');
    if (!nonempty(session.bookingSessionId) || sessionById.has(session.bookingSessionId) ||
      !Array.isArray(session.bookingIds) || session.bookingIds.length === 0 ||
      new Set(session.bookingIds).size !== session.bookingIds.length) fail('CHECKOUT_SESSION_INVALID');
    // Bind sessions by their returned identity, never their array position. A provider may
    // return one continuous session per court or one session per hourly booking.
    const entries = bookings.map((booking, index) => ({ booking: object(booking), item: request.items[index]! }))
      .filter(entry => entry.booking?.booking_session_id === session.bookingSessionId);
    const items = entries.map(entry => entry.item);
    const first = items[0];
    if (!first || (hourlySessions ? items.length !== 1 : items.length !== plan.durationHours)) fail('CHECKOUT_SESSION_INVALID');
    const expectedIds = entries.map(entry => entry.booking?.id);
    if ((session.bookingIds as unknown[]).length !== expectedIds.length || expectedIds.some(id => !(session.bookingIds as unknown[]).includes(id)))
      fail('CHECKOUT_GROUPING_INVALID');
    if (session.requestSessionRef !== first!.sessionRef ||
      items.some(item => item.sessionRef !== first!.sessionRef || item.spaceId !== first!.spaceId || item.date !== first!.date) ||
      session.facilityId !== request.facilityId || session.spaceId !== first!.spaceId || session.date !== first!.date ||
      session.startTime !== seconds(items[0]!.startTime) || session.endTime !== seconds(items.at(-1)!.endTime) ||
      session.durationHours !== items.length) fail('CHECKOUT_SESSION_INVALID');
    sessionIds.push(session.bookingSessionId as string); sessionById.set(session.bookingSessionId as string, session);
  }
  if (new Set(sessionIds).size !== sessionIds.length) fail('CHECKOUT_SESSION_INVALID');
  const bookingIds: string[] = [], bookingNumbers: string[] = [], keys = new Set<string>();
  let responseCustomerId: string | undefined;
  let holdExpiresAt: string | undefined;
  for (const [index, rawBooking] of bookings.entries()) {
    const booking = object(rawBooking), item = request.items[index]!, session = sessionById.get(String(booking?.booking_session_id));
    if (!booking) fail('CHECKOUT_BOOKING_INVALID');
    const validBooking = booking!;
    const returnedCustomerId = typeof validBooking.customer_id === 'string' ? validBooking.customer_id : '';
    if (!safeIdentifier(returnedCustomerId)) fail('CHECKOUT_BOOKING_INVALID');
    if (responseCustomerId !== undefined && returnedCustomerId !== responseCustomerId) fail('CHECKOUT_BOOKING_INVALID');
    responseCustomerId = returnedCustomerId;
    if (!nonempty(validBooking.id) || !nonempty(validBooking.booking_no) || validBooking.booking_status !== 'pending' ||
      validBooking.payment_status !== 'pending' || !session || validBooking.booking_session_id !== session.bookingSessionId ||
      validBooking.space_id !== item.spaceId ||
      (validBooking.facility_id !== undefined && validBooking.facility_id !== item.facilityId) ||
      validBooking.date !== item.date || validBooking.start_time !== seconds(item.startTime) || validBooking.end_time !== seconds(item.endTime) ||
      validBooking.duration !== 60 || !sameAmount(validBooking.rate, item.rate) || validBooking.guest_count !== 1 ||
      !nonempty(validBooking.hold_expires_at) || !Number.isFinite(Date.parse(validBooking.hold_expires_at)) ||
      Date.parse(validBooking.hold_expires_at) <= now.getTime()) fail('CHECKOUT_BOOKING_INVALID');
    const key = `${validBooking.space_id}/${validBooking.date}/${validBooking.start_time}/${validBooking.end_time}`;
    if (keys.has(key) || bookingIds.includes(validBooking.id as string) || bookingNumbers.includes(validBooking.booking_no as string) ||
      (holdExpiresAt !== undefined && holdExpiresAt !== validBooking.hold_expires_at)) fail('CHECKOUT_BOOKING_DUPLICATE');
    keys.add(key);
    holdExpiresAt = validBooking.hold_expires_at as string;
    bookingIds.push(validBooking.id as string); bookingNumbers.push(validBooking.booking_no as string);
  }
  for (const [sessionId, session] of sessionById) {
    const expected = bookings.map((value, index) => ({ value: object(value), item: request.items[index]! }))
      .filter(entry => entry.value?.booking_session_id === sessionId).map(entry => entry.value?.id);
    const actual = session.bookingIds as unknown[];
    if (new Set(actual).size !== expected.length || expected.some(id => !actual.includes(id))) fail('CHECKOUT_GROUPING_INVALID');
  }
  if (new Set(bookingIds).size !== bookingIds.length || new Set(bookingNumbers).size !== bookingNumbers.length ||
    validTransaction.reference !== bookingNumbers[0]) fail('CHECKOUT_GROUPING_INVALID');
  return { bookingIds, bookingNumbers, sessionId: sessionIds[0]!, sessionIds, holdExpiresAt: holdExpiresAt!,
    transactionId: validTransaction.id as string, trustedTotalAmount: root.trustedTotalAmount as number };
}
