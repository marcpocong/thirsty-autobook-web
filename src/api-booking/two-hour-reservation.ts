import { courtBySpace } from '../court-registry.js';
import { THIRSTY_PICKLE_FACILITY_ID } from './live-availability-provider.js';
import { DurableSubmissionJournal, type ObservedCheckoutResponse, type SubmissionPermit } from './durable-submission-journal.js';
import { acquireFreshSlotProofs } from './slot-proofs.js';
import { SubmissionDispatchError } from './submission-errors.js';
import { createHash } from 'node:crypto';
import type { BookingPlan } from './types.js';
import { buildStandardPublicCheckoutRequest, validatePublicCheckoutResponse } from './public-checkout.js';

export interface HourIdentity { spaceId: string; date: string; startTime: string; endTime: string }
export interface SlotCheckRequest extends HourIdentity { clientId: string; facilityId: string }
export interface CheckoutCustomer { clientId: string; customerId: string; customerFirstName: string; customerLastName: string; customerEmail: string; customerPhone: string }
export interface TwoHourItem extends HourIdentity {
  activityKey: null | 'pickleball'; activityLabel: null | 'Pickleball'; availabilityProof: string; chargedAmount: number; duration: 60;
  facilityId: string; guestCount: 1; promotionId: null; rate: number; sessionRef: `session_${number}`;
}
export interface TwoHourCheckoutRequest extends Omit<CheckoutCustomer, 'customerFirstName' | 'customerLastName'> {
  bookingType: 'online'; customerFirstName: null; customerLastName: null; facilityId: string;
  items: TwoHourItem[]; usedCustomerMembershipId: null; userId: null;
}
export interface VerifiedTwoHourHold { bookingIds: string[]; sessionId: string; holdExpiresAt: string; transactionId: string }
export type ReservationPhase = 'SECURITY_CONTEXT_READY' | 'SLOT_PROOFS_READY' | 'CHECKOUT_RESPONSE_RECEIVED';

/** An observed-schema transport must implement both calls; this contract never generates proofs. */
export interface TwoHourTransport {
  /** Onda's court UI obtains its challenge and fingerprint before its final slot checks. */
  prepareCheckoutContext?(): Promise<void>;
  /** Must make a new normal-session request for each call; no proof cache or captured values. */
  checkSlot(request: SlotCheckRequest): Promise<unknown>;
  publicCheckout(request: TwoHourCheckoutRequest, permit: SubmissionPermit): Promise<unknown>;
}

export class TwoHourReservationError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'TwoHourReservationError'; }
}
function fail(code: string): never { throw new TwoHourReservationError(code); }
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const safeIdentifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);

/** Retains only recovery identifiers and totals if a successful HTTP response fails strict validation. */
export function observedResponse(raw: unknown, validationCode: string): ObservedCheckoutResponse {
  const root = object(raw);
  const bookings = Array.isArray(root?.bookings) ? root.bookings.slice(0, 12).map(object) : [];
  const sessions = Array.isArray(root?.bookingSessions) ? root.bookingSessions.slice(0, 12).map(object) : [];
  const transaction = object(root?.transaction);
  const paths:string[]=[];
  const kind=(v:unknown)=>v===null?'null':Array.isArray(v)?'array':typeof v;
  for(const key of ['success','bookings','bookingSessions','transaction','trustedTotalAmount'])paths.push(`${key}:${kind(root?.[key])}`);
  for(const [name,values,fields] of [['bookings',bookings,['id','booking_session_id','space_id','date','start_time','end_time','hold_expires_at']],
    ['bookingSessions',sessions,['requestSessionRef','bookingSessionId','bookingIds','spaceId','date','startTime','endTime','durationHours']]] as const)
    for(const key of fields)for(const type of new Set(values.map(v=>kind(v?.[key]))))paths.push(`${name}[].${key}:${type}`);
  const structure={bookingCount:Array.isArray(root?.bookings)?root.bookings.length:null,sessionCount:Array.isArray(root?.bookingSessions)?root.bookingSessions.length:null,
    missingSessionLinks:bookings.filter(booking=>!sessions.some(session=>typeof booking?.booking_session_id==='string'&&session?.bookingSessionId===booking.booking_session_id)).length,
    shapeFingerprint:createHash('sha256').update(JSON.stringify(paths)).digest('hex'),paths:paths.slice(0,64)};
  const ids = (key: string, values: Array<Record<string, unknown> | null>) =>
    values.map(value => value?.[key]).filter(safeIdentifier);
    return { success: root?.success === true, structure,bookingIds: ids('id', bookings),
    bookingNumbers: ids('booking_no', bookings), bookingSessionIds: ids('bookingSessionId', sessions),
    holdExpiresAt: bookings.map(value => value?.hold_expires_at).filter((value): value is string =>
      typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value))),
    ...(typeof transaction?.amount === 'number' && Number.isFinite(transaction.amount)
      ? { transactionAmount: transaction.amount } : {}),
    ...(safeIdentifier(transaction?.id) ? { transactionId: transaction.id } : {}),
    ...(typeof root?.trustedTotalAmount === 'number' && Number.isFinite(root.trustedTotalAmount)
      ? { trustedTotalAmount: root.trustedTotalAmount } : {}), validationCode };
}

