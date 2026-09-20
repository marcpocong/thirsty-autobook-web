import { parseAvailability } from './availability-parser.js';
import { BookingPlanningError, planBooking } from './booking-planner.js';
import { OndaLiveAvailabilityProvider } from './live-availability-provider.js';
import type { BookingPreferences } from './types.js';

// Read-only API-first candidate preview. This entry point has no reservation or checkout import.
const [date, startTime, durationText, courtCountText, maximumText, priorityText] = process.argv.slice(2);
if (!date || !startTime || !durationText || !courtCountText || !maximumText || !priorityText) {
  console.error('Usage: npx tsx src/api-booking/preview-live.ts YYYY-MM-DD HH:00 HOURS COURTS MAX_PHP COURT_PRIORITY_CSV');
  process.exitCode = 2;
} else {
  const durationHours = Number(durationText);
  const courtCount = Number(courtCountText);
  const courtPriority = priorityText.split(',').map(Number);
  const maximum = Number(maximumText);
  if (!/^([01]\d|2[0-3]):00$/.test(startTime) || !Number.isInteger(durationHours) || durationHours < 1 || durationHours > 6 ||
    (courtCount !== 1 && courtCount !== 2) || !Number.isFinite(maximum) || maximum < 0 ||
    !courtPriority.length || courtPriority.some(court => !Number.isInteger(court) || court < 1 || court > 7) ||
    new Set(courtPriority).size !== courtPriority.length) {
    console.error('PREVIEW_ARGUMENTS_INVALID');
    process.exit(2);
  }
  const preferences: BookingPreferences = {
    mode: durationHours > 3 ? 'extended' : 'standard', targetDate: date, durationHours,
    preferredStartTimes: [startTime], fallbackStartTimes: [], courtPriority, fallbackCourts: [],
    courtCount: courtCount as 1 | 2, maximumTotalPrice: maximum, currency: 'PHP',
  };
  try {
    const provider = new OndaLiveAvailabilityProvider();
    const envelope = await provider.getAvailability({ startDate: date, endDate: date });
    const snapshot = parseAvailability(envelope.raw, { startDate: date, endDate: date,
      capturedAt: envelope.capturedAt, fixtureKind: 'live', label: envelope.label,
      now: new Date(), maximumAgeMs: 15_000 });
    try {
      const plan = planBooking(snapshot, preferences);
      console.log(JSON.stringify({ mode: 'READ_ONLY_LIVE_AVAILABILITY', capturedAt: snapshot.capturedAt,
        date: plan.targetDate, availableHours: snapshot.slots.filter(slot => slot.isAvailable).length,
        chunks: plan.chunks.map(chunk => ({ startTime: chunk.startTime, endTime: chunk.endTime,
          courts: chunk.courts.map(court => court.court), totalPrice: chunk.totalPrice })), totalPrice: plan.totalPrice }));
    } catch (error) {
      if (!(error instanceof BookingPlanningError)) throw error;
      console.log(JSON.stringify({ mode: 'READ_ONLY_LIVE_AVAILABILITY', capturedAt: snapshot.capturedAt,
        date, availableHours: snapshot.slots.filter(slot => slot.isAvailable).length, candidate: null, reason: error.code }));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'LIVE_PREVIEW_FAILED');
    process.exitCode = 1;
  }
}
