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
//# sourceMappingURL=candidate-journal.js.map