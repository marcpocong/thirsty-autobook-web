import { describe, expect, it, vi } from 'vitest';
import { candidateJournalKeys, firstUnjournaledCandidate, firstUnjournaledAvailableCandidate } from '../../src/api-booking/candidate-journal.js';
import { availabilityFixture } from '../availability-fixture.js';
import { parseAvailability } from '../../src/api-booking/availability-parser.js';
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
  it('searches past the preview limit when earlier candidates have journals', async () => {
    const date='2026-09-21',now=new Date('2026-09-19T00:00:00.000Z');
    const snapshot=parseAvailability(availabilityFixture(date),{startDate:date,endDate:date,
      capturedAt:now.toISOString(),fixtureKind:'synthetic',label:'offline',now,maximumAgeMs:1000});
    let checked=0;
    const selected=await firstUnjournaledAvailableCandidate(snapshot,{mode:'standard',targetDate:date,durationHours:1,
      preferredStartTimes:['08:00'],fallbackStartTimes:['09:00','10:00','11:00','12:00','13:00','14:00'],
      courtPriority:[7,6,5,4,3,2,1],fallbackCourts:[],courtCount:1,maximumTotalPrice:Infinity,currency:'PHP'},
    'facility',async()=>++checked<=32);
    expect(checked).toBe(33);
    expect(selected?.plan.startTime).toBe('12:00');
    expect(selected?.plan.courts[0]?.court).toBe(3);
  });
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

  it('requires both Extended checkout chunks to have unused journal keys', async () => {
    const first = candidate(7, 'court-7').courts[0]!;
    const second = { ...candidate(7, 'court-7').courts[0]!, startTime: '15:00', endTime: '17:00', durationMinutes: 120,
      slots: [] };
    const extended: BookingPlan = { mode: 'extended', targetDate: '2026-09-21', startTime: '12:00', endTime: '17:00',
      durationHours: 5, courts: [first, second], chunks: [
        { startTime: '12:00', endTime: '15:00', durationHours: 3, courts: [first], totalPrice: 1800 },
        { startTime: '15:00', endTime: '17:00', durationHours: 2, courts: [second], totalPrice: 1200 }],
      totalPrice: 3000, currency: 'PHP' };
    const keys = candidateJournalKeys(extended, 'facility');
    expect(keys).toHaveLength(2); expect(new Set(keys).size).toBe(2);
    await expect(firstUnjournaledCandidate([extended], 'facility', async key => key === keys[1])).resolves.toBeUndefined();
  });

  it('guards every court in both Extended checkout chunks', () => {
    const firstA = candidate(7, 'court-7').courts[0]!;
    const firstB = candidate(6, 'court-6').courts[0]!;
    const secondA = { ...firstA, startTime: '15:00', endTime: '17:00', durationMinutes: 120, slots: [] };
    const secondB = { ...firstB, startTime: '15:00', endTime: '17:00', durationMinutes: 120, slots: [] };
    const extended: BookingPlan = { mode: 'extended', targetDate: '2026-09-21', startTime: '12:00', endTime: '17:00',
      durationHours: 5, courts: [firstA, firstB, secondA, secondB], chunks: [
        { startTime: '12:00', endTime: '15:00', durationHours: 3, courts: [firstA, firstB], totalPrice: 3600 },
        { startTime: '15:00', endTime: '17:00', durationHours: 2, courts: [secondA, secondB], totalPrice: 2400 }],
      totalPrice: 6000, currency: 'PHP' };
    const keys = candidateJournalKeys(extended, 'facility');
    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(4);
  });
});
