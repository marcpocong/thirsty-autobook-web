export const WORKER_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
/** Onda permits at most two courts in one checkout. */
export function requiredWorkerIds(strategy, courtCount) {
    const courtGroups = Math.ceil(courtCount / 2);
    const timeGroups = strategy === 'extended' ? 2 : 1;
    return WORKER_IDS.slice(0, courtGroups * timeGroups);
}
export const playerLabel = (worker) => worker === 'A' ? 'Primary' : `Player ${WORKER_IDS.indexOf(worker) + 1}`;
//# sourceMappingURL=workers.js.map