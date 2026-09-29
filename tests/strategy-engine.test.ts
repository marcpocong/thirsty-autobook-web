import { describe, expect, it } from 'vitest';
import { compileSmartPlan, confirmSmartRates, describeSmartPlan, emptySmartDraft, smartDraftFromPhase3, smartImmediateSends, SMART_MAX_FAN_OUT, SMART_MAX_SENDS,
  type SmartDraft } from '../src/precision-simple.js';
import { authorizePrecision, precisionCandidateId, wave1SendCount } from '../src/api-booking/precision-phase3.js';
import { PRECISION_MAX_FAN_OUT, PRECISION_MAX_SENDS } from '../src/workers.js';
import { ConfigSchema } from '../src/config.js';
import { defaultSetup } from '../ui/booking.js';
import { DEFAULT_STRATEGY_GOAL, draftFromSuggestion, enumeratePrimeWindows, knownScheduleFromCells, presetAllocation, PUBLIC_CONFLICT_OVERRIDE, scoreWindow,
  suggestPlan, validateGoal, windowEvidence, STRATEGY_MAX_CANDIDATES, type BlockAuditCell, type KnownSchedule, type StrategyGoal } from '../src/strategy-engine.js';

const targetDate = '2026-10-01', now = new Date('2026-09-29T12:00:00.000Z');
const players = { PLAYER_FULL_NAME: 'Fixture Player', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'fixture@example.invalid' };
const rates = confirmSmartRates(600, 700, 'VENUE_SCHEDULE', targetDate, now);
function backend(phase3: NonNullable<ReturnType<typeof compileSmartPlan>['phase3']>) {
  const config = ConfigSchema.parse({ ...defaultSetup, BOOKING_METHOD: 'proofless', DURATION_HOURS: 3, RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: [], PRECISION_PHASE3: phase3, ...players });
  const saved = config.PRECISION_PHASE3!;
  return authorizePrecision({ date: targetDate, releaseMs: Date.parse('2026-09-29T00:00:00Z'), candidates: saved.candidates,
    wave1: saved.wave1.map(value => ({ workerId: value.workerId, candidateId: precisionCandidateId(targetDate, saved.candidates[value.candidateIndex]!),
      ...(value.fanOutOffsetsMs ? { fanOutOffsetsMs: value.fanOutOffsetsMs } : value.releaseOffsetMs ? { releaseOffsetMs: value.releaseOffsetMs } : {}) })),
    standby: saved.standby, budgets: saved.budgets, concurrentWave2: saved.concurrentWave2, rescueEnabled: saved.rescueEnabled, authorizedAt: now.toISOString() });
}
/** Block audit: every hour UNRELEASED (no known public booking) except the listed PUBLIC_BOOKING / failed cells. */
function schedule(booked: Array<[number, string]> = [], failed: number[] = []): KnownSchedule {
  const cells: BlockAuditCell[] = [];
  for (let court = 1; court <= 7; court++) for (let hour = 8; hour <= 23; hour++) {
    const text = `${String(hour).padStart(2, '0')}:00`;
    cells.push(booked.some(([c, h]) => c === court && h === text) ? { court, hour: text, status: 'BLOCKED', source: 'PUBLIC_BOOKING' }
      : failed.includes(court) ? { court, hour: text, status: 'UNKNOWN', source: 'PUBLIC_BOOKING_QUERY_FAILED' }
      : { court, hour: text, status: 'UNRELEASED', source: 'DATE_UNRELEASED' });
  }
  return knownScheduleFromCells(targetDate, now.toISOString(), cells);
}

