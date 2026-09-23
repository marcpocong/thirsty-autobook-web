import { writeFileSync, renameSync } from 'node:fs';
import { playerReadiness, BookingSetupSchema, loadConfigWithReconciliation, calculateTarget, planFingerprint } from '../src/config.js';
import { candidatePlans, describeBookingPlan } from '../src/booking-plan.js';
import { SPECIAL_SESSION_MODE, specialSessionDescription } from '../src/api-booking/special-session.js';
export const defaultSetup = { SESSION_MODE: 'normal', BOOKING_METHOD: 'browser', BOOKING_TYPE: 'standard', COURT_COUNT: 1, START_TIME: '08:00', DURATION_HOURS: 2, PREFERRED_COURTS: [7, 6, 5, 4, 3, 2, 1], FALLBACK_COURTS: [], FALLBACK_TIMES: [], MAX_SELECTION_ATTEMPTS: 3 };
export function bookingView(c, fallbackReconciliation = { valid: c.FALLBACK_TIMES, removed: [] }) {
    const target = calculateTarget(c);
    const setup = BookingSetupSchema.parse({ SESSION_MODE: c.SESSION_MODE, BOOKING_METHOD: c.BOOKING_METHOD, BOOKING_TYPE: c.BOOKING_TYPE, COURT_COUNT: c.COURT_COUNT, START_TIME: c.START_TIME, DURATION_HOURS: c.DURATION_HOURS, PREFERRED_COURTS: [...c.PREFERRED_COURTS, ...c.FALLBACK_COURTS], FALLBACK_COURTS: [], FALLBACK_TIMES: c.FALLBACK_TIMES, MAX_SELECTION_ATTEMPTS: c.MAX_SELECTION_ATTEMPTS });
    const players = playerReadiness(c);
    return { setup, fallbackReconciliation, targetDate: target.targetDate, releaseMs: target.releaseMs, preferences: target.preferences, playerConfigured: players.primary, extendedPlayerConfigured: players.extended, thirdPlayerConfigured: players.third, fourthPlayerConfigured: players.fourth, fifthPlayerConfigured: players.fifth, sixthPlayerConfigured: players.sixth, seventhPlayerConfigured: players.seventh, eighthPlayerConfigured: players.eighth, fingerprint: planFingerprint(c),
        slots: target.preferences[0].hours.map(h => `${h}–${String(Number(h.slice(0, 2)) + 1).padStart(2, '0')}:00`) };
}
export function readBooking() { const loaded = loadConfigWithReconciliation(); return bookingView(loaded.config, loaded.fallbackReconciliation); }
export function saveBooking(input) {
    const setup = BookingSetupSchema.parse(input);
    writeFileSync('config.local.json.tmp', JSON.stringify(setup, null, 2) + '\n');
    renameSync('config.local.json.tmp', 'config.local.json');
    return readBooking();
}
export function describePlan(plan) {
    const s = plan.setup;
    if (s.SESSION_MODE === SPECIAL_SESSION_MODE)
        return specialSessionDescription(plan.targetDate) +
            '\nNo fallback courts or times. Each checkout validates its current exact price before dispatch.';
    const plans = candidatePlans({ strategy: s.BOOKING_TYPE, date: plan.targetDate, start: s.START_TIME, duration: s.DURATION_HOURS, courtCount: s.COURT_COUNT, priority: s.PREFERRED_COURTS, fallbackStarts: s.FALLBACK_TIMES });
    const method = s.BOOKING_METHOD === 'browser' ? 'Normal Browser' : s.BOOKING_METHOD === 'hybrid' ? 'Hybrid Availability' : s.BOOKING_METHOD === 'proofless' ? 'Proofless Direct' : 'API-First';
    return describeBookingPlan(plans[0], Infinity) + `\nBooking method: ${method}\nCourt priority: ${s.PREFERRED_COURTS.join(' → ')}\nFallback starts move the whole block: ${s.FALLBACK_TIMES.join(', ') || 'None'}\nValid splits: ${plans.filter(p => p.requestedStart === s.START_TIME).map(p => p.chunks.map(c => c.duration).join('+')).join(' → ')}\nSame courts are prioritized across checkouts when available.\nPlayer information: Configured`;
}
//# sourceMappingURL=booking.js.map