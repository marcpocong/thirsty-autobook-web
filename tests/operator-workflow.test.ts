import { describe, expect, it } from 'vitest';
import { compileObjective, defaultObjective, enumerateTargets, objectiveFromLegacySetup, rebaseReleasedDates, savedMangoReleaseSetup, withStrategy, type BookingObjective } from '../src/booking-objective.js';
import { operatorGates, planLadder, readinessLayers, readinessSummary, type OperatorInputs } from '../src/execution-state.js';
import { classifyFailure, failureCategory } from '../src/preparation-failure.js';
import { summarizeRunOutcome } from '../src/run-outcome.js';
import { setupDifferences } from '../src/plan-diff.js';
import { provenanceStatus } from '../src/provenance.js';
import { capacityAdvice, reduceShotgunAttempts } from '../src/capacity-advice.js';
import { forecastPreparation } from '../src/quick-shotgun.js';

// 2026-10-14 21:00 Manila: the next Mango release publishes 2026-10-17 at 08:00 on 2026-10-15.
const NOW = Date.parse('2026-10-14T13:00:00Z');
/** The October 18 shape: Mango Courts 7/6/5 at 19:00 for 3 h, everything on Court 7 through a custom allocation. */
function incidentObjective(counts: Record<number, unknown>, budget = 20): BookingObjective {
  const o = withStrategy(defaultObjective(NOW, 'NEXT_RELEASE'), 'SHOTGUN');
  o.wings.BUKO.enabled = false;
  o.wings.MANGO = { ...o.wings.MANGO, courts: [7, 6, 5, 4].map((court, i) => ({ court, priority: i + 1 })), startTimes: ['19:00'], durationHours: 3, minimum: 1, ideal: 1 };
  const ids = enumerateTargets(o).targets.map(t => t.id);
  o.shotgun = { ...o.shotgun, allocationMode: 'CUSTOM', budget, timingMode: 'DENSE_CORE', timingCapacityOverride: true,
    customCounts: Object.fromEntries(Object.entries(counts).map(([court, value]) => [ids[[7, 6, 5, 4].indexOf(Number(court))]!, value])) as Record<string, number> };
  return o;
}

describe('custom Shotgun counts: sparse, explicit, invalid', () => {
  it('normalizes ABSENT counts to zero (migrated sparse plan) exactly like explicit zeros', () => {
    const sparse = compileObjective(incidentObjective({ 7: 20 }), { nowMs: NOW }), explicit = compileObjective(incidentObjective({ 7: 20, 6: 0, 5: 0, 4: 0 }), { nowMs: NOW });
    expect(sparse.problems).toEqual([]); expect(explicit.problems).toEqual([]);
    expect(sparse.attemptCount).toBe(20);
    expect(sparse.cohorts[0]!.smart!.shotgun!.shots.map(s => s.configuredOffsetMs)).toEqual(explicit.cohorts[0]!.smart!.shotgun!.shots.map(s => s.configuredOffsetMs));
  });
  it.each([[-1, '-1'], [1.5, '1.5'], [null, 'blank'], [Number.POSITIVE_INFINITY, 'Infinity'], ['3', '3']])('keeps %s rejected, named by its court, never rounded or replaced', (value, shown) => {
    const o = incidentObjective({ 7: 17, 6: value }), compiled = compileObjective(o, { nowMs: NOW });
    const problem = compiled.problems.find(p => p.includes('attempt count must be'));
    expect(problem).toContain('Mango Court 6 · 19:00');
    expect(problem).toContain(`found ${shown}`);
    // The internal target-ID message is not shown twice.
    expect(compiled.problems.some(p => p.startsWith('Custom Shotgun count for'))).toBe(false);
    expect(savedMangoReleaseSetup(compiled, '2026-10-17').setup).toBeNull();
    const court6 = enumerateTargets(o).targets.find(t => t.court === 6)!.id;
    expect(o.shotgun.customCounts![court6]).toBe(value);
  });
  it('serializes only authorized attempts: zero-count alternatives stay in the objective, never in the runtime schedule', async () => {
    const { BookingSetupSchema, ConfigSchema } = await import('../src/config.js');
    const o = incidentObjective({ 7: 20 }), compiled = compileObjective(o, { nowMs: NOW });
    const setup = BookingSetupSchema.parse(savedMangoReleaseSetup(compiled, '2026-10-17').setup);
    const shotgun = setup.STRATEGY_V2!.shotgun!;
    expect(Object.values(shotgun.counts)).toEqual([20]);
    expect(Object.values(shotgun.customCounts ?? {}).every(v => v > 0)).toBe(true);
    expect(shotgun.exactSchedule).toHaveLength(20);
    expect(shotgun.exactSchedule.map(s => s.configuredOffsetMs)).toEqual(compiled.cohorts[0]!.smart!.shotgun!.shots.map(s => s.configuredOffsetMs));
    expect(setup.PRECISION_PHASE3!.wave1.reduce((n, a) => n + (a.fanOutOffsetsMs?.length ?? 1), 0)).toBe(20);
    expect(o.wings.MANGO.courts.map(c => c.court)).toEqual([7, 6, 5, 4]);
    expect(() => ConfigSchema.parse({ ...setup, PLAYER_FULL_NAME: 'Fixture Player', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'fixture@example.invalid' })).not.toThrow();
  });
  it('a migrated legacy plan with sparse counts reproduces its exact saved timing', async () => {
    const { BookingSetupSchema } = await import('../src/config.js');
    const compiled = compileObjective(incidentObjective({ 7: 20 }), { nowMs: NOW });
    const saved = BookingSetupSchema.parse(savedMangoReleaseSetup(compiled, '2026-10-17').setup);
    const migrated = objectiveFromLegacySetup(saved as never, NOW).objective;
    const again = compileObjective(migrated, { nowMs: NOW });
    expect(again.problems).toEqual([]);
    expect(again.cohorts[0]!.smart!.shotgun!.shots.map(s => s.configuredOffsetMs)).toEqual(saved.STRATEGY_V2!.shotgun!.exactSchedule.map(s => s.configuredOffsetMs));
  });
});

