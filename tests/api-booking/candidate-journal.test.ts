import { describe, expect, it, vi } from 'vitest';
import { firstUnjournaledCandidate } from '../../src/api-booking/candidate-journal.js';
import type { BookingPlan } from '../../src/api-booking/types.js';

const candidate = (court: number, spaceId: string): BookingPlan => {
  const plannedCourt = { court, spaceId, date: '2026-09-21', startTime: '12:00', endTime: '13:00', durationMinutes: 60,
    price: 600, currency: 'PHP', slots: [{ court, spaceId, date: '2026-09-21', bookingDate: '2026-09-21', startTime: '12:00',
      endTime: '13:00', price: 600, currency: 'PHP', isAvailable: true, isNightRate: false, isNextDay: false }] };
  return { mode: 'standard', targetDate: '2026-09-21', durationHours: 1, startTime: '12:00', endTime: '13:00',
    currency: 'PHP', totalPrice: 600, courts: [plannedCourt],
    chunks: [{ startTime: '12:00', endTime: '13:00', durationHours: 1, courts: [plannedCourt], totalPrice: 600 }] };
};

describe('durable candidate selection', () => {
  it('skips a journaled preferred court and selects the next approved candidate', async () => {
    const candidates = [candidate(7, 'court-7'), candidate(6, 'court-6')];
    const seen: string[] = [];
    const hasRecord = vi.fn(async key => { seen.push(key); return seen.length === 1; });
    const selected = await firstUnjournaledCandidate(candidates, 'facility', hasRecord);
    expect(selected?.plan.courts[0]?.court).toBe(6);
    expect(hasRecord).toHaveBeenCalledTimes(2);
    expect(new Set(seen).size).toBe(2);
  });

  it('returns no candidate when every available court is journaled', async () => {
    await expect(firstUnjournaledCandidate([candidate(7, 'court-7')], 'facility', async () => true)).resolves.toBeUndefined();
  });
});
