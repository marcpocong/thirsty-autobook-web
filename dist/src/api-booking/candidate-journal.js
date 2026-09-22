import { BookingPlanningError, bookingPlanKey, planBooking } from './booking-planner.js';
import { DurableSubmissionJournal } from './durable-submission-journal.js';
export function candidateJournalKeys(plan, facilityId) {
    return plan.chunks.flatMap(chunk => {
        if (!chunk.courts.length)
            throw Error('API_CANDIDATE_COURT_MISSING');
        return chunk.courts.map(court => DurableSubmissionJournal.key(facilityId, court.spaceId, plan.targetDate, chunk.startTime, chunk.endTime));
    });
}
export async function firstUnjournaledCandidate(candidates, facilityId, hasRecord) {
    for (const plan of candidates) {
        const keys = candidateJournalKeys(plan, facilityId);
        if (!(await Promise.all(keys.map(hasRecord))).some(Boolean))
            return { plan, key: keys[0] };
    }
    return undefined;
}
/** Search the complete finite preference space; the preview's 32-plan display limit does not apply to live tests. */
export async function firstUnjournaledAvailableCandidate(snapshot, preferences, facilityId, hasRecord) {
    const excluded = new Set();
    for (;;) {
        let plan;
        try {
            plan = planBooking(snapshot, preferences, excluded);
        }
        catch (error) {
            if (error instanceof BookingPlanningError &&
                (error.code === 'BOOKING_CANDIDATES_EXCLUDED' || error.code === 'BOOKING_NO_CONSECUTIVE_AVAILABILITY'))
                return undefined;
            throw error;
        }
        const keys = candidateJournalKeys(plan, facilityId);
        let blocked = false;
        for (const key of keys)
            if (await hasRecord(key)) {
                blocked = true;
                break;
            }
        if (!blocked)
            return { plan, key: keys[0] };
        excluded.add(bookingPlanKey(plan));
    }
}
//# sourceMappingURL=candidate-journal.js.map