describe('a draft whose release already happened', () => {
  it('moves to the next release date and carries custom counts to the same courts (October 18: the moved draft showed 0 attempts)', () => {
    const o = incidentObjective({ 7: 3 }, 3), snapshot = JSON.stringify(o);
    const later = Date.parse('2026-10-15T02:00:00Z');   // 10:00 Manila, after the 2026-10-15 08:00 release of 2026-10-17
    const before = compileObjective(o, { nowMs: later });
    const { objective, notes } = rebaseReleasedDates(o, later);
    expect(objective.wings.MANGO.bookingDate).toBe('2026-10-18');
    const compiled = compileObjective(objective, { nowMs: later });
    expect(compiled.problems).toEqual([]);
    expect(compiled.attemptCount).toBe(3);
    expect(Object.values(objective.shotgun.customCounts!)).toEqual([3]);
    expect(Object.keys(objective.shotgun.customCounts!)[0]).toContain(':2026-10-18:19:00:');
    expect(notes).toHaveLength(2);
    expect(notes[1]).toContain('no value was changed');
    expect(JSON.stringify(o)).toBe(snapshot);
    expect(before.problems.join(' ')).toMatch(/already released|was released/);
    // A draft for a future release is untouched.
    expect(rebaseReleasedDates(o, NOW)).toEqual({ objective: o, notes: [] });
  });
});

describe('draft versus saved release plan', () => {
  it('lists exact before/after differences in operator terms and ignores only non-authorizing lineage', async () => {
    const { BookingSetupSchema } = await import('../src/config.js');
    const big = BookingSetupSchema.parse(savedMangoReleaseSetup(compileObjective(incidentObjective({ 7: 20 }), { nowMs: NOW }), '2026-10-17').setup);
    const small = BookingSetupSchema.parse(savedMangoReleaseSetup(compileObjective(incidentObjective({ 7: 3 }, 3), { nowMs: NOW }), '2026-10-17').setup);
    const diff = setupDifferences(big, small);
    expect(diff.summary.find(d => d.label === 'Attempts')).toEqual({ label: 'Attempts', saved: '20', draft: '3' });
    expect(diff.summary.some(d => d.label === 'Exact offsets (ms)')).toBe(true);
    expect(diff.total).toBeGreaterThan(0);
    const lineage = structuredClone(big); lineage.STRATEGY_V2!.objective!.fingerprint = 'f'.repeat(64);
    expect(setupDifferences(big, lineage).total).toBe(0);
    expect(setupDifferences(big, structuredClone(big))).toEqual({ summary: [], fields: [], total: 0 });
  });
});

