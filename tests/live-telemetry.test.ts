import { describe, expect, it } from 'vitest';
import { describeChildren, reduceLiveRun } from '../ui/live-run.js';
import { liveTimingSamples, summarizeRun } from '../src/release-telemetry.js';
import type { UiEvent } from '../src/ui-events.js';
import type { LiveRunView } from '../ui/types.js';

type Stage = Extract<UiEvent, { type: 'apiStage' }>;
const stage = (name: string, extra: Partial<Stage> = {}): Stage => ({ type: 'apiStage', stage: name, elapsedMs: 0, ...extra } as Stage);
const candidate = 'a'.repeat(64);

describe('Live view model (parent goal → independently tracked children)', () => {
  it('groups fan-out children under their immediate target and keeps each child outcome', () => {
    const candidates = new Map<string, { court: number; startTime: string; endTime: string }>();
    let view: LiveRunView | null = null;
    for (const event of [stage('RUN_STARTED'), stage('PHASE3_AUTHORIZATION', { maxRescue: 2 }),
      stage('PHASE3_CANDIDATE', { candidateId: candidate, court: 7, startTime: '19:00', endTime: '22:00' }),
      ...[0, 1, 2].map(index => stage('PHASE3_FAN_OUT_CHILD', { workerId: 'A', candidateId: candidate, attemptId: `att-${index}`, fanOutIndex: index, fanOutCount: 3, releaseOffsetMs: index === 2 ? 0 : -10 * (2 - index) })),
      stage('PREWARM_TIER_STATUS', { message: 'Tier 1 ready: 1/1' }),
      ...[0, 1, 2].map(index => stage('PHASE3_WAVE1_STARTED', { workerId: 'A', candidateId: candidate, attemptId: `att-${index}`, fanOutIndex: index, fanOutCount: 3 })),
      stage('PHASE3_SETTLED', { workerId: 'A', candidateId: candidate, attemptId: 'att-0', state: 'REJECTED', fanOutIndex: 0, fanOutCount: 3, wave: 'WAVE_1' }),
      stage('PHASE3_SETTLED', { workerId: 'A', candidateId: candidate, attemptId: 'att-1', state: 'REJECTED', fanOutIndex: 1, fanOutCount: 3, wave: 'WAVE_1' }),
      // A late non-terminal event never overwrites a terminal outcome.
      stage('PHASE3_WAVE1_STARTED', { workerId: 'A', candidateId: candidate, attemptId: 'att-0', fanOutIndex: 0, fanOutCount: 3 }),
    ]) view = reduceLiveRun(view, event, candidates);
    expect(view!.parents).toHaveLength(1);
    const parent = view!.parents[0]!;
    expect(parent).toMatchObject({ wave: 'WAVE_1', workerId: 'A', court: 7, startTime: '19:00', endTime: '22:00' });
    expect(parent.children.map(child => [child.label, child.state, child.offsetMs])).toEqual([['A0', 'REJECTED', -20], ['A1', 'REJECTED', -10], ['A2', 'IN_FLIGHT', 0]]);
    expect(describeChildren(parent)).toBe('3 attempts: 2 rejected, 1 in flight');
    expect(view).toMatchObject({ rescueEnabled: true, rescueMax: 2, tiers: 'Tier 1 ready: 1/1' });
  });
  it('tracks Rescue as its own parent per candidate, with predictions, prewarm and observed error', () => {
    const candidates = new Map([[candidate, { court: 3, startTime: '19:00', endTime: '22:00' }]]);
    let view: LiveRunView | null = reduceLiveRun(null, stage('RUN_STARTED'), candidates);
    candidates.set(candidate, { court: 3, startTime: '19:00', endTime: '22:00' });
    for (const event of [stage('RESCUE_PREDICTION', { candidateId: candidate, predictedStartMs: 598_000, predictedEndMs: 610_000, confidence: 'HOLD_EXPIRY_PATTERN' }),
      stage('RESCUE_PREWARM', { candidateId: candidate, workerId: 'E' }), stage('RESCUE_PREWARM_READY', { candidateId: candidate, workerId: 'E' }),
      stage('PHASE3_ATTEMPT_RESERVED', { workerId: 'E', candidateId: candidate, attemptId: 'r1', wave: 'RESCUE', court: 3, startTime: '19:00', endTime: '22:00' }),
      stage('RESCUE_PREDICTION_OUTCOME', { candidateId: candidate, errorMs: 1_200 }),
      stage('PHASE3_DISPATCH', { workerId: 'E', candidateId: candidate, attemptId: 'r1', wave: 'RESCUE' }),
      stage('PHASE3_SETTLED', { workerId: 'E', candidateId: candidate, attemptId: 'r1', wave: 'RESCUE', state: 'REJECTED' })]) view = reduceLiveRun(view, event, candidates);
    expect(view!.parents.map(parent => [parent.wave, parent.children.map(child => child.state)])).toEqual([['RESCUE', ['REJECTED']]]);
    expect(view!.predictions[0]).toMatchObject({ court: 3, prewarm: 'READY', errorMs: 1_200, confidence: 'HOLD_EXPIRY_PATTERN' });
  });
  it('shows Fixed Precision fan-out children too, and freeze notes', () => {
    let view: LiveRunView | null = reduceLiveRun(null, stage('RUN_STARTED'), new Map());
    for (const [index, state] of ['REJECTED', 'UNKNOWN'].entries())
      view = reduceLiveRun(view, stage('PRECISION_ATTEMPT_STATE', { workerId: 'B', court: 6, startTime: '21:00', endTime: '24:00', attemptState: state, attemptId: `f${index}`, fanOutIndex: index, fanOutCount: 2 }), new Map());
    view = reduceLiveRun(view, stage('PHASE3_WAVE1_EXCLUDED', { workerId: 'C', candidateId: candidate, code: 'PUBLIC_BOOKING_CONFLICT_AT_FREEZE' }), new Map());
    expect(view!.parents[0]!.children.map(child => child.state)).toEqual(['REJECTED', 'UNKNOWN']);
    expect(view!.notes[0]).toBe('Worker C: left out at freeze (public booking conflict at freeze).');
  });
});

