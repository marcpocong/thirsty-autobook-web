import { compileSmartPlan, type SmartContext, type SmartDraft } from './precision-simple.js';

const LIMIT_PROBLEM = 'Attempt limits are inconsistent. Check Advanced settings.';

/** Normal save may repair stale execution limits, never targets, worker reservations or safety evidence.
 * Try the smallest set of budget resets, and require the unchanged real compiler to accept the result.
 * A preview does not mutate the draft or authorize execution. */
export function fitNormalAttemptLimits(draft: SmartDraft, context: SmartContext) {
  const original = compileSmartPlan(draft, context);
  const unchanged = { draft, compiled: original, normalized: [] as Array<'wave2' | 'rescue' | 'total'> };
  if (draft.shotgun?.enabled || !original.problems.includes(LIMIT_PROBLEM)) return unchanged;
  const keys = (['wave2', 'rescue', 'total'] as const).filter(key => draft.advanced[key] !== undefined);
  const masks = Array.from({ length: 2 ** keys.length - 1 }, (_, i) => i + 1)
    .sort((a, b) => a.toString(2).replaceAll('0', '').length - b.toString(2).replaceAll('0', '').length || a - b);
  for (const mask of masks) {
    const candidate = structuredClone(draft);
    const normalized = keys.filter((_, i) => mask & (1 << i));
    for (const key of normalized) delete candidate.advanced[key];
    const compiled = compileSmartPlan(candidate, context);
    if (compiled.phase3 && !compiled.problems.length) return { draft: candidate, compiled, normalized };
  }
  return unchanged;
}