describe('Smart immediate targets with fan-out children', () => {
  const draft = (extra: Partial<SmartDraft> = {}): SmartDraft => ({ ...emptySmartDraft(), rates, retryReopened: true, maxReopenedAttempts: 2,
    immediate: [{ court: 7, start: '19:00', durationHours: 3, fanOutOffsetsMs: [-20, -10, 0] }, { court: 6, start: '20:00', durationHours: 3, fanOutOffsetsMs: [-20, -10, 0] }],
    backups: [{ court: 5, start: '18:00', durationHours: 3 }], ...extra });
  it('mirrors the backend fan-out and send limits', () => {
    expect(SMART_MAX_FAN_OUT).toBe(PRECISION_MAX_FAN_OUT);
    expect(SMART_MAX_SENDS).toBe(PRECISION_MAX_SENDS);
  });
  it('compiles children into the authoritative object, counts every child as a send, and the backend accepts it', () => {
    const compiled = compileSmartPlan(draft(), { targetDate });
    expect(compiled.problems).toEqual([]);
    const phase3 = compiled.phase3!;
    expect(phase3.wave1.map(value => value.fanOutOffsetsMs)).toEqual([[-20, -10, 0], [-20, -10, 0]]);
    expect(smartImmediateSends(phase3.wave1)).toBe(6);
    expect(phase3.budgets).toEqual({ wave2: 1, rescue: 2, total: 9 });
    const authorization = backend(phase3);
    expect(wave1SendCount(authorization)).toBe(6);
    expect(authorization.wave1[0]!.fanOutOffsetsMs).toEqual([-20, -10, 0]);
  });
  it('"what will happen" is generated from the saved object and lists every child', () => {
    const description = describeSmartPlan(compileSmartPlan(draft(), { targetDate }).phase3!);
    expect(description.sections[0]!.lines[0]).toBe('2 immediate targets will be sent as 6 independently tracked attempts (fan-out). They do not wait for the released schedule.');
    expect(description.sections[0]!.lines[1]).toContain('3 fan-out children: A0 −20 ms, A1 −10 ms, A2 0 ms');
    expect(description.summary).toContain('2 immediate (6 sends with fan-out)');
    expect(description.maxSends).toBe(9);
  });
  it('round-trips a saved fan-out plan exactly', () => {
    const phase3 = compileSmartPlan(draft(), { targetDate }).phase3!;
    const again = compileSmartPlan(smartDraftFromPhase3(phase3, { targetDate }), { targetDate }).phase3!;
    expect(again).toEqual(phase3);
  });
  it('rejects fan-out on a backup, a single child, five children, or together with a single offset', () => {
    const problems = (value: SmartDraft) => compileSmartPlan(value, { targetDate }).problems.join(' ');
    expect(problems(draft({ backups: [{ court: 5, start: '18:00', durationHours: 3, fanOutOffsetsMs: [-10, 0] }] }))).toMatch(/invalid fan-out/);
    expect(problems(draft({ immediate: [{ court: 7, start: '19:00', durationHours: 3, fanOutOffsetsMs: [0] }] }))).toMatch(/invalid fan-out/);
    expect(problems(draft({ immediate: [{ court: 7, start: '19:00', durationHours: 3, fanOutOffsetsMs: [-40, -30, -20, -10, 0] }] }))).toMatch(/invalid fan-out/);
    expect(problems(draft({ immediate: [{ court: 7, start: '19:00', durationHours: 3, fanOutOffsetsMs: [-10, 0], releaseOffsetMs: -5 }] }))).toMatch(/invalid fan-out/);
  });
  it('the config schema and authorizePrecision refuse inconsistent fan-out budgets', () => {
    const phase3 = compileSmartPlan(draft(), { targetDate }).phase3!;
    expect(() => backend({ ...phase3, budgets: { ...phase3.budgets, total: 3 } })).toThrow();
    expect(() => authorizePrecision({ date: targetDate, releaseMs: 1, candidates: phase3.candidates, standby: [], concurrentWave2: false, rescueEnabled: false,
      authorizedAt: now.toISOString(), budgets: { wave2: 0, rescue: 0, total: 1 },
      wave1: [{ workerId: 'A', candidateId: precisionCandidateId(targetDate, phase3.candidates[0]!), fanOutOffsetsMs: [0] }] })).toThrow('PRECISION_WAVE1_ASSIGNMENT_INVALID');
  });
  it('keeps an old plan without fan-out byte-for-byte (fingerprint unchanged by the new optional fields)', () => {
    const phase3 = compileSmartPlan(draft({ immediate: [{ court: 7, start: '19:00', durationHours: 3 }] }), { targetDate }).phase3!;
    const withoutOffsets = authorizePrecision({ date: targetDate, releaseMs: 1, candidates: phase3.candidates, standby: phase3.standby, budgets: phase3.budgets,
      concurrentWave2: false, rescueEnabled: true, authorizedAt: now.toISOString(),
      wave1: [{ workerId: phase3.wave1[0]!.workerId, candidateId: precisionCandidateId(targetDate, phase3.candidates[0]!) }] });
    expect(withoutOffsets.wave1[0]).toEqual({ workerId: 'A', candidateId: precisionCandidateId(targetDate, phase3.candidates[0]!) });
  });
});

