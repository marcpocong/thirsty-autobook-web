export const WORKER_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
/** Onda permits at most two courts in one checkout. */
export function requiredWorkerIds(strategy, courtCount) {
    const courtGroups = Math.ceil(courtCount / 2);
    const timeGroups = strategy === 'extended' ? 2 : 1;
    return WORKER_IDS.slice(0, courtGroups * timeGroups);
}
/** Precision v1 uses one worker per exact target, A through G (seven courts). H is never a Precision worker. */
export const PRECISION_MAX_ATTEMPTS = 7;
/** Fixed Precision fan-out creates exactly four child attempts inside each configured worker browser. */
export const PRECISION_FAN_OUT_ATTEMPTS = 4;
export const PRECISION_WORKER_IDS = WORKER_IDS.slice(0, PRECISION_MAX_ATTEMPTS);
/** Workers a saved plan needs: one per Precision attempt (A-G in row order, no grouping), otherwise the General allocation. */
export function planWorkerIds(setup) {
    if (setup.RELEASE_STRATEGY === 'precision' && setup.PRECISION_PHASE3)
        return [...new Set([...setup.PRECISION_PHASE3.wave1.map(value => value.workerId), ...setup.PRECISION_PHASE3.standby])];
    if (setup.RELEASE_STRATEGY === 'precision')
        return PRECISION_WORKER_IDS.slice(0, Math.max(1, Math.min(PRECISION_MAX_ATTEMPTS, setup.PRECISION_TARGETS?.length ?? 0)));
    return requiredWorkerIds(setup.BOOKING_TYPE, setup.COURT_COUNT);
}
export const playerLabel = (worker) => worker === 'A' ? 'Primary' : `Player ${WORKER_IDS.indexOf(worker) + 1}`;
//# sourceMappingURL=workers.js.map