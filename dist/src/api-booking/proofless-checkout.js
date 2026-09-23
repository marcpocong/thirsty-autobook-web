import { createHash } from 'node:crypto';
import { COURT_TO_SPACE_ID } from './availability-parser.js';
import { THIRSTY_PICKLE_FACILITY_ID } from './live-availability-provider.js';
import { observedResponse, standardPlanJournalKeys } from './two-hour-reservation.js';
import { validatePublicCheckoutResponse } from './public-checkout.js';
import { SubmissionDispatchError } from './submission-errors.js';
import { targetDateState } from './court-hour-matrix.js';
export const DIRECT_ASSUMED_DAY_RATE = 600;
export const DIRECT_ASSUMED_EVENING_RATE = 700;
export const DIRECT_MAX_DISPATCH_LATENESS_MS = 1_000;
const unique = (values) => [...new Set(values)];
/**
 * Builds the deterministic saved-plan candidate used by the primary scheduled
 * release lane. It intentionally does not claim that the target date is open:
 * rates are the last verified venue schedule and every item remains proofless.
 */
export function prooflessReleasePlan(preferences) {
    const { mode, targetDate, durationHours, courtCount, currency } = preferences;
    const startTime = preferences.preferredStartTimes[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || !startTime || !/^([01]\d|2[0-3]):00$/.test(startTime) || currency !== 'PHP')
        throw Error('DIRECT_TARGET_INVALID');
    if ((mode === 'standard' && (durationHours < 1 || durationHours > 3)) || (mode === 'extended' && (durationHours < 4 || durationHours > 6)))
        throw Error('DIRECT_PLAN_INVALID');
    const startHour = Number(startTime.slice(0, 2));
    if (startHour < 8 || startHour + durationHours > 24)
        throw Error('DIRECT_TARGET_INVALID');
    const split = mode === 'standard' ? [durationHours] : [3, durationHours - 3];
    const priority = unique([...preferences.courtPriority, ...preferences.fallbackCourts]);
    if (priority.length < courtCount)
        throw Error('DIRECT_COURTS_MISSING');
    let offset = startHour;
    const chunks = [];
    const allCourts = [];
    for (const [chunkIndex, chunkDuration] of split.entries()) {
        const selected = preferences.exactCourts?.[chunkIndex] ?? priority.slice(0, courtCount);
        if (selected.length !== courtCount || unique(selected).length !== selected.length || selected.some(court => !COURT_TO_SPACE_ID[court]))
            throw Error('DIRECT_COURTS_INVALID');
        const courts = selected.map(court => {
            const spaceId = COURT_TO_SPACE_ID[court];
            const slots = Array.from({ length: chunkDuration }, (_, index) => {
                const hour = offset + index, start = `${String(hour).padStart(2, '0')}:00`, end = `${String(hour + 1).padStart(2, '0')}:00`;
                const price = hour >= 16 ? DIRECT_ASSUMED_EVENING_RATE : DIRECT_ASSUMED_DAY_RATE;
                return { court, spaceId, date: targetDate, bookingDate: targetDate, startTime: start, endTime: end, isAvailable: true,
                    isNightRate: hour >= 16, isNextDay: false, currency: 'PHP', price };
            });
            return { court, spaceId, date: targetDate, startTime: slots[0].startTime, endTime: slots.at(-1).endTime,
                durationMinutes: chunkDuration * 60, price: slots.reduce((sum, slot) => sum + slot.price, 0), currency: 'PHP', slots };
        });
        const totalPrice = courts.reduce((sum, court) => sum + court.price, 0);
        chunks.push({ startTime: courts[0].startTime, endTime: courts[0].endTime, durationHours: chunkDuration, courts, totalPrice });
        allCourts.push(...courts);
        offset += chunkDuration;
    }
    const totalPrice = chunks.reduce((sum, chunk) => sum + chunk.totalPrice, 0);
    if (Number.isFinite(preferences.maximumTotalPrice) && totalPrice > preferences.maximumTotalPrice)
        throw Error('DIRECT_PRICE_LIMIT_EXCEEDED');
    return { mode, targetDate, startTime, endTime: chunks.at(-1).endTime, durationHours, courts: allCourts, chunks, totalPrice, currency };
}
/** A complete, explicit status matrix for release diagnostics. Missing cells on
 * an unreleased date are UNRELEASED ("no known booking, date not yet published"),
 * never silently reported as open. Whether the date is unreleased comes from
 * targetDateState, which needs the release instant and response time; without
 * them, or after release, a missing date stays UNKNOWN. */
