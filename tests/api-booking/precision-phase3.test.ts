import { describe, expect, it } from 'vitest';
import { authorizePrecision, candidatePriceFromObservation, candidatesConflict, classifyActionableObservation, precisionCandidateId, pricedPrecisionPlan,
  PrecisionSession, type CandidateInput, type PrecisionAuthorizationInput } from '../../src/api-booking/precision-phase3.js';
import { prooflessRequest } from '../../src/api-booking/proofless-checkout.js';
import type { AvailabilityObservation } from '../../src/slot-evidence.js';
import { ProviderTraceSet } from '../../src/api-booking/checkout-provider-trace.js';

const releaseMs = Date.parse('2026-09-24T00:00:00Z');
const candidate = (court: number, start: string, durationHours = 3, priority = court): CandidateInput => ({
  court, start, durationHours, priority, permissions: { wave1: true, wave2: true, rescue: true },
  rateEvidence: { source: 'operator schedule', capturedAt: '2026-09-23T12:00:00Z', status: 'OPERATOR_CONFIRMED',
    date: '2026-09-26', perHour: Array(durationHours).fill(700), actionable: true },
});
const input = (candidates: CandidateInput[]): PrecisionAuthorizationInput => ({ date: '2026-09-26', releaseMs, candidates,
  wave1: [], standby: ['B', 'C'], budgets: { wave2: 2, rescue: 1, total: 4 }, concurrentWave2: true,
  rescueEnabled: true, authorizedAt: '2026-09-23T12:00:00Z' });
