import type { FrozenPrecisionAuthorization } from './precision-phase3.js';
import { classifyTargetEvidence, type PreReleaseEvidence } from './pre-release-evidence.js';
import type { PrecisionAttempt } from './precision-race.js';

/** Public conflicts remove only their saved target. No replacement, reallocation or offset change. */
export function selectPhase3FreezeTargets(authorization: FrozenPrecisionAuthorization,
  evidence: Pick<PreReleaseEvidence, 'snapshot' | 'blocks' | 'failedCourts' | 'dateState'>, date: string) {
  return authorization.wave1.map(assignment => {
    const candidate = authorization.candidates.find(value => value.id === assignment.candidateId);
    if (!candidate) throw Error('SHOTGUN_FROZEN_PLAN_INCOMPLETE');
    const result = classifyTargetEvidence(candidate, evidence, date);
    const conflict = result.evidence === 'PUBLIC_BOOKING_PRESENT' || result.evidence === 'UNAVAILABLE_WITH_PUBLIC_BOOKING';
    const override = conflict && candidate.publicEvidence?.override === 'OPERATOR_OVERRIDE_PUBLIC_CONFLICT';
    return { assignment, candidate, evidence: result.evidence, excluded: conflict && !override, override };
  });
}

/** Every surviving child must still match its original worker, target and literal offset exactly. */
export function assertPhase3ShotgunSelection(selection: ReturnType<typeof selectPhase3FreezeTargets>,
  actual: readonly Pick<PrecisionAttempt, 'target'>[]): void {
  const signature = (target: PrecisionAttempt['target']) => JSON.stringify([target.workerId, target.targetKey,
    target.court, target.start, target.end, target.durationHours, target.assumedAmount, target.releaseOffsetMs ?? 0]);
  const expected = selection.filter(value => !value.excluded).flatMap(({ assignment, candidate }) =>
    (assignment.fanOutOffsetsMs ?? [assignment.releaseOffsetMs ?? 0]).map(offset =>
      signature({workerId:assignment.workerId,targetKey:candidate.logicalKey,court:candidate.court,start:candidate.start,
        end:candidate.end,durationHours:candidate.durationHours,assumedAmount:candidate.expectedAmount,releaseOffsetMs:offset}))).sort();
  if (!expected.length) throw Error('PHASE3_PUBLIC_CONFLICT_ALL_TARGETS');
  const received = actual.map(({ target }) => signature(target)).sort();
  if (JSON.stringify(expected) !== JSON.stringify(received)) throw Error('SHOTGUN_FROZEN_PLAN_INCOMPLETE');
}