export function prooflessCourtHourStatuses(snapshot, date, publicBlocks = [], failedPublicCourts = [], context = {}) {
    const dateState = targetDateState(snapshot, date, context);
    return Array.from({ length: 7 }, (_, index) => index + 1).flatMap(court => Array.from({ length: 16 }, (_, index) => {
        const hour = `${String(index + 8).padStart(2, '0')}:00`;
        const hourEnd = `${String(index + 9).padStart(2, '0')}:00`;
        if (publicBlocks.some(block => block.court === court && block.startTime < hourEnd && block.endTime > hour))
            return { court, hour, status: 'BLOCKED', source: 'PUBLIC_BOOKING' };
        const slot = snapshot?.slots.find(value => value.date === date && value.court === court && value.startTime === hour);
        if (slot)
            return { court, hour, status: slot.isAvailable ? 'OPEN' : 'BLOCKED', source: 'AVAILABILITY', price: slot.price };
        if (failedPublicCourts.includes(court))
            return { court, hour, status: 'UNKNOWN', source: 'PUBLIC_BOOKING_QUERY_FAILED' };
        if (!snapshot)
            return { court, hour, status: 'UNKNOWN', source: 'AVAILABILITY_READ_FAILED' };
        return { court, hour, status: dateState === 'UNRELEASED' ? 'UNRELEASED' : 'UNKNOWN', source: dateState === 'UNRELEASED' ? 'DATE_UNRELEASED' : 'NO_AUTHORITATIVE_RECORD' };
    }));
}
/** Chooses the first saved start/court combination with no confirmed block.
 * OPEN cells and UNRELEASED cells with a successful public-record lookup may be
 * used. UNKNOWN fails closed. Exact test overrides are never changed. */
