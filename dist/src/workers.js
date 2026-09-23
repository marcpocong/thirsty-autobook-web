export const WORKER_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
/** Onda permits at most two courts in one checkout. */
export function requiredWorkerIds(strategy, courtCount) {
    const courtGroups = Math.ceil(courtCount / 2);
    const timeGroups = strategy === 'extended' ? 2 : 1;
    return WORKER_IDS.slice(0, courtGroups * timeGroups);
}
/** Workers a saved plan needs: one per Precision attempt (A, B, C in row order), otherwise the General allocation. */
export function planWorkerIds(setup) {
    if (setup.RELEASE_STRATEGY === 'precision')
        return WORKER_IDS.slice(0, Math.max(1, Math.min(3, setup.PRECISION_TARGETS?.length ?? 0)));
    return requiredWorkerIds(setup.BOOKING_TYPE, setup.COURT_COUNT);
}
export const playerLabel = (worker) => worker === 'A' ? 'Primary' : `Player ${WORKER_IDS.indexOf(worker) + 1}`;
//# sourceMappingURL=workers.js.map