export function selectedTwoHours(plan: BookingPlan): [HourIdentity, HourIdentity] {
  if (plan.mode !== 'standard' || plan.durationHours !== 2 || plan.courts.length !== 1 || plan.chunks.length !== 1 ||
    plan.chunks[0]?.courts.length !== 1 || plan.chunks[0]?.durationHours !== 2 || plan.targetDate !== plan.courts[0]?.date ||
    plan.startTime !== plan.courts[0]?.startTime || plan.endTime !== plan.courts[0]?.endTime) fail('TWO_HOUR_PLAN_REQUIRED');
  const court = plan.courts[0]!;
  if (courtBySpace(court.spaceId)?.wing !== (plan.wing ?? 'MANGO') || courtBySpace(court.spaceId)?.number !== court.court ||
    court.slots.length !== 2 || court.durationMinutes !== 120 || !court.slots.every(slot => slot.isAvailable &&
      slot.spaceId === court.spaceId && slot.court === court.court && slot.date === court.date && slot.bookingDate === court.date &&
      slot.currency === 'PHP') || court.slots[0]?.startTime !== court.startTime ||
    court.slots[0]?.endTime !== court.slots[1]?.startTime || court.slots[1]?.endTime !== court.endTime ||
    court.slots.some(slot => !/^([01]\d|2[0-3]):00$/.test(slot.startTime) ||
      slot.endTime !== (Number(slot.startTime.slice(0, 2)) === 23 ? '00:00' : `${String(Number(slot.startTime.slice(0, 2)) + 1).padStart(2, '0')}:00`)) ||
    plan.currency !== 'PHP' || plan.totalPrice !== court.slots.reduce((sum, slot) => sum + slot.price, 0)) fail('TWO_HOUR_PLAN_INVALID');
  return court.slots.map(slot => ({ spaceId: slot.spaceId, date: slot.date, startTime: slot.startTime, endTime: slot.endTime })) as [HourIdentity, HourIdentity];
}

/** One to three exact hours from a live, single-court standard plan. */
export function selectedStandardHours(plan: BookingPlan): HourIdentity[] {
  const chunk = plan.chunks[0];
  if (plan.mode !== 'standard' || ![1, 2, 3].includes(plan.durationHours) || ![1, 2].includes(plan.courts.length) ||
    plan.chunks.length !== 1 || chunk?.durationHours !== plan.durationHours || chunk.courts.length !== plan.courts.length ||
    new Set(plan.courts.map(court => court.spaceId)).size !== plan.courts.length ||
    plan.courts.some((court, courtIndex) => chunk.courts[courtIndex]?.spaceId !== court.spaceId ||
      courtBySpace(court.spaceId)?.wing !== (plan.wing ?? 'MANGO') || courtBySpace(court.spaceId)?.number !== court.court ||
      court.durationMinutes !== plan.durationHours * 60 || court.date !== plan.targetDate ||
      court.startTime !== plan.startTime || court.endTime !== plan.endTime || court.slots.length !== plan.durationHours ||
      court.slots.some((slot, index) => slot.spaceId !== court.spaceId || slot.court !== court.court ||
        slot.date !== court.date || slot.bookingDate !== court.date || !slot.isAvailable || slot.currency !== 'PHP' ||
        slot.startTime !== (index ? court.slots[index - 1]!.endTime : court.startTime)) ||
      court.slots.at(-1)?.endTime !== court.endTime ||
      court.price !== court.slots.reduce((sum, slot) => sum + slot.price, 0)) || plan.currency !== 'PHP' ||
    plan.totalPrice !== plan.courts.reduce((sum, court) => sum + court.price, 0)) fail('STANDARD_PLAN_INVALID');
  return [...plan.courts].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) ||
    a.spaceId.localeCompare(b.spaceId)).flatMap(court => court.slots.map(slot => ({ spaceId: slot.spaceId,
      date: slot.date, startTime: slot.startTime, endTime: slot.endTime })));
}

