import { describe, expect, it } from 'vitest';
import { applyDurationOffsetPreset, compileSmartPlan, confirmSmartRates, describeSmartPlan, emptySmartDraft, smartDraftFromPhase3, smartPlanText, smartRateFor,
  SMART_MAX_SLOTS, SMART_WORKERS, type SmartDraft, type SmartSlot } from '../src/precision-simple.js';
import { PRECISION_MAX_CANDIDATES, authorizePrecision, precisionCandidateId } from '../src/api-booking/precision-phase3.js';
import { PRECISION_WORKER_IDS } from '../src/workers.js';
import { ConfigSchema } from '../src/config.js';
import { bookingView, defaultSetup, describePlan } from '../ui/booking.js';

const targetDate = '2026-09-27', now = new Date('2026-09-24T12:00:00.000Z');
const players = { PLAYER_FULL_NAME: 'Fixture Player', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'fixture@example.invalid' };
const slot = (court: number, start: string, durationHours = 3): SmartSlot => ({ court, start, durationHours });
function draft(extra: Partial<SmartDraft> = {}): SmartDraft {
  return { ...emptySmartDraft(), immediate: [slot(7, '19:00'), slot(6, '19:00'), slot(5, '18:00'), slot(4, '17:00')],
    backups: [slot(3, '19:00'), slot(2, '18:00'), slot(1, '17:00')], rates: confirmSmartRates(600, 700, 'OPERATOR_CONFIRMED', targetDate, now), ...extra };
}
it('Duration x Offset preset changes only duration/offset on existing immediate rows',()=>{
  const source=draft({immediate:[{...slot(7,'19:00'),worker:'G',priority:9},{...slot(6,'18:00'),worker:'A'}]});
  const result=applyDurationOffsetPreset(source);
  expect(result.immediate).toEqual([
    {court:7,start:'19:00',durationHours:3,worker:'G',priority:9,releaseOffsetMs:-25},
    {court:6,start:'18:00',durationHours:3,worker:'A',releaseOffsetMs:-10},
  ]);
  expect(result.backups).toEqual(source.backups);
  expect(result.releaseLab).toEqual({version:1,kind:'DURATION_OFFSET_V1',label:'Duration × Offset'});
  expect(source.immediate[0]).not.toHaveProperty('releaseOffsetMs');
});
/** The backend accepts exactly what the compiler produced. */
function backendAccepts(phase3: NonNullable<ReturnType<typeof compileSmartPlan>['phase3']>) {
  const config = ConfigSchema.parse({ ...defaultSetup, BOOKING_METHOD: 'proofless', DURATION_HOURS: 3, RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: [], PRECISION_PHASE3: phase3, ...players });
  return authorizePrecision({ date: targetDate, releaseMs: Date.parse('2026-09-25T00:00:00Z'), candidates: config.PRECISION_PHASE3!.candidates,
    wave1: phase3.wave1.map(value => ({ workerId: value.workerId, candidateId: precisionCandidateId(targetDate, phase3.candidates[value.candidateIndex]!) })),
    standby: phase3.standby, budgets: phase3.budgets, concurrentWave2: phase3.concurrentWave2, rescueEnabled: phase3.rescueEnabled, authorizedAt: now.toISOString() });
}
const visible = (value: SmartDraft) => ({ immediate: value.immediate.map(({ court, start, durationHours }) => ({ court, start, durationHours })),
  backups: value.backups.map(({ court, start, durationHours }) => ({ court, start, durationHours })),
  useBackupsImmediately: value.useBackupsImmediately, retryReopened: value.retryReopened, maxReopenedAttempts: value.maxReopenedAttempts });

