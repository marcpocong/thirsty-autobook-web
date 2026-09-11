import type { TimingEvent } from './release-performance.js';

// Numeric, same-run observations only; never retain response/config data.
export function availabilityPerformance(events: readonly TimingEvent[]) {
  if (!events.some(e => e.event === 'availabilityRequestStarted')) return null;
  const first = (name: string) => events.find(e => e.event === name);
  const delta = (a: TimingEvent | undefined, b: TimingEvent | undefined) => a && b && b.monoMs >= a.monoMs ? b.monoMs - a.monoMs : null;
  const phase = (a: string, b: string) => delta(first(a), first(b));
  const requests = events.flatMap((e, index) => {
    if (e.event !== 'availabilityRequestStarted') return [];
    const next = events.findIndex((v, i) => i > index && v.event === 'availabilityRequestStarted');
    const attempt = events.slice(index, next < 0 ? undefined : next);
    const response = attempt.find(v => v.event === 'availabilityResponseReceived');
    const parsed = attempt.find(v => v.event === 'availabilityParsed');
    return [{ durationMs: delta(e, response), parseMs: parsed?.value ?? null,
      responseToCandidateMs: delta(response, attempt.find(v => v.event === 'availabilityCandidateResolved')) }];
  });
  return { requests, releaseToRequestMs: phase('releaseTriggerFired', 'availabilityRequestStarted'),
    releaseToGridMs: phase('releaseTriggerFired', 'targetGridReady'),
    apiCandidateReadyToGridMs: phase('availabilityApiCandidatesReady', 'targetGridReady'),
    apiCandidateResolutionMs: first('availabilityApiCandidatesReady')?.value ?? null,
    gridToFirstClickMs: phase('targetGridReady', 'slot1ClickStarted'),
    releaseToFirstClickMs: phase('releaseTriggerFired', 'slot1ClickStarted'),
    releaseToSelectionMs: phase('releaseTriggerFired', 'selectionVerified'),
    selectionToProceedMs: phase('selectionVerified', 'bookingProceedStarted'),
    proceedToReviewMs: phase('bookingProceedStarted', 'reviewDetected'),
    reviewToPlayerCompletedMs: phase('reviewDetected', 'playerFillCompleted'),
    playerProceedToSummaryMs: phase('playerProceedStarted', 'paymentSummaryDetected'),
    finalActionToHoldMs: phase('finalOndaActionStarted', 'qrHandoffVerified'),
    candidateResolutionMs: first('availabilityCandidateResolved')?.value ?? null };
}
