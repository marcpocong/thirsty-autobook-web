import { z } from 'zod';
import { DateTime } from 'luxon';
import { expandHours, type Preference } from './config.js';
import { resolvePreference, type Cell } from './grid.js';

export const FACILITY_ID = '5f8786bd-dc61-4509-b893-74cda8f783f7';
export const COURT_TO_SPACE_ID = Object.freeze({
  1: 'c8c8fb0a-518e-4838-b006-8f200e477788', 2: 'df1a98c3-deb2-4721-949a-d5a1e54fdce0',
  3: '0e853a91-33b6-4de2-9237-778007a9313b', 4: '2166184c-db40-4a04-9a80-656878f7327b',
  5: '1cdcd209-71ce-4a72-a2f6-9252c4d06a01', 6: '7aa7d361-9e60-433f-85ed-9e8eeaef8f96',
  7: '648d72bb-0789-40c6-9557-66709da121ba',
});
export const SPACE_ID_TO_COURT: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(Object.entries(COURT_TO_SPACE_ID).map(([court, id]) => [id, Number(court)])));
if (Object.keys(COURT_TO_SPACE_ID).join(',') !== '1,2,3,4,5,6,7' ||
    new Set(Object.values(COURT_TO_SPACE_ID)).size !== 7 ||
    Object.entries(COURT_TO_SPACE_ID).some(([court, id]) => !z.uuid().safeParse(id).success || SPACE_ID_TO_COURT[id] !== Number(court))) {
  throw Error('AVAILABILITY_COURT_MAP_INVALID');
}
export function assertAvailabilityDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || DateTime.fromISO(date).toISODate() !== date) throw Error('AVAILABILITY_DATE_INVALID');
}
export function availabilityPath(targetDate: string) {
  assertAvailabilityDate(targetDate);
  return `/api/public/facilities/${FACILITY_ID}/date-availability?startDate=${targetDate}&endDate=${targetDate}&duration=60&includeSchedule=true`;
}
const SlotSchema = z.object({
  date: z.string(), bookingDate: z.string(), startTime: z.string().regex(/^(0[89]|1\d|2[0-3]):00$/),
  endTime: z.string(), isAvailable: z.boolean(),
  isNightRate: z.boolean().optional().catch(undefined),
  pricing: z.object({ amount: z.number().finite().nonnegative().optional(), currency: z.string().optional() }).optional().catch(undefined),
});
const ResponseSchema = z.object({ success: z.literal(true), data: z.object({
  dates: z.record(z.string(), z.boolean()), slotsBySpace: z.record(z.string(), z.array(z.unknown()).max(1000)),
}) });
export interface AvailabilitySlot {
  court: number; spaceId: string; date: string; bookingDate: string; startTime: string; endTime: string;
  available: boolean; price?: number; currency?: string; nightRate?: boolean;
}
export interface AvailabilitySnapshot {
  targetDate: string; released: boolean; slots: AvailabilitySlot[]; unknownSpaces: number; knownCourts: number;
}
export function parseAvailability(raw: unknown, targetDate: string): AvailabilitySnapshot {
  assertAvailabilityDate(targetDate);
  const parsed = ResponseSchema.safeParse(raw);
  if (!parsed.success) throw Error('AVAILABILITY_SCHEMA_INVALID');
  const { dates, slotsBySpace } = parsed.data.data;
  if (!Object.hasOwn(dates, targetDate) || Object.keys(dates).some(date => date !== targetDate)) throw Error('AVAILABILITY_DATE_MISMATCH');
  const slots: AvailabilitySlot[] = [], seen = new Set<string>();
  let unknownSpaces = 0, knownCourts = 0;
  for (const [spaceId, values] of Object.entries(slotsBySpace)) {
    const court = Object.hasOwn(SPACE_ID_TO_COURT, spaceId) ? SPACE_ID_TO_COURT[spaceId] : undefined;
    if (!court) { unknownSpaces++; continue; }
    knownCourts++;
    for (const value of values) {
      const result = SlotSchema.safeParse(value);
      if (!result.success) throw Error('AVAILABILITY_SLOT_INVALID');
      const slot = result.data;
      if (slot.date !== targetDate || slot.bookingDate !== targetDate) throw Error('AVAILABILITY_DATE_MISMATCH');
      const end = Number(slot.startTime.slice(0, 2)) + 1;
      if (slot.endTime !== `${String(end).padStart(2, '0')}:00` && !(end === 24 && slot.endTime === '00:00')) throw Error('AVAILABILITY_SLOT_INVALID');
      const key = `${court}/${slot.startTime}`;
      if (seen.has(key)) throw Error('AVAILABILITY_SLOT_DUPLICATE');
      seen.add(key);
      slots.push({ court, spaceId, date: slot.date, bookingDate: slot.bookingDate, startTime: slot.startTime,
        endTime: slot.endTime, available: slot.isAvailable, price: slot.pricing?.amount,
        currency: slot.pricing?.currency, nightRate: slot.isNightRate });
    }
  }
  if (!knownCourts) throw Error('AVAILABILITY_COURTS_MISSING');
  return { targetDate, released: dates[targetDate]!, slots, unknownSpaces, knownCourts };
}

