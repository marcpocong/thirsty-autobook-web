import type { BookingPlan } from './types.js';
import { DurableSubmissionJournal } from './durable-submission-journal.js';

export async function firstUnjournaledCandidate(
  candidates: readonly BookingPlan[], facilityId: string, hasRecord: (key: string) => Promise<boolean>,
): Promise<{ plan: BookingPlan; key: string } | undefined> {
  for (const plan of candidates) {
    const court = plan.courts[0];
    if (!court) continue;
    const key = DurableSubmissionJournal.key(facilityId, court.spaceId, plan.targetDate, plan.startTime, plan.endTime);
    if (!await hasRecord(key)) return { plan, key };
  }
  return undefined;
}