describe('Prime Strategy Generator', () => {
  it('enumerates every window from 17:00 through midnight, including windows that end at 24:00', () => {
    const windows = enumeratePrimeWindows({ ...DEFAULT_STRATEGY_GOAL, courts: [7] });
    const text = (duration: number) => windows.filter(window => window.durationHours === duration).map(window => window.start);
    expect(text(3)).toEqual(['17:00', '18:00', '19:00', '20:00', '21:00']);
    expect(text(2)).toEqual(['17:00', '18:00', '19:00', '20:00', '21:00', '22:00']);
    expect(text(1)).toEqual(['17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00']);
    expect(windows).toHaveLength(18);
    expect(enumeratePrimeWindows({ ...DEFAULT_STRATEGY_GOAL, primeFrom: '17:00', primeUntil: '17:00' })).toEqual([]);
  });
  it('validates the goal', () => {
    expect(validateGoal(DEFAULT_STRATEGY_GOAL)).toEqual([]);
    expect(validateGoal({ ...DEFAULT_STRATEGY_GOAL, durations: [4] }).length).toBe(1);
    expect(validateGoal({ ...DEFAULT_STRATEGY_GOAL, courts: [7, 7] }).length).toBe(1);
    expect(validateGoal({ ...DEFAULT_STRATEGY_GOAL, primeUntil: '25:00' }).length).toBe(1);
  });
  it('classifies windows without ever calling an unreleased no-record hour "open"', () => {
    const known = schedule([[7, '23:00']], [3]);
    expect(windowEvidence({ court: 7, start: '21:00', durationHours: 3 }, known).evidence).toBe('KNOWN_PUBLIC_BOOKING_CONFLICT');
    expect(windowEvidence({ court: 7, start: '20:00', durationHours: 3 }, known).evidence).toBe('NO_KNOWN_PUBLIC_CONFLICT');
    expect(windowEvidence({ court: 3, start: '19:00', durationHours: 3 }, known).evidence).toBe('UNKNOWN_PUBLIC_QUERY_FAILED');
    expect(windowEvidence({ court: 7, start: '19:00', durationHours: 3 }, null).evidence).toBe('UNKNOWN_PUBLIC_QUERY_FAILED');
    const cells = [...known.hours.values()];
    expect(cells).not.toContain('PUBLISHED_OPEN');
  });
  it('scores explicit preferences only (duration order, prime fit, court order, evidence quality)', () => {
    const goal: StrategyGoal = DEFAULT_STRATEGY_GOAL;
    const best = scoreWindow({ court: 7, start: '19:00', durationHours: 3 }, goal, 'NO_KNOWN_PUBLIC_CONFLICT');
    expect(best.total).toBeGreaterThan(scoreWindow({ court: 7, start: '19:00', durationHours: 2 }, goal, 'NO_KNOWN_PUBLIC_CONFLICT').total);
    expect(best.total).toBeGreaterThan(scoreWindow({ court: 1, start: '19:00', durationHours: 3 }, goal, 'NO_KNOWN_PUBLIC_CONFLICT').total);
    expect(scoreWindow({ court: 7, start: '19:00', durationHours: 3 }, goal, 'UNKNOWN_PUBLIC_QUERY_FAILED').evidence).toBe(0);
  });
});

