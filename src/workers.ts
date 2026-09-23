export const WORKER_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
export type WorkerId = typeof WORKER_IDS[number];
export type CourtCount = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Onda permits at most two courts in one checkout. */
export function requiredWorkerIds(strategy:'standard'|'extended',courtCount:CourtCount):WorkerId[]{
  const courtGroups=Math.ceil(courtCount/2);
  const timeGroups=strategy==='extended'?2:1;
  return WORKER_IDS.slice(0,courtGroups*timeGroups) as WorkerId[];
}

/** Workers a saved plan needs: one per Precision attempt (A, B, C in row order), otherwise the General allocation. */
export function planWorkerIds(setup:{RELEASE_STRATEGY?:'general'|'precision';PRECISION_TARGETS?:readonly unknown[];BOOKING_TYPE:'standard'|'extended';COURT_COUNT:CourtCount}):WorkerId[]{
  if(setup.RELEASE_STRATEGY==='precision')return WORKER_IDS.slice(0,Math.max(1,Math.min(3,setup.PRECISION_TARGETS?.length??0))) as WorkerId[];
  return requiredWorkerIds(setup.BOOKING_TYPE,setup.COURT_COUNT);
}

export const playerLabel=(worker:WorkerId)=>worker==='A'?'Primary':`Player ${WORKER_IDS.indexOf(worker)+1}`;
