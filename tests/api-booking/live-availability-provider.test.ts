import { describe, expect, it, vi } from 'vitest';
import { availabilityFixture } from '../availability-fixture.js';
import { OndaLiveAvailabilityProvider, THIRSTY_PICKLE_FACILITY_ID } from '../../src/api-booking/live-availability-provider.js';

const date = '2026-09-18';
const now = new Date('2026-09-18T00:00:00.000Z');
const raw = availabilityFixture(date);
const response = (body: unknown, status = 200, contentType = 'application/json') => new Response(JSON.stringify(body),
  { status, headers: { 'content-type': contentType } });

describe('live read-only availability provider', () => {
  it('uses only the observed GET endpoint, omits credentials, and validates the captured response', async () => {
    const fetcher = vi.fn(async () => response(raw));
    const provider = new OndaLiveAvailabilityProvider({ fetcher: fetcher as typeof fetch, clock: () => now });
    const envelope = await provider.getAvailability({ startDate: date, endDate: date });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(`https://app.onda.fit/api/public/facilities/${THIRSTY_PICKLE_FACILITY_ID}/date-availability?startDate=${date}&endDate=${date}&duration=60&includeSchedule=true`);
    expect(init).toMatchObject({ method: 'GET', redirect: 'error', credentials: 'omit' });
    expect(envelope).toMatchObject({ fixtureKind: 'live', capturedAt: now.toISOString() });
  });

  it('rejects invalid dates before making a request', async () => {
    const fetcher = vi.fn();
    const provider = new OndaLiveAvailabilityProvider({ fetcher: fetcher as typeof fetch });
    await expect(provider.getAvailability({ startDate: '2026-02-31', endDate: date })).rejects.toThrow('AVAILABILITY_QUERY_INVALID');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails closed on rate limits and contradictory payloads', async () => {
    const limited = new OndaLiveAvailabilityProvider({ fetcher: (async () => response({}, 429)) as typeof fetch, clock: () => now });
    await expect(limited.getAvailability({ startDate: date, endDate: date })).rejects.toThrow('AVAILABILITY_RATE_LIMITED');
    const invalid = new OndaLiveAvailabilityProvider({ fetcher: (async () => response({ success: true, data: { dates: {}, slotsBySpace: {} } })) as typeof fetch, clock: () => now });
    await expect(invalid.getAvailability({ startDate: date, endDate: date })).rejects.toThrow('AVAILABILITY_DATE_RANGE_INCOMPLETE');
  });

  it('permits an incomplete target date only for the pre-release watcher', async () => {
    const incomplete = { success: true, data: { dates: {}, slotsBySpace: {} } };
    const provider = new OndaLiveAvailabilityProvider({ allowIncompleteRange: true,
      fetcher: (async () => response(incomplete)) as typeof fetch, clock: () => now });
    await expect(provider.getAvailability({ startDate: date, endDate: date })).resolves.toMatchObject({ raw: incomplete });
  });
});