export function resolveProoflessReleasePlan(preferences, snapshot, publicBlocks = [], failedPublicCourts = [], context = {}) {
    const starts = unique([...preferences.preferredStartTimes, ...preferences.fallbackStartTimes]);
    const priority = unique([...preferences.courtPriority, ...preferences.fallbackCourts]);
    const statuses = prooflessCourtHourStatuses(snapshot, preferences.targetDate, publicBlocks, failedPublicCourts, context);
    const blocked = (court, start, duration) => Array.from({ length: duration }, (_, index) => `${String(Number(start.slice(0, 2)) + index).padStart(2, '0')}:00`).some(hour => statuses.some(value => value.court === court && value.hour === hour && ['BLOCKED', 'UNKNOWN'].includes(value.status)));
    for (const start of starts) {
        const exact = preferences.exactCourts;
        if (exact) {
            const split = preferences.mode === 'standard' ? [preferences.durationHours] : [3, preferences.durationHours - 3];
            let offset = Number(start.slice(0, 2)), valid = true;
            for (const [index, duration] of split.entries()) {
                const chunkStart = `${String(offset).padStart(2, '0')}:00`, courts = exact[index] ?? [];
                if (courts.length !== preferences.courtCount || courts.some(court => blocked(court, chunkStart, duration))) {
                    valid = false;
                    break;
                }
                offset += duration;
            }
            if (valid)
                return prooflessReleasePlan({ ...preferences, preferredStartTimes: [start], fallbackStartTimes: [] });
            continue;
        }
        const selected = priority.filter(court => !blocked(court, start, preferences.durationHours)).slice(0, preferences.courtCount);
        if (selected.length === preferences.courtCount) {
            const exactCourts = preferences.mode === 'standard' ? [selected] : [selected, selected];
            return prooflessReleasePlan({ ...preferences, preferredStartTimes: [start], fallbackStartTimes: [], exactCourts });
        }
    }
    throw Error('DIRECT_NO_UNBLOCKED_CONFIGURATION');
}
export function assertDirectDispatchWindow(releaseMs, now = Date.now()) {
    if (!Number.isSafeInteger(releaseMs) || releaseMs <= 0 || !Number.isFinite(now) || now < releaseMs ||
        now - releaseMs > DIRECT_MAX_DISPATCH_LATENESS_MS)
        throw Error('DIRECT_RELEASE_WINDOW_MISSED');
}
export function prooflessRequest(plan, customer) {
    if (plan.mode !== 'standard' || plan.chunks.length !== 1 || plan.courts.length < 1 || plan.courts.length > 2 ||
        plan.courts.some(court => court.slots.length !== plan.durationHours))
        throw Error('DIRECT_PLAN_INVALID');
    const courts = [...plan.courts].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.spaceId.localeCompare(b.spaceId));
    if (plan.totalPrice !== courts.reduce((sum, court) => sum + court.slots.reduce((slotSum, slot) => slotSum + slot.price, 0), 0))
        throw Error('DIRECT_PRICE_INVALID');
    return { clientId: customer.clientId, customerId: customer.customerId, customerEmail: customer.customerEmail,
        customerPhone: customer.customerPhone, customerFirstName: null, customerLastName: null, facilityId: THIRSTY_PICKLE_FACILITY_ID,
        bookingType: 'online', usedCustomerMembershipId: null, userId: null,
        items: courts.flatMap((court, courtIndex) => court.slots.map(slot => ({ sessionRef: `session_${courtIndex + 1}`, facilityId: THIRSTY_PICKLE_FACILITY_ID,
            spaceId: slot.spaceId, date: slot.date, startTime: slot.startTime, endTime: slot.endTime, duration: 60,
            rate: slot.price, chargedAmount: slot.price, guestCount: 1, activityKey: null, activityLabel: null, promotionId: null, availabilityProof: null }))) };
}
export async function submitDirectCheckout(plan, customer, transport, journal, releaseMs, additionalJournals = [], now = Date.now, dispatch = {}) {
    const request = prooflessRequest(plan, customer), keys = standardPlanJournalKeys(plan, THIRSTY_PICKLE_FACILITY_ID);
    const journals = [journal, ...additionalJournals];
    if (journals.length !== keys.length)
        throw Error('SUBMISSION_JOURNAL_COUNT_INVALID');
    const fingerprint = createHash('sha256').update(JSON.stringify({ courts: plan.courts.map(court => court.court), date: plan.targetDate,
        start: plan.startTime, end: plan.endTime, price: plan.totalPrice, method: 'direct-proofless' })).digest('hex');
    const begun = [];
    try {
        for (const [index, key] of keys.entries()) {
            const current = journals[index];
            await current.begin(key, new Date(now()), { attemptId: key, planFingerprint: fingerprint, targetDate: plan.targetDate,
                courtIds: plan.courts.map(court => court.court), hourlyBoundaries: plan.courts.flatMap(court => court.slots.map(slot => ({ startTime: slot.startTime, endTime: slot.endTime }))),
                expectedBookingCount: request.items.length, maximumAmount: plan.totalPrice, stage: 'dispatching' });
            begun.push({ journal: current, key });
        }
    }
    catch (error) {
        await Promise.allSettled(begun.map(entry => entry.journal.mark(entry.key, 'rejected', new Date(now()), undefined, undefined, 'DUPLICATE_LOGICAL_BOOKING_BLOCKED')));
        throw error;
    }
    const markAll = (state, diagnostic, observed, failureCode) => Promise.all(begun.map(entry => entry.journal.mark(entry.key, state, new Date(now()), diagnostic, observed, failureCode)));
    const key = keys[0];
    let permit;
    try {
        permit = await journal.claimSupervisedOneShot(key);
    }
    catch (error) {
        await markAll('rejected');
        throw error;
    }
    try {
        const windowCheck = () => { if (releaseMs !== undefined) {
            try {
                assertDirectDispatchWindow(releaseMs, now());
            }
            catch {
                throw new SubmissionDispatchError('DIRECT_RELEASE_WINDOW_MISSED', false);
            }
        } };
        windowCheck();
        // The window is checked again as the transport's final step, so a request can
        // never pass here and then leave seconds later after security work.
        const raw = await transport.publicCheckoutProofless(request, permit, {
            requirePreparedContext: dispatch.requirePreparedContext === true, ...(releaseMs !== undefined ? { beforePost: windowCheck } : {})
        });
        // Response validation compares booking identities, amounts, dates and sessions; it does not inspect proof strings.
        let verified;
        try {
            verified = validatePublicCheckoutResponse(raw, request, plan, new Date(now()), plan.totalPrice);
        }
        catch {
            await markAll('unknown', undefined, observedResponse(raw, 'DIRECT_RESPONSE_VALIDATION_FAILED'), 'DIRECT_RESPONSE_VALIDATION_FAILED');
            throw Error('SUBMISSION_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED');
        }
        await markAll('verified', undefined, observedResponse(raw, 'CHECKOUT_RESPONSE_VERIFIED'));
        return verified;
    }
    catch (error) {
        const dispatched = !(error instanceof SubmissionDispatchError) || error.dispatched;
        const rejected = error instanceof SubmissionDispatchError && error.confirmedRejected;
        if (error instanceof Error && error.message === 'SUBMISSION_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED')
            throw error;
        await markAll(dispatched && !rejected ? 'unknown' : 'rejected', error instanceof SubmissionDispatchError ? error.diagnostic : undefined, undefined, error instanceof SubmissionDispatchError ? error.code : 'DIRECT_CHECKOUT_FAILED').catch(() => undefined);
        if (dispatched && !rejected)
            throw Error('SUBMISSION_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED');
        throw error;
    }
}
//# sourceMappingURL=proofless-checkout.js.map