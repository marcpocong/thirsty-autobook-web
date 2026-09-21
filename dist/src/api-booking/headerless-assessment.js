import { loadLocalCheckoutCustomer } from './local-customer.js';
import { HeaderlessAssessmentError, HeaderlessAssessmentTransport } from './headerless-assessment-transport.js';
import { selectedTwoHours, TwoHourReservationAdapter } from './two-hour-reservation.js';
/** Deliberately has no command-line entry point or desktop wiring. Invoke only for an approved exact attempt. */
export async function assessHeaderlessCheckout(input) {
    const { page, plan, availability, customer, approval, journal, observe } = input;
    const [first, second] = selectedTwoHours(plan);
    const ageMs = Date.now() - Date.parse(availability.capturedAt);
    if (availability.fixtureKind !== 'live' || !Number.isFinite(ageMs) || ageMs < 0 || ageMs > 15_000 ||
        availability.incompleteDates.includes(plan.targetDate) || availability.returnedDates[plan.targetDate] !== true ||
        !plan.courts[0].slots.every(slot => availability.slots.some(current => current.spaceId === slot.spaceId && current.date === slot.date && current.startTime === slot.startTime &&
            current.endTime === slot.endTime && current.isAvailable && current.price === slot.price)))
        throw new HeaderlessAssessmentError('ASSESSMENT_FRESH_AVAILABILITY_REQUIRED');
    if (approval.environment !== 'production' || approval.facilityId !== '5f8786bd-dc61-4509-b893-74cda8f783f7' ||
        approval.spaceId !== first.spaceId || approval.spaceId !== second.spaceId ||
        approval.date !== plan.targetDate || approval.startTime !== first.startTime ||
        approval.endTime !== second.endTime || approval.customerId !== customer.customerId ||
        approval.clientId !== customer.clientId ||
        !Number.isFinite(approval.maximumAmount) || approval.maximumAmount <= 0 ||
        plan.totalPrice > approval.maximumAmount || !approval.approvalReference.trim())
        throw new HeaderlessAssessmentError('ASSESSMENT_PLAN_MISMATCH');
    const transport = new HeaderlessAssessmentTransport(page, approval, observe);
    return new TwoHourReservationAdapter(transport, journal).submit(plan, customer, { supervisedOneShot: true });
}
/** Resolves the privately configured, contact-bound customer for a specifically approved assessment. */
export function assessHeaderlessCheckoutForConfiguredCustomer(input) {
    return assessHeaderlessCheckout({ ...input, customer: loadLocalCheckoutCustomer() });
}
//# sourceMappingURL=headerless-assessment.js.map