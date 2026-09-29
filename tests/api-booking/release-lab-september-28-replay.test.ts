import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { authorizePrecision, classifyActionableObservation, precisionCandidateId, PrecisionSession,
  type CandidateInput } from '../../src/api-booking/precision-phase3.js';
import type { AvailabilityObservation } from '../../src/slot-evidence.js';

interface FixtureObservation { seq:number; requestOffsetMs:number; responseOffsetMs:number; state:'OPEN'|'UNAVAILABLE'; cacheStatus:string; ageS?:number }
const fixture = JSON.parse(readFileSync(resolve('tests/fixtures/release-lab/september-28-reopen.json'), 'utf8')) as {
  releaseMs:number; target:{court:number;start:string;durationHours:number}; initialAttempt:'REJECTED'; observations:FixtureObservation[];
};
const matrix = (state:'OPEN'|'UNAVAILABLE') => Array.from({length:7},(_,court)=>
  `${court+1}:${(court===6?(state==='OPEN'?'O':'X'):'X').repeat(16)}`).join(',');
const observation = (row:FixtureObservation):AvailabilityObservation => ({
  seq:row.seq,scheduledOffsetMs:row.requestOffsetMs,requestOffsetMs:row.requestOffsetMs,responseOffsetMs:row.responseOffsetMs,
  outcome:'ok',targetDatePresent:true,matrix:matrix(row.state),prices:Array.from({length:7},()=>Array(16).fill(700)),
  cache:{status:row.cacheStatus,...(row.ageS===undefined?{}:{ageS:row.ageS})},
});

describe('September 28 bounded-cache Rescue replay',()=>{
  it('selects the authorized Court 7 reopening around +606 s, rejects unbounded/old cache evidence, and never duplicates the epoch',()=>{
    const candidate:CandidateInput={...fixture.target,priority:1,permissions:{wave1:true,wave2:false,rescue:true},
      rateEvidence:{source:'sanitized fixture',capturedAt:'2026-09-27T23:00:00Z',status:'OPERATOR_CONFIRMED',date:'2026-09-30',perHour:[700,700,700],actionable:true}};
    const candidateId=precisionCandidateId('2026-09-30',candidate);
    const auth=authorizePrecision({date:'2026-09-30',releaseMs:fixture.releaseMs,candidates:[candidate],wave1:[{workerId:'A',candidateId}],standby:[],
      budgets:{wave2:0,rescue:1,total:2},concurrentWave2:false,rescueEnabled:true,authorizedAt:'2026-09-27T23:30:00Z'});
    const session=new PrecisionSession(auth);
    session.record({id:'wave1',candidateId,workerId:'A',wave:'WAVE_1',state:fixture.initialAttempt});
    const [unknown,unavailable,tooOld,reopen]=fixture.observations.map(observation);
    const evaluate=(value:AvailabilityObservation,at:number)=>classifyActionableObservation(value,value.seq,fixture.releaseMs,fixture.releaseMs+at,6_000);
    expect(evaluate(unknown!,590_500).fitness).toBe('FORENSIC_ONLY_CACHE_AGE_UNKNOWN');
    session.observe(evaluate(unavailable!,600_500));
    expect(evaluate(tooOld!,603_500).fitness).toBe('FORENSIC_ONLY_STALE');
    session.observe(evaluate(reopen!,606_500));
    expect(session.latest?.fitness).toBe('ACTIONABLE_BOUNDED_CACHE');
    const [choice]=session.select('RESCUE',fixture.releaseMs+606_500,6_000);
    expect(choice).toMatchObject({candidate:{court:7,start:'19:00',durationHours:3},reopenEpoch:2,evidenceSeq:4});
    session.record({id:'rescue-1',candidateId,workerId:'A',wave:'RESCUE',state:'REJECTED',reopenEpoch:choice!.reopenEpoch});
    expect(session.select('RESCUE',fixture.releaseMs+606_500,6_000)).toEqual([]);
  });
});