describe('suggestions, diversification and overrides', () => {
  const balanced = presetAllocation('BALANCED', { readyWorkers: 7, recommendedFanOutWidth: 2 });
  it('diversifies immediate targets across start times instead of one shared window', () => {
    const plan = suggestPlan({ goal: DEFAULT_STRATEGY_GOAL, schedule: schedule(), allocation: balanced });
    expect(plan.immediate.map(window => `C${window.court} ${window.start}-${window.end}`)).toEqual(['C7 19:00-22:00', 'C6 20:00-23:00', 'C5 18:00-21:00', 'C4 21:00-24:00']);
    expect(plan.reasons).toContain('Diversified across start times to reduce one-window concentration.');
  });
  it('avoids known public conflicts and fails closed on failed public reads', () => {
    const plan = suggestPlan({ goal: DEFAULT_STRATEGY_GOAL, schedule: schedule([[7, '20:00'], [6, '21:00']], [5]), allocation: balanced });
    for (const window of [...plan.immediate, ...plan.backups]) {
      expect(window.evidence).toBe('NO_KNOWN_PUBLIC_CONFLICT');
      expect(window.court).not.toBe(5);
    }
    expect(plan.excluded.some(window => window.reason === 'KNOWN_CONFLICT' && window.court === 7 && window.start === '19:00')).toBe(true);
    expect(plan.excluded.some(window => window.reason === 'EVIDENCE_UNKNOWN' && window.court === 5)).toBe(true);
    // C7's best non-conflicting 3-hour window: 17:00 and 21:00 tie on prime fit; the later one is taken.
    expect(plan.immediate[0]).toMatchObject({ court: 7, start: '21:00', durationHours: 3 });
  });
  it('a force-included conflicting window stays in the plan with a persisted override marker, and the backend keeps the marker', () => {
    const known = schedule([[7, '19:00']]);
    const plan = suggestPlan({ goal: DEFAULT_STRATEGY_GOAL, schedule: known, allocation: balanced, forceInclude: [{ court: 7, start: '19:00', durationHours: 3 }] });
    expect(plan.immediate[0]).toMatchObject({ court: 7, start: '19:00', forced: true, evidence: 'KNOWN_PUBLIC_BOOKING_CONFLICT' });
    expect(plan.reasons.join(' ')).toMatch(/force-included by the operator/);
    const draft = draftFromSuggestion(plan, { ...emptySmartDraft(), rates }, [-10, 0]);
    expect(draft.immediate[0]).toMatchObject({ publicEvidence: { evidence: 'KNOWN_PUBLIC_BOOKING_CONFLICT', override: PUBLIC_CONFLICT_OVERRIDE }, fanOutOffsetsMs: [-10, 0] });
    const compiled = compileSmartPlan(draft, { targetDate });
    expect(compiled.problems).toEqual([]);
    const authorization = backend(compiled.phase3!);
    expect(authorization.candidates[0]!.publicEvidence).toEqual({ evidence: 'KNOWN_PUBLIC_BOOKING_CONFLICT', override: PUBLIC_CONFLICT_OVERRIDE });
    // Round-trip keeps the marker: never silently removed or re-added.
    expect(smartDraftFromPhase3(compiled.phase3!, { targetDate }).immediate[0]!.publicEvidence?.override).toBe(PUBLIC_CONFLICT_OVERRIDE);
  });
  it('stays inside the 21-candidate authorization and puts the rest in the Wave 2 / Rescue pool', () => {
    const plan = suggestPlan({ goal: DEFAULT_STRATEGY_GOAL, schedule: schedule(), allocation: balanced });
    expect(plan.immediate.length + plan.backups.length).toBe(STRATEGY_MAX_CANDIDATES);
    expect(plan.excluded.filter(window => window.reason === 'CAPACITY').length).toBeGreaterThan(0);
    const compiled = compileSmartPlan(draftFromSuggestion(plan, { ...emptySmartDraft(), rates }, [-10, 0]), { targetDate });
    expect(compiled.problems).toEqual([]);
    expect(compiled.phase3!.candidates).toHaveLength(21);
    expect(compiled.phase3!.wave1).toHaveLength(4);
    expect(compiled.phase3!.standby).toEqual(['E', 'F', 'G']);
    expect(compiled.phase3!.rescueEnabled).toBe(true);
    backend(compiled.phase3!);
  });
});

describe('strategy presets', () => {
  it('derive allocation from ready workers and the machine recommendation, never fixed counts', () => {
    expect(presetAllocation('BALANCED', { readyWorkers: 7, recommendedFanOutWidth: 2 })).toMatchObject({ immediateTargets: 4, fanOutWidth: 2, standby: 3, wave2: true, rescue: true });
    expect(presetAllocation('RELEASE_FOCUSED', { readyWorkers: 7, recommendedFanOutWidth: 2 })).toMatchObject({ immediateTargets: 7, fanOutWidth: 2, standby: 0, wave2: false });
    expect(presetAllocation('RESCUE_FOCUSED', { readyWorkers: 7, recommendedFanOutWidth: 3 })).toMatchObject({ immediateTargets: 3, fanOutWidth: 2, standby: 4, wave2: true, rescue: true });
    expect(presetAllocation('BALANCED', { readyWorkers: 5, recommendedFanOutWidth: 1 })).toMatchObject({ immediateTargets: 3, fanOutWidth: 1, standby: 2 });
  });
  it('an operator fan-out override wins over the machine recommendation (up to the hard limit)', () => {
    expect(presetAllocation('BALANCED', { readyWorkers: 7, recommendedFanOutWidth: 2, fanOutWidthOverride: 4 }).fanOutWidth).toBe(4);
    expect(presetAllocation('BALANCED', { readyWorkers: 7, recommendedFanOutWidth: 2, fanOutWidthOverride: 9 }).fanOutWidth).toBe(4);
  });
  it('every preset compiles into the same authoritative backend object type', () => {
    for (const preset of ['BALANCED', 'RELEASE_FOCUSED', 'RESCUE_FOCUSED'] as const) {
      const allocation = presetAllocation(preset, { readyWorkers: 7, recommendedFanOutWidth: 2 });
      const plan = suggestPlan({ goal: DEFAULT_STRATEGY_GOAL, schedule: schedule(), allocation });
      const compiled = compileSmartPlan(draftFromSuggestion(plan, { ...emptySmartDraft(), rates }, allocation.fanOutWidth > 1 ? [-10, 0] : [0]), { targetDate });
      expect(compiled.problems, preset).toEqual([]);
      const authorization = backend(compiled.phase3!);
      expect(wave1SendCount(authorization)).toBe(allocation.immediateTargets * allocation.fanOutWidth);
    }
  });
});
