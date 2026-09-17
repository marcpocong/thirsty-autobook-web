import { COURT_TO_SPACE_ID } from './availability-parser.js';
import { THIRSTY_PICKLE_FACILITY_ID } from './live-availability-provider.js';
import { DurableSubmissionJournal, type SubmissionPermit } from './durable-submission-journal.js';
import { acquireFreshSlotProofs } from './slot-proofs.js';
import { SubmissionDispatchError } from './submission-errors.js';
import { createHash } from 'node:crypto';
import type { BookingPlan } from './types.js';

export interface HourIdentity { spaceId: string; date: string; startTime: string; endTime: string }
export interface SlotCheckRequest extends HourIdentity { clientId: string; facilityId: string }
export interface CheckoutCustomer { clientId: string; customerId: string; customerFirstName: string; customerLastName: string; customerEmail: string; customerPhone: string }
export interface TwoHourItem extends HourIdentity {
  activityKey: null; activityLabel: null; availabilityProof: string; chargedAmount: number; duration: 60;
  facilityId: string; guestCount: 1; promotionId: null; rate: number; sessionRef: 'session_1';
}
export interface TwoHourCheckoutRequest extends Omit<CheckoutCustomer, 'customerFirstName' | 'customerLastName'> {
  bookingType: 'online'; customerFirstName: null; customerLastName: null; facilityId: string;
  items: [TwoHourItem, TwoHourItem]; usedCustomerMembershipId: null; userId: null;
}
export interface VerifiedTwoHourHold { bookingIds: [string, string]; sessionId: string; holdExpiresAt: string; transactionId: string }

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

