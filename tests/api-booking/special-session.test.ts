import { describe, expect, it } from 'vitest';
import { availabilityFixture } from '../availability-fixture.js';
import { parseAvailability } from '../../src/api-booking/availability-parser.js';
import { SPECIAL_SESSION_BLOCKS, specialSessionCourtAssignment,
  specialSessionPlans } from '../../src/api-booking/special-session.js';

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
