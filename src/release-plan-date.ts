/**
 * The booking date a saved release plan was authorized for, against the date the next release publishes.
 * Dependency-free (renderer-safe). A Precision/Shotgun plan carries its date in every candidate's rate evidence; the
 * runner refuses candidates whose date differs from the release target (PRECISION_CANDIDATE_INVALID), so a plan saved
 * for an earlier release must be re-saved deliberately. Nothing here, or anywhere, moves a saved plan to a new date.
 */
export type SavedPlanDateStatus = 'CURRENT' | 'STALE' | 'FUTURE' | 'MIXED' | 'UNDATED';
export interface SavedPlanDate { status: SavedPlanDateStatus; planDate: string | null; targetDate: string; detail: string }
interface DatedSetup { PRECISION_PHASE3?: { candidates: ReadonlyArray<{ rateEvidence?: { date?: string } }> } | null }

export function savedPlanDate(setup: DatedSetup | null | undefined, targetDate: string): SavedPlanDate {
  const candidates = setup?.PRECISION_PHASE3?.candidates ?? [];
  if (!candidates.length) return { status: 'UNDATED', planDate: null, targetDate, detail: `Follows the next release target ${targetDate}.` };
  const dates = [...new Set(candidates.map(candidate => candidate.rateEvidence?.date ?? ''))];
  if (dates.length !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(dates[0]!))
    return { status: 'MIXED', planDate: null, targetDate, detail: 'The saved plan does not carry one booking date. Review and save it again.' };
  const planDate = dates[0]!;
  if (planDate === targetDate) return { status: 'CURRENT', planDate, targetDate, detail: `Saved for ${planDate}, the date the next release publishes.` };
  return planDate < targetDate
    ? { status: 'STALE', planDate, targetDate, detail: `Saved for ${planDate}, whose release has already passed. The next release publishes ${targetDate}. Review the plan and save it for that date deliberately; nothing is re-dated automatically.` }
    : { status: 'FUTURE', planDate, targetDate, detail: `Saved for ${planDate}, but the next release publishes ${targetDate}. It cannot be armed for this release.` };
}
export const planDateArmable = (value: SavedPlanDate | null | undefined) => !value || value.status === 'CURRENT' || value.status === 'UNDATED';
