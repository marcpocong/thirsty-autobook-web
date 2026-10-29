import { classifyReopening, deriveTimeline, type AvailabilityObservation, type ReopeningConfidence } from './slot-evidence.js';

export interface ExpiryWindow { court:number;hour:string;startMs:number;endMs:number;sourceSeq?:number }
export function openingCycles(availability:readonly AvailabilityObservation[]) {
  const observations=new Map(availability.map(o=>[o.seq,o]));
  const transitions=deriveTimeline(availability,[],Number.MAX_SAFE_INTEGER).filter(e=>e.kind==='state');
  const closedAt=new Map<string,number>();
  const openings=transitions.flatMap(e=>{
    const key=`${e.court}/${e.hour}`;
    if(e.to==='UNAVAILABLE'){closedAt.set(key,e.after.seq);return [];}
    const before=e.before&&observations.get(e.before.seq),after=observations.get(e.after.seq);
    const confidence:ReopeningConfidence=before&&after?classifyReopening(before,after):'UNKNOWN';
    return [{...e,sourceSeq:closedAt.get(key)??null,confidence}];
  });
  const distinctCells=new Set(openings.map(e=>`${e.court}/${e.hour}`)).size;
  return {openings,metrics:{distinctCellsEverReopened:distinctCells,totalReopeningTransitions:openings.length,
    firstOpenings:distinctCells,subsequentOpenings:openings.length-distinctCells,
    openToUnavailableTransitions:transitions.filter(e=>e.to==='UNAVAILABLE').length}};
}

/** Request-order, one-to-one matching: each prediction takes the first trustworthy opening of
 * its own closing cycle. Duplicate/overlapping windows cannot claim the same transition twice.
 * The observed response boundary is scored, never a claimed provider expiry instant. */
export function scoreExpiryWindows(availability:readonly AvailabilityObservation[],windows:readonly ExpiryWindow[]) {
  const {openings}=openingCycles(availability),used=new Set<number>();
  return [...windows].sort((a,b)=>(a.sourceSeq??a.startMs)-(b.sourceSeq??b.startMs)||a.startMs-b.startMs).map(window=>{
    const index=openings.findIndex((e,i)=>!used.has(i)&&e.court===window.court&&e.hour===window.hour&&
      (e.confidence==='CONFIRMED'||e.confidence==='PROBABLE')&&
      (window.sourceSeq!==undefined?e.sourceSeq===window.sourceSeq:e.sourceSeq!==null&&e.after.responseOffsetMs>=window.startMs));
    if(index>=0)used.add(index);
    const reopened=index>=0?openings[index]!.after.responseOffsetMs:null;
    return {court:window.court,hour:window.hour,predictedStartMs:window.startMs,predictedEndMs:window.endMs,
      sourceSeq:window.sourceSeq??null,observedReopenMs:reopened,errorMs:reopened===null?null:Math.round(reopened-(window.startMs+window.endMs)/2),
      insideWindow:reopened===null?null:reopened>=window.startMs&&reopened<=window.endMs};
  });
}
