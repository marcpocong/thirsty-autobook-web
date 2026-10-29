import { describe,expect,it } from 'vitest';
import { analyzeMovementForensics } from '../src/release-lab-analysis.js';
import type { AvailabilityObservation } from '../src/slot-evidence.js';

const prices=Array.from({length:7},()=>Array(16).fill(700));
const row=(court:number,codes:string)=>`${court}:${codes}`;
const matrix=(taken:Set<string>)=>Array.from({length:7},(_,court)=>row(court+1,Array.from({length:16},(_,index)=>
  taken.has(`${court+1}/${String(index+8).padStart(2,'0')}:00`)?'X':'O').join(''))).join(',');
const observation=(seq:number,offset:number,taken:Set<string>,cache:{status:string;ageS?:number}={status:'MISS',ageS:0}):AvailabilityObservation=>({
  seq,scheduledOffsetMs:offset,requestOffsetMs:offset,responseOffsetMs:offset+100,outcome:'ok',targetDatePresent:true,matrix:matrix(taken),prices,cache,
});

describe('Release Lab movement forensics',()=>{
  it('detects all-court blanket ranges and keeps a four-hour movement ambiguous',()=>{
    const taken=new Set<string>();for(let court=1;court<=7;court++)for(let hour=12;hour<16;hour++)taken.add(`${court}/${hour}:00`);
    const result=analyzeMovementForensics([observation(1,0,new Set()),observation(2,1000,taken)]);
    expect(result.blankets).toMatchObject([{courts:[1,2,3,4,5,6,7],start:'12:00',end:'16:00',cells:28,confidence:'HIGH'}]);
    expect(result.clusters).toHaveLength(7);
    expect(result.clusters.every(cluster=>cluster.confidence==='AMBIGUOUS')).toBe(true);
    expect(result.distribution).toMatchObject({fourPlus:7,ambiguous:7});
  });
  it('downgrades cached movement confidence and never assigns an actor',()=>{
    const taken=new Set(['1/12:00','1/13:00']);
    const result=analyzeMovementForensics([observation(1,0,new Set()),observation(2,1000,taken,{status:'HIT',ageS:1})]);
    expect(result.clusters[0]).toMatchObject({court:1,hours:['12:00','13:00'],confidence:'MEDIUM'});
    expect(JSON.stringify(result)).not.toMatch(/competitor|customer|email|actor/i);
  });
  it('reports broad openings separately from broad closings with sampled bounds',()=>{
    const taken=new Set<string>();for(let court=1;court<=7;court++)for(let hour=12;hour<16;hour++)taken.add(`${court}/${hour}:00`);
    const result=analyzeMovementForensics([observation(1,0,taken),observation(2,70_000,new Set()),observation(3,95_000,taken)]);
    expect(result.broadMovements).toMatchObject([{direction:'UNAVAILABLE_TO_OPEN',cells:28,windowMs:[0,70_100]},
      {direction:'OPEN_TO_UNAVAILABLE',cells:28,windowMs:[70_000,95_100]}]);
    expect(result.blankets.map(v=>v.direction)).toEqual(['UNAVAILABLE_TO_OPEN','OPEN_TO_UNAVAILABLE']);
  });
});