export function selectedTwoHours(plan: BookingPlan): [HourIdentity, HourIdentity] {
  if (plan.mode !== 'standard' || plan.durationHours !== 2 || plan.courts.length !== 1 || plan.chunks.length !== 1 ||
    plan.chunks[0]?.courts.length !== 1 || plan.chunks[0]?.durationHours !== 2 || plan.targetDate !== plan.courts[0]?.date ||
    plan.startTime !== plan.courts[0]?.startTime || plan.endTime !== plan.courts[0]?.endTime) fail('TWO_HOUR_PLAN_REQUIRED');
  const court = plan.courts[0]!;
  if (COURT_TO_SPACE_ID[court.court as keyof typeof COURT_TO_SPACE_ID] !== court.spaceId ||
    court.slots.length !== 2 || court.durationMinutes !== 120 || !court.slots.every(slot => slot.isAvailable &&
      slot.spaceId === court.spaceId && slot.court === court.court && slot.date === court.date && slot.bookingDate === court.date &&
      slot.currency === 'PHP') || court.slots[0]?.startTime !== court.startTime ||
    court.slots[0]?.endTime !== court.slots[1]?.startTime || court.slots[1]?.endTime !== court.endTime ||
    court.slots.some(slot => !/^([01]\d|2[0-3]):00$/.test(slot.startTime) ||
      slot.endTime !== (Number(slot.startTime.slice(0, 2)) === 23 ? '00:00' : `${String(Number(slot.startTime.slice(0, 2)) + 1).padStart(2, '0')}:00`)) ||
    plan.currency !== 'PHP' || plan.totalPrice !== court.slots.reduce((sum, slot) => sum + slot.price, 0)) fail('TWO_HOUR_PLAN_INVALID');
  return court.slots.map(slot => ({ spaceId: slot.spaceId, date: slot.date, startTime: slot.startTime, endTime: slot.endTime })) as [HourIdentity, HourIdentity];
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
  const parsedBookings = bookings as unknown[];
  const session = object((sessions as unknown[])[0]);
  if (!session || session.requestSessionRef !== 'session_1' || !nonempty(session.bookingSessionId) ||
    session.facilityId !== request.facilityId || session.spaceId !== request.items[0].spaceId ||
    session.date !== request.items[0].date || session.startTime !== `${request.items[0].startTime}:00` ||
    session.endTime !== `${request.items[1].endTime}:00` || session.durationHours !== 2 ||
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
    private readonly clock: () => Date = () => new Date(), private readonly maximumProofAgeMs = 15_000) {}

  async submit(plan: BookingPlan, customer: CheckoutCustomer, control: { supervisedOneShot: true }): Promise<VerifiedTwoHourHold> {
    if (control?.supervisedOneShot !== true || process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT !== 'SUPERVISED_ONE_SHOT')
      fail('LIVE_SUBMISSION_DISABLED');
    const hours = selectedTwoHours(plan);
    if (!Object.values(customer).every(nonempty) || Object.values(customer).some(value => /^<.*>$/.test(value)) || Object.values(customer).some(value => /[\r\n]/.test(value)))
      fail('CHECKOUT_CUSTOMER_INVALID');
    if (!Number.isFinite(this.maximumProofAgeMs) || this.maximumProofAgeMs <= 0) fail('PROOF_AGE_INVALID');
    await this.transport.prepareCheckoutContext?.();
    // Each hour has its own fresh check. Any failed check stops before the durable dispatch record.
    const proofs = await acquireFreshSlotProofs(hours, { clientId: customer.clientId,
      facilityId: THIRSTY_PICKLE_FACILITY_ID, transport: this.transport, clock: this.clock,
      maximumAgeMs: this.maximumProofAgeMs, concurrency: 2 });
    const items = hours.map((hour, index) => ({ ...hour, activityKey: null, activityLabel: null,
      availabilityProof: proofs[index]!.availabilityProof, chargedAmount: plan.courts[0]!.slots[index]!.price, duration: 60 as const,
      facilityId: THIRSTY_PICKLE_FACILITY_ID, guestCount: 1 as const, promotionId: null,
      rate: plan.courts[0]!.slots[index]!.price, sessionRef: 'session_1' as const })) as [TwoHourItem, TwoHourItem];
    // The court UI passes null names to createBookingTransaction even after resolving a customer ID.
    const request: TwoHourCheckoutRequest = { bookingType: 'online', ...customer,
      customerFirstName: null, customerLastName: null,
      facilityId: THIRSTY_PICKLE_FACILITY_ID, items, usedCustomerMembershipId: null, userId: null };
    const now = this.clock();
    const key = DurableSubmissionJournal.key(THIRSTY_PICKLE_FACILITY_ID, hours[0].spaceId, hours[0].date, hours[0].startTime, hours[1].endTime);
    const planFingerprint = createHash('sha256').update(JSON.stringify({ mode: plan.mode, targetDate: plan.targetDate,
      durationHours: plan.durationHours, courts: plan.courts.map(court => ({ court: court.court, spaceId: court.spaceId,
        date: court.date, startTime: court.startTime, endTime: court.endTime, price: court.price })) })).digest('hex');
    await this.journal.begin(key, now, { attemptId: key, planFingerprint, targetDate: plan.targetDate,
      courtIds: [plan.courts[0]!.court], hourlyBoundaries: hours.map(hour => ({ startTime: hour.startTime, endTime: hour.endTime })),
      expectedBookingCount: items.length, maximumAmount: plan.totalPrice, stage: 'dispatching' });
    let permit: SubmissionPermit;
    try { permit = await this.journal.claimSupervisedOneShot(key, now); }
    catch (error) { await this.journal.mark(key, 'rejected', this.clock()); throw error; }
    try {
      const raw = await this.transport.publicCheckout(request, permit);
      const verified = validateTwoHourResponse(raw, request, this.clock());
      await this.journal.mark(key, 'verified', this.clock());
      return verified;
    } catch (error) {
      // A sent request may have succeeded even when its response was lost or malformed.
      const dispatched = !(error instanceof SubmissionDispatchError) || error.dispatched;
      await this.journal.mark(key, dispatched ? 'unknown' : 'rejected', this.clock(),
        error instanceof SubmissionDispatchError ? error.diagnostic : undefined).catch(() => undefined);
      if (!dispatched) throw error;
      fail('SUBMISSION_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED');
    }
  }
}
