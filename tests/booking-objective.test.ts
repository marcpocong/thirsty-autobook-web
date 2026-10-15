import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { DateTime } from 'luxon';
import { sha256Hex, canonicalJson } from '../src/sha256-pure.js';
import { releaseInstantFor, nextReleaseFor } from '../src/wing-release-data.js';
import { releaseForTarget, nextWingRelease } from '../src/wing-release-policy.js';
import { compileObjective, defaultObjective, enumerateTargets, evaluateObjectiveOutcome, literalShotgunSchedule, objectiveFromDualWingPlan, objectiveFromLegacySetup,
  objectiveProblems, objectiveQuota, savedMangoReleaseSetup, selectImmediate, withMode, withStrategy, type BookingObjective, type AttemptOutcome } from '../src/booking-objective.js';
import { evaluateCapability, capabilityMatrix, weakestCapability } from '../src/capability-matrix.js';
import { executionState, editEffect } from '../src/execution-state.js';
import { applyPreset, comparePresets, duplicatePreset, renamePreset, restorePreset, savePreset, scheduleMetrics, suggestShotgun } from '../src/shotgun-advisor.js';
import { MANGO_SPACE_IDS, BUKO_SPACE_IDS } from '../src/court-registry.js';

// 2026-10-14 21:00 Manila: next release is 2026-10-15 08:00 Manila.
const NOW = Date.parse('2026-10-14T13:00:00Z');
function example(): BookingObjective {
  const o = defaultObjective(NOW, 'NEXT_RELEASE');
  const goal = (wing: 'MANGO' | 'BUKO') => ({ ...o.wings[wing], enabled: true, minimum: 1, ideal: 2, courts: [1, 2, 3, 4].map((court, i) => ({ court, priority: i + 1 })), startTimes: ['18:00'], durationHours: 2 });
  return { ...o, wings: { MANGO: goal('MANGO'), BUKO: goal('BUKO') } };
}

describe('pure fingerprint and release calendar', () => {
  it('pure SHA-256 matches node:crypto and canonical JSON is key-order independent', () => {
    for (const text of ['', 'abc', 'x'.repeat(1000), JSON.stringify({ ü: '✓', n: 1 })]) expect(sha256Hex(text)).toBe(createHash('sha256').update(text).digest('hex'));
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
  });
  it('renderer-safe release instants equal the Luxon policy for both wings', () => {
    for (const date of ['2026-10-17', '2026-10-21', '2026-12-31', '2027-03-01']) for (const wing of ['MANGO', 'BUKO'] as const)
      expect(releaseInstantFor(date, wing)).toBe(releaseForTarget(date, wing).toMillis());
    for (const now of [NOW, Date.parse('2026-10-15T00:00:00Z'), Date.parse('2026-10-14T23:59:59Z')]) for (const wing of ['MANGO', 'BUKO'] as const) {
      const pure = nextReleaseFor(now, wing), luxon = nextWingRelease(new Date(now), wing);
      expect(pure.bookingDate).toBe(luxon.bookingDate); expect(pure.releaseMs).toBe(DateTime.fromISO(luxon.releaseAt).toMillis());
    }
  });
});

