export const WORKER_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
export type WorkerId = typeof WORKER_IDS[number];
export type CourtCount = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Onda permits at most two courts in one checkout. */
export function requiredWorkerIds(strategy:'standard'|'extended',courtCount:CourtCount):WorkerId[]{
  const courtGroups=Math.ceil(courtCount/2);
  const timeGroups=strategy==='extended'?2:1;
  return WORKER_IDS.slice(0,courtGroups*timeGroups) as WorkerId[];
}

export const playerLabel=(worker:WorkerId)=>worker==='A'?'Primary':`Player ${WORKER_IDS.indexOf(worker)+1}`;
