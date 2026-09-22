import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { availabilityFixture } from '../availability-fixture.js';
import { parseAvailability } from '../../src/api-booking/availability-parser.js';
import { SPECIAL_SESSION_BLOCKS, SPECIAL_SESSION_REQUIRED_WORKERS, SPECIAL_ADAPTIVE_WORKERS, SPECIAL_BONUS_WORKERS,
  SPECIAL_ADAPTIVE_BLOCKS, SPECIAL_BONUS_BLOCKS, specialSessionCourtAssignment, specialSessionPlans,
  specialSessionFingerprint, specialAdaptivePlans, specialBonusPlansForCourt,
  specialBonusLanePlans } from '../../src/api-booking/special-session.js';
import { chooseDirectCourt } from '../../src/api-booking/special-direct-checkout.js';

const date = '2026-09-25';
function snapshot() {
  const capturedAt = '2026-09-23T00:00:00.000Z';
  return parseAvailability(availabilityFixture(date), { startDate: date, endDate: date, capturedAt,
    fixtureKind: 'synthetic', label: 'special', now: new Date(capturedAt), maximumAgeMs: 1000 });
}

describe('special Friday session', () => {
  it('maps the four players to the exact asymmetric court blocks', () => {
    expect(SPECIAL_SESSION_BLOCKS).toEqual([
      { workerId: 'A', court: 6, startTime: '17:00', endTime: '20:00', durationHours: 3 },
      { workerId: 'B', court: 6, startTime: '20:00', endTime: '22:00', durationHours: 2 },
      { workerId: 'C', court: 7, startTime: '19:00', endTime: '21:00', durationHours: 2 },
      { workerId: 'D', court: 7, startTime: '21:00', endTime: '23:00', durationHours: 2 },
    ]);
  });

  it('builds four exact standard checkout plans only when every slot is available', () => {
    const plans = specialSessionPlans(snapshot());
    expect([...plans!.keys()]).toEqual(['A', 'B', 'C', 'D']);
    expect([...plans!.values()].map(plan => [plan.courts[0]!.court, plan.startTime, plan.endTime]))
      .toEqual([[6, '17:00', '20:00'], [6, '20:00', '22:00'], [7, '19:00', '21:00'], [7, '21:00', '23:00']]);
  });

  it('keeps Court 6 and falls back from Court 7 when only its required hour is unavailable', () => {
    const value = snapshot();
    const target = value.slots.find(slot => slot.court === 7 && slot.startTime === '20:00')!;
    target.isAvailable = false;
    const plans = specialSessionPlans(value)!;
    expect(specialSessionCourtAssignment(plans)).toEqual({ earlyCourt: 6, lateCourt: 5 });
  });

  it('swaps the preferred courts when Court 6 cannot satisfy the early block', () => {
    const value = snapshot();
    value.slots.find(slot => slot.court === 6 && slot.startTime === '17:00')!.isAvailable = false;
    const plans = specialSessionPlans(value)!;
    expect(specialSessionCourtAssignment(plans)).toEqual({ earlyCourt: 7, lateCourt: 6 });
  });

  it('falls back to two other distinct courts when both preferred courts are unavailable', () => {
    const value = snapshot();
    for (const slot of value.slots) if (slot.court === 6 || slot.court === 7) slot.isAvailable = false;
    const plans = specialSessionPlans(value)!;
    expect(specialSessionCourtAssignment(plans)).toEqual({ earlyCourt: 5, lateCourt: 4 });
  });

  it('refuses the session when only one court can satisfy both blocks', () => {
    const value = snapshot();
    for (const slot of value.slots) if (slot.court !== 5) slot.isAvailable = false;
    expect(specialSessionPlans(value)).toBeUndefined();
  });

  it('preserves an assigned fallback court for a safe retry worker', () => {
    const value = snapshot();
    value.slots.find(slot => slot.court === 5 && slot.startTime === '17:00')!.isAvailable = false;
    const plans = specialSessionPlans(value, ['B'], { earlyCourt: 5, lateCourt: 4 })!;
    expect([...plans.keys()]).toEqual(['B']);
    expect(plans.get('B')!.courts[0]!.court).toBe(5);
  });
});