describe('booking objective model', () => {
  it('defaults: Shotgun for the next release with separate Mango and Buko dates, Normal for available now', () => {
    const next = defaultObjective(NOW, 'NEXT_RELEASE');
    expect(next.strategy).toBe('SHOTGUN'); expect(next.checkoutMethod).toBe('PROOFLESS');
    expect(next.wings.MANGO.bookingDate).toBe('2026-10-17'); expect(next.wings.BUKO.bookingDate).toBe('2026-10-21');
    const now = withMode(next, 'AVAILABLE_NOW', NOW);
    expect(now.strategy).toBe('NORMAL'); expect(now.checkoutMethod).toBe('API_FRESH_PROOF'); expect(now.wings.MANGO.bookingDate).toBe('2026-10-14');
    expect(withStrategy(next, 'NORMAL').checkoutMethod).toBe('PROOFLESS');
  });
  it('keeps distinct Mango and Buko identities for the same court number', () => {
    const { targets } = enumerateTargets(example());
    const mango3 = targets.find(t => t.wing === 'MANGO' && t.court === 3)!, buko3 = targets.find(t => t.wing === 'BUKO' && t.court === 3)!;
    expect(mango3.spaceId).toBe(MANGO_SPACE_IDS[3]); expect(buko3.spaceId).toBe(BUKO_SPACE_IDS[3]);
    expect(mango3.id).not.toBe(buko3.id); expect(mango3.bookingDate).toBe('2026-10-17'); expect(buko3.bookingDate).toBe('2026-10-21');
    expect(new Set(targets.map(t => t.id)).size).toBe(targets.length);
  });
  it('compiles the four-court, two-wing example through the existing Shotgun compiler with per-wing quotas', () => {
    const compiled = compileObjective(example(), { nowMs: NOW });
    expect(compiled.problems).toEqual([]);
    expect(compiled.quota).toEqual({ scope: 'PER_WING', wings: { MANGO: { minimum: 1, ideal: 2 }, BUKO: { minimum: 1, ideal: 2 } } });
    expect(compiled.cohorts).toHaveLength(1);
    const cohort = compiled.cohorts[0]!;
    expect(cohort.releaseAt).toBe('2026-10-15T00:00:00.000Z');
    for (const wing of ['MANGO', 'BUKO'] as const) expect(new Set(cohort.immediate.filter(t => t.wing === wing).map(t => t.court)).size).toBeGreaterThanOrEqual(2);
    expect(cohort.immediate.length).toBeLessThanOrEqual(7);
    expect(cohort.smart?.phase3?.candidates.every(c => c.wing && c.spaceId && c.bookingDate)).toBe(true);
    expect(compiled.expectedHolds.ideal).toBe(4);
    expect(compiled.capability.MANGO?.status).toBe('LIVE_PILOT'); expect(compiled.capability.BUKO?.status).toBe('OFFLINE_ONLY');
    expect(compiled.liveStatus).toBe('OFFLINE_ONLY');
    expect(compileObjective(example(), { nowMs: NOW }).fingerprint).toBe(compiled.fingerprint);
  });
  it('creates separate cohorts for different release instants and never rewrites dates', () => {
    const o = example(); o.wings.BUKO.bookingDate = '2026-10-22';
    const compiled = compileObjective(o, { nowMs: NOW });
    expect(compiled.cohorts.map(c => c.releaseAt)).toEqual(['2026-10-15T00:00:00.000Z', '2026-10-16T00:00:00.000Z']);
    expect(compiled.targets.filter(t => t.wing === 'BUKO').every(t => t.bookingDate === '2026-10-22')).toBe(true);
    expect(compiled.warnings.join(' ')).toContain('separate scheduled cohorts');
  });
  it('limits immediate targets to worker capacity and reports the quota reach', () => {
    const o = example(); o.wings.MANGO.ideal = 4; o.wings.BUKO.ideal = 4;
    const { targets } = enumerateTargets(o);
    const selection = selectImmediate(targets, objectiveQuota(o), 7);
    expect(selection.immediate).toHaveLength(7);
    expect(selection.warnings.join(' ')).toMatch(/only 3 distinct courts fit/);
  });
  it('keeps custom literal offsets exactly and reports invalid ones instead of clamping', () => {
    const o = withStrategy(example(), 'SHOTGUN');
    const ids = compileObjective(o, { nowMs: NOW }).cohorts[0]!.immediate.map(t => t.id);
    const pairs = [{ targetId: ids[0]!, offsetMs: -1999 }, { targetId: ids[1]!, offsetMs: -1234 }, { targetId: ids[0]!, offsetMs: -17 }, { targetId: ids[2]!, offsetMs: 0 }, { targetId: ids[3]!, offsetMs: -640 }];
    o.shotgun = { ...o.shotgun, timingMode: 'CUSTOM', allocationMode: 'CUSTOM', budget: 5, customOffsetsMs: pairs.map(p => p.offsetMs), customAssignments: pairs.map(p => p.targetId), presetId: 'FULLY_CUSTOM', source: 'CUSTOM' };
    // The existing capacity guard requires an explicit acknowledgement for a 17 ms gap; it never respaces.
    expect(compileObjective(o, { nowMs: NOW }).problems.join(' ')).toMatch(/Custom spacing reaches 17 ms/);
    o.shotgun.timingCapacityOverride = true;
    const compiled = compileObjective(o, { nowMs: NOW });
    expect(compiled.problems).toEqual([]);
    const shots = compiled.cohorts[0]!.smart!.shotgun!.shots.map(s => `${s.logicalTargetId}|${s.configuredOffsetMs}`).sort();
    expect(shots).toEqual(pairs.map(p => `${p.targetId}|${p.offsetMs}`).sort());
    expect(literalShotgunSchedule(pairs).offsets.sort((a, b) => a - b)).toEqual(pairs.map(p => p.offsetMs).sort((a, b) => a - b));
    o.shotgun.customOffsetsMs = [...o.shotgun.customOffsetsMs!.slice(0, 4), 5];
    const invalid = compileObjective(o, { nowMs: NOW });
    expect(invalid.problems.join(' ')).toMatch(/−2000 through 0/);
    expect(o.shotgun.customOffsetsMs.at(-1)).toBe(5);
  });
  it('requires an operator-confirmed day rate for hours before 4 PM', () => {
    const o = example(); o.wings.MANGO.startTimes = ['15:00'];
    expect(compileObjective(o, { nowMs: NOW }).problems.join(' ')).toMatch(/Confirm the daytime rate/);
    o.wings.MANGO.dayRate = { perHour: 600, confirmedAt: new Date(NOW).toISOString(), date: '2026-10-17' };
    const compiled = compileObjective(o, { nowMs: NOW });
    expect(compiled.problems).toEqual([]);
    expect(compiled.cohorts[0]!.smart!.phase3!.candidates.find(c => c.wing === 'MANGO')!.rateEvidence.perHour).toEqual([600, 700]);
  });
  it('validates exact mode and quotas', () => {
    const o = example(); o.targetMode = 'EXACT';
    expect(objectiveProblems(o).join(' ')).toMatch(/mark 2 courts/);
    o.wings.MANGO.ideal = 0;
    expect(objectiveProblems(o).join(' ')).toMatch(/minimum must be 1–7/);
  });
  it('plans Available Now as provider-supported checkouts in separate browser contexts', () => {
    const o = withMode(example(), 'AVAILABLE_NOW', NOW); o.wings.BUKO.startTimes = ['18:00', '19:00'];
    const compiled = compileObjective(o, { nowMs: NOW });
    expect(compiled.problems).toEqual([]);
    expect(compiled.normalSteps.map(s => [s.wing, s.courtCount, s.exact, s.workers])).toEqual([['MANGO', 2, null, ['A']], ['BUKO', 1, [1], ['B']], ['BUKO', 1, [2], ['C']]]);
    expect(compiled.warnings.join(' ')).toMatch(/alternative Buko starts are not attempted/);
    expect(compiled.capability.BUKO?.status).toBe('LIVE_PILOT');
  });
  it('never assigns a checkout to a browser whose customer context holds a pending checkout', () => {
    const o = withMode(example(), 'AVAILABLE_NOW', NOW);
    const compiled = compileObjective(o, { nowMs: NOW, normalSkip: new Set(['A', 'C']) });
    expect(compiled.normalSteps.map(s => s.workers)).toEqual([['B'], ['D'], ['E']]);
    expect(compiled.warnings.join(' ')).toMatch(/A, C are skipped/);
    const crowded = compileObjective(o, { nowMs: NOW, normalSkip: new Set(['A', 'B', 'C', 'D', 'E', 'F']) });
    expect(crowded.problems.join(' ')).toMatch(/needs 3 separate browsers\/customers; only 2 are free/);
  });
  it('ranks flexible Buko courts by fresh open cells without inventing openness', () => {
    const o = withMode(example(), 'AVAILABLE_NOW', NOW); o.wings.MANGO.enabled = false; o.wings.BUKO.ideal = 1; o.wings.BUKO.minimum = 1;
    const open = new Set(['BUKO:3:18:00', 'BUKO:3:19:00']);
    expect(compileObjective(o, { nowMs: NOW, openCells: open }).normalSteps[0]!.exact).toEqual([3]);
    expect(compileObjective(o, { nowMs: NOW }).normalSteps[0]!.exact).toEqual([1]);
  });
});

