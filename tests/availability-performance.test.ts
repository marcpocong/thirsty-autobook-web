import { it, expect } from 'vitest';
import { availabilityPerformance } from '../src/availability-performance.js';
import { Telemetry } from '../src/telemetry.js';
const e = (event: string, monoMs: number, value?: number) => ({ event, monoMs, value });
it('keeps per-request measurements separate and missing endpoints null', () => {
  const result = availabilityPerformance([e('releaseTriggerFired', 0), e('availabilityRequestStarted', 1),
    e('availabilityResponseReceived', 100), e('availabilityParsed', 102, 2), e('targetGridReady', 150),
    e('availabilityCandidateResolved', 151, 1), e('availabilityRequestStarted', 200), e('failed', 210)])!;
  expect(result.requests).toEqual([{ durationMs: 99, parseMs: 2, responseToCandidateMs: 51, outcome: 'PARSED' }, { durationMs: null, parseMs: null, responseToCandidateMs: null, outcome: 'PENDING_AT_STOP' }]);
  expect(result.releaseToGridMs).toBe(150); expect(result.gridToFirstClickMs).toBeNull();
  expect(result.selectionToProceedMs).toBeNull(); expect(result.candidateResolutionMs).toBe(1);
  expect(availabilityPerformance([])).toBeNull();
});
it('includes hybrid measurements in failure serialization without API data', () => {
  const t = new Telemetry(); t.mark('availabilityRequestStarted');
  const doc = t.document('RATE_LIMITED');
  expect(doc.availabilityPerformance?.requests[0]?.durationMs).toBeNull();
  expect(JSON.stringify(doc)).not.toMatch(/slotsBySpace|cookies|https?:/);
});

it('summarizes no-refresh, early API candidates, source and selection-to-hold timing', () => {
  const result = availabilityPerformance([e('availabilityRequestStarted',0),e('targetEnabledWithoutReload',1),
    e('availabilityApiCandidatesReady',2),e('targetGridReady',3),e('candidateSourceApiUi',4),
    e('selectionVerified',10),e('qrHandoffVerified',30)])!;
  expect(result).toMatchObject({targetEnabledWithoutReload:true,apiCandidateExistedBeforeGrid:true,candidateSource:'API+UI',selectionToQrHoldMs:20});
  expect(availabilityPerformance([e('availabilityRequestStarted',0),e('availabilityFallbackToUi',1)])!.requests[0]!.outcome).toBe('CANCELED_OR_FAILED');
});
