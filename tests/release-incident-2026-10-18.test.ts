import { describe, expect, it } from 'vitest';
import { UiEventSchema } from '../src/ui-events.js';
import { decodeStructuredEvent } from '../ui/processes.js';
import { shouldContinueAdaptiveRun } from '../src/api-booking/precision-phase3.js';
import { Controller, type Dependencies } from '../ui/controller.js';
import { defaultSetup } from '../ui/booking.js';

describe('October 18 incident regressions', () => {
  it('records the strict authorization validation reason instead of a generic invalid-settings message', () => {
    const controller = new Controller({ publish: () => undefined } as unknown as Dependencies);
    expect(() => controller['releaseSetup']({ ...defaultSetup, BOOKING_METHOD: 'proofless', RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: [] })).toThrow('BOOKING_SETTINGS_INVALID');
    expect(controller.state.detail).toContain('Precision attempts');
    expect(controller.state.logs.at(-1)?.text).toContain('BOOKING_SETTINGS_INVALID:');
  });
  it('shows actual prewarm counts and marks a nothing-dispatched outcome as failed instead of waiting', () => {
    const controller = new Controller({ publish: () => undefined } as unknown as Dependencies);
    controller.state.activeApiRelease = { releaseMs: 1792281600000, targetDate: '2026-10-20', phase: 'WAITING' };
    controller['event']({ type: 'apiStage', stage: 'PREWARM_TIER_STATUS', elapsedMs: 1, message: 'Tier 1 ready: 0/1 (1 preparing)' });
    expect(controller.state.detail).toContain('Tier 1 ready: 0/1');
    controller['event']({ type: 'apiStage', stage: 'FAILED', elapsedMs: 2, code: 'NOTHING_DISPATCHED' });
    expect(controller.state.activeApiRelease.phase).toBe('FAILED');
    expect(controller.state.headline).toBe('OBJECTIVE NOT ACHIEVED · NOTHING DISPATCHED');
  });
  it('delivers the previously rejected pilot, quota, fan-out, failure and lockdown stages', () => {
    const common = { type: 'apiStage', elapsedMs: 375396, workerId: 'A', attemptId: 'core-A-official-1' };
    for (const detail of [
      { stage: 'SHOTGUN_LIVE_PILOT_ATTESTED', attempts: 3 },
      { stage: 'PHASE3_OBJECTIVE_QUOTA', scope: 'PER_WING', mango: 1, buko: 0 },
      { stage: 'PHASE3_FAN_OUT_CHILD', workerGroupIndex: 0, fanOutIndex: 0, fanOutCount: 3 },
      { stage: 'PHASE3_SETTLED', workerGroupIndex: 0, state: 'NOT_DISPATCHED', code: 'SHOTGUN_TRIGGER_MISSED' },
      { stage: 'SECURITY_PREWARM_FAILED', workerGroupIndex: 0, code: 'ONDA_SECURITY_VERIFICATION_FAILED' },
      { stage: 'RELEASE_LOCKDOWN_COMPLETE', deferred: 0, flushed: 0, workInFinal50Ms: 0, workInFinal20Ms: 0, workInFinal10Ms: 0 },
    ]) {
      const event = { ...common, ...detail };
      expect(UiEventSchema.safeParse(event).success).toBe(true);
      expect(decodeStructuredEvent(JSON.stringify(event))).toEqual({ event });
    }
  });
  it('records a readable schema failure without retaining rejected secrets or values', () => {
    const result = decodeStructuredEvent(JSON.stringify({ type: 'apiStage', stage: 'PHASE3_SETTLED', elapsedMs: 1, secret: 'PRIVATE_TOKEN_VALUE' }));
    expect(result).toEqual({ error: 'UI_EVENT_SCHEMA_REJECTED stage=PHASE3_SETTLED issues=unrecognized_keys:event:secret' });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_TOKEN_VALUE');
    expect(decodeStructuredEvent('{broken')).toEqual({ error: 'UI_EVENT_JSON_INVALID' });
    expect('error' in decodeStructuredEvent(JSON.stringify({ type: 'apiStage', stage: 'PHASE3_SETTLED', elapsedMs: -1 }))).toBe(true);
  });
  it('ends a settled release with no permitted adaptive work, including the all-unsent incident', () => {
    const plan = { budgets: { wave2: 0, rescue: 0, total: 3 }, rescueEnabled: false };
    expect(shouldContinueAdaptiveRun(plan, { wave1Settled: false, wave1Fired: false, pending: 0 })).toBe(true);
    expect(shouldContinueAdaptiveRun(plan, { wave1Settled: true, wave1Fired: false, pending: 0 })).toBe(false);
    expect(shouldContinueAdaptiveRun(plan, { wave1Settled: true, wave1Fired: true, pending: 0 })).toBe(false);
    expect(shouldContinueAdaptiveRun(plan, { wave1Settled: true, wave1Fired: true, pending: 1 })).toBe(true);
    expect(shouldContinueAdaptiveRun({ ...plan, budgets: { wave2: 1, rescue: 0, total: 4 } }, { wave1Settled: true, wave1Fired: true, pending: 0 })).toBe(true);
    expect(shouldContinueAdaptiveRun({ budgets: { wave2: 0, rescue: 1, total: 4 }, rescueEnabled: true }, { wave1Settled: true, wave1Fired: true, pending: 0 })).toBe(true);
  });
});
