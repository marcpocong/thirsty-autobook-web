import { describe, expect, it } from 'vitest';
import type { BookingPlan } from '../../src/api-booking/types.js';
import { validateTargetSnapshot } from '../../src/api-booking/real-checkout-hybrid.js';
import type { Snapshot } from '../../src/grid.js';

const slot = { court: 7, spaceId: 'space-7', date: '2026-09-19', bookingDate: '2026-09-19',
  startTime: '13:00', endTime: '14:00', isAvailable: true, isNightRate: false,
  isNextDay: false, currency: 'PHP', price: 700 };
const plannedCourt = { court: 7, spaceId: 'space-7', date: '2026-09-19', startTime: '13:00',
  endTime: '14:00', durationMinutes: 60, price: 700, currency: 'PHP' as const, slots: [slot] };
const plan: BookingPlan = { mode: 'standard', targetDate: '2026-09-19', startTime: '13:00',
  endTime: '14:00', durationHours: 1, totalPrice: 700, currency: 'PHP', courts: [plannedCourt],
  chunks: [{ startTime: '13:00', endTime: '14:00', durationHours: 1, totalPrice: 700, courts: [plannedCourt] }] };
const partial: Snapshot = { heading: 'Sat, September 19', busy: false,
  rows: [{ date: '2026-09-19', hour: '13:00' }], cells: [{ date: '2026-09-19', hour: '13:00',
    label: 'Court 7: Mango Wing 1 PM to 2 PM available', state: 'available', disabled: false }] };

describe('API plan to genuine checkout target', () => {
  it('accepts the exact actionable target before the complete calendar exists', () => {
    expect(validateTargetSnapshot(partial, plan)).toEqual({ fullGridReady: false });
    expect(validateTargetSnapshot({ ...partial, cells: [...partial.cells,
      { date: '2026-09-19', hour: '14:00', label: 'unhydrated unrelated cell', state: null, disabled: true }] }, plan))
      .toEqual({ fullGridReady: false });
  });
  it('rejects stale, busy, unavailable and foreign selected states', () => {
    expect(() => validateTargetSnapshot({ ...partial, busy: true }, plan)).toThrow('HYBRID_TARGET_NOT_READY');
    expect(() => validateTargetSnapshot({ ...partial, rows: [{ date: '2026-09-18', hour: '13:00' }] }, plan)).toThrow('HYBRID_TARGET_NOT_READY');
    expect(() => validateTargetSnapshot({ ...partial, cells: [{ ...partial.cells[0]!, disabled: true }] }, plan)).toThrow('HYBRID_CELL_UNKNOWN');
    expect(() => validateTargetSnapshot({ ...partial, cells: [...partial.cells,
      { date: '2026-09-19', hour: '13:00', label: 'Court 6: Mango Wing 1 PM to 2 PM selected', state: 'selected', disabled: false }] }, plan))
      .toThrow('HYBRID_PREEXISTING_SELECTION');
  });
});
