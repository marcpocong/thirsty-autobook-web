import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { discoverApiAvailability } from './api-booking/availability-engine.js';
import { firstUnjournaledAvailableCandidate } from './api-booking/candidate-journal.js';
import { standardCheckoutChunks } from './api-booking/extended-checkout.js';
import { standardPlanJournalKeys } from './api-booking/two-hour-reservation.js';
import { buildStandardPublicCheckoutRequest, validatePublicCheckoutResponse, type PublicCheckoutRequest } from './api-booking/public-checkout.js';
import { checkoutDiagnostic } from './api-booking/checkout-diagnostics.js';
import { DurableSubmissionJournal } from './api-booking/durable-submission-journal.js';
import type { AvailabilityProvider } from './api-booking/availability-provider.js';
import type { BookingPlan, BookingPreferences } from './api-booking/types.js';
import { COURT_REGISTRY, FACILITY_ID, type Wing } from './court-registry.js';
import { compileObjective, evaluateObjectiveOutcome, type AttemptOutcome, type BookingObjective, type NormalCheckoutStep } from './booking-objective.js';

/**
 * OFFLINE SIMULATION of the Normal (fresh-proof) strategy for the exact Booking Setup objective. Real modules run:
 * availability parsing and freshness, candidate planning, the durable candidate journal, checkout chunking, the
 * standard checkout request builder, the response validator and journal settlement. Only the provider is synthetic:
 * availability comes from a fixture and checkout responses are local fixtures. No browser, network, customer
 * profile or production journal is used. Proofs are synthetic strings and never reach Onda.
 */
export const NORMAL_LAB_SCENARIOS = ['NORMAL_SUCCESS', 'ALL_REJECTED', 'PARTIAL_COMPLETION', 'PAYMENT_IN_PROGRESS', 'THROTTLE', 'UNKNOWN',
  'WRONG_WING', 'MISSING_AVAILABILITY', 'STALE_AVAILABILITY', 'DUPLICATE_TARGET'] as const;
export type NormalLabScenario = typeof NORMAL_LAB_SCENARIOS[number];
export interface NormalLabStep { step: number; wing: Wing; worker: string; courts: number[]; start: string; durationHours: number; state: string; code?: string; localMs: number }

function fixtureAvailability(wing: Wing, date: string, open: (court: number, hour: number) => boolean) {
  const slotsBySpace: Record<string, unknown[]> = {};
  for (const court of COURT_REGISTRY.filter(c => c.wing === wing)) slotsBySpace[court.spaceId] = Array.from({ length: 16 }, (_, index) => {
    const hour = 8 + index, start = `${String(hour).padStart(2, '0')}:00`, end = hour === 23 ? '24:00' : `${String(hour + 1).padStart(2, '0')}:00`;
    return { date, bookingDate: date, startTime: start, endTime: end, isAvailable: open(court.number, hour), isNightRate: hour >= 16, isNextDay: false,
      pricing: { currency: 'PHP', amount: hour >= 16 ? 700 : 600 } };
  });
  return { success: true, data: { facilityId: FACILITY_ID, dates: { [date]: true }, slotsBySpace } };
}
/** Pending-hold fixture mirroring the validated provider shape: one booking per hour, one session per court. */
export function simulatedNormalPending(request: PublicCheckoutRequest, serial: number, now = Date.now()) {
  const refs = [...new Set(request.items.map(item => item.sessionRef))], expires = new Date(now + 600_000).toISOString();
  const ids = request.items.map((_, i) => `offline-${serial}-${i}`), numbers = request.items.map((_, i) => `offline-number-${serial}-${i}`);
  const sessionId = (ref: string) => `offline-session-${serial}-${ref}`, total = request.items.reduce((sum, item) => sum + item.chargedAmount, 0);
  return { success: true,
    bookings: request.items.map((item, i) => ({ id: ids[i], booking_no: numbers[i], customer_id: request.customerId, space_id: item.spaceId, facility_id: item.facilityId, date: item.date,
      start_time: `${item.startTime}:00`, end_time: `${item.endTime}:00`, duration: 60, rate: item.rate, guest_count: 1, booking_status: 'pending', payment_status: 'pending',
      booking_session_id: sessionId(item.sessionRef), hold_expires_at: expires })),
    bookingSessions: refs.map(ref => { const items = request.items.filter(item => item.sessionRef === ref);
      return { requestSessionRef: ref, bookingSessionId: sessionId(ref), facilityId: request.facilityId, spaceId: items[0]!.spaceId, date: items[0]!.date,
        startTime: `${items[0]!.startTime}:00`, endTime: `${items.at(-1)!.endTime}:00`, durationHours: items.length, bookingIds: request.items.flatMap((item, i) => item.sessionRef === ref ? [ids[i]] : []) }; }),
    transaction: { id: `offline-transaction-${serial}`, reference: numbers[0], amount: total, status: 'pending' }, trustedTotalAmount: total };
}
const customer = (worker: string) => ({ clientId: `00000000-0000-4000-8000-${String(worker.charCodeAt(0)).padStart(12, '0')}`,
  customerId: `00000000-0000-4000-9000-${String(worker.charCodeAt(0)).padStart(12, '0')}`, customerEmail: `offline-${worker}@example.invalid`, customerPhone: '09000000000',
  customerFirstName: 'Offline', customerLastName: 'Fixture' });