const observation = (seq: number, code: 'O' | 'X', cache = 'MISS', offset = 1000): AvailabilityObservation => ({
  seq, requestOffsetMs: offset, responseOffsetMs: offset + 500, scheduledOffsetMs: offset, outcome: 'ok', targetDatePresent: true,
  matrix: Array.from({ length: 7 }, (_, court) => `${court + 1}:${code.repeat(16)}`).join(','),
  prices: Array.from({ length: 7 }, () => Array(16).fill(700)), cache: { status: cache },
});
describe('Phase 3 authorization and evidence', () => {
  it('allows overlapping alternatives in the pool but rejects duplicate and conflicting Wave 1 assignments', () => {
    const draft = input([candidate(3, '15:00'), candidate(3, '17:00'), candidate(4, '15:00')]);
    const frozen = authorizePrecision({ ...draft, wave1: [{ workerId: 'A', candidateId: id(draft, 0) }] });
    expect(frozen.candidates).toHaveLength(3);
    expect(Object.isFrozen(frozen.candidates[0]!.rateEvidence.perHour)).toBe(true);
    expect(Object.isFrozen(frozen.candidates[0]!.permissions)).toBe(true);
    expect(Object.isFrozen(frozen.budgets)).toBe(true);
    expect(candidatesConflict(frozen.candidates[0]!, frozen.candidates[1]!)).toBe(true);
    expect(() => authorizePrecision({ ...draft, wave1: [{ workerId: 'A', candidateId: id(draft, 0) },
      { workerId: 'B', candidateId: id(draft, 1) }] })).toThrow('PRECISION_WAVE1_CONFLICT');
    expect(() => authorizePrecision({ ...draft, candidates: [draft.candidates[0]!, draft.candidates[0]!] })).toThrow('PRECISION_CANDIDATE_DUPLICATE');
  });
  it('rejects cached, stale, incomplete, old-request, and unreleased evidence', () => {
    const fresh = observation(2, 'O');
    expect(classifyActionableObservation(fresh, 2, releaseMs, releaseMs + 2000, 5000).fitness).toBe('ACTIONABLE_FRESH');
    expect(classifyActionableObservation(observation(2, 'O', 'HIT'), 2, releaseMs, releaseMs + 2000, 5000).fitness)
      .toBe('FORENSIC_ONLY_CACHE_AGE_UNKNOWN');
    expect(classifyActionableObservation(fresh, 2, releaseMs, releaseMs + 7000, 5000).fitness).toBe('FORENSIC_ONLY_STALE');
    expect(classifyActionableObservation(fresh, 3, releaseMs, releaseMs + 2000, 5000).fitness).toBe('FORENSIC_ONLY_OUTDATED_REQUEST');
    expect(classifyActionableObservation({ ...fresh, matrix: '1:O' }, 2, releaseMs, releaseMs + 2000, 5000).fitness)
      .toBe('FORENSIC_ONLY_INCOMPLETE');
    expect(classifyActionableObservation({ ...fresh, requestOffsetMs: -5 }, 2, releaseMs, releaseMs + 2000, 5000).fitness).toBe('UNRELEASED');
  });
  it('selects one adaptive wave using prices from the same fresh observation and stops on UNKNOWN', () => {
    const draft = input([candidate(1, '15:00'), candidate(2, '16:00'), candidate(3, '17:00')]);
    const auth = authorizePrecision({ ...draft, wave1: [{ workerId: 'A', candidateId: id(draft, 0) }] });
    const session = new PrecisionSession(auth);
    session.record({ id: 'wave1', candidateId: auth.candidates[0]!.id, workerId: 'A', wave: 'WAVE_1', state: 'IN_FLIGHT' });
    session.observe(classifyActionableObservation(observation(1, 'O'), 1, releaseMs, releaseMs + 2000, 5000));
    const selected = session.select('WAVE_2', releaseMs + 2000, 5000);
    expect(selected.map(value => value.candidate.court)).toEqual([2, 3]);
    expect(selected[0]!.prices).toEqual([700, 700, 700]);
    expect(session.select('WAVE_2', releaseMs + 2000, 5000)).toEqual([]);
    expect(candidatePriceFromObservation(auth.candidates[1]!, classifyActionableObservation(observation(2, 'X'), 2,
      releaseMs, releaseMs + 2500, 5000))).toBeNull();
    session.attempts[0]!.state = 'UNKNOWN';
    expect(session.select('RESCUE', releaseMs + 2000, 5000)).toEqual([]);
  });
  it('keeps Wave 2 available when an earlier fresh grid has no open authorized target', () => {
    const draft = input([candidate(1, '15:00'), candidate(2, '16:00')]);
    const auth = authorizePrecision({ ...draft, wave1: [{ workerId: 'A', candidateId: id(draft, 0) }] });
    const session = new PrecisionSession(auth);
    session.record({ id: 'wave1', candidateId: auth.candidates[0]!.id, workerId: 'A', wave: 'WAVE_1', state: 'REJECTED' });
    session.observe(classifyActionableObservation(observation(1, 'X'), 1, releaseMs, releaseMs + 2000, 5000));
    expect(session.select('WAVE_2', releaseMs + 2000, 5000)).toEqual([]);
    session.observe(classifyActionableObservation(observation(2, 'O', 'MISS', 2500), 2, releaseMs, releaseMs + 3000, 5000));
    expect(session.select('WAVE_2', releaseMs + 3000, 5000).map(value => value.candidate.court)).toEqual([2]);
  });
  it('captures a sanitized normal-response fallback without any CDP trace', () => {
    const trace = new ProviderTraceSet('synthetic', 'release', releaseMs, () => 2000);
    trace.captureFallback({ workerId: 'A', attemptId: 'attempt', candidateId: 'candidate', wave: 'WAVE_1' },
      { status: 409, contentType: 'application/json; charset=utf-8', server: 'fixture', cloudflareRay: '',
        vercelId: 'secret-token', requestId: 'request-12345678', serverTiming: 'app;dur=5;desc="private-data"',
        responseReceivedMs: 20, responseCompletedMs: 21 });
    expect(trace.records()).toEqual([]);
    expect(trace.fallbacks()).toMatchObject([{ status: 409, contentType: 'application/json', server: 'fixture',
      vercelId: null, requestId: 'request-12345678', serverTiming: [{ name: 'app', durMs: 5 }], responseReceivedMs: 20 }]);
    expect(JSON.stringify(trace.fallbacks())).not.toMatch(/secret-token|private-data/);
  });
  it('puts only the triggering evidence prices in the adaptive checkout request', () => {
    const draft=input([candidate(1,'15:00')]);
    const auth=authorizePrecision({...draft,wave1:[{workerId:'A',candidateId:id(draft,0)}]});
    const plan=pricedPrecisionPlan(auth.candidates[0]!,draft.date,[950,975,1000]);
    expect(plan.totalPrice).toBe(2925);
    expect(prooflessRequest(plan,{clientId:'synthetic',customerId:'synthetic',customerEmail:'synthetic@example.invalid',
      customerPhone:'0000000000',customerFirstName:'Synthetic',customerLastName:'Player'}).items.map(item=>item.rate))
      .toEqual([950,975,1000]);
  });
});
function id(draft: PrecisionAuthorizationInput, index: number): string {
  return precisionCandidateId(draft.date, draft.candidates[index]!);
}
