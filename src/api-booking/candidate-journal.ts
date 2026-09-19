import type { BookingPlan } from './types.js';
import { DurableSubmissionJournal } from './durable-submission-journal.js';

export function candidateJournalKeys(plan: BookingPlan, facilityId: string): string[] {
  return plan.chunks.map(chunk => {
    const court = chunk.courts[0];
    if (!court) throw Error('API_CANDIDATE_COURT_MISSING');
    return DurableSubmissionJournal.key(facilityId, court.spaceId, plan.targetDate, chunk.startTime, chunk.endTime);
  });
}

export async function firstUnjournaledCandidate(
  candidates: readonly BookingPlan[], facilityId: string, hasRecord: (key: string) => Promise<boolean>,
): Promise<{ plan: BookingPlan; key: string } | undefined> {
  for (const plan of candidates) {
    const keys = candidateJournalKeys(plan, facilityId);
    if (!(await Promise.all(keys.map(hasRecord))).some(Boolean)) return { plan, key: keys[0]! };
  }
  return undefined;
}
