import { describe, expect, it } from 'vitest';
import { openingCycles, scoreExpiryWindows } from '../src/slot-opening-cycles.js';
import type { AvailabilityObservation } from '../src/slot-evidence.js';
const read=(seq:number,offset:number,code:string):AvailabilityObservation=>({seq,scheduledOffsetMs:offset,requestOffsetMs:offset,
  responseOffsetMs:offset+100,outcome:'ok',targetDatePresent:true,matrix:`7:${code.repeat(16)}`,cache:{status:'MISS',ageS:0}});
describe('per-cell opening cycles and one-to-one expiry scoring',()=>{
  const observations=[read(1,0,'X'),read(2,70_000,'O'),read(3,95_000,'X'),read(4,691_000,'O'),read(5,750_000,'X'),read(6,1_350_000,'O')];
  it('counts distinct cells separately from every repeated transition in request order',()=>{
    expect(openingCycles([...observations].reverse()).metrics).toEqual({distinctCellsEverReopened:16,totalReopeningTransitions:48,
      firstOpenings:16,subsequentOpenings:32,openToUnavailableTransitions:32});
  });
  it('matches the later opening to its own closing cycle and never an earlier broad opening',()=>{
    const rows=scoreExpiryWindows(observations,[{court:7,hour:'19:00',startMs:688_000,endMs:698_000,sourceSeq:3},
      {court:7,hour:'19:00',startMs:1_348_000,endMs:1_358_000,sourceSeq:5}]);
    expect(rows.map(r=>[r.observedReopenMs,r.insideWindow])).toEqual([[691_100,true],[1_350_100,true]]);
  });
  it('does not assign a transition to duplicate overlapping windows',()=>{
    const window={court:7,hour:'19:00',startMs:688_000,endMs:698_000,sourceSeq:3};
    expect(scoreExpiryWindows(observations,[window,window]).map(r=>r.observedReopenMs)).toEqual([691_100,null]);
  });
  it('separates outside-window, absent, cached and overlapping observations',()=>{
    const window={court:7,hour:'19:00',startMs:600_000,endMs:610_000,sourceSeq:3};
    expect(scoreExpiryWindows(observations,[window])[0]!.insideWindow).toBe(false);
    expect(scoreExpiryWindows(observations.slice(0,3),[window])[0]!.insideWindow).toBeNull();
    const uncertain=structuredClone(observations);uncertain[3]!.cache={status:'HIT'};
    expect(scoreExpiryWindows(uncertain,[window])[0]!.observedReopenMs).toBeNull();
    const overlap=structuredClone(observations);overlap[2]!.responseOffsetMs=692_000;
    expect(scoreExpiryWindows(overlap,[window])[0]!.observedReopenMs).toBeNull();
  });
});