describe('saved Mango release plan (live authorization format)', () => {
  const mangoOnly = (strategy: 'SHOTGUN' | 'PRECISION' | 'NORMAL') => {
    const o = withStrategy(example(), strategy); o.wings.BUKO.enabled = false; o.wings.MANGO.courts = [7, 6, 5].map((court, i) => ({ court, priority: i + 1 })); o.wings.MANGO.startTimes = ['19:00'];
    return o;
  };
  const players = { PLAYER_FULL_NAME: 'Fixture Player', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'fixture@example.invalid' };
  it('converts a Mango Shotgun cohort into the undated live format with literal offsets and the quota', async () => {
    const { ConfigSchema, BookingSetupSchema } = await import('../src/config.js');
    const compiled = compileObjective(mangoOnly('SHOTGUN'), { nowMs: NOW });
    expect(compiled.problems).toEqual([]);
    const saved = savedMangoReleaseSetup(compiled, '2026-10-17');
    expect(saved.problems).toEqual([]);
    const setup = BookingSetupSchema.parse(saved.setup);
    expect(setup.PRECISION_PHASE3!.candidates.every(c => c.wing === undefined && c.bookingDate === undefined)).toBe(true);
    expect(setup.STRATEGY_V2!.objective).toMatchObject({ scope: 'PER_WING', wings: { MANGO: { minimum: 1, ideal: 2 } }, fingerprint: compiled.fingerprint });
    const scopedOffsets = compiled.cohorts[0]!.smart!.shotgun!.shots.map(s => s.configuredOffsetMs).sort((a, b) => a - b);
    expect(setup.STRATEGY_V2!.shotgun!.exactSchedule.map(s => s.configuredOffsetMs).sort((a, b) => a - b)).toEqual(scopedOffsets);
    expect(() => ConfigSchema.parse({ ...setup, ...players })).not.toThrow();
  });
  it('keeps Precision per-target offsets and saves Normal as the General format', async () => {
    const { BookingSetupSchema } = await import('../src/config.js');
    const precision = mangoOnly('PRECISION'), ids = enumerateTargets(precision).targets.map(t => t.id);
    precision.precision.offsetsMs = { [ids[0]!]: [-25, -10], [ids[1]!]: [-5] };
    const saved = BookingSetupSchema.parse(savedMangoReleaseSetup(compileObjective(precision, { nowMs: NOW }), '2026-10-17').setup);
    expect(saved.PRECISION_PHASE3!.wave1.map(a => a.fanOutOffsetsMs ?? [a.releaseOffsetMs ?? 0])).toEqual([[-25, -10], [-5], [0]]);
    const normal = BookingSetupSchema.parse(savedMangoReleaseSetup(compileObjective(mangoOnly('NORMAL'), { nowMs: NOW }), '2026-10-17').setup);
    expect(normal).toMatchObject({ RELEASE_STRATEGY: 'general', COURT_COUNT: 2, START_TIME: '19:00', PREFERRED_COURTS: [7, 6, 5, 4, 3, 2, 1] });
  });
  it('refuses instead of re-dating or dropping a wing', () => {
    expect(savedMangoReleaseSetup(compileObjective(example(), { nowMs: NOW }), '2026-10-17').problems.join(' ')).toMatch(/Mango-only/);
    const later = mangoOnly('SHOTGUN'); later.wings.MANGO.bookingDate = '2026-10-18';
    expect(savedMangoReleaseSetup(compileObjective(later, { nowMs: NOW }), '2026-10-17').problems.join(' ')).toMatch(/publishes Mango 2026-10-17/);
  });
});

