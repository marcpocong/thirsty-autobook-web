import { describe, expect, it } from 'vitest';
import { fanOutTimingPlan } from '../src/fanout-timing.js';
import { applyLiveAnchor, calibrateLiveAnchor, recommendGroupShiftMs, type LiveTimingSample } from '../src/live-anchor-calibration.js';

const at = '2026-09-28T00:00:00.000Z';
function sample(runId: string, configuredOffsetMs: number, observedChromeStartMs: number, extra: Partial<LiveTimingSample> = {}): LiveTimingSample {
  return { runId, releaseMs: Date.parse(at), configuredOffsetMs, observedChromeStartMs,
    triggerToChromeLagMs: Math.round((observedChromeStartMs - configuredOffsetMs) * 10) / 10, workerId: 'A', fanOutIndex: 0, fanOutCount: 1,
    dispatchMode: 'node', origin: 'REAL_RELEASE', trustedClockValid: true, dispatched: true, recordedAt: at, ...extra };
}
const now = Date.parse('2026-09-30T00:00:00.000Z');

describe('Smart Timing V2.2 live anchor', () => {
  it('recovers September 28 configured-to-Chrome lag without selecting the earliest HTTP response offset', () => {
    const configured = [-50, -25, -10, -5, 0, 0, 0], chrome = [-45.6, -20.9, -6, -0.8, 4.2, 4.3, 4.8];
    const samples = configured.map((value, index) => sample('sep-28', value, chrome[index]!, { workerId: 'CB ADEFG'.replaceAll(' ', '')[index]!,
      responseDurationMs: [10_000, 8_000, 20_000, 12_000, 9_000, 11_000, 10_000][index] }));
    const calibration = calibrateLiveAnchor(samples, { dispatchMode: 'node', fanOutWidth: 1 }, { now });
    expect(calibration).toMatchObject({ sampleCount: 7, releaseCount: 1, evidenceStrength: 'LIMITED', medianLagMs: 4.2, minLagMs: 4, maxLagMs: 4.8 });
    expect(recommendGroupShiftMs(fanOutTimingPlan('TIGHT', 1, null), calibration)).toBe(-4);
    expect(samples.find(value => value.configuredOffsetMs === -25)?.responseDurationMs).toBe(8_000);
  });

  it('is identical when only HTTP response order/duration changes', () => {
    const a = [sample('r1', -25, -21, { responseDurationMs: 8_000 }), sample('r1', -10, -6, { responseDurationMs: 20_000 })];
    const b = [sample('r1', -25, -21, { responseDurationMs: 30_000 }), sample('r1', -10, -6, { responseDurationMs: 5_000 })];
    expect(calibrateLiveAnchor(a, { dispatchMode: 'node', fanOutWidth: 1 }, { now }))
      .toEqual(calibrateLiveAnchor(b, { dispatchMode: 'node', fanOutWidth: 1 }, { now }));
  });

  it('does not treat width-1 history as matching width-2 evidence', () => {
    const samples = Array.from({ length: 7 }, (_, index) => sample(`r${index}`, 0, 4.2));
    const width2 = calibrateLiveAnchor(samples, { dispatchMode: 'node', fanOutWidth: 2 }, { now });
    expect(width2).toMatchObject({ sampleCount: 0, releaseCount: 0, evidenceStrength: 'NONE' });
    expect(recommendGroupShiftMs(fanOutTimingPlan('TIGHT', 2, null), width2)).toBe(0);
  });

  it('centers width-2 predicted Chrome starts while preserving spacing', () => {
    const samples = ['r1', 'r2'].flatMap(runId => [sample(runId, -10, 2, { fanOutCount: 2, fanOutIndex: 0 }), sample(runId, 0, 12, { fanOutCount: 2, fanOutIndex: 1 })]);
    const calibration = calibrateLiveAnchor(samples, { dispatchMode: 'node', fanOutWidth: 2 }, { now });
    const base = fanOutTimingPlan('TIGHT', 2, null), anchored = applyLiveAnchor(base, calibration);
    expect(anchored.groupShiftMs).toBe(-7);
    expect(anchored.children.map(value => value.configuredOffsetMs)).toEqual([-17, -7]);
    expect(anchored.children[1]!.configuredOffsetMs - anchored.children[0]!.configuredOffsetMs).toBe(base.spacingMs);
    expect(anchored.children.map(value => value.predictedChromeStartMs?.[0])).toEqual([-5, 5]);
  });

  it('does not manufacture an earlier shift when a 10 ms group with 4-5 ms lag already straddles release', () => {
    const samples = ['r1', 'r2'].flatMap((runId, run) => [sample(runId, -10, -5.8 + run / 10, { fanOutCount: 2, fanOutIndex: 0 }),
      sample(runId, 0, 4.4 + run / 10, { fanOutCount: 2, fanOutIndex: 1 })]);
    expect(recommendGroupShiftMs(fanOutTimingPlan('TIGHT', 2, null), calibrateLiveAnchor(samples, { dispatchMode: 'node', fanOutWidth: 2 }, { now }))).toBe(0);
  });

  it('uses robust medians, rejects invalid data, and fails stale evidence toward zero', () => {
    const lags = [4.1, 4.2, 4.3, 4.4, 40];
    const valid = lags.map((lag, index) => sample(`r${index}`, 0, lag));
    const bad = [sample('bad-clock', 0, 100, { trustedClockValid: false }), sample('not-sent', 0, 100, { dispatched: false }),
      sample('synthetic', 0, 100, { origin: 'SYNTHETIC' }), sample('impossible', 0, 3_000)];
    const calibration = calibrateLiveAnchor([...valid, ...bad], { dispatchMode: 'node', fanOutWidth: 1 }, { now });
    expect(calibration).toMatchObject({ sampleCount: 5, medianLagMs: 4.3, maxLagMs: 40, evidenceStrength: 'STRONG' });
    expect(recommendGroupShiftMs(fanOutTimingPlan('TIGHT', 1, null), calibration)).toBe(-4);
    const stale = calibrateLiveAnchor(valid, { dispatchMode: 'node', fanOutWidth: 1 }, { now: Date.parse('2026-11-30T00:00:00Z') });
    expect(stale.stale).toBe(true);
    expect(recommendGroupShiftMs(fanOutTimingPlan('TIGHT', 1, null), stale)).toBe(0);
  });

  it('supports an operator group-shift override without changing child spacing', () => {
    const base = fanOutTimingPlan('TIGHT', 2, null), calibration = calibrateLiveAnchor([], { dispatchMode: 'node', fanOutWidth: 2 }, { now });
    const plan = applyLiveAnchor(base, calibration, -5);
    expect(plan).toMatchObject({ groupShiftMs: -5, anchorSource: 'OPERATOR_OVERRIDE' });
    expect(plan.children.map(value => value.configuredOffsetMs)).toEqual([-15, -5]);
  });

  it('filters old rows before Auto so one recent release cannot resurrect them', () => {
    const recent=sample('recent',0,6),old=Array.from({length:20},(_,index)=>sample(`old-${index}`,0,100,{recordedAt:'2026-01-01T00:00:00.000Z'}));
    const calibration=calibrateLiveAnchor([...old,recent],{dispatchMode:'node',fanOutWidth:1},{now});
    expect(calibration).toMatchObject({sampleCount:1,releaseCount:1,medianLagMs:6,staleSampleCount:20,staleReleaseCount:20});
  });

  it('gives each release one main vote instead of weighting a high-width run by its children',()=>{
    const noisy=Array.from({length:100},(_,index)=>sample('wide',0,1,{workerId:String.fromCharCode(65+(index%7))}));
    const calibration=calibrateLiveAnchor([...noisy,sample('normal-1',0,9),sample('normal-2',0,9)],{dispatchMode:'node',fanOutWidth:1},{now});
    expect(calibration.medianLagMs).toBe(9);
    expect(calibration.releaseMedians).toHaveLength(3);
  });
});
