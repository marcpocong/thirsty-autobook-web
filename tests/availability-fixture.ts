import { COURT_TO_SPACE_ID } from '../src/onda-availability.js';
import type { Cell } from '../src/grid.js';
export const availabilityDate = '2026-09-13';
export function availabilityFixture(date = availabilityDate) {
  return { success: true, data: { dates: { [date]: true }, slotsBySpace: Object.fromEntries(
    Object.values(COURT_TO_SPACE_ID).reverse().map(id => [id, Array.from({ length: 16 }, (_, i) => ({
      date, bookingDate: date, startTime: `${String(i + 8).padStart(2, '0')}:00`,
      endTime: `${String(i + 9).padStart(2, '0')}:00`, isAvailable: true,
      pricing: { currency: 'PHP', amount: 600 }, isNightRate: false,
    }))])) } };
}
export function availabilityCells(date = availabilityDate): Cell[] {
  return Array.from({ length: 112 }, (_, i) => ({ court: i % 7 + 1, hour: `${String(8 + Math.floor(i / 7)).padStart(2, '0')}:00`,
    date, state: 'OPEN', label: '' }));
}