describe('special Friday A-H topology', () => {
  it('requires the full eight-worker roster', () => {
    expect(SPECIAL_SESSION_REQUIRED_WORKERS).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  });

  it('assigns every lane its preferred court and keeps all four distinct when everything is open', () => {
    const value = snapshot();
    const efCourt = chooseDirectCourt(value)!;
    expect(efCourt).toBe(5);
    const core = specialSessionPlans(value, undefined, undefined, [efCourt])!;
    const assigned = specialSessionCourtAssignment(core);
    expect(assigned).toEqual({ earlyCourt: 6, lateCourt: 7 });
    const bonus = specialBonusLanePlans(value, [efCourt, assigned.earlyCourt, assigned.lateCourt])!;
    expect(bonus.court).toBe(4);
    const combined = new Map(core);
    for (const [worker, plan] of bonus.plans) combined.set(worker, plan);
    const fullAssignment = specialSessionCourtAssignment(combined);
    expect(fullAssignment).toEqual({ earlyCourt: 6, lateCourt: 7, bonusCourt: 4 });
    const courts = new Set([assigned.earlyCourt, assigned.lateCourt, efCourt, bonus.court]);
    expect(courts.size).toBe(4);
  });

  it('covers exactly nineteen distinct court-hours across eight non-overlapping workers', () => {
    const value = snapshot();
    const efCourt = chooseDirectCourt(value)!;
    const core = specialSessionPlans(value, undefined, undefined, [efCourt])!;
    const assigned = specialSessionCourtAssignment(core);
    const adaptive = specialAdaptivePlans(value, efCourt)!;
    const bonus = specialBonusLanePlans(value, [efCourt, assigned.earlyCourt, assigned.lateCourt])!.plans;
    const all = new Map([...core, ...adaptive, ...bonus]);
    expect([...all.keys()].sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    const hourKeys = [...all.values()].flatMap(plan =>
      plan.courts[0]!.slots.map(slot => `${slot.court}|${slot.startTime}`));
    expect(hourKeys.length).toBe(19);
    expect(new Set(hourKeys).size).toBe(19);
  });

  it('falls back the bonus court when 4, then 3, are unavailable', () => {
    const value = snapshot();
    for (const slot of value.slots) if (slot.court === 4) slot.isAvailable = false;
    expect(specialBonusLanePlans(value, [5, 6, 7])!.court).toBe(3);
    for (const slot of value.slots) if (slot.court === 3) slot.isAvailable = false;
    expect(specialBonusLanePlans(value, [5, 6, 7])!.court).toBe(2);
  });

  it('lets A/B and C/D proceed with no distinct fourth court for G/H', () => {
    const value = snapshot();
    for (const slot of value.slots) if (![6, 7].includes(slot.court)) slot.isAvailable = false;
    const core = specialSessionPlans(value)!;
    expect([...core.keys()]).toEqual(['A', 'B', 'C', 'D']);
    expect(specialBonusLanePlans(value, [6, 7])).toBeUndefined();
  });

  it('requires all five hourly G/H slots on a candidate court, never a partial one', () => {
    const value = snapshot();
    value.slots.find(slot => slot.court === 4 && slot.startTime === '19:00')!.isAvailable = false;
    expect(specialBonusPlansForCourt(value, 4)).toBeUndefined();
    expect(specialBonusLanePlans(value, [5, 6, 7])!.court).toBe(3);
  });

  it('prices G/H from the actual observed slots, not an assumption', () => {
    const value = snapshot();
    const prices: Record<string, number> = { '17:00': 611, '18:00': 622, '19:00': 633, '20:00': 500, '21:00': 500 };
    for (const slot of value.slots) if (slot.court === 4 && prices[slot.startTime] !== undefined) slot.price = prices[slot.startTime]!;
    const plans = specialBonusPlansForCourt(value, 4)!;
    expect(plans.get('G')!.totalPrice).toBe(611 + 622 + 633);
    expect(plans.get('H')!.totalPrice).toBe(1000);
  });

  it('never reuses another lane\'s exact hour identity across all eight workers', () => {
    const value = snapshot();
    const efCourt = chooseDirectCourt(value)!;
    const core = specialSessionPlans(value, undefined, undefined, [efCourt])!;
    const assigned = specialSessionCourtAssignment(core);
    const adaptive = specialAdaptivePlans(value, efCourt)!;
    const bonus = specialBonusLanePlans(value, [efCourt, assigned.earlyCourt, assigned.lateCourt])!.plans;
    const identities = [...core, ...adaptive, ...bonus].flatMap(([worker, plan]) =>
      plan.courts[0]!.slots.map(slot => ({ worker, key: `${slot.spaceId}|${slot.date}|${slot.startTime}|${slot.endTime}` })));
    const seen = new Map<string, string>();
    for (const { worker, key } of identities) {
      expect(seen.has(key)).toBe(false);
      seen.set(key, worker);
    }
  });

  it('changes the release fingerprint when the topology (blocks, lanes, priorities) changes', () => {
    const current = specialSessionFingerprint();
    expect(current).toMatch(/^[a-f0-9]{64}$/);
    expect(specialSessionFingerprint()).toBe(current);
    const legacySixWorkerShape = createHash('sha256').update(JSON.stringify({
      blocks: SPECIAL_SESSION_BLOCKS, directWorkers: ['E', 'F'], directCourtPriority: [5, 4, 3, 2, 1], assumedEveningRate: 700,
    })).digest('hex');
    expect(current).not.toBe(legacySixWorkerShape);
  });

  it('builds the E/F adaptive proof-based plans on the reserved court with the A/B shape', () => {
    const value = snapshot();
    const plans = specialAdaptivePlans(value, 5)!;
    expect([...plans.keys()]).toEqual(SPECIAL_ADAPTIVE_WORKERS);
    expect(plans.get('E')!.courts[0]!.court).toBe(5);
    expect([plans.get('E')!.startTime, plans.get('E')!.endTime]).toEqual(['17:00', '20:00']);
    expect([plans.get('F')!.startTime, plans.get('F')!.endTime]).toEqual(['20:00', '22:00']);
    expect(SPECIAL_ADAPTIVE_BLOCKS.map(block => block.workerId)).toEqual(SPECIAL_ADAPTIVE_WORKERS);
  });

  it('builds the G/H bonus proof-based plans with the A/B shape on a fourth court', () => {
    const value = snapshot();
    const plans = specialBonusPlansForCourt(value, 4)!;
    expect([...plans.keys()]).toEqual(SPECIAL_BONUS_WORKERS);
    expect([plans.get('G')!.startTime, plans.get('G')!.endTime]).toEqual(['17:00', '20:00']);
    expect([plans.get('H')!.startTime, plans.get('H')!.endTime]).toEqual(['20:00', '22:00']);
    expect(SPECIAL_BONUS_BLOCKS.map(block => block.workerId)).toEqual(SPECIAL_BONUS_WORKERS);
  });
});