describe('quota outcome reconciliation', () => {
  const hold = (wing: 'MANGO' | 'BUKO', court: number, start = '18:00', extra: Partial<AttemptOutcome> = {}): AttemptOutcome => ({ wing, court, date: '2026-10-17', start, end: '20:00', state: 'HOLD_VERIFIED_QR_ATTENTION', ...extra });
  const quota = objectiveQuota(example());
  it('distinguishes none, partial, minimum, ideal, extra and unknown', () => {
    expect(evaluateObjectiveOutcome(quota, []).status).toBe('NONE');
    expect(evaluateObjectiveOutcome(quota, [hold('MANGO', 1)]).status).toBe('PARTIAL');
    expect(evaluateObjectiveOutcome(quota, [hold('MANGO', 1), hold('BUKO', 2)]).status).toBe('MINIMUM');
    const ideal = evaluateObjectiveOutcome(quota, [hold('MANGO', 1), hold('MANGO', 2), hold('BUKO', 1), hold('BUKO', 2), hold('BUKO', 3)]);
    expect(ideal.status).toBe('IDEAL'); expect(ideal.extraHolds).toBe(1); expect(ideal.paymentPending).toBe(5); expect(ideal.paymentConfirmed).toBe(0);
    const unknown = evaluateObjectiveOutcome(quota, [hold('MANGO', 1), { ...hold('BUKO', 1), state: 'UNKNOWN' }]);
    expect(unknown.status).toBe('UNKNOWN'); expect(unknown.needsReview).toBe(true);
  });
  it('never double-counts one court or one provider booking', () => {
    const sameCourt = evaluateObjectiveOutcome(quota, [hold('MANGO', 1, '18:00'), hold('MANGO', 1, '20:00'), hold('BUKO', 1)]);
    expect(sameCourt.perWing.find(w => w.wing === 'MANGO')!.courts).toEqual([1]);
    expect(sameCourt.status).toBe('MINIMUM'); expect(sameCourt.extraHolds).toBe(1);
    const duplicate = evaluateObjectiveOutcome(quota, [hold('MANGO', 1, '18:00', { transactionId: 't1' }), hold('MANGO', 2, '18:00', { transactionId: 't1' })]);
    expect(duplicate.holds).toBe(1); expect(duplicate.duplicates).toBe(1); expect(duplicate.needsReview).toBe(true);
  });
  it('supports an any-wing quota and treats payment as confirmed only with explicit evidence', () => {
    const anyOne = { scope: 'ANY_WING' as const, wings: { MANGO: { minimum: 1, ideal: 1 }, BUKO: { minimum: 1, ideal: 1 } }, overall: { minimum: 1, ideal: 1 } };
    expect(evaluateObjectiveOutcome(anyOne, [hold('BUKO', 4)]).status).toBe('IDEAL');
    expect(evaluateObjectiveOutcome(anyOne, [hold('BUKO', 4, '18:00', { payment: 'CONFIRMED' })]).paymentConfirmed).toBe(1);
  });
});

