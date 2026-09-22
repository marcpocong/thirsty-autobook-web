import type { Page } from 'playwright';
import type { AvailabilitySnapshot, BookingPlan } from './types.js';
import type { CheckoutCustomer, VerifiedTwoHourHold } from './two-hour-reservation.js';
import { selectedStandardHours, TwoHourReservationAdapter } from './two-hour-reservation.js';
import type { ReservationPhase } from './two-hour-reservation.js';
import { DurableSubmissionJournal } from './durable-submission-journal.js';
import { OndaBrowserSessionTransport, type CheckoutResponseCapture } from './browser-session-transport.js';
import { calendarFreeSecurityContext } from './calendar-free-security-context.js';
import { THIRSTY_PICKLE_FACILITY_ID } from './live-availability-provider.js';
import { THIRSTY_PICKLE_CLIENT_ID } from './local-customer.js';

export interface ApprovedCalendarFreeAttempt {
  courts: number[]; date: string; startTime: string; endTime: string; maximumAmount: number;
  customerId: string; approvalReference: string;
}

/** A supervised entry point; the caller must supply a fresh journal with a new one-shot permit. */
export async function submitCalendarFreeTwoHourCheckout(input: {
  page: Page; plan: BookingPlan; availability: AvailabilitySnapshot; customer: CheckoutCustomer;
  approval: ApprovedCalendarFreeAttempt; journal: DurableSubmissionJournal;
  additionalJournals?: DurableSubmissionJournal[];
  captureCheckoutResponse?: CheckoutResponseCapture;
  transport?: OndaBrowserSessionTransport;
  onPhase?(phase:ReservationPhase):void;
  onHumanVerificationRequired?(): Promise<void>;
  onHumanVerificationCompleted?(): Promise<void>;
}): Promise<VerifiedTwoHourHold> {
  if (process.env.ONDA_CALENDAR_FREE_CHECKOUT !== 'APPROVED_ONE_SHOT' ||
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT !== 'SUPERVISED_ONE_SHOT')
    throw Error('CALENDAR_FREE_SUBMISSION_DISABLED');
  const { plan, availability, customer, approval } = input;
  const hours = selectedStandardHours(plan);
  const first = hours[0]!, last = hours.at(-1)!;
  const age = Date.now() - Date.parse(availability.capturedAt);
  if (availability.fixtureKind !== 'live' || !Number.isFinite(age) || age < 0 || age > 15_000 ||
    availability.incompleteDates.includes(plan.targetDate) || availability.returnedDates[plan.targetDate] !== true ||
    !plan.courts.every(court => court.slots.every(slot => availability.slots.some(current =>
      current.spaceId === slot.spaceId && current.date === slot.date && current.startTime === slot.startTime &&
      current.endTime === slot.endTime && current.isAvailable && current.price === slot.price))))
    throw Error('CALENDAR_FREE_FRESH_AVAILABILITY_REQUIRED');
  if (approval.courts.length !== plan.courts.length || approval.courts.some((court, index) => court !== plan.courts[index]?.court) ||
    approval.date !== plan.targetDate ||
    approval.startTime !== first.startTime || approval.endTime !== last.endTime ||
    approval.customerId !== customer.customerId || !Number.isFinite(approval.maximumAmount) ||
    plan.totalPrice > approval.maximumAmount || !approval.approvalReference.trim() ||
    new Set(hours.map(hour => hour.spaceId)).size !== plan.courts.length || customer.clientId !== THIRSTY_PICKLE_CLIENT_ID)
    throw Error('CALENDAR_FREE_APPROVAL_MISMATCH');
  if(input.transport&&!input.transport.isForPage(input.page))throw Error('CALENDAR_FREE_TRANSPORT_PAGE_MISMATCH');
  const transport = input.transport ?? new OndaBrowserSessionTransport(input.page, () => calendarFreeSecurityContext(input.page)(),
    input.captureCheckoutResponse, { onHumanVerificationRequired: input.onHumanVerificationRequired,
      onHumanVerificationCompleted: input.onHumanVerificationCompleted });
  return new TwoHourReservationAdapter(transport, input.journal, undefined, undefined,
    input.additionalJournals, input.onPhase).submit(plan, customer, { supervisedOneShot: true });
}
