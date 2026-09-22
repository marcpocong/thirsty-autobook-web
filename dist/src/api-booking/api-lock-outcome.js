import { SubmissionDispatchError } from './submission-errors.js';
/** Release only when no verified hold exists and checkout is proven unsent or every journal is rejected. */
export function canReleaseApiLockAfterFailure(verifiedHold, error, states) {
    if (verifiedHold)
        return false;
    return error instanceof SubmissionDispatchError && !error.dispatched || states.length > 0 && states.every(state => state === 'rejected');
}
/** Parallel workers may release only when every failure is proven unsent, or every durable journal is rejected. */
export function canReleaseApiLockAfterParallelFailure(verifiedHold, errors, states, expectedWorkers) {
    if (verifiedHold)
        return false;
    const everyWorkerProvenUnsent = errors.length === expectedWorkers &&
        errors.every(error => error instanceof SubmissionDispatchError && !error.dispatched);
    return everyWorkerProvenUnsent || states.length > 0 && states.every(state => state === 'rejected');
}
/**
 * A single attempt's safe-retry eligibility: true only when every durable
 * journal for its hourly boundaries is conclusively 'rejected', or (when no
 * journal record exists yet) the error itself proves the request was never
 * sent. An 'unknown' or 'verified' journal, or a possibly-dispatched error,
 * is never safe to retry.
 */
export function conclusiveNoHoldFromStates(states, error) {
    if (states.some(Boolean))
        return states.length > 0 && states.every(state => state === 'rejected');
    return error instanceof SubmissionDispatchError && !error.dispatched;
}
//# sourceMappingURL=api-lock-outcome.js.map