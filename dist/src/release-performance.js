const round = (n) => Math.round(n * 1000) / 1000;
const delta = (a, b) => a && b && b.monoMs >= a.monoMs ? round(b.monoMs - a.monoMs) : null;
const slotClick = (e) => /^slot\d+ClickStarted$/.test(e.event);
const slotConfirmed = (e) => /^slot\d+StateConfirmed$/.test(e.event);
function workerPerformance(events, workerId) {
    const scoped = events.some(e => e.workerId !== undefined), run = events.filter(e => e.workerId === workerId || (!scoped && workerId === 'A' && e.workerId === undefined));
    const trigger = run.find(e => e.event === 'releaseTriggerFired');
    if (!trigger)
        return null;
    const after = run.slice(run.indexOf(trigger)), first = (name, source = after) => source.find(e => e.event === name);
    const selected = first('selectionVerified'), selectedIndex = selected ? after.indexOf(selected) : -1;
    const attemptIndex = selectedIndex < 0 ? -1 : after.findLastIndex((e, i) => i <= selectedIndex && e.event === 'selectionAttemptStarted');
    const successful = selectedIndex < 0 ? [] : after.slice(Math.max(0, attemptIndex), selectedIndex + 1), clicks = successful.filter(slotClick), confirmed = successful.filter(slotConfirmed);
    const enabled = first('targetDateEnabled'), clicked = first('targetDateClicked'), grid = first('targetGridReady'), snapshot = first('gridSnapshotCompleted');
    const preference = (attemptIndex < 0 ? after : after.slice(0, attemptIndex + 1)).findLast(e => e.event === 'preferenceResolved' || e.event === 'fallbackResolved'), verification = successful.find(e => e.event === 'selectionFinalVerificationCompleted'), proceed = first('bookingProceedClicked');
    const reloads = after.flatMap((event, index) => { if (event.event !== 'reloadStarted')
        return []; const next = after.findIndex((e, i) => i > index && e.event === 'reloadStarted'), attempt = after.slice(index, next < 0 ? undefined : next), one = (name) => attempt.find(e => e.event === name), commit = one('reloadCommitted'), venue = one('releaseVenueVerified'), picker = one('releasePickerEnabled'); return [{ triggerToCommitMs: delta(trigger, commit), commitToVenueMs: delta(commit, venue), venueToPickerMs: delta(venue, picker), pickerToTargetMs: delta(picker, one('targetDateEnabled')) }]; });
    const count = (name) => run.filter(e => e.event === name).length;
    return { branch: first('targetEnabledWithoutReload') ? 'NO-REFRESH' : reloads.length ? 'RELOAD FALLBACK' : 'NOT MEASURED', triggerErrorMs: Number.isFinite(trigger.value) ? trigger.value : null,
        triggerToTargetEnabledMs: delta(trigger, enabled), targetEnabledToClickMs: delta(enabled, clicked), targetClickToGridReadyMs: delta(clicked, grid), gridReadyToSnapshotCompletedMs: delta(grid, snapshot), snapshotToPreferenceResolvedMs: delta(snapshot, preference),
        preferenceToFirstSlotClickMs: delta(preference, clicks[0]), firstSlotClickToLastStateConfirmedMs: delta(clicks[0], confirmed.at(-1)), lastSlotConfirmedToSelectionVerificationMs: delta(confirmed.at(-1), verification), selectionVerificationToBookingProceedMs: delta(verification, proceed),
        proceedToReviewDetectedMs: delta(proceed, first('reviewDetected')), reviewDetectedToValidatedMs: delta(first('reviewDetected'), first('reviewValidated')), reviewValidatedToPlayerFormDetectedMs: delta(first('reviewValidated'), first('playerFormDetected')), playerFormDetectedToFillCompletedMs: delta(first('playerFormDetected'), first('playerFillCompleted')), fillCompletedToPlayerProceedMs: delta(first('playerFillCompleted'), first('playerProceedClicked')),
        playerProceedToPaymentSummaryDetectedMs: delta(first('playerProceedClicked'), first('paymentSummaryDetected')), paymentSummaryDetectedToValidatedMs: delta(first('paymentSummaryDetected'), first('paymentSummaryValidated')), paymentValidatedToTermsControlMs: delta(first('paymentSummaryValidated'), first('termsControlDetected')), termsControlToTermsCheckedMs: delta(first('termsControlDetected'), first('termsChecked')), termsCheckedToFinalButtonActionableMs: delta(first('termsChecked'), first('finalButtonActionable')),
        finalActionStartedToClickedMs: delta(first('finalOndaActionStarted'), first('finalOndaButtonClicked')), finalClickToCheckoutPageMs: delta(first('finalOndaButtonClicked'), first('checkoutPageDetected')), checkoutPageToHoldStatusMs: delta(first('checkoutPageDetected'), first('holdStatusDetected')), holdStatusToQrHandoffMs: delta(first('holdStatusDetected'), first('qrHandoffVerified')),
        triggerToSelectionVerifiedMs: delta(trigger, selected), triggerToBookingProceedMs: delta(trigger, proceed), triggerToFinalClickMs: delta(trigger, first('finalOndaButtonClicked')), triggerToQrHandoffMs: delta(trigger, first('qrHandoffVerified')),
        counters: { selectionFullGridReads: count('selectionFullGridRead'), preProceedGridReads: count('preProceedGridRead'), fullGuards: count('fullGuardCompleted'), lightGuards: count('lightGuardCompleted'), slotClicks: run.filter(slotClick).length, selectionSummaryReads: count('selectionSummaryRead'), reviewParses: count('reviewParsed'), paymentSummaryParses: count('paymentSummaryParsed'), termsControlAcquisitions: count('termsControlDetected') }, reloads };
}
export function releasePerformance(events) {
    if (!events.some(e => e.event === 'releaseTriggerFired'))
        return null;
    const A = workerPerformance(events, 'A'), B = workerPerformance(events, 'B');
    const both = (key) => A && B && A[key] !== null && B[key] !== null ? Math.max(A[key], B[key]) : null;
    return { workers: { A, B }, overall: { triggerToBothSelectionsVerifiedMs: both('triggerToSelectionVerifiedMs'), triggerToBothFinalClicksMs: both('triggerToFinalClickMs'), triggerToBothQrHandoffsMs: both('triggerToQrHandoffMs') } };
}
//# sourceMappingURL=release-performance.js.map