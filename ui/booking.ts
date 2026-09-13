import { writeFileSync, renameSync } from 'node:fs';
import { BookingSetupSchema, loadConfig, calculateTarget, planFingerprint, type BookingSetup, type Config } from '../src/config.js';
export const defaultSetup: BookingSetup = { COURT_COUNT:1, START_TIME: '08:00', DURATION_HOURS: 2, PREFERRED_COURTS: [7,6,5,4,3,2,1], FALLBACK_COURTS: [], FALLBACK_TIMES: [], MAX_PRICE: 1200, MAX_SELECTION_ATTEMPTS: 3 };
export function bookingView(c: Config) {
  const target = calculateTarget(c);
  const setup = BookingSetupSchema.parse({ COURT_COUNT:c.COURT_COUNT, START_TIME:c.START_TIME, DURATION_HOURS:c.DURATION_HOURS, PREFERRED_COURTS:[...c.PREFERRED_COURTS,...c.FALLBACK_COURTS], FALLBACK_COURTS:[], FALLBACK_TIMES:c.FALLBACK_TIMES, MAX_PRICE:c.MAX_PRICE, MAX_SELECTION_ATTEMPTS:c.MAX_SELECTION_ATTEMPTS });
  return { setup, targetDate:target.targetDate, releaseMs:target.releaseMs, preferences:target.preferences, playerConfigured:true, fingerprint:planFingerprint(c),
    slots:target.preferences[0]!.hours.map(h => `${h}–${String(Number(h.slice(0,2))+1).padStart(2,'0')}:00`) };
}
export type BookingView = ReturnType<typeof bookingView>;
export function readBooking(): BookingView { return bookingView(loadConfig()); }
export function saveBooking(input: unknown) {
  const setup = BookingSetupSchema.parse(input);
  writeFileSync('config.local.json.tmp', JSON.stringify(setup, null, 2) + '\n');
  renameSync('config.local.json.tmp', 'config.local.json');
  return readBooking();
}
export function describePlan(plan: BookingView) {
  const s=plan.setup;
  return `${s.COURT_COUNT === 2 ? `2 courts / SAME TIME BLOCK\nMaximum per court: PHP ${s.MAX_PRICE}\nMaximum possible combined: PHP ${2*s.MAX_PRICE}\n` : ''}Target: ${plan.targetDate}\nPrimary slots: ${plan.slots.join(', ')}\nCourt order: ${s.PREFERRED_COURTS.join(' → ')}\nFallback starts: ${s.FALLBACK_TIMES.join(', ') || 'None'}\nDuration: ${s.DURATION_HOURS} hours\nMaximum: PHP ${s.MAX_PRICE}\nCandidate attempts: ${s.MAX_SELECTION_ATTEMPTS}\nPlayer information: Configured`;
}
