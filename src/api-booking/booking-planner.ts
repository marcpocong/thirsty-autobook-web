import type { AvailabilitySlot, AvailabilitySnapshot, BookingPlan, BookingPreferences, PlannedCourt } from './types.js';

export class BookingPlanningError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'BookingPlanningError'; }
}

export const bookingPlanKey = (plan: BookingPlan) => JSON.stringify(plan.chunks.map(chunk => [chunk.startTime, chunk.endTime, chunk.courts.map(court => [court.court, court.spaceId])]));

const unique = <T>(values: T[]) => [...new Set(values)];
const cents = (value: number) => Math.round(value * 100);

function patterns(duration: number): number[][] {
  return duration <= 3 ? [[duration]] : duration === 4 ? [[3, 1], [2, 2], [1, 3]] : duration === 5 ? [[3, 2], [2, 3]] : [[3, 3]];
}

function validate(p: BookingPreferences) {
  if (!Number.isInteger(p.durationHours) || (p.mode === 'standard' ? p.durationHours < 1 || p.durationHours > 3 : p.durationHours < 4 || p.durationHours > 6)) throw new BookingPlanningError('BOOKING_DURATION_INVALID');
  if (p.courtCount !== 1 && p.courtCount !== 2) throw new BookingPlanningError('BOOKING_COURT_COUNT_INVALID');
  if (!Number.isFinite(p.maximumTotalPrice) || p.maximumTotalPrice < 0 || Math.abs(cents(p.maximumTotalPrice) - p.maximumTotalPrice * 100) > 1e-7) throw new BookingPlanningError('BOOKING_MAXIMUM_PRICE_INVALID');
  if (!p.preferredStartTimes.length || !p.courtPriority.length || [...p.courtPriority, ...p.fallbackCourts].some(c => !Number.isInteger(c) || c < 1 || c > 7)) throw new BookingPlanningError('BOOKING_PREFERENCES_INVALID');
  if (p.exactCourts && (p.exactCourts.length !== (p.mode === 'standard' ? 1 : 2) || p.exactCourts.some(cs => cs.length !== p.courtCount || unique(cs).length !== cs.length || cs.some(c => !Number.isInteger(c) || c < 1 || c > 7)))) throw new BookingPlanningError('BOOKING_EXACT_COURTS_INVALID');
}

function groups<T>(values: T[], count: number): T[][] {
  if (count === 0) return [[]];
  return values.flatMap((value, index) => groups(values.slice(index + 1), count - 1).map(rest => [value, ...rest]));
}

export function planBooking(snapshot: AvailabilitySnapshot, p: BookingPreferences, excluded = new Set<string>()): BookingPlan {
  validate(p);
  if (!Object.hasOwn(snapshot.returnedDates, p.targetDate)) throw new BookingPlanningError('BOOKING_TARGET_DATE_MISSING');
  const index = new Map(snapshot.slots.map(slot => [`${slot.court}/${slot.date}/${slot.startTime}`, slot]));
  let enoughCourts = false;
  let affordable = false;
  for (const startTime of unique([...p.preferredStartTimes, ...p.fallbackStartTimes])) {
    if (!/^([01]\d|2[0-3]):00$/.test(startTime)) continue;
    const start = Number(startTime.slice(0, 2));
    if (start < 8 || start + p.durationHours > 24) continue;
    for (const split of patterns(p.durationHours)) {
      let offset = start;
      const options: PlannedCourt[][][] = [];
      let completeCourtPattern = true;
      for (const [chunkIndex, duration] of split.entries()) {
        const hours = Array.from({ length: duration }, (_, i) => `${String(offset + i).padStart(2, '0')}:00`);
        const courtOrder = p.exactCourts?.[chunkIndex] ?? unique([...p.courtPriority, ...p.fallbackCourts]);
        const candidates: PlannedCourt[] = [];
        for (const court of courtOrder) {
          const slots = hours.map(hour => index.get(`${court}/${p.targetDate}/${hour}`));
          if (slots.some(slot => !slot || !slot.isAvailable || slot.bookingDate !== p.targetDate || slot.currency !== p.currency)) continue;
          const present = slots as AvailabilitySlot[];
          candidates.push({ court, spaceId: present[0]!.spaceId, date: p.targetDate, startTime: hours[0]!, endTime: present.at(-1)!.endTime,
            durationMinutes: duration * 60, price: present.reduce((sum, slot) => sum + slot.price, 0), currency: p.currency, slots: present });
        }
        if (candidates.length < p.courtCount) completeCourtPattern = false;
        const combinations = p.exactCourts ? (candidates.length === p.courtCount ? [candidates] : []) : groups(candidates, p.courtCount);
        options.push(combinations.filter(cs => cs.every(c => cents(c.price) <= cents(p.maximumTotalPrice))));
        offset += duration;
      }
      if (completeCourtPattern) enoughCourts = true;
      if (options.some(o => !o.length)) continue;
      affordable = true;
      for (const a of options[0]!) {
        const seconds = split.length === 1 ? [[]] : [...options[1]!].sort((x, y) => y.filter(c => a.some(first => first.court === c.court)).length - x.filter(c => a.some(first => first.court === c.court)).length);
        for (const b of seconds) {
          const selected = split.length === 1 ? [a] : [a, b];
          const key = JSON.stringify(selected.map(cs => [cs[0]!.startTime, cs[0]!.endTime, cs.map(c => [c.court, c.spaceId])]));
          if (excluded.has(key)) continue;
          const chunks = selected.map(cs => ({ startTime: cs[0]!.startTime, endTime: cs[0]!.endTime, durationHours: cs[0]!.durationMinutes / 60, courts: cs, totalPrice: cs.reduce((sum, c) => sum + c.price, 0) }));
          return { mode: p.mode, targetDate: p.targetDate, startTime, endTime: chunks.at(-1)!.endTime, durationHours: p.durationHours,
            courts: selected.flat(), chunks, totalPrice: chunks.reduce((sum, chunk) => sum + chunk.totalPrice, 0), currency: p.currency };
        }
      }
    }
  }
  throw new BookingPlanningError(affordable ? 'BOOKING_CANDIDATES_EXCLUDED' : enoughCourts ? 'BOOKING_MAXIMUM_PRICE_EXCEEDED' : 'BOOKING_NO_CONSECUTIVE_AVAILABILITY');
}

/**
 * Returns the same deterministic ordering used by planBooking, without reading
 * or waiting for a browser grid. The limit is a safety bound on local work.
 */
export function rankBookingCandidates(snapshot: AvailabilitySnapshot, p: BookingPreferences, limit = 32): BookingPlan[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 256) throw new BookingPlanningError('BOOKING_CANDIDATE_LIMIT_INVALID');
  const candidates: BookingPlan[] = [];
  const excluded = new Set<string>();
  while (candidates.length < limit) {
    try {
      const candidate = planBooking(snapshot, p, excluded);
      const key = bookingPlanKey(candidate);
      if (excluded.has(key)) throw new BookingPlanningError('BOOKING_CANDIDATE_ENUMERATION_FAILED');
      excluded.add(key); candidates.push(candidate);
    } catch (error) {
      if (error instanceof BookingPlanningError && (error.code === 'BOOKING_CANDIDATES_EXCLUDED' || error.code === 'BOOKING_NO_CONSECUTIVE_AVAILABILITY' || error.code === 'BOOKING_MAXIMUM_PRICE_EXCEEDED')) break;
      throw error;
    }
  }
  return candidates;
}