describe('migration', () => {
  it('interprets an old General Mango plan as a Normal objective without rewriting it', () => {
    const setup = { BOOKING_METHOD: 'api-first', BOOKING_TYPE: 'standard', RELEASE_STRATEGY: 'general', COURT_COUNT: 2, START_TIME: '19:00', DURATION_HOURS: 3, PREFERRED_COURTS: [7, 6, 5, 4, 3, 2, 1], FALLBACK_TIMES: ['18:00'] };
    const frozen = JSON.stringify(setup);
    const { objective } = objectiveFromLegacySetup(setup, NOW);
    expect(JSON.stringify(setup)).toBe(frozen);
    expect(objective.strategy).toBe('NORMAL'); expect(objective.checkoutMethod).toBe('API_FRESH_PROOF');
    expect(objective.wings.MANGO).toMatchObject({ enabled: true, ideal: 2, startTimes: ['19:00', '18:00'], durationHours: 3 });
    expect(objective.wings.BUKO.enabled).toBe(false);
    expect(compileObjective(objective, { nowMs: NOW }).generalRelease).toMatchObject({ COURT_COUNT: 2, START_TIME: '19:00', FALLBACK_TIMES: ['18:00'], PREFERRED_COURTS: [7, 6, 5, 4, 3, 2, 1], BOOKING_METHOD: 'api-first' });
  });
  it('interprets an old Precision/Shotgun plan as Mango targets with their literal offsets', () => {
    const setup = { BOOKING_METHOD: 'proofless', BOOKING_TYPE: 'standard', RELEASE_STRATEGY: 'precision', COURT_COUNT: 1, START_TIME: '19:00', DURATION_HOURS: 3, PREFERRED_COURTS: [7, 6, 5, 4, 3, 2, 1], FALLBACK_TIMES: [],
      PRECISION_PHASE3: { candidates: [{ court: 7, start: '19:00', durationHours: 3, priority: 1 }, { court: 6, start: '19:00', durationHours: 3, priority: 2 }], wave1: [{ candidateIndex: 0, fanOutOffsetsMs: [-30, -10] }, { candidateIndex: 1, releaseOffsetMs: -5 }] },
      STRATEGY_V2: { shotgun: { enabled: false, budget: 8, allocationMode: 'EQUAL' as const, windowStartMs: -1000, windowEndMs: 0, timingMode: 'AUTO' as const } } };
    const { objective } = objectiveFromLegacySetup(setup, NOW);
    expect(objective.strategy).toBe('PRECISION');
    expect(Object.values(objective.precision.offsetsMs)).toEqual([[-30, -10], [-5]]);
    expect(objective.wings.MANGO.courts.map(c => c.court)).toEqual([7, 6]);
  });
  it('maps the previous dual-wing wrapper objectives onto quotas', () => {
    const base = { shotgun: { budget: 8, allocationMode: 'EQUAL' as const, windowStartMs: -2000, windowEndMs: 0, timingMode: 'AUTO' as const },
      targets: [{ wing: 'MANGO' as const, court: 7, start: '19:00', durationHours: 2, bookingDate: '2026-10-17', priority: 1 }, { wing: 'BUKO' as const, court: 4, start: '19:00', durationHours: 2, bookingDate: '2026-10-21', priority: 2 }] };
    expect(objectiveFromDualWingPlan({ ...base, objective: 'ANY_ONE' }, NOW).quotaScope).toBe('ANY_WING');
    const perWing = objectiveFromDualWingPlan({ ...base, objective: 'ONE_PER_WING' }, NOW);
    expect(objectiveQuota(perWing).wings).toEqual({ MANGO: { minimum: 1, ideal: 1 }, BUKO: { minimum: 1, ideal: 1 } });
  });
});

