import { it, expect, vi } from 'vitest';
import { COURT_TO_SPACE_ID, SPACE_ID_TO_COURT, FACILITY_ID, parseAvailability, availabilityPath, apiCandidates, hybridPreferences, compareAvailability } from '../src/onda-availability.js';
import { compilePreferences, ObservationSchema } from '../src/config.js';
import { AvailabilityDiscovery } from '../src/availability-discovery.js';
import { Safety } from '../src/safety.js';
import { Telemetry } from '../src/telemetry.js';
import { availabilityFixture, availabilityCells, availabilityDate as date } from './availability-fixture.js';
const preferences = compilePreferences({ START_TIME: '19:00', FALLBACK_TIMES: ['18:00', '20:00'], DURATION_HOURS: 2, PREFERRED_COURTS: [7, 5, 6], FALLBACK_COURTS: [1] });
const parse = () => parseAvailability(availabilityFixture(), date);
it('uses the seven exact verified mappings and inverse, independent of response order', () => {
  expect(Object.values(COURT_TO_SPACE_ID)).toEqual(['c8c8fb0a-518e-4838-b006-8f200e477788', 'df1a98c3-deb2-4721-949a-d5a1e54fdce0', '0e853a91-33b6-4de2-9237-778007a9313b', '2166184c-db40-4a04-9a80-656878f7327b', '1cdcd209-71ce-4a72-a2f6-9252c4d06a01', '7aa7d361-9e60-433f-85ed-9e8eeaef8f96', '648d72bb-0789-40c6-9557-66709da121ba']);
  expect(new Set(Object.values(COURT_TO_SPACE_ID)).size).toBe(7);
  for (const [court, id] of Object.entries(COURT_TO_SPACE_ID)) expect(SPACE_ID_TO_COURT[id]).toBe(Number(court));
  expect(parse().slots[0]!.court).toBe(7); expect(parse().knownCourts).toBe(7);
});
it('builds one canonical exact-date GET path and rejects invalid date input', () => {
  expect(availabilityPath(date)).toBe(`/api/public/facilities/${FACILITY_ID}/date-availability?startDate=${date}&endDate=${date}&duration=60&includeSchedule=true&slotDateMode=web-operating-day`);
  expect(() => availabilityPath('2026-02-30')).toThrow(); expect(() => availabilityPath('2026-09-13&duration=1')).toThrow();
  expect(ObservationSchema.parse({}).AVAILABILITY_DISCOVERY_MODE).toBe('ui');
  expect(ObservationSchema.safeParse({ AVAILABILITY_DISCOVERY_MODE: 'api-only' }).success).toBe(false);
});
it('strips extra fields and ignores/counts unknown spaces including inherited property names', () => {
  const raw: any = availabilityFixture(); raw.checkoutToken = 'private';
  raw.data.slotsBySpace['unknown'] = [{ private: 'ignored' }]; raw.data.slotsBySpace['toString'] = [];
  raw.data.slotsBySpace[COURT_TO_SPACE_ID[1]][0].extra = 'private';
  const result = parseAvailability(raw, date);
  expect(result.unknownSpaces).toBe(2); expect(result.slots).toHaveLength(112);
  expect(JSON.stringify(result)).not.toContain('private');
});
it.each(['success', 'data', 'structure', 'date', 'bookingDate', 'missingDate', 'extraDate', 'available', 'end', 'duplicate'])('rejects %s ambiguity from API candidate use', kind => {
  const raw: any = availabilityFixture(), slot = raw.data.slotsBySpace[COURT_TO_SPACE_ID[7]][0];
  if (kind === 'success') raw.success = false;
  if (kind === 'data') delete raw.data;
  if (kind === 'structure') raw.data.slotsBySpace = [];
  if (kind === 'date') slot.date = '2026-09-12';
  if (kind === 'bookingDate') slot.bookingDate = '2026-09-12';
  if (kind === 'missingDate') raw.data.dates = {};
  if (kind === 'extraDate') raw.data.dates['2026-09-12'] = true;
  if (kind === 'available') slot.isAvailable = 'true';
  if (kind === 'end') slot.endTime = '10:00';
  if (kind === 'duplicate') raw.data.slotsBySpace[COURT_TO_SPACE_ID[7]].push(slot);
  expect(() => parseAvailability(raw, date)).toThrow(/^AVAILABILITY_/);
});
it.each([1, 2, 3, 4])('keeps configured court/time ordering and contiguous %s-hour durations', duration => {
  const ordered = compilePreferences({ START_TIME: '19:00', FALLBACK_TIMES: ['18:00', '20:00'], DURATION_HOURS: duration, PREFERRED_COURTS: [7, 5, 6], FALLBACK_COURTS: [1] });
  expect(apiCandidates(parse(), ordered, 10000)).toEqual(ordered);
});
it('rejects holes, unavailable hours and noncontiguous candidates', () => {
  const api = parse(); api.slots = api.slots.filter(s => !(s.court === 7 && s.startTime === '20:00'));
  expect(apiCandidates(api, preferences, 1200)[0]!.court).toBe(5);
  api.slots.forEach(s => { s.available = false; }); expect(apiCandidates(api, preferences, 1200)).toEqual([]);
  expect(apiCandidates(parse(), [{ court: 7, hours: ['18:00', '20:00'] }], 1200)).toEqual([]);
});
it('keeps available courts regardless of known PHP price and tolerates optional pricing', () => {
  expect(apiCandidates(parse(), preferences, 1)).toEqual(preferences);
  expect(hybridPreferences(parse(), date, availabilityCells(), preferences, 1).preferences).toEqual(preferences);
  const raw: any = availabilityFixture();
  Object.values(raw.data.slotsBySpace).forEach((slots: any) => slots.forEach((s: any) => { delete s.pricing; delete s.isNightRate; }));
  expect(apiCandidates(parseAvailability(raw, date), preferences, 1199)).toEqual(preferences);
});
it('intersects OPEN UI, falls back to DOM for API-closed state and rejects wrong UI date', () => {
  const api = parse(), cells = availabilityCells();
  cells.find(c => c.court === 7 && c.hour === '19:00')!.state = 'TAKEN';
  const ranked = hybridPreferences(api, date, cells, preferences, 1200);
  expect(ranked.source).toBe('API+UI'); expect(ranked.preferences[0]!.court).toBe(5);
  api.slots.forEach(s => { s.available = false; });
  expect(hybridPreferences(api, date, cells, preferences, 1200)).toEqual({ source: 'UI_ONLY', preferences });
  expect(hybridPreferences(undefined, date, cells, preferences, 1200).preferences).toBe(preferences);
  expect(() => hybridPreferences(api, date, availabilityCells('2026-09-12'), preferences, 1200)).toThrow('UI_DATE_MISMATCH');
  expect(hybridPreferences({ ...api, targetDate: '2026-09-12' }, date, cells, preferences, 1200).source).toBe('UI_ONLY');
});
it('compares API and UI with sanitized counts', () => {
  const api = parse(), cells = availabilityCells();
  expect(compareAvailability(api, cells)).toEqual({ agreed: 112, domOpenApiClosed: 0, domClosedApiOpen: 0 });
  api.slots[0]!.available = false; cells[0]!.state = 'TAKEN';
  expect(compareAvailability(api, cells)).toEqual({ agreed: 110, domOpenApiClosed: 1, domClosedApiOpen: 1 });
});
it('never waits on slow discovery and ignores an initial response arriving after the grid', async () => {
  let resolve!: (value: ReturnType<typeof parse>) => void;
  const request = vi.fn(() => new Promise<ReturnType<typeof parse>>(r => { resolve = r; }));
  const discovery = new AvailabilityDiscovery(date, 1200, request, new Safety(), new Telemetry());
  discovery.start(); discovery.start(); discovery.captureAtGrid();
  expect(discovery.rank(availabilityCells(), preferences)).toBe(preferences); expect(request).toHaveBeenCalledOnce();
  resolve(parse()); await vi.waitFor(() => expect(request).toHaveBeenCalledOnce()); await Promise.resolve();
  expect(discovery.rank(availabilityCells(), preferences)).toBe(preferences);
});
it('reuses an early response and bounds conflict refresh to three serialized requests', async () => {
  const request = vi.fn(async () => parse()), t = new Telemetry();
  const discovery = new AvailabilityDiscovery(date, 1200, request, new Safety(), t);
  discovery.start(); await new Promise(resolve => setTimeout(resolve, 0)); discovery.captureAtGrid();
  discovery.rank(availabilityCells(), preferences); expect(discovery.source).toBe('API+UI');
  for (let i = 0; i < 5; i++) { discovery.refresh(); await new Promise(resolve => setTimeout(resolve, 0)); }
  expect(request).toHaveBeenCalledTimes(3);
  expect(t.events.filter(e => e.event === 'availabilityRefreshStarted')).toHaveLength(2);
  discovery.finish(); discovery.start(); expect(request).toHaveBeenCalledTimes(3);
});
it('optional request rejection falls back without hiding a safety stop', async () => {
  const safety = new Safety(), discovery = new AvailabilityDiscovery(date, 1200, async () => { throw Error('private network detail'); }, safety, new Telemetry());
  discovery.start(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(discovery.rank(availabilityCells(), preferences)).toBe(preferences);
  safety.stop('RATE_LIMITED'); expect(() => discovery.rank(availabilityCells(), preferences)).toThrow('RATE_LIMITED');
});

it('precomputes early candidates and excludes attempted preferences when the UI becomes ready', async () => {
  const t = new Telemetry();
  const discovery = new AvailabilityDiscovery(date, 1200, async () => parse(), new Safety(), t, preferences);
  discovery.start(); await new Promise(resolve => setTimeout(resolve, 0)); discovery.captureAtGrid();
  expect(t.events.some(e => e.event === 'availabilityApiCandidatesReady')).toBe(true);
  expect(discovery.rank(availabilityCells(), preferences.slice(1))).toEqual(preferences.slice(1));
  expect(discovery.source).toBe('API+UI');
});
