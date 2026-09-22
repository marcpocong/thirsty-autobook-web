import { describe, expect, it } from 'vitest';
import { availabilityFixture } from '../availability-fixture.js';
import { parseAvailability } from '../../src/api-booking/availability-parser.js';
import { planBooking } from '../../src/api-booking/booking-planner.js';
import { standardCheckoutChunks } from '../../src/api-booking/extended-checkout.js';
import { requiredWorkerIds } from '../../src/workers.js';

describe('Extended API checkout chunks', () => {
  it.each([[4, [3, 1]], [5, [3, 2]], [6, [3, 3]]] as const)('turns %i hours into two exact standard checkout plans', (duration, split) => {
    const date = '2026-09-21', now = new Date('2026-09-19T00:00:00.000Z');
    const snapshot = parseAvailability(availabilityFixture(date), { startDate: date, endDate: date,
      capturedAt: now.toISOString(), fixtureKind: 'synthetic', label: 'offline', now, maximumAgeMs: 1000 });
    const plan = planBooking(snapshot, { mode: 'extended', targetDate: date, durationHours: duration,
      preferredStartTimes: ['12:00'], fallbackStartTimes: [], courtPriority: [7, 6, 5], fallbackCourts: [],
      courtCount: 1, maximumTotalPrice: 3600, currency: 'PHP' });
    const chunks = standardCheckoutChunks(plan);
    expect(chunks.map(chunk => chunk.durationHours)).toEqual(split);
    expect(chunks.every(chunk => chunk.mode === 'standard' && chunk.chunks.length === 1 && chunk.courts.length === 1)).toBe(true);
    expect(chunks[0]!.endTime).toBe(chunks[1]!.startTime);
    expect(chunks.reduce((sum, chunk) => sum + chunk.totalPrice, 0)).toBe(plan.totalPrice);
  });

  it('keeps both courts together in each Extended checkout chunk', () => {
    const date = '2026-09-21', now = new Date('2026-09-19T00:00:00.000Z');
    const snapshot = parseAvailability(availabilityFixture(date), { startDate: date, endDate: date,
      capturedAt: now.toISOString(), fixtureKind: 'synthetic', label: 'offline', now, maximumAgeMs: 1000 });
    const plan = planBooking(snapshot, { mode: 'extended', targetDate: date, durationHours: 5,
      preferredStartTimes: ['12:00'], fallbackStartTimes: [], courtPriority: [7, 6, 5], fallbackCourts: [],
      courtCount: 2, maximumTotalPrice: 1800, currency: 'PHP' });
    const chunks = standardCheckoutChunks(plan);
    expect(chunks.map(chunk => [chunk.durationHours, chunk.courts.map(court => court.court)])).toEqual([
      [3, [7, 6]], [2, [7, 6]]]);
    expect(chunks.map(chunk => chunk.totalPrice)).toEqual([3600, 2400]);
  });

  it.each(['standard', 'extended'] as const)('splits four %s courts into two-court checkouts with matching workers', mode => {
    const date = '2026-09-21', now = new Date('2026-09-19T00:00:00.000Z');
    const snapshot = parseAvailability(availabilityFixture(date), { startDate: date, endDate: date,
      capturedAt: now.toISOString(), fixtureKind: 'synthetic', label: 'offline', now, maximumAgeMs: 1000 });
    const plan = planBooking(snapshot, { mode, targetDate: date, durationHours: mode === 'standard' ? 2 : 4,
      preferredStartTimes: ['12:00'], fallbackStartTimes: [], courtPriority: [7, 6, 5, 4], fallbackCourts: [],
      courtCount: 4, maximumTotalPrice: Infinity, currency: 'PHP' });
    const chunks = standardCheckoutChunks(plan), workers = requiredWorkerIds(mode, 4);
    expect(chunks).toHaveLength(workers.length);
    expect(workers).toEqual(mode === 'standard' ? ['A', 'B'] : ['A', 'B', 'C', 'D']);
    expect(chunks.map(chunk => chunk.courts.map(court => court.court))).toEqual(mode === 'standard'
      ? [[7, 6], [5, 4]] : [[7, 6], [5, 4], [7, 6], [5, 4]]);
    expect(chunks.every(chunk => chunk.courts.length === 2 && chunk.totalPrice === chunk.courts.reduce((sum, court) => sum + court.price, 0))).toBe(true);
    expect(chunks.reduce((sum, chunk) => sum + chunk.totalPrice, 0)).toBe(plan.totalPrice);
  });
  it.each(['standard','extended'] as const)('allocates seven %s courts to exact two-court worker groups',mode=>{
    const date='2026-09-21',now=new Date('2026-09-19T00:00:00.000Z');
    const snapshot=parseAvailability(availabilityFixture(date),{startDate:date,endDate:date,capturedAt:now.toISOString(),
      fixtureKind:'synthetic',label:'seven',now,maximumAgeMs:1000});
    const plan=planBooking(snapshot,{mode,targetDate:date,durationHours:mode==='standard'?3:6,
      preferredStartTimes:['12:00'],fallbackStartTimes:[],courtPriority:[7,6,5,4,3,2,1],fallbackCourts:[],
      courtCount:7,maximumTotalPrice:Infinity,currency:'PHP'});
    const chunks=standardCheckoutChunks(plan),workers=requiredWorkerIds(mode,7);
    expect(chunks).toHaveLength(mode==='standard'?4:8);
    expect(chunks).toHaveLength(workers.length);
    expect(chunks.map(chunk=>chunk.courts.length)).toEqual(mode==='standard'?[2,2,2,1]:[2,2,2,1,2,2,2,1]);
    expect(chunks.reduce((sum,chunk)=>sum+chunk.totalPrice,0)).toBe(plan.totalPrice);
  });
});