describe('capability matrix', () => {
  it('blocks unverified Buko and legacy shapes with precise reasons', () => {
    expect(evaluateCapability({ wing: 'BUKO', mode: 'AVAILABLE_NOW', strategy: 'NORMAL', method: 'PROOFLESS', courts: 1 }).reasons[0]).toMatch(/BUKO_PROOFLESS_NOT_ENABLED/);
    expect(evaluateCapability({ wing: 'MANGO', mode: 'AVAILABLE_NOW', strategy: 'NORMAL', method: 'BROWSER', courts: 3 }).status).toBe('BLOCKED');
    expect(evaluateCapability({ wing: 'MANGO', mode: 'NEXT_RELEASE', strategy: 'SHOTGUN', method: 'API_FRESH_PROOF', courts: 1 }).status).toBe('BLOCKED');
    const buko = evaluateCapability({ wing: 'BUKO', mode: 'NEXT_RELEASE', strategy: 'SHOTGUN', method: 'PROOFLESS', courts: 1 });
    expect(buko.status).toBe('OFFLINE_ONLY'); expect(buko.reasons.join(' ')).toMatch(/08:00 release instant has not \(PROVISIONAL\)/);
  });
  it('treats Mango Shotgun as an attested live pilot and Precision as the supported live path', () => {
    const shotgun = evaluateCapability({ wing: 'MANGO', mode: 'NEXT_RELEASE', strategy: 'SHOTGUN', method: 'PROOFLESS', courts: 2 });
    expect(shotgun).toMatchObject({ status: 'LIVE_PILOT', live: true, requiresAttestation: true });
    expect(shotgun.evidence.map(e => e.id)).toContain('MANGO_PROOFLESS_OFFPEAK');
    expect(evaluateCapability({ wing: 'MANGO', mode: 'NEXT_RELEASE', strategy: 'PRECISION', method: 'PROOFLESS', courts: 1 }).status).toBe('LIVE_SUPPORTED');
    expect(weakestCapability([shotgun, evaluateCapability({ wing: 'MANGO', mode: 'AVAILABLE_NOW', strategy: 'NORMAL', method: 'API_FRESH_PROOF', courts: 1 })])).toBe('LIVE_PILOT');
    expect(capabilityMatrix().length).toBeGreaterThan(10);
  });
});