export function apiCandidates(api: AvailabilitySnapshot, preferences: Preference[], maximum: number) {
  const slots = new Map(api.slots.map(slot => [`${slot.court}/${slot.startTime}`, slot]));
  return preferences.filter(p => {
    if (!api.released || !p.hours.length || JSON.stringify(expandHours(p.hours[0]!, p.hours.length)) !== JSON.stringify(p.hours)) return false;
    const components = p.hours.map(hour => slots.get(`${p.court}/${hour}`));
    if (components.some(s => !s || !s.available || s.date !== api.targetDate || s.bookingDate !== api.targetDate)) return false;
    const priced = components.every(s => s!.price !== undefined && s!.currency === 'PHP');
    return !priced || components.reduce((sum, s) => sum + s!.price!, 0) <= maximum;
  });
}
export function compareAvailability(api: AvailabilitySnapshot, cells: Cell[]) {
  if (cells.some(c => c.date !== api.targetDate)) throw Error('AVAILABILITY_UI_DATE_MISMATCH');
  const slots = new Map(api.slots.map(s => [`${s.court}/${s.startTime}`, s.available && api.released]));
  let agreed = 0, domOpenApiClosed = 0, domClosedApiOpen = 0;
  for (const c of cells) {
    const open = slots.get(`${c.court}/${c.hour}`) === true;
    if (c.state === 'OPEN' && !open) domOpenApiClosed++;
    else if (c.state !== 'OPEN' && open) domClosedApiOpen++;
    else agreed++;
  }
  return { agreed, domOpenApiClosed, domClosedApiOpen };
}
export function hybridPreferences(api: AvailabilitySnapshot | undefined, targetDate: string, cells: Cell[], preferences: Preference[], maximum: number, earlyCandidates?: Preference[]) {
  if (cells.some(c => c.date !== targetDate)) throw Error('AVAILABILITY_UI_DATE_MISMATCH');
  if (!api || api.targetDate !== targetDate) return { preferences, source: 'UI_ONLY' as const };
  const slots = new Map(api.slots.map(s => [`${s.court}/${s.startTime}`, s]));
  const withinKnownPrice = preferences.filter(p => {
    const parts = p.hours.map(hour => slots.get(`${p.court}/${hour}`));
    return !parts.every(s => s?.price !== undefined && s.currency === 'PHP') || parts.reduce((sum, s) => sum + s!.price!, 0) <= maximum;
  });
  const available = earlyCandidates ?? apiCandidates(api, withinKnownPrice, maximum);
  const intersected = withinKnownPrice.filter(p => available.some(a => a.court === p.court && a.hours.join(',') === p.hours.join(',')) && !!resolvePreference(cells, [p]));
  // If the server's view is stale/closed but the strict UI is open, use ordinary UI discovery.
  return intersected.length ? { preferences: intersected, source: 'API+UI' as const } : { preferences: withinKnownPrice, source: 'UI_ONLY' as const };
}