const base = (patch: Partial<OperatorInputs> = {}): OperatorInputs => ({ mode: 'NEXT_RELEASE', owns: true, draftProblems: [], liveSaveProblems: [], runtime: { status: 'VALID', problems: [] },
  savedPlan: { exists: true, matchesDraft: true, differences: 0 }, operation: 'idle', prepared: { forSavedPlan: true, forOtherPlan: false }, armed: false, running: false,
  lock: { present: false, canPrepareOver: false, unresolvedSubmission: false }, disconnected: [], playersMissing: [], termsAuthorized: true,
  forecast: { verdict: 'READY', ready: 3, configured: 3, omitted: 0, required: true }, ...patch });

describe('operator gates: one authority, a visible reason and a recovery for every blocked control', () => {
  it('walks Save → Prepare → Authorize and Arm → Emergency Stop', () => {
    expect(operatorGates(base({ savedPlan: { exists: true, matchesDraft: false, differences: 4 }, prepared: { forSavedPlan: false, forOtherPlan: false } })).primary).toMatchObject({ action: 'SAVE_PLAN', gate: { enabled: true } });
    expect(operatorGates(base({ prepared: { forSavedPlan: false, forOtherPlan: false } })).primary).toMatchObject({ action: 'PREPARE', label: 'Prepare', gate: { enabled: true } });
    expect(operatorGates(base()).primary).toMatchObject({ action: 'AUTHORIZE_ARM', label: 'Authorize and Arm', gate: { enabled: true } });
    expect(operatorGates(base({ armed: true })).primary).toMatchObject({ action: 'STOP', label: 'Emergency Stop', gate: { enabled: true } });
  });
  it.each([
    ['plan problems', base({ draftProblems: ['a', 'b', 'c'], savedPlan: { exists: true, matchesDraft: null, differences: 0 } }), /3 plan problems must be fixed/, 'REVIEW_PROBLEMS'],
    ['draft differs from saved', base({ savedPlan: { exists: true, matchesDraft: false, differences: 2 }, prepared: { forSavedPlan: false, forOtherPlan: false } }), null, null],
    ['browser disconnected', base({ disconnected: ['C'] }), /Browser C is disconnected/, 'RECHECK_BROWSERS'],
    ['capacity', base({ forecast: { verdict: 'NOT_FEASIBLE', ready: 11, configured: 20, omitted: 9, required: true } }), /only 11 of 20 attempts.*9 would be omitted/, 'REVIEW_CAPACITY'],
    ['terms', base({ termsAuthorized: false }), /Tick the Terms authorization/, 'AUTHORIZE_TERMS'],
    ['forecast unavailable', base({ forecast: { verdict: 'UNAVAILABLE', ready: 0, configured: 3, omitted: 0, required: true } }), /forecast for this exact plan is unavailable/, 'PREPARE'],
    ['stale preparation', base({ prepared: { forSavedPlan: false, forOtherPlan: true } }), null, null],
  ] as const)('%s', (_name, inputs, reason, recovery) => {
    const g = operatorGates(inputs);
    if (reason) { expect(g.primary.gate.enabled).toBe(false); expect(g.primary.gate.reason).toMatch(reason); expect(g.primary.gate.recovery?.action).toBe(recovery);
      expect(g.blockers[0]!.reason).toMatch(reason); }
    for (const gate of [g.save, g.prepare, g.terms, g.arm, g.saveDraft, g.test, g.primary.gate]) if (!gate.enabled) expect(gate.reason).toBeTruthy();
  });
  it('a draft that differs from the saved plan blocks Prepare with the exact reason and a Review changes recovery', () => {
    const g = operatorGates(base({ savedPlan: { exists: true, matchesDraft: false, differences: 2 }, prepared: { forSavedPlan: false, forOtherPlan: false } }));
    expect(g.prepare).toMatchObject({ enabled: false, recovery: { action: 'REVIEW_CHANGES' } });
    expect(g.prepare.reason).toContain('different from your saved release plan (2 changes)');
    expect(g.blockers.map(b => b.control)).toContain('Prepare');
  });
  it('a preparation for an older plan is never armable and says why', () => {
    const g = operatorGates(base({ prepared: { forSavedPlan: false, forOtherPlan: true } }));
    expect(g.primary).toMatchObject({ action: 'PREPARE', label: 'Prepare again' });
    expect(g.terms).toMatchObject({ enabled: false, recovery: { action: 'PREPARE' } });
    expect(g.terms.reason).toContain('older plan');
  });
  it('an unresolved earlier submission routes to review, never to a retry', () => {
    const g = operatorGates(base({ lock: { present: true, canPrepareOver: false, unresolvedSubmission: true } }));
    expect(g.primary.action).toBe('REVIEW_SUBMISSION');
    expect(g.prepare).toMatchObject({ enabled: false, recovery: { action: 'REVIEW_SUBMISSION' } });
    expect(g.prepare.reason).toContain('unknown');
  });
  it('every closed gate across a broad state matrix has a reason', () => {
    for (const operation of ['idle', 'prepare', 'saving']) for (const armed of [false, true]) for (const lock of [false, true]) for (const match of [true, false, null]) for (const prepared of [false, true]) {
      const g = operatorGates(base({ operation, armed, lock: { present: lock, canPrepareOver: false, unresolvedSubmission: false }, savedPlan: { exists: true, matchesDraft: match, differences: 1 }, prepared: { forSavedPlan: prepared, forOtherPlan: false } }));
      for (const gate of [g.save, g.prepare, g.terms, g.arm, g.saveDraft, g.test, g.stop, g.primary.gate]) if (!gate.enabled) expect(gate.reason, JSON.stringify({ operation, armed, lock, match, prepared })).toBeTruthy();
    }
  });
});

