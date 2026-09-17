import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { availabilityFixture } from '../availability-fixture.js';
import { COURT_TO_SPACE_ID, parseAvailability } from '../../src/api-booking/availability-parser.js';
import { planBooking } from '../../src/api-booking/booking-planner.js';
import { candidatePlans } from '../../src/booking-plan.js';
import type { BookingPreferences } from '../../src/api-booking/types.js';

const syntheticRaw = availabilityFixture('2026-09-18');
const synthetic = parseAvailability(syntheticRaw, {
  startDate: '2026-09-18', endDate: '2026-09-18', capturedAt: '2026-09-18T00:00:00Z',
  fixtureKind: 'synthetic', label: 'SYNTHETIC ALL-OPEN FIXTURE', now: new Date('2026-09-18T00:00:01Z'), maximumAgeMs: 5_000,
});
const base: BookingPreferences = {
  mode: 'standard', targetDate: '2026-09-18', durationHours: 3,
  preferredStartTimes: ['10:00'], fallbackStartTimes: ['12:00'],
  courtPriority: [7, 3], fallbackCourts: [6, 1, 2, 4, 5], courtCount: 1,
  maximumTotalPrice: 1_800, currency: 'PHP',
};

describe('deterministic booking planning', () => {
  it.each([4, 5, 6])('matches Chrome first split and checkout boundaries for %i hours', duration => {
    const chrome = candidatePlans({ strategy: 'extended', date: base.targetDate, start: '18:00', duration,
      courtCount: 1, priority: [7, 3], fallbackStarts: [] })[0]!;
    const api = planBooking(synthetic, { ...base, mode: 'extended', durationHours: duration, preferredStartTimes: ['18:00'] });
    expect(api.chunks.map(chunk => [chunk.startTime, chunk.durationHours, chunk.courts.map(c => c.court)])).toEqual(
      chrome.chunks.map(chunk => [chunk.start, chunk.duration, [7]]));
  });

  it('applies the price cap per court in each checkout and reports court shortages separately', () => {
    const two = planBooking(synthetic, { ...base, courtCount: 2, maximumTotalPrice: 1_800 });
    expect(two.chunks[0]!.totalPrice).toBe(3_600);
    const raw = availabilityFixture('2026-09-18');
    for (const [id, slots] of Object.entries(raw.data.slotsBySpace)) if (id !== COURT_TO_SPACE_ID[7]) {
      for (const slot of slots) slot.isAvailable = false;
    }
    const sparse = parseAvailability(raw, { startDate: base.targetDate, endDate: base.targetDate,
      capturedAt: '2026-09-18T00:00:00Z', fixtureKind: 'synthetic', label: 'one court',
      now: new Date('2026-09-18T00:00:01Z'), maximumAgeMs: 5_000 });
    expect(() => planBooking(sparse, { ...base, courtCount: 2 })).toThrowError('BOOKING_NO_CONSECUTIVE_AVAILABILITY');
  });

  it('respects exact courts independently for each Extended chunk', () => {
    const p = planBooking(synthetic, { ...base, mode: 'extended', durationHours: 4,
      exactCourts: [[7], [3]], preferredStartTimes: ['18:00'] });
    expect(p.chunks.map(c => c.courts[0]!.court)).toEqual([7, 3]);
  });
  it('plans three consecutive synthetic hours on the preferred court', () => {
    const plan = planBooking(synthetic, base);
    expect(plan).toMatchObject({ mode: 'standard', startTime: '10:00', endTime: '13:00', totalPrice: 1_800 });
    expect(plan.courts.map(court => court.court)).toEqual([7]);
    expect(plan.courts[0]!.slots.map(slot => slot.startTime)).toEqual(['10:00', '11:00', '12:00']);
  });

  it('uses court priority before fallback courts and falls back deterministically', () => {
    const raw = availabilityFixture('2026-09-18');
    const court7 = raw.data.slotsBySpace[COURT_TO_SPACE_ID[7]]!;
    court7.find(slot => slot.startTime === '10:00')!.isAvailable = false;
    const snapshot = parseAvailability(raw, {
      startDate: '2026-09-18', endDate: '2026-09-18', capturedAt: '2026-09-18T00:00:00Z',
      fixtureKind: 'synthetic', label: 'SYNTHETIC MODIFIED FIXTURE', now: new Date('2026-09-18T00:00:01Z'), maximumAgeMs: 5_000,
    });
    expect(planBooking(snapshot, base).courts[0]!.court).toBe(3);
  });

  it('moves the whole booking to a fallback start when no preferred block is consecutive', () => {
    const raw = availabilityFixture('2026-09-18');
    for (const slots of Object.values(raw.data.slotsBySpace)) slots.find(slot => slot.startTime === '11:00')!.isAvailable = false;
    const snapshot = parseAvailability(raw, {
      startDate: '2026-09-18', endDate: '2026-09-18', capturedAt: '2026-09-18T00:00:00Z',
      fixtureKind: 'synthetic', label: 'SYNTHETIC FALLBACK FIXTURE', now: new Date('2026-09-18T00:00:01Z'), maximumAgeMs: 5_000,
    });
    expect(planBooking(snapshot, base).startTime).toBe('12:00');
  });

  it('enforces maximum total price', () => {
    expect(() => planBooking(synthetic, { ...base, maximumTotalPrice: 1_799 })).toThrowError('BOOKING_MAXIMUM_PRICE_EXCEEDED');
  });

  it('uses a cheaper fallback court when a preferred court exceeds the total maximum', () => {
    const raw = availabilityFixture('2026-09-18');
    for (const slot of raw.data.slotsBySpace[COURT_TO_SPACE_ID[7]]!.filter(slot => ['10:00', '11:00', '12:00'].includes(slot.startTime))) slot.pricing.amount = 1_000;
    const snapshot = parseAvailability(raw, {
      startDate: '2026-09-18', endDate: '2026-09-18', capturedAt: '2026-09-18T00:00:00Z',
      fixtureKind: 'synthetic', label: 'SYNTHETIC PRICE FALLBACK FIXTURE', now: new Date('2026-09-18T00:00:01Z'), maximumAgeMs: 5_000,
    });
    expect(planBooking(snapshot, base).courts[0]!.court).toBe(3);
  });

  it('plans Extended as two sequential checkout chunks', () => {
    const plan = planBooking(synthetic, {
      ...base, mode: 'extended', durationHours: 4, courtCount: 2, preferredStartTimes: ['18:00'], maximumTotalPrice: 4_800,
    });
    expect(plan.chunks.map(chunk => [chunk.startTime, chunk.endTime, chunk.courts.map(court => court.court)])).toEqual([
      ['18:00', '21:00', [7, 3]], ['21:00', '22:00', [7, 3]],
    ]);
    expect(plan.totalPrice).toBe(4_800);
  });

  it('requires the mode-specific duration range', () => {
    expect(() => planBooking(synthetic, { ...base, mode: 'extended', durationHours: 3 })).toThrowError('BOOKING_DURATION_INVALID');
    expect(() => planBooking(synthetic, { ...base, durationHours: 4 })).toThrowError('BOOKING_DURATION_INVALID');
  });

  it('uses captured historical availability for a real two-hour observed block without hardcoding it', () => {
    const fixturePath = fileURLToPath(new URL('../../src/api-booking/fixtures/onda-availability-snapshot-2026-09-17.json', import.meta.url));
    const raw = JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown;
    const historical = parseAvailability(raw, {
      startDate: '2026-09-17', endDate: '2026-09-19', capturedAt: '2026-09-17T12:00:00Z',
      fixtureKind: 'captured-historical', label: 'SANITIZED HISTORICAL SNAPSHOT', now: new Date('2026-09-17T12:01:00Z'), maximumAgeMs: 120_000,
    });
    const plan = planBooking(historical, { ...base, durationHours: 2, preferredStartTimes: ['08:00'], courtPriority: [7, 6, 3], maximumTotalPrice: 1_200 });
    expect(plan.courts[0]!.court).toBe(3);
    expect(plan.startTime).toBe('08:00');
    expect(plan.chunks).toHaveLength(1);
    expect(plan.chunks[0]!.courts[0]!.slots.map(slot => slot.startTime)).toEqual(['08:00', '09:00']);
  });
});
