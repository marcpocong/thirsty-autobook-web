/**
 * Canonical hour-boundary handling for Onda ranges.
 *
 * Internally a range that ends at midnight ends at "24:00", so every HH:MM string comparison
 * (`start < end`, overlap tests) stays correct. Onda itself writes that boundary as "00:00" in its
 * availability feed, its public-booking records and its checkout payload. Convert only at the edge:
 * `internalRangeEnd` when reading Onda data, `ondaWireBoundary` when writing a request.
 */
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "HH:MM" or "HH:MM:SS" → "HH:MM", or null when the value is not a clock time. */
export function clockMinutesText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.slice(0, 5);
  return HH_MM.test(text) && (value.length === 5 || /^:[0-5]\d$/.test(value.slice(5))) ? text : null;
}

/** Internal end of a range: Onda's "00:00" after a later start is midnight at the end of the day ("24:00"). */
export function internalRangeEnd(start: string, end: string): string {
  return end === '00:00' && start !== '00:00' ? '24:00' : end;
}

/**
 * One Onda record's range in internal form, or null when it is not a forward range on one day.
 * `23:00 → 00:00` becomes `23:00 → 24:00`; `22:00 → 23:00` is unchanged.
 */
export function normalizeOndaRange(startValue: unknown, endValue: unknown): { startTime: string; endTime: string } | null {
  const start = clockMinutesText(startValue);
  const rawEnd = typeof endValue === 'string' && /^24:00(?::00)?$/.test(endValue) ? '24:00' : clockMinutesText(endValue);
  if (start === null || rawEnd === null) return null;
  const end = internalRangeEnd(start, rawEnd);
  return start < end ? { startTime: start, endTime: end } : null;
}

/** Wire form of an internal boundary: Onda's checkout endpoint writes the end of the 23:00 hour as "00:00", never "24:00". */
export const ondaWireBoundary = (time: string): string => time === '24:00' ? '00:00' : time;

/** Inverse of ondaWireBoundary for the END of a wire item (a wire "00:00" end is internal "24:00"). */
export const internalWireEnd = (time: string): string => time === '00:00' ? '24:00' : time;

/** Whole-hour minutes since midnight for an internal "HH:00" boundary ("24:00" → 1440), or NaN. */
export function internalHourMinutes(time: string): number {
  if (time === '24:00') return 1440;
  return /^([01]\d|2[0-3]):00$/.test(time) ? Number(time.slice(0, 2)) * 60 : Number.NaN;
}

/** Two internal ranges on the same court overlap (half-open intervals). */
export const rangesOverlap = (a: { startTime: string; endTime: string }, b: { startTime: string; endTime: string }) =>
  a.startTime < b.endTime && b.startTime < a.endTime;