describe('plan ladder and readiness layers', () => {
  it('distinguishes Draft → Validated → Saved → Prepared → Armed → Executed', () => {
    const steps = planLadder({ ...base({ savedPlan: { exists: true, matchesDraft: false, differences: 3 }, prepared: { forSavedPlan: false, forOtherPlan: true } }), executed: null });
    expect(steps.map(s => [s.stage, s.status])).toEqual([['DRAFT', 'DONE'], ['VALIDATED', 'DONE'], ['SAVED', 'STALE'], ['PREPARED', 'STALE'], ['ARMED', 'PENDING'], ['EXECUTED', 'PENDING']]);
    expect(planLadder({ ...base({ draftProblems: ['x'] }), executed: null })[0]).toMatchObject({ stage: 'DRAFT', status: 'BLOCKED' });
  });
  it('never presents a favorable forecast as live security readiness', () => {
    const layers = readinessLayers({ plan: { problems: 0, runtime: 'VALID', saved: true }, environment: { prepared: true, forOtherPlan: false, required: 1, connected: 1, identityIssues: 0 },
      forecast: { verdict: 'READY', ready: 3, configured: 3, atRisk: 0, omitted: 0, measured: true, samples: 12 }, security: { planned: 3, ready: 0, preparing: 0, failed: 0, omitted: 0, leadMs: 105_000 }, armed: { armed: false, running: false } });
    expect(layers.find(l => l.id === 'FORECAST')).toMatchObject({ status: 'OK' });
    expect(layers.find(l => l.id === 'SECURITY')).toMatchObject({ status: 'PENDING' });
    expect(layers.find(l => l.id === 'FORECAST')!.detail).toContain('not proof of security readiness');
    expect(readinessSummary(layers)).toBe('Prepared · forecast feasible · live security is verified only after arming');
  });
  it('reports actual security evidence once armed (October 18: tier 1 preparing, tiers 2 and 3 omitted)', () => {
    const layers = readinessLayers({ plan: { problems: 0, runtime: 'VALID', saved: true }, environment: { prepared: true, forOtherPlan: false, required: 1, connected: 1, identityIssues: 0 },
      forecast: { verdict: 'READY', ready: 3, configured: 3, atRisk: 0, omitted: 0, measured: true, samples: 12 }, security: { planned: 3, ready: 0, preparing: 1, failed: 0, omitted: 2, leadMs: 105_000 }, armed: { armed: true, running: false } });
    expect(layers.find(l => l.id === 'SECURITY')).toMatchObject({ status: 'BLOCKED', detail: '0/3 ready · 1 preparing · 2 omitted · actual evidence for this run' });
    expect(readinessSummary(layers)).toContain('Armed · live security');
  });
  it('an unprepared saved plan leads with the earliest incomplete stage', () => {
    const layers = readinessLayers({ plan: { problems: 0, runtime: 'VALID', saved: true }, environment: { prepared: false, forOtherPlan: false, required: 1, connected: 0, identityIssues: 0 },
      forecast: { verdict: 'UNAVAILABLE', ready: 0, configured: 3, atRisk: 0, omitted: 0, measured: false, samples: 0 }, security: null, armed: { armed: false, running: false } });
    expect(readinessSummary(layers)).toBe('Saved plan is valid · not prepared yet · forecast: Forecast unavailable');
  });
});

