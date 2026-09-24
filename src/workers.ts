export const WORKER_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
export type WorkerId = typeof WORKER_IDS[number];
export type CourtCount = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Onda permits at most two courts in one checkout. */
export function requiredWorkerIds(strategy:'standard'|'extended',courtCount:CourtCount):WorkerId[]{
  const courtGroups=Math.ceil(courtCount/2);
  const timeGroups=strategy==='extended'?2:1;
  return WORKER_IDS.slice(0,courtGroups*timeGroups) as WorkerId[];
}

/** Precision v1 uses one worker per exact target, A through G (seven courts). H is never a Precision worker. */
export const PRECISION_MAX_ATTEMPTS = 7;
export const PRECISION_WORKER_IDS = WORKER_IDS.slice(0, PRECISION_MAX_ATTEMPTS) as readonly WorkerId[];

/** Workers a saved plan needs: one per Precision attempt (A-G in row order, no grouping), otherwise the General allocation. */
export function planWorkerIds(setup:{RELEASE_STRATEGY?:'general'|'precision';PRECISION_TARGETS?:readonly unknown[];
  PRECISION_PHASE3?:{wave1:readonly {workerId:WorkerId}[];standby:readonly WorkerId[]};BOOKING_TYPE:'standard'|'extended';COURT_COUNT:CourtCount}):WorkerId[]{
  if(setup.RELEASE_STRATEGY==='precision'&&setup.PRECISION_PHASE3)
    return [...new Set([...setup.PRECISION_PHASE3.wave1.map(value=>value.workerId),...setup.PRECISION_PHASE3.standby])];
  if(setup.RELEASE_STRATEGY==='precision')return PRECISION_WORKER_IDS.slice(0,Math.max(1,Math.min(PRECISION_MAX_ATTEMPTS,setup.PRECISION_TARGETS?.length??0)));
  return requiredWorkerIds(setup.BOOKING_TYPE,setup.COURT_COUNT);
}

export const playerLabel=(worker:WorkerId)=>worker==='A'?'Primary':`Player ${WORKER_IDS.indexOf(worker)+1}`;