describe('Smart backups compiler', () => {
  it('mirrors the backend worker set and candidate limit (never Worker H)', () => {
    expect([...SMART_WORKERS]).toEqual([...PRECISION_WORKER_IDS]);
    expect(SMART_MAX_SLOTS).toBe(PRECISION_MAX_CANDIDATES);
    expect(SMART_WORKERS).not.toContain('H');
  });

  it('derives workers, backup workers, priorities, permissions and limits automatically', () => {
    const compiled = compileSmartPlan(draft({ retryReopened: true }), { targetDate });
    expect(compiled.problems).toEqual([]);
    const p = compiled.phase3!;
    expect(p.wave1).toEqual([{ workerId: 'A', candidateIndex: 0 }, { workerId: 'B', candidateIndex: 1 }, { workerId: 'C', candidateIndex: 2 }, { workerId: 'D', candidateIndex: 3 }]);
    expect(p.standby).toEqual(['E', 'F', 'G']);
    expect(p.budgets).toEqual({ wave2: 3, rescue: 1, total: 8 });
    expect(p.candidates.map(c => c.priority)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(p.candidates.slice(0, 4).every(c => c.permissions.wave1 && !c.permissions.wave2 && c.permissions.rescue)).toBe(true);
    expect(p.candidates.slice(4).every(c => !c.permissions.wave1 && c.permissions.wave2 && c.permissions.rescue)).toBe(true);
    // 19:00-22:00 is evening only; 17:00 is 16:00+ too; the rate card never invents a price.
    expect(p.candidates[0]!.rateEvidence).toMatchObject({ perHour: [700, 700, 700], status: 'OPERATOR_CONFIRMED', date: targetDate, actionable: true });
    expect(backendAccepts(p).candidates).toHaveLength(7);
    const text = smartPlanText(describeSmartPlan(p));
    expect(text).toContain('4 immediate + up to 3 backups + up to 1 reopened-slot attempt');
    expect(text).toContain('Maximum possible sends: 8');
  });

  it('Rescue off means a zero reopened budget; on uses the simple maximum', () => {
    expect(compileSmartPlan(draft(), { targetDate }).phase3!.budgets).toEqual({ wave2: 3, rescue: 0, total: 7 });
    const on = compileSmartPlan(draft({ retryReopened: true, maxReopenedAttempts: 2 }), { targetDate }).phase3!;
    expect(on.budgets.rescue).toBe(2); expect(on.rescueEnabled).toBe(true); expect(backendAccepts(on).budgets.total).toBe(9);
    expect(on.candidates.every(c => c.permissions.rescue)).toBe(true);
  });

  it('skips a worker known not to be ready and warns only by letter when one is pinned', () => {
    const compiled = compileSmartPlan(draft(), { targetDate, unavailable: new Set(['B']) });
    expect(compiled.phase3!.wave1.map(value => value.workerId)).toEqual(['A', 'C', 'D', 'E']);
    expect(compiled.phase3!.standby).toEqual(['F', 'G']);
    expect(compiled.warnings.join(' ')).toContain('Only 2 backup workers are free, so at most 2 of 3 backups can be tried.');
    const pinned = draft(); pinned.immediate[1] = { ...pinned.immediate[1]!, worker: 'B' };
    const warned = compileSmartPlan(pinned, { targetDate, unavailable: new Set(['B']) });
    expect(warned.warnings).toContain('Worker B is not ready and will not be used.');
    expect(warned.warnings.join(' ')).not.toMatch(/[0-9a-f]{8}-|@|\d{7,}/i);
  });

  it('blocks saving until rates are confirmed for the next release date, and never guesses them', () => {
    const missing = compileSmartPlan(draft({ rates: emptySmartDraft().rates }), { targetDate });
    expect(missing.phase3).toBeNull(); expect(missing.problems.join(' ')).toContain('Review rates: 7 slots need a confirmed rate');
    expect(missing.rates[0]).toMatchObject({ evidence: null, label: 'Rate needs review' });
    const stale = compileSmartPlan(draft({ rates: confirmSmartRates(600, 700, 'VENUE_SCHEDULE', '2026-09-26', now) }), { targetDate });
    expect(stale.phase3).toBeNull(); expect(stale.rates[0]!.label).toBe('Rate needs review · confirmed for Sat, Sep 26');
    const dayOnly = compileSmartPlan(draft({ rates: confirmSmartRates(600, null, 'OPERATOR_CONFIRMED', targetDate, now) }), { targetDate });
    expect(dayOnly.phase3).toBeNull();
    expect(smartRateFor(slot(3, '08:00', 2), confirmSmartRates(600, null, 'OPERATOR_CONFIRMED', targetDate, now), targetDate, true).label).toBe('Expected: ₱1,200 · current configured rate');
  });

  it('rejects overlapping immediate attempts, duplicates and a missing immediate attempt', () => {
    expect(compileSmartPlan(draft({ immediate: [slot(7, '19:00'), slot(7, '20:00', 2)] }), { targetDate }).problems.join(' ')).toContain('overlap on the same court');
    expect(compileSmartPlan(draft({ backups: [slot(7, '19:00')] }), { targetDate }).problems.join(' ')).toContain('listed twice');
    expect(compileSmartPlan(draft({ immediate: [] }), { targetDate }).problems).toContain('Add at least one immediate attempt.');
    const eight = compileSmartPlan(draft({ immediate: [1, 2, 3, 4, 5, 6, 7].map(court => slot(court, '19:00')).concat(slot(1, '08:00', 1)), backups: [] }), { targetDate });
    expect(eight.phase3).toBeNull();
  });

  it('round-trips simple draft -> PRECISION_PHASE3 -> reload -> same visible plan and same backend object', () => {
    for (const value of [draft(), draft({ useBackupsImmediately: true, retryReopened: true, maxReopenedAttempts: 3 }), draft({ backups: [] }),
      draft({ immediate: [slot(1, '08:00', 1)], backups: [slot(2, '09:00', 2)] })]) {
      const first = compileSmartPlan(value, { targetDate }).phase3!;
      const reloaded = smartDraftFromPhase3(first, { targetDate });
      expect(visible(reloaded)).toEqual(visible(value));
      expect(reloaded.advanced).toEqual({});
      expect(reloaded.immediate.concat(reloaded.backups).every(item => !item.worker && !item.rate && !item.permissions && item.priority === undefined)).toBe(true);
      expect(compileSmartPlan(reloaded, { targetDate }).phase3).toEqual(first);
    }
  });

  it('keeps expert overrides from a saved plan exactly (Advanced settings round-trip)', () => {
    const base = draft({ retryReopened: true });
    base.immediate[0] = { ...base.immediate[0]!, worker: 'G', priority: 9 };
    base.backups[1] = { ...base.backups[1]!, permissions: { wave1: false, wave2: false, rescue: true },
      rate: { source: 'operator confirmed', capturedAt: '2026-09-24T01:02:03.000Z', status: 'VENUE_SCHEDULE', date: targetDate, perHour: [650, 700, 700], actionable: true } };
    base.advanced = { standby: ['E', 'F'], wave2: 1, rescue: 2, total: 6 };
    const saved = compileSmartPlan(base, { targetDate }).phase3!;
    expect(saved.wave1[0]).toEqual({ workerId: 'G', candidateIndex: 0 });
    expect(backendAccepts(saved).budgets).toEqual({ wave2: 1, rescue: 2, total: 6 });
    const reloaded = smartDraftFromPhase3(saved, { targetDate });
    // The reopened limit fits the simple control, so only what it cannot express is pinned.
    expect(reloaded.maxReopenedAttempts).toBe(2);
    expect(reloaded.advanced).toEqual({ standby: ['E', 'F'], wave2: 1, total: 6 });
    expect(reloaded.immediate[0]).toMatchObject({ worker: 'G', priority: 9 });
    expect(reloaded.backups[1]!.permissions).toEqual({ wave1: false, wave2: false, rescue: true });
    expect(reloaded.backups[1]!.rate!.perHour).toEqual([650, 700, 700]);
    expect(compileSmartPlan(reloaded, { targetDate }).phase3).toEqual(saved);
  });

  it('pins a saved worker mapping that automatic derivation would change, instead of silently moving it', () => {
    const saved = compileSmartPlan(draft(), { targetDate }).phase3!; // A-D, standby E-G
    const reloaded = smartDraftFromPhase3(saved, { targetDate, unavailable: new Set(['B']) });
    expect(reloaded.immediate[1]!.worker).toBe('B');
    const again = compileSmartPlan(reloaded, { targetDate, unavailable: new Set(['B']) });
    expect(again.phase3).toEqual(saved);
    expect(again.warnings).toContain('Worker B is not ready and will not be used.');
  });

  it('every compiled plan from varied drafts is accepted by the config schema and authorizePrecision', () => {
    let seed = 7; const random = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
    for (let run = 0; run < 120; run++) {
      const pick = () => slot(1 + random(7), `${String(8 + random(14)).padStart(2, '0')}:00`, 1 + random(3));
      const value = draft({ immediate: Array.from({ length: 1 + random(7) }, pick), backups: Array.from({ length: random(8) }, pick),
        useBackupsImmediately: random(2) === 1, retryReopened: random(2) === 1, maxReopenedAttempts: 1 + random(3) });
      const compiled = compileSmartPlan(value, { targetDate, unavailable: new Set(random(3) === 0 ? ['C'] : []) });
      if (!compiled.phase3) { expect(compiled.problems.length).toBeGreaterThan(0); continue; }
      expect(() => backendAccepts(compiled.phase3!)).not.toThrow();
      expect(compiled.phase3.wave1.every(value => value.workerId !== ('H' as never))).toBe(true);
    }
  });

  it('the arming confirmation for a Smart plan is plain language generated from the saved object', () => {
    const phase3 = compileSmartPlan(draft({ retryReopened: true }), { targetDate }).phase3!;
    const view = bookingView(ConfigSchema.parse({ ...defaultSetup, BOOKING_METHOD: 'proofless', DURATION_HOURS: 3, RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: [], PRECISION_PHASE3: phase3, ...players }));
    const text = describePlan({ ...view, targetDate });
    expect(text).toContain('SMART BACKUPS');
    expect(text).toContain('4 immediate attempts will be sent.');
    expect(text).toContain('Immediate · Worker A → Court 7 19:00–22:00 · PHP 2100');
    expect(text).toContain('UNKNOWN stops later attempts.');
    expect(text).not.toContain('Wave 1 exact sends');
  });
});

describe('Smart immediate attempts: per-attempt Release Offset', () => {
  it('compiles each offset onto its Wave 1 assignment, restores it, and states it in the plan', () => {
    const immediate = [{ ...slot(7, '19:00'), releaseOffsetMs: -1733 }, slot(6, '19:00'), { ...slot(5, '18:00'), releaseOffsetMs: -875 }];
    const compiled = compileSmartPlan(draft({ immediate }), { targetDate });
    const phase3 = compiled.phase3!;
    expect(phase3.wave1.map(value => value.releaseOffsetMs)).toEqual([-1733, undefined, -875]);
    expect(phase3.wave1[1]).not.toHaveProperty('releaseOffsetMs');
    backendAccepts(phase3);
    expect(smartDraftFromPhase3(phase3, { targetDate }).immediate.map(value => value.releaseOffsetMs)).toEqual([-1733, undefined, -875]);
    const lines = describeSmartPlan(phase3).sections[0]!.lines;
    expect(lines[1]).toContain('1733 ms early');
    expect(lines[2]).not.toContain('ms early');
  });

  it('backups never carry an offset: they are sent only after release', () => {
    const phase3 = compileSmartPlan(draft({ immediate: [{ ...slot(7, '19:00'), releaseOffsetMs: -25 as const }] }), { targetDate }).phase3!;
    expect(phase3.candidates.every(candidate => !('releaseOffsetMs' in candidate))).toBe(true);
    expect(phase3.wave1).toHaveLength(1);
  });

  it('rejects offsets outside the guarded range and any offset on a post-release backup', () => {
    expect(compileSmartPlan(draft({ immediate: [{ ...slot(7, '19:00'), releaseOffsetMs: -2001 }] }), { targetDate }).problems)
      .toContain('Court 7 · 7:00 PM · 3 hours has an invalid release offset.');
    expect(compileSmartPlan(draft({ backups: [{ ...slot(6, '19:00'), releaseOffsetMs: -500 }] }), { targetDate }).problems)
      .toContain('Court 6 · 7:00 PM · 3 hours has an invalid release offset.');
  });
});