describe('typed failures', () => {
  it.each([['CHROME_DISCONNECTED', 'BROWSER_DISCONNECTED', true], ['WRONG_CHROME_PROFILE', 'WRONG_PROFILE', true], ['ONDA_TAB_AMBIGUOUS_OR_MISSING', 'INVALID_VENUE_OR_TAB', true],
    ['ONDA_SECURITY_VERIFICATION_FAILED', 'SECURITY_VERIFICATION_FAILED', true], ['PREPARED_PLAN_CHANGED', 'PLAN_FINGERPRINT_MISMATCH', true], ['PREPARATION_RESULT_INVALID', 'INVALID_PREPARATION_EVIDENCE', true],
    ['RESET_REQUIRED', 'STALE_PREPARATION', true], ['AUTOMATION_LOCK_EXISTS', 'RETAINED_LOCK', false], ['PAYMENT_HOLD_MAY_BE_ACTIVE', 'VERIFIED_HOLD', false],
    ['HANDOFF_STATUS_UNKNOWN', 'UNKNOWN_SUBMISSION', false], ['RELEASE_CLOCK_REFRESH_TIMEOUT', 'CLOCK_UNTRUSTED', true], ['SHOTGUN_PREWARM_NOT_FULLY_READY', 'CAPACITY_LIMITED', true],
    ['NOTHING_DISPATCHED', 'RUN_NOT_ACHIEVED', true], ['RATE_LIMITED', 'PROVIDER_THROTTLED', false], ['LOCAL_PLAYER_C_CUSTOMER_ID_UNVERIFIED', 'PLAYER_CONFIGURATION', true]] as const)
  ('%s → %s', (code, category, retrySafe) => {
    const failure = classifyFailure(code, { operation: 'prepare', lockPresent: false });
    expect(failure.category).toBe(category); expect(failure.retrySafe).toBe(retrySafe); expect(failure.recovery.label).toBeTruthy();
  });
  it('an unexplained failure is retry-safe only when nothing was left behind, and keeps its stage and worker', () => {
    const clean = classifyFailure('BOOKING_OPERATION_FAILED', { operation: 'prepare', step: 'final', workerId: 'B', lockPresent: false });
    expect(clean).toMatchObject({ category: 'INTERNAL_ERROR', retrySafe: true, step: 'final', workerId: 'B', recovery: { action: 'PREPARE' } });
    expect(clean.detail).toContain('step final · browser B');
    expect(classifyFailure('BOOKING_OPERATION_FAILED', { operation: 'prepare', lockPresent: true })).toMatchObject({ retrySafe: false, recovery: { action: 'OPEN_ACTIVITY' } });
    expect(classifyFailure('not a code', { operation: 'arm' }).code).toBe('OPERATION_FAILED');
    expect(failureCategory('SOMETHING_NEW')).toBe('INTERNAL_ERROR');
  });
});

