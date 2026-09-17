import { describe, expect, it } from 'vitest';
import { availabilityFixture } from '../availability-fixture.js';
import { parseAvailability } from '../../src/api-booking/availability-parser.js';
import { discoverApiAvailability } from '../../src/api-booking/availability-engine.js';
import { MockAvailabilityProvider } from '../../src/api-booking/mock/mock-availability-provider.js';
import type { BookingPreferences } from '../../src/api-booking/types.js';

const date = '2026-09-18';
const now = new Date('2026-09-18T00:00:01.000Z');
const preferences: BookingPreferences = { mode: 'standard', targetDate: date, durationHours: 2, preferredStartTimes: ['08:00', '12:00'], fallbackStartTimes: [], courtPriority: [3, 2, 1], fallbackCourts: [4, 5, 6, 7], courtCount: 1, maximumTotalPrice: 1_200, currency: 'PHP' };

describe('API-first availability engine', () => {
  it('discovers and ranks candidates from the provider without a browser grid', async () => {
    const result = await discoverApiAvailability(new MockAvailabilityProvider({ raw: availabilityFixture(date), capturedAt: now.toISOString(), fixtureKind: 'synthetic', label: 'synthetic' }), preferences, { now: () => now, maximumAgeMs: 5_000 });
    expect(result.candidates.length).toBeGreaterThan(1);
    expect(result.candidates[0]).toMatchObject({ targetDate: date, startTime: '08:00' });
    expect(result.candidates[0]!.courts[0]!.court).toBe(3);
    expect(result.timing.label).toBe('API-FIRST timing');
    expect(result.timing.requestDispatchedMs).toBeGreaterThanOrEqual(0);
    expect(result.timing.responseReceivedMs).toBeGreaterThanOrEqual(result.timing.requestDispatchedMs!);
    expect(result.timing.candidateSelectionMs).toBeGreaterThanOrEqual(result.timing.parsedMs!);
  });

  it('uses the exact target date and fails closed for a malformed provider response', async () => {
    let query: { startDate: string; endDate: string } | undefined;
    const provider = { kind: 'fixture-backed-mock' as const, getAvailability: async (value: typeof query) => { query = value; return { raw: { success: false }, capturedAt: now.toISOString(), fixtureKind: 'live' as const, label: 'bad' }; } };
    await expect(discoverApiAvailability(provider, preferences, { now: () => now })).rejects.toThrow('AVAILABILITY_RESPONSE_INVALID');
    expect(query).toEqual({ startDate: date, endDate: date });
  });

  it('does not treat a date-level release flag as hourly availability', async () => {
    const raw = availabilityFixture(date) as any;
    raw.data.dates[date] = false;
    expect(() => parseAvailability(raw, { startDate: date, endDate: date, capturedAt: now.toISOString(), fixtureKind: 'synthetic', label: 'synthetic', now, maximumAgeMs: 5_000 })).toThrow('AVAILABILITY_DATE_FLAG_CONFLICT');
  });
});