export async function runNormalLab(input: { objective: BookingObjective; scenario: NormalLabScenario; nowMs?: number }, options: { directory: string; runId: string; isAborted: () => boolean; onPhase?: (phase: string) => void }) {
  if (!NORMAL_LAB_SCENARIOS.includes(input.scenario)) throw Error('LAB_REQUEST_INVALID');
  if (process.cwd() !== options.directory) throw Error('LAB_ISOLATED_CWD_REQUIRED');
  const nowMs = input.nowMs ?? Date.now();
  const compiled = compileObjective(input.objective, { nowMs });
  if (compiled.strategy !== 'NORMAL') throw Error('LAB_NORMAL_STRATEGY_REQUIRED');
  if (compiled.problems.length) throw Error(`LAB_PLAN_INVALID: ${compiled.problems.join(' ')}`);
  const steps: NormalCheckoutStep[] = compiled.normalSteps.length ? compiled.normalSteps : compiled.generalRelease ? [{ index: 0, wing: 'MANGO', date: input.objective.wings.MANGO.bookingDate,
    start: compiled.generalRelease.START_TIME, fallbackStarts: compiled.generalRelease.FALLBACK_TIMES, durationHours: compiled.generalRelease.DURATION_HOURS, courtCount: compiled.generalRelease.COURT_COUNT,
    priority: compiled.generalRelease.PREFERRED_COURTS, exact: null, workers: ['A', 'B', 'C', 'D'].slice(0, Math.ceil(compiled.generalRelease.COURT_COUNT / 2)), method: compiled.method, maximum: input.objective.price.maxPerCheckout, expectedHolds: Math.ceil(compiled.generalRelease.COURT_COUNT / 2) }] : [];
  const rows: NormalLabStep[] = [], outcomes: AttemptOutcome[] = [], warnings: string[] = ['Availability and checkout responses are local fixtures. Proofs are synthetic and never sent. Local timing is not provider timing.'];
  const journals = join(options.directory, 'journals'), achieved = new Map<Wing, Set<number>>();
  let globalStop: string | undefined, serial = 0, planned = 0, initiated = 0;
  const quota = compiled.quota;
  const wingDone = (wing: Wing) => quota.scope === 'PER_WING' ? (achieved.get(wing)?.size ?? 0) >= (quota.wings[wing]?.ideal ?? 1)
    : [...achieved.values()].reduce((n, set) => n + set.size, 0) >= (quota.overall?.ideal ?? 1);
  const journalFor = (key: string) => new DurableSubmissionJournal(join(journals, key));
  for (const step of steps) {
    if (options.isAborted()) throw Error('LAB_STOPPED');
    const started = performance.now();
    const skip = globalStop ?? (wingDone(step.wing) ? 'QUOTA_REACHED_FOR_WING' : undefined);
    if (skip) { rows.push({ step: step.index + 1, wing: step.wing, worker: step.workers.join('+'), courts: step.exact ?? [], start: step.start, durationHours: step.durationHours, state: 'SUPPRESSED', code: skip, localMs: 0 }); continue; }
    options.onPhase?.(`Checkout ${step.index + 1}/${steps.length}: ${step.wing === 'MANGO' ? 'Mango' : 'Buko'} · offline`);
    const startHour = Number(step.start.slice(0, 2));
    const requested = (court: number, hour: number) => (step.exact ?? step.priority).includes(court) && hour >= startHour && hour < startHour + step.durationHours;
    const missing = input.scenario === 'MISSING_AVAILABILITY';
    const raw = fixtureAvailability(step.wing, step.date, (court, hour) => !missing && (requested(court, hour) || (!step.exact && hour >= startHour && hour < startHour + step.durationHours)));
    const capturedAt = new Date(input.scenario === 'STALE_AVAILABILITY' ? Date.now() - 20_000 : Date.now()).toISOString();
    const provider: AvailabilityProvider = { kind: 'fixture-backed-mock', getAvailability: async () => ({ raw, capturedAt, fixtureKind: 'synthetic', label: 'OFFLINE NORMAL FIXTURE' }) };
    const preferences: BookingPreferences = { wing: step.wing, mode: 'standard', targetDate: step.date, durationHours: step.durationHours, preferredStartTimes: [step.start],
      fallbackStartTimes: step.fallbackStarts, courtPriority: step.priority, fallbackCourts: [], ...(step.exact ? { exactCourts: [step.exact] } : {}),
      courtCount: step.courtCount as BookingPreferences['courtCount'], maximumTotalPrice: step.maximum ?? Infinity, currency: 'PHP' };
    let plan: BookingPlan | undefined;
    try {
      const discovery = await discoverApiAvailability(provider, preferences);
      if (input.scenario === 'DUPLICATE_TARGET' && discovery.candidates[0]) {
        // A retained record for the first candidate must make the shared journal skip it.
        const [key] = standardPlanJournalKeys(standardCheckoutChunks(discovery.candidates[0])[0]!, FACILITY_ID);
        const j = journalFor(key!); await j.begin(key!, new Date(), { executionMode: 'OFFLINE_INTERCEPTED', attemptId: key!, planFingerprint: key!, targetDate: step.date, courtIds: [], hourlyBoundaries: [], expectedBookingCount: 1, maximumAmount: 0, stage: 'dispatching' });
        await j.mark(key!, 'unknown', new Date(), undefined, undefined, 'OFFLINE_RETAINED_UNKNOWN');
      }
      const selected = await firstUnjournaledAvailableCandidate(discovery.snapshot, preferences, FACILITY_ID, async key => (await journalFor(key).peekDisposition(key)) === 'blocked');
      if (!selected) throw Error(input.scenario === 'DUPLICATE_TARGET' ? 'DUPLICATE_LOGICAL_BOOKING_BLOCKED' : 'API_NO_UNUSED_CANDIDATE');
      plan = selected.plan;
    } catch (error) {
      rows.push({ step: step.index + 1, wing: step.wing, worker: step.workers.join('+'), courts: step.exact ?? [], start: step.start, durationHours: step.durationHours, state: 'NOT_DISPATCHED', code: (error as Error).message.slice(0, 80), localMs: performance.now() - started });
      continue;
    }
    const chunks = standardCheckoutChunks(plan);
    planned += chunks.length;
    for (const [index, chunk] of chunks.entries()) {
      const worker = step.workers[index] ?? step.workers.at(-1)!, courts = chunk.courts.map(c => c.court);
      const keys = standardPlanJournalKeys(chunk, FACILITY_ID), journalsHere = keys.map(journalFor);
      if (globalStop) { rows.push({ step: step.index + 1, wing: step.wing, worker, courts, start: chunk.startTime, durationHours: chunk.durationHours, state: 'SUPPRESSED', code: globalStop, localMs: 0 }); continue; }
      const proofs = chunk.courts.flatMap(court => court.slots.map(slot => ({ spaceId: slot.spaceId, date: slot.date, startTime: slot.startTime, endTime: slot.endTime,
        availabilityProof: `offline-synthetic-proof-${slot.spaceId.slice(0, 8)}-${slot.startTime}`, requestedAt: capturedAt, receivedAt: capturedAt })));
      const request: PublicCheckoutRequest = buildStandardPublicCheckoutRequest(chunk, customer(worker), FACILITY_ID, proofs);
      for (const [k, key] of keys.entries()) await journalsHere[k]!.begin(key, new Date(), { executionMode: 'OFFLINE_INTERCEPTED', wing: step.wing, spaceIds: [chunk.courts[k]!.spaceId], attemptId: key, planFingerprint: compiled.fingerprint,
        targetDate: step.date, courtIds: [chunk.courts[k]!.court], hourlyBoundaries: chunk.courts[k]!.slots.map(s => ({ startTime: s.startTime, endTime: s.endTime })), expectedBookingCount: chunk.courts[k]!.slots.length, maximumAmount: chunk.totalPrice, stage: 'dispatching' });
      initiated++; serial++;
      let status = 409, body: unknown = { success: false, error: 'Slot unavailable (offline fixture)' };
      const succeeds = input.scenario === 'NORMAL_SUCCESS' || input.scenario === 'DUPLICATE_TARGET' || (input.scenario === 'PARTIAL_COMPLETION' && serial === 1) ||
        (input.scenario === 'PAYMENT_IN_PROGRESS' && serial === 1) || input.scenario === 'WRONG_WING';
      if (succeeds) { status = 200; body = simulatedNormalPending(request, serial); if (input.scenario === 'WRONG_WING') (body as ReturnType<typeof simulatedNormalPending>).bookings[0]!.space_id = 'wrong-wing-space'; }
      if (input.scenario === 'PAYMENT_IN_PROGRESS' && serial > 1) body = { success: false, error: 'Payment already in progress' };
      if (input.scenario === 'THROTTLE') { status = 429; body = { success: false, error: 'Too many requests' }; }
      if (input.scenario === 'UNKNOWN') { status = 200; body = { success: true }; }
      let state: string, code: string | undefined;
      if (status === 200) {
        try {
          const verified = validatePublicCheckoutResponse(body, request, chunk, new Date(), step.maximum ?? undefined);
          for (const [k, key] of keys.entries()) await journalsHere[k]!.mark(key, 'verified', new Date(), undefined, { success: true, bookingIds: verified.bookingIds, bookingNumbers: verified.bookingNumbers,
            bookingSessionIds: verified.sessionIds, holdExpiresAt: [verified.holdExpiresAt], transactionId: verified.transactionId, trustedTotalAmount: verified.trustedTotalAmount, validationCode: 'OFFLINE_ONLY' });
          state = 'HOLD_VERIFIED';
          for (const court of courts) { const set = achieved.get(step.wing) ?? new Set<number>(); set.add(court); achieved.set(step.wing, set); }
          for (const court of chunk.courts) outcomes.push({ wing: step.wing, court: court.court, date: step.date, start: chunk.startTime, end: chunk.endTime, state, transactionId: `${verified.transactionId}:${court.court}`, payment: 'PENDING' });
        } catch (error) {
          state = 'UNKNOWN'; code = (error as Error).message;
          for (const [k, key] of keys.entries()) await journalsHere[k]!.mark(key, 'unknown', new Date(), undefined, undefined, 'OFFLINE_RESPONSE_UNVERIFIED');
          globalStop = 'OBJECTIVE_OUTCOME_UNKNOWN';
          for (const court of chunk.courts) outcomes.push({ wing: step.wing, court: court.court, date: step.date, start: chunk.startTime, end: chunk.endTime, state, code });
        }
      } else {
        const diagnostic = checkoutDiagnostic({ status, contentType: 'application/json', body: JSON.stringify(body) });
        for (const [k, key] of keys.entries()) await journalsHere[k]!.mark(key, 'rejected', new Date(), diagnostic, undefined, 'OFFLINE_REJECTED');
        state = 'REJECTED';
        code = diagnostic.errorHint === 'payment-in-progress' ? 'PAYMENT_IN_PROGRESS_STOP' : status === 429 ? 'PROVIDER_THROTTLE_STOP' : 'SLOT_REJECTED';
        if (code !== 'SLOT_REJECTED') globalStop = code;
        for (const court of chunk.courts) outcomes.push({ wing: step.wing, court: court.court, date: step.date, start: chunk.startTime, end: chunk.endTime, state, code });
      }
      rows.push({ step: step.index + 1, wing: step.wing, worker, courts, start: chunk.startTime, durationHours: chunk.durationHours, state, ...(code ? { code } : {}), localMs: performance.now() - started });
    }
  }
  const objectiveOutcome = evaluateObjectiveOutcome(quota, outcomes);
  return { label: 'OFFLINE / INTERCEPTED' as const, environment: 'OFFLINE_SIMULATION' as const, strategy: 'NORMAL' as const, method: compiled.method, runId: options.runId, scenario: input.scenario,
    planned, initiated, omitted: planned - initiated, steps: rows, outcomes, objectiveOutcome, warnings, authorizationFingerprint: compiled.fingerprint };
}