describe('final outcome accounting', () => {
  it('October 18: three definitively unsent attempts are NOTHING DISPATCHED, never unknown or rejected', () => {
    const s = summarizeRunOutcome(Array.from({ length: 3 }, () => ({ state: 'NOT_DISPATCHED', code: 'SHOTGUN_TRIGGER_MISSED' })), 3);
    expect(s).toMatchObject({ planned: 3, prepared: 0, initiated: 0, holds: 0, rejected: 0, unsent: 3, unknown: 0, pending: 0, settled: true, headline: 'NOTHING DISPATCHED' });
    expect(s.unsentReasons).toEqual({ SHOTGUN_TRIGGER_MISSED: 3 });
    expect(s.detail).toContain('0 requests initiated');
  });
  it('separates provider rejection, internal failure, unknown and pending', () => {
    const s = summarizeRunOutcome([{ state: 'REJECTED' }, { state: 'PREWARM_FAILED', code: 'SECURITY_PREWARM_FAILED' }, { state: 'UNKNOWN' }, { state: 'IN_FLIGHT' }], 5);
    expect(s).toMatchObject({ rejected: 1, unsent: 1, internalFailures: 1, unknown: 1, initiated: 3, pending: 2, settled: false, headline: 'OUTCOME UNKNOWN' });
    expect(s.nextStep).toContain('Do NOT retry');
    expect(summarizeRunOutcome([{ state: 'REJECTED' }, { state: 'NOT_DISPATCHED' }], 2).headline).toBe('ALL SENT ATTEMPTS REJECTED');
    expect(summarizeRunOutcome([{ state: 'QR_READY' }, { state: 'UNKNOWN' }], 2).headline).toBe('HOLD VERIFIED');
  });
});

describe('build provenance', () => {
  it('never treats a newer source checkout as installed', () => {
    expect(provenanceStatus('a'.repeat(40), { headSha: 'a'.repeat(40), branch: 'main' }).label).toBe('Installed matches source');
    const ahead = provenanceStatus('a'.repeat(40), { headSha: 'b'.repeat(40), branch: 'main' });
    expect(ahead).toMatchObject({ label: 'Source updated · not installed', tone: 'warn' });
    expect(ahead.detail).toContain('npm run app:update');
    expect(provenanceStatus(null, null).tone).toBe('warn');
  });
});

describe('capacity advice (explicit, never automatic)', () => {
  const prior = { p95Source: 'COMPATIBLE_MEASURED_HISTORY' as const, preparationP95Ms: 30_492, sampleCount: 20 };
  it('a capacity-limited 20-attempt plan gets a smaller fully-forecast plan with exact before/after, and the draft is untouched', () => {
    const o = incidentObjective({ 7: 20 }), snapshot = JSON.stringify(o);
    const compiled = compileObjective(o, { nowMs: NOW });
    const forecast = forecastPreparation(compiled.cohorts[0]!.smart!.phase3!, new Set(), prior);
    expect(forecast.projectedOmitted).toBeGreaterThan(0);
    const advice = capacityAdvice(o, { nowMs: NOW }, prior)!;
    expect(advice.before).toMatchObject({ attempts: 20, omitted: forecast.projectedOmitted });
    expect(advice.after.omitted).toBe(0);
    expect(advice.after.attempts).toBeLessThan(20); expect(advice.after.attempts).toBeGreaterThan(0);
    expect(advice.after.offsets).toHaveLength(advice.after.attempts);
    expect(advice.objective.shotgun.budget).toBe(advice.after.attempts);
    expect(JSON.stringify(o)).toBe(snapshot);
    expect(compileObjective(advice.objective, { nowMs: NOW }).problems).toEqual([]);
  });
  it('a plan that fits returns no advice, and literal timing keeps the attempts closest to release with their exact offsets', () => {
    expect(capacityAdvice(incidentObjective({ 7: 3 }, 3), { nowMs: NOW }, prior)).toBeNull();
    const o = incidentObjective({ 7: 4 }, 4), id = Object.keys(o.shotgun.customCounts!)[0]!;
    o.shotgun = { ...o.shotgun, timingMode: 'CUSTOM', customAssignments: [id, id, id, id], customOffsetsMs: [-1000, -600, -80, 0] };
    const reduced = reduceShotgunAttempts(o, 3);
    expect(reduced.shotgun.customOffsetsMs).toEqual([-600, -80, 0]);
    expect(o.shotgun.customOffsetsMs).toEqual([-1000, -600, -80, 0]);
  });
});