export function standardPlanJournalKeys(plan: BookingPlan, facilityId: string): string[] {
  selectedStandardHours(plan);
  return [...plan.courts].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) ||
    a.spaceId.localeCompare(b.spaceId)).map(court => DurableSubmissionJournal.key(facilityId, court.spaceId,
      plan.targetDate, plan.startTime, plan.endTime));
}

/** Validates the observed two-booking, one-session pending response. No checkout handoff is inferred. */
export function validateTwoHourResponse(raw: unknown, request: TwoHourCheckoutRequest, now: Date): VerifiedTwoHourHold {
  const root = object(raw);
  const bookings = root?.bookings;
  const sessions = root?.bookingSessions;
  const transaction = object(root?.transaction);
  const total = request.items.reduce((sum, item) => sum + item.chargedAmount, 0);
  if (root?.success !== true || !Array.isArray(bookings) || bookings.length !== 2 ||
    !Array.isArray(sessions) || sessions.length !== 1 || !transaction || transaction.status !== 'pending' ||
    !nonempty(transaction.id) || transaction.amount !== total || root.trustedTotalAmount !== total)
    fail('CHECKOUT_RESPONSE_INVALID');
  const [first, second] = request.items;
  if (!first || !second || request.items.length !== 2) fail('CHECKOUT_ITEMS_INVALID');
  const parsedBookings = bookings as unknown[];
  const session = object((sessions as unknown[])[0]);
  if (!session || session.requestSessionRef !== 'session_1' || !nonempty(session.bookingSessionId) ||
    session.facilityId !== request.facilityId || session.spaceId !== first.spaceId ||
    session.date !== first.date || session.startTime !== `${first.startTime}:00` ||
    session.endTime !== `${second.endTime}:00` || session.durationHours !== 2 ||
    !Array.isArray(session.bookingIds) || session.bookingIds.length !== 2)
    fail('CHECKOUT_SESSION_INVALID');
  const ids: string[] = [];
  let expiry: string | undefined;
  for (const [index, bookingValue] of parsedBookings.entries()) {
    const booking = object(bookingValue);
    const item = request.items[index]!;
    if (!booking || !nonempty(booking.id) || !nonempty(booking.booking_no) ||
      booking.booking_status !== 'pending' || booking.payment_status !== 'pending' ||
      booking.booking_session_id !== session.bookingSessionId || booking.customer_id !== request.customerId ||
      booking.space_id !== item.spaceId || booking.date !== item.date ||
      booking.start_time !== `${item.startTime}:00` || booking.end_time !== `${item.endTime}:00` ||
      booking.duration !== 60 || booking.rate !== item.rate || booking.guest_count !== 1 ||
      !nonempty(booking.hold_expires_at) || !Number.isFinite(Date.parse(booking.hold_expires_at)) ||
      Date.parse(booking.hold_expires_at) <= now.getTime() ||
      (expiry !== undefined && expiry !== booking.hold_expires_at)) fail('CHECKOUT_BOOKING_INVALID');
    expiry = booking.hold_expires_at;
    ids.push(booking.id);
  }
  if (new Set(ids).size !== 2 || new Set(session.bookingIds).size !== 2 ||
    ids.some(id => !(session.bookingIds as unknown[]).includes(id))) fail('CHECKOUT_GROUPING_INVALID');
  if (transaction.reference !== object(parsedBookings[0])?.booking_no) fail('CHECKOUT_TRANSACTION_INVALID');
  return { bookingIds: ids as [string, string], sessionId: session.bookingSessionId as string,
    holdExpiresAt: expiry!, transactionId: transaction.id };
}

export class TwoHourReservationAdapter {
  constructor(private readonly transport: TwoHourTransport, private readonly journal: DurableSubmissionJournal,
    private readonly clock: () => Date = () => new Date(), private readonly maximumProofAgeMs = 15_000,
    private readonly additionalJournals: DurableSubmissionJournal[] = [],
    private readonly onPhase?: (phase:ReservationPhase)=>void) {}

  private phase(value:ReservationPhase){try{this.onPhase?.(value);}catch{/* Timing must never change booking outcome. */}}