describe('release dispatch telemetry summary', () => {
  it('separates configured trigger from Chrome request start and measures compression per fan-out position', () => {
    const row = (id: string, workerId: string, index: number, configured: number, chrome: number, extra: Record<string, unknown> = {}) => ({ schema: 'critical-path/v1', workerId: id,
      workerInvokedMs: configured + 0.3, requestObservedMs: chrome + 2, responseObservedMs: chrome + 900, fetchInvokedMs: { ms: chrome - 1, lowMs: chrome - 1.5, highMs: chrome - 0.5 },
      browserRequestStartMs: chrome, meta: { workerId, fanOutIndex: index, fanOutCount: 2, configuredOffsetMs: configured, parentGoalId: `g-${workerId}`, finalState: 'REJECTED',
        prewarmReadyMs: -9_000, ...extra } });
    const summary = summarizeRun('run-1', [{ type: 'header', schema: 'critical-path/v1' }, row('a0', 'A', 0, -35, -4), row('a1', 'A', 1, -10, 11), row('b0', 'B', 0, -35, -3), row('b1', 'B', 1, -10, 12)], [
      { stage: 'PHASE3_ADAPTIVE_SELECTED', at: '2026-09-29T00:10:00.000Z', workerId: 'E', candidateId: 'c', wave: 'RESCUE' },
      { stage: 'PHASE3_DISPATCH', at: '2026-09-29T00:10:00.400Z', workerId: 'E', candidateId: 'c', wave: 'RESCUE' },
      { stage: 'RESCUE_PREDICTION_OUTCOME', errorMs: 1500 }]);
    expect(summary.children.map(child => [child.label, child.errorMs])).toEqual([['A0', 31], ['A1', 21], ['B0', 32], ['B1', 22]]);
    expect(summary.summary.perChildIndex.map(value => [value.fanOutIndex, value.error.p50])).toEqual([[0, 31], [1, 21]]);
    // 16 ms of Chrome-start spread for 25 ms of configured spread: the offsets were compressed to 64%.
    expect(summary.summary).toMatchObject({ spreadMs: 16, compression: 0.64 });
    expect(summary.summary.prewarmHeadroomMs.min).toBe(8_965);
    expect(summary.summary.adaptiveSelectionToPost.p50).toBe(400);
    expect(summary.summary.reopenPredictionErrorMs.p50).toBe(1500);
    expect(JSON.stringify(summary)).not.toMatch(/token|cookie|customer/i);
  });
  it('recovers legacy single-attempt offsets from live progress and does not turn undispatched missing data into zero', () => {
    const row = (workerId: string, chrome: number) => ({ schema: 'critical-path/v1', workerId, dispatchMode: 'node', browserRequestStartMs: chrome,
      calibration: { consistent: true }, meta: {} });
    const progress = [
      { mode: 'live', targetDate: '2026-09-30', at: '2026-09-27T23:30:00Z' },
      { stage: 'RELEASE_OFFSET_SCHEDULED', workerId: 'A', releaseOffsetMs: -10 },
      { stage: 'PHASE3_DISPATCH', workerId: 'A' }, { stage: 'PHASE3_DISPATCH', workerId: 'B' },
    ];
    const run = summarizeRun('real-run', [{ schema: 'critical-path/v1', type: 'header', releaseMs: 1_790_553_600_000, wallToTrustedMs: 39 }, row('A', -6), row('B', 4.3), row('C', 9)], progress);
    expect(run.children.map(value => [value.workerId, value.configuredOffsetMs, value.errorMs])).toEqual([['A', -10, 4], ['B', 0, 4.3], ['C', null, null]]);
    expect(liveTimingSamples([run]).map(value => [value.workerId, value.triggerToChromeLagMs])).toEqual([['A', 4], ['B', 4.3]]);
  });
  it('joins legacy worker:index fan-out rows to each child offset without collapsing the worker schedule', () => {
    const progress = [{ mode: 'live', at: '2026-09-29T00:00:00Z' }, ...[-35, -30, -25, -10].map(releaseOffsetMs => ({ stage: 'RELEASE_OFFSET_SCHEDULED', workerId: 'A', releaseOffsetMs }))];
    const rows = [{ schema: 'critical-path/v1', type: 'header', releaseMs: 1_790_640_000_000, wallToTrustedMs: -746 },
      ...[-22.5, -18.6, -9.3, -3.6].map((browserRequestStartMs, index) => ({ schema: 'critical-path/v1', workerId: `A:${index}`, dispatchMode: 'node',
        prePostMs: browserRequestStartMs - 5, browserRequestStartMs, responseObservedMs: 3_000, calibration: null }))];
    const run = summarizeRun('fanout-live', rows, progress);
    expect(run.children.map(value => [value.label, value.fanOutCount, value.configuredOffsetMs])).toEqual([
      ['A0', 4, -35], ['A1', 4, -30], ['A2', 4, -25], ['A3', 4, -10],
    ]);
    expect(liveTimingSamples([run])).toHaveLength(4);
  });
});
