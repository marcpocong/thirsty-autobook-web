import { parseAvailability } from './availability-parser.js';
import { planBooking } from './booking-planner.js';
import { OndaLiveAvailabilityProvider, THIRSTY_PICKLE_FACILITY_ID } from './live-availability-provider.js';
import { selectedTwoHours } from './two-hour-reservation.js';
import { acquireFreshSlotProofs } from './slot-proofs.js';

// Read-only preparation. Proof values never leave this process or appear in output.
const date = process.argv[2] ?? '';
const startTime = process.argv[3] ?? '';
const court = Number(process.argv[4]);
const maximumAmount = Number(process.argv[5]);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !/^([01]\d|2[0-2]):00$/.test(startTime ?? '') ||
  !Number.isInteger(court) || court < 1 || court > 7 || !Number.isFinite(maximumAmount) || maximumAmount <= 0) {
  console.error('Usage: npx tsx src/api-booking/verify-candidate.ts YYYY-MM-DD HH:00 COURT MAX_PHP');
  process.exit(2);
}
const clientId = '532c276d-fa48-48d2-9c16-91e0ad0125fa';
const started = performance.now();
try {
  const envelope = await new OndaLiveAvailabilityProvider().getAvailability({ startDate: date, endDate: date });
  const snapshot = parseAvailability(envelope.raw, { startDate: date, endDate: date, capturedAt: envelope.capturedAt,
    fixtureKind: 'live', label: envelope.label, now: new Date(), maximumAgeMs: 15_000 });
  const plan = planBooking(snapshot, { mode: 'standard', targetDate: date, durationHours: 2, preferredStartTimes: [startTime!],
    fallbackStartTimes: [], courtPriority: [court], fallbackCourts: [], exactCourts: [[court]], courtCount: 1,
    maximumTotalPrice: maximumAmount, currency: 'PHP' });
  const hours = selectedTwoHours(plan);
  const availabilityMs = Math.round(performance.now() - started);
  const response = await acquireFreshSlotProofs(hours, { clientId, facilityId: THIRSTY_PICKLE_FACILITY_ID,
    transport: { async checkSlot(request) {
      const result = await fetch('https://app.onda.fit/api/public/is-slot-available', { method: 'POST',
        credentials: 'omit', redirect: 'error', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(request), signal: AbortSignal.timeout(10_000) });
      if (result.status !== 200 || !result.headers.get('content-type')?.toLowerCase().includes('application/json'))
        throw Error('SLOT_HTTP_FAILED');
      return result.json() as Promise<unknown>;
    } } });
  console.log(JSON.stringify({ mode: 'READ_ONLY_CANDIDATE_VERIFICATION', capturedAt: snapshot.capturedAt,
    court, date, startTime: plan.startTime, endTime: plan.endTime, hourlyPrices: plan.courts[0]!.slots.map(slot => slot.price),
    totalPrice: plan.totalPrice, slotProofs: response.length, availabilityMs,
    proofStageMs: Math.round(performance.now() - started - availabilityMs), totalMs: Math.round(performance.now() - started) }));
} catch (error) {
  console.error(error instanceof Error && 'code' in error ? String(error.code) : 'CANDIDATE_VERIFICATION_FAILED');
  process.exitCode = 1;
}
