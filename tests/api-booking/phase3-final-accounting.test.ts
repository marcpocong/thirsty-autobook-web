import { describe, expect, it } from 'vitest';
import { phase3AttemptCounts, reconcileWave1Attempts } from '../../src/api-booking/phase3-wave1-reporting.js';
import { PrecisionSession } from '../../src/api-booking/precision-phase3.js';
import type { PrecisionAttempt } from '../../src/api-booking/precision-race.js';
const children=Array.from({length:8},(_,index)=>({id:`child-${index}`,fanOutIndex:index%3,fanOutCount:3,
  target:{workerId:index<3?'A':index<6?'B':'C'}} as PrecisionAttempt));
const identity=(child:PrecisionAttempt)=>({id:`correlation-${child.id}`,candidateId:`target-${child.target.workerId}`,workerId:child.target.workerId});
describe('complete frozen Wave 1 final accounting',()=>{
  it('reconciles seven started UNKNOWN children plus one suppressed before dispatch-start',()=>{
    const session=new PrecisionSession({} as any);
    for(const child of children.slice(0,7))session.record({...identity(child),wave:'WAVE_1',state:'UNKNOWN'});
    const results=children.map((attempt,i)=>({attempt,state:i===7?'NOT_DISPATCHED' as const:'UNKNOWN' as const}));
    reconcileWave1Attempts(session,children,results,identity);
    expect(phase3AttemptCounts(session.attempts)).toEqual({attemptCount:8,sentCount:7,settledCount:8,pendingCount:0,unsentCount:1,unknownCount:7,rejectedCount:0,verifiedCount:0});
    expect(session.status).toBe('MANUAL_RECONCILIATION_REQUIRED');
    // Reconciliation is idempotent, never a second reservation or budget consumer.
    reconcileWave1Attempts(session,children,results,identity);expect(session.attempts).toHaveLength(8);
  });
  it('rejects missing, duplicate and foreign result identities',()=>{
    const results=children.map(attempt=>({attempt,state:'NOT_DISPATCHED' as const}));
    for(const bad of [results.slice(1),[...results.slice(1),results[1]!],
      [...results.slice(1),{...results[0]!,attempt:{...children[0]!,id:'foreign'}}]])
      expect(()=>reconcileWave1Attempts(new PrecisionSession({} as any),children,bad,identity)).toThrow('PHASE3_ACCOUNTING_INVALID');
  });
  it('counts verified holds, confirmed rejection, unknown, pending and unsent separately',()=>{
    const states=['VERIFIED','REJECTED','UNKNOWN','IN_FLIGHT','NOT_DISPATCHED'] as const;
    expect(phase3AttemptCounts(states.map((state,i)=>({...identity(children[i]!),wave:'WAVE_1' as const,state})))).toMatchObject({
      attemptCount:5,sentCount:3,settledCount:4,pendingCount:1,unsentCount:1,unknownCount:1,rejectedCount:1,verifiedCount:1});
  });
});