describe('execution state', () => {
  const base = { draftFingerprint: 'a', savedFingerprint: 'a', problems: 0, operation: 'idle', prepared: false, armed: false, dispatching: false };
  it('moves through draft, saved, prepared, armed, running and outcomes', () => {
    expect(executionState({ ...base, savedFingerprint: null }).state).toBe('DRAFT');
    expect(executionState({ ...base, draftFingerprint: 'b' }).can.prepare).toBe(false);
    expect(executionState(base).state).toBe('SAVED');
    expect(executionState({ ...base, operation: 'prepare' }).state).toBe('PREPARING');
    expect(executionState({ ...base, prepared: true }).can.arm).toBe(true);
    expect(executionState({ ...base, armed: true, operation: 'full' }).state).toBe('ARMED');
    expect(executionState({ ...base, dispatching: true, operation: 'full' }).state).toBe('RUNNING');
    expect(executionState({ ...base, outcome: 'MINIMUM' }).state).toBe('PARTIAL');
    expect(executionState({ ...base, outcome: 'IDEAL' }).state).toBe('COMPLETED');
    expect(executionState({ ...base, outcome: 'UNKNOWN' }).state).toBe('NEEDS_REVIEW');
    expect(editEffect('PREPARED')).toBe('INVALIDATES_PREPARATION'); expect(editEffect('ARMED')).toBe('REFUSE_DISARM_FIRST');
  });
});

describe('shotgun advisor and presets', () => {
  it('suggests a bounded, explained heuristic starting point', () => {
    const s = suggestShotgun({ immediateTargets: 7, targetWings: ['MANGO', 'BUKO'], idealCourts: 4, readyWorkers: 7 });
    expect(s.confidence).toBe('HEURISTIC'); expect(s.settings.budget).toBe(14); expect(s.settings.allocationMode).toBe('EQUAL');
    expect(s.rationale.join(' ')).toMatch(/Budget 14/);
    const single = suggestShotgun({ immediateTargets: 1, targetWings: ['MANGO'], idealCourts: 1, readyWorkers: 7, timing: { status: 'READY', shotCount: 8, p95: 4.5 } });
    expect(single.settings.budget).toBe(8); expect(single.confidence).toBe('LOCALLY_BENCHMARKED');
  });
  it('saves, renames, duplicates, restores and compares presets without recalculating them', () => {
    const custom = { ...suggestShotgun({ immediateTargets: 2, targetWings: ['MANGO'], idealCourts: 1, readyWorkers: 7 }).settings, timingMode: 'CUSTOM' as const, customOffsetsMs: [-1500, -3, 0] };
    let list = savePreset([], 'My core', custom, '2026-10-14T00:00:00.000Z');
    expect(() => savePreset(list, 'my core', custom)).toThrow('PRESET_NAME_EXISTS');
    list = renamePreset(list, list[0]!.id, 'Core v2'); list = duplicatePreset(list, list[0]!.id);
    expect(list.map(p => p.name)).toEqual(['Core v2', 'Core v2 copy']);
    expect(restorePreset(list, list[1]!.id).customOffsetsMs).toEqual([-1500, -3, 0]);
    expect(comparePresets(custom, { ...custom, customOffsetsMs: [-1500, -4, 0] }).find(row => row.label === 'Offsets')!.differs).toBe(true);
    const literal = [{ targetId: 't1', offsetMs: -777 }, { targetId: 't2', offsetMs: -1 }];
    const fully = applyPreset('FULLY_CUSTOM', custom, { suggestion: suggestShotgun({ immediateTargets: 2, targetWings: ['MANGO'], idealCourts: 1, readyWorkers: 7 }), literal });
    expect(fully).toMatchObject({ timingMode: 'CUSTOM', customOffsetsMs: [-777, -1], customAssignments: ['t1', 't2'] });
  });
  it('reports schedule density, gaps and invalid offsets literally', () => {
    const m = scheduleMetrics([{ targetId: 'a', offsetMs: -1000, workerId: 'A' }, { targetId: 'a', offsetMs: -1000, workerId: 'A' }, { targetId: 'b', offsetMs: -50, workerId: 'B' }, { targetId: 'b', offsetMs: 12 }]);
    expect(m).toMatchObject({ count: 4, earliestMs: -1000, latestMs: -50, minimumGapMs: 0, invalid: [12], closeGaps: 1, perWorker: { A: 2, B: 1 } });
    expect(m.coincident).toEqual([{ offsetMs: -1000, count: 2 }]);
  });
});