  async submit(plan: BookingPlan, customer: CheckoutCustomer, control: { supervisedOneShot: true }): Promise<VerifiedTwoHourHold> {
    if (control?.supervisedOneShot !== true || process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT !== 'SUPERVISED_ONE_SHOT')
      fail('LIVE_SUBMISSION_DISABLED');
    const hours = selectedStandardHours(plan);
    if (!Object.values(customer).every(nonempty) || Object.values(customer).some(value => /^<.*>$/.test(value)) || Object.values(customer).some(value => /[\r\n]/.test(value)))
      fail('CHECKOUT_CUSTOMER_INVALID');
    if (!Number.isFinite(this.maximumProofAgeMs) || this.maximumProofAgeMs <= 0) fail('PROOF_AGE_INVALID');
    await this.transport.prepareCheckoutContext?.();
    this.phase('SECURITY_CONTEXT_READY');
    // Each hour has its own fresh check. Any failed check stops before the durable dispatch record.
    const proofs = await acquireFreshSlotProofs(hours, { clientId: customer.clientId,
      facilityId: THIRSTY_PICKLE_FACILITY_ID, transport: this.transport, clock: this.clock,
      maximumAgeMs: this.maximumProofAgeMs, concurrency: 2 });
    this.phase('SLOT_PROOFS_READY');
    const request = buildStandardPublicCheckoutRequest(plan, customer, THIRSTY_PICKLE_FACILITY_ID, proofs);
    const now = this.clock();
    const keys = standardPlanJournalKeys(plan, THIRSTY_PICKLE_FACILITY_ID);
    const journals = [this.journal, ...this.additionalJournals];
    if (journals.length !== keys.length) fail('SUBMISSION_JOURNAL_COUNT_INVALID');
    const key = keys[0]!;
    const planFingerprint = createHash('sha256').update(JSON.stringify({ mode: plan.mode, targetDate: plan.targetDate,
      durationHours: plan.durationHours, courts: plan.courts.map(court => ({ court: court.court, spaceId: court.spaceId,
        date: court.date, startTime: court.startTime, endTime: court.endTime, price: court.price })) })).digest('hex');
    const begun: Array<{ journal: DurableSubmissionJournal; key: string }> = [];
    try {
      for (const [index, currentKey] of keys.entries()) {
        const journal = journals[index]!;
        await journal.begin(currentKey, now, { attemptId: currentKey, planFingerprint, targetDate: plan.targetDate,
          ...(plan.wing === 'BUKO' ? {wing:plan.wing,spaceIds:plan.courts.map(court=>court.spaceId)} : {}),
          courtIds: plan.courts.map(court => court.court),
          hourlyBoundaries: hours.map(hour => ({ startTime: hour.startTime, endTime: hour.endTime })),
          expectedBookingCount: request.items.length, maximumAmount: plan.totalPrice, stage: 'dispatching' });
        begun.push({ journal, key: currentKey });
      }
    } catch (error) {
      await Promise.allSettled(begun.map(entry => entry.journal.mark(entry.key, 'rejected', this.clock(),
        undefined, undefined, 'DUPLICATE_LOGICAL_BOOKING_BLOCKED')));
      throw error;
    }
    const markAll = async (state: 'unknown' | 'verified' | 'rejected', diagnostic?: Parameters<DurableSubmissionJournal['mark']>[3],
      observed?: ObservedCheckoutResponse, failureCode?: string) => {
      await Promise.all(begun.map(entry => entry.journal.mark(entry.key, state, this.clock(), diagnostic, observed, failureCode)));
    };
    let permit: SubmissionPermit;
    try { permit = await this.journal.claimSupervisedOneShot(key, now); }
    catch (error) { await markAll('rejected'); throw error; }
    try {
      const raw = await this.transport.publicCheckout(request, permit);
      this.phase('CHECKOUT_RESPONSE_RECEIVED');
      let verified: VerifiedTwoHourHold;
      try {
        const response = validatePublicCheckoutResponse(raw, request, plan, this.clock(), plan.totalPrice);
        verified = { bookingIds: response.bookingIds, sessionId: response.sessionId,
          holdExpiresAt: response.holdExpiresAt, transactionId: response.transactionId };
      }
      catch (error) {
        const code = error instanceof Error && 'code' in error && typeof error.code === 'string'
          ? error.code : 'CHECKOUT_RESPONSE_VALIDATION_FAILED';
        await markAll('unknown', undefined, observedResponse(raw, code), code);
        fail('SUBMISSION_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED');
      }
      await markAll('verified', undefined, observedResponse(raw, 'CHECKOUT_RESPONSE_VERIFIED'));
      return verified;
    } catch (error) {
      // A sent request may have succeeded even when its response was lost or malformed.
      const dispatched = !(error instanceof SubmissionDispatchError) || error.dispatched;
      const confirmedRejected = error instanceof SubmissionDispatchError && error.confirmedRejected;
      const failureCode = error instanceof SubmissionDispatchError || error instanceof TwoHourReservationError
        ? error.code : 'CHECKOUT_UNEXPECTED_ERROR';
      await markAll(dispatched && !confirmedRejected ? 'unknown' : 'rejected',
        error instanceof SubmissionDispatchError ? error.diagnostic : undefined,
        undefined, failureCode).catch(() => undefined);
      if (!dispatched || confirmedRejected) throw error;
      fail('SUBMISSION_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED');
    }
  }
}
