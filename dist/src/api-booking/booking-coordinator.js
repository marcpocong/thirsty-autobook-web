import { performance } from 'node:perf_hooks';
import { parseAvailability } from './availability-parser.js';
import { planBooking } from './booking-planner.js';
import { logicalBookingId, MemoryIntentStore } from './intent-store.js';
const key = (chunkIndex, court) => `${chunkIndex}/${court}`;
const minor = (amount) => Math.round(amount * 100);
function validateHolds(holds, plan, intentId, now, allowExpired = false) {
    const expected = new Map(plan.chunks.flatMap((chunk, i) => chunk.courts.map(court => [key(i, court.court), court])));
    const ids = new Set();
    const keys = new Set();
    for (const hold of holds) {
        const court = expected.get(key(hold.chunkIndex, hold.court));
        if (!court || !hold.holdId || ids.has(hold.holdId) || keys.has(key(hold.chunkIndex, hold.court)) ||
            hold.synthetic !== true || hold.intentId !== intentId || hold.facilityId !== 'offline-fixture-facility' ||
            hold.spaceId !== court.spaceId || hold.date !== court.date || hold.startTime !== court.startTime ||
            hold.endTime !== court.endTime || hold.durationMinutes !== court.durationMinutes ||
            hold.currency !== court.currency || minor(hold.amount) !== minor(court.price) ||
            hold.status !== 'pending' || hold.paymentStatus !== 'pending' ||
            !Number.isFinite(Date.parse(hold.holdExpiresAt)) || (!allowExpired && Date.parse(hold.holdExpiresAt) <= now.getTime()))
            return false;
        ids.add(hold.holdId);
        keys.add(key(hold.chunkIndex, hold.court));
    }
    return true;
}
export class ApiBookingCoordinator {
    availability;
    reservation;
    checkout;
    intents;
    activeRuns = new Set();
    attemptedRuns = new Set();
    constructor(availability, reservation, checkout, intents = new MemoryIntentStore()) {
        this.availability = availability;
        this.reservation = reservation;
        this.checkout = checkout;
        this.intents = intents;
    }
    async coordinate(options) {
        if (this.activeRuns.has(options.runId) || this.attemptedRuns.has(options.runId))
            throw Error('DUPLICATE_RESERVATION_SUBMISSION_BLOCKED');
        const intentId = logicalBookingId(options.preferences);
        const prior = this.intents.get(intentId);
        if (prior)
            throw Error(prior.state === 'unknown' || prior.state === 'partial' || prior.state === 'checkout-failed' ? 'AUTHORITATIVE_RECONCILIATION_REQUIRED' : 'DUPLICATE_LOGICAL_BOOKING_BLOCKED');
        this.activeRuns.add(options.runId);
        try {
            return await this.coordinateOnce(options, intentId);
        }
        finally {
            this.activeRuns.delete(options.runId);
        }
    }
    async coordinateOnce(options, intentId) {
        const clock = options.clock ?? (options.now ? () => new Date(options.now) : () => new Date());
        const timings = { label: 'MOCK timing', availabilityMs: 0, parsingMs: 0, planningMs: 0, reservationMs: 0, checkoutMs: 0 };
        let started = performance.now();
        const envelope = await this.availability.getAvailability({ startDate: options.preferences.targetDate, endDate: options.preferences.targetDate });
        timings.availabilityMs = performance.now() - started;
        const parse = () => parseAvailability(envelope.raw, { startDate: options.preferences.targetDate, endDate: options.preferences.targetDate,
            capturedAt: envelope.capturedAt, fixtureKind: envelope.fixtureKind, label: envelope.label,
            now: clock(), maximumAgeMs: options.maximumSnapshotAgeMs });
        started = performance.now();
        const snapshot = parse();
        timings.parsingMs = performance.now() - started;
        started = performance.now();
        const plan = planBooking(snapshot, options.preferences);
        timings.planningMs = performance.now() - started;
        parse(); // Recheck freshness immediately before any state-changing submission.
        this.intents.begin(intentId, options.runId);
        this.attemptedRuns.add(options.runId);
        started = performance.now();
        let result;
        try {
            result = await this.reservation.submit({ runId: options.runId, intentId, plan, integration: 'mock-only' });
        }
        catch {
            result = { kind: 'unknown-outcome', synthetic: true, code: 'SUBMISSION_OUTCOME_UNKNOWN', reconciliationRequired: true };
        }
        timings.reservationMs = performance.now() - started;
        const afterSubmit = clock();
        const unknown = () => {
            this.intents.set(intentId, 'unknown');
            const reservation = { kind: 'unknown-outcome', synthetic: true, code: 'SUBMISSION_OUTCOME_UNKNOWN', reconciliationRequired: true };
            return { kind: 'stopped', synthetic: true, reason: 'unknown-outcome', reservation, reconciliationRequired: true, timings };
        };
        const stop = (reservation, reconciliationRequired, holds) => ({ kind: 'stopped', synthetic: true, reason: reservation.kind, reservation, holds, reconciliationRequired, timings });
        if (result.kind === 'unknown-outcome')
            return unknown();
        if (result.kind === 'conflict' || result.kind === 'validation-failure') {
            this.intents.set(intentId, 'confirmed-failure');
            return stop(result, false);
        }
        if (result.kind === 'partial-success') {
            const expected = new Set(plan.chunks.flatMap((chunk, i) => chunk.courts.map(c => key(i, c.court))));
            const held = new Set(result.holds.map(h => key(h.chunkIndex, h.court)));
            const failed = new Set(result.failedCourts.map(f => key(f.chunkIndex, f.court)));
            if (!result.holds.length || !result.failedCourts.length || !validateHolds(result.holds, plan, intentId, afterSubmit, true) ||
                held.size !== result.holds.length || failed.size !== result.failedCourts.length ||
                [...held].some(k => failed.has(k)) || [...expected].some(k => !held.has(k) && !failed.has(k)) ||
                [...failed].some(k => !expected.has(k)))
                return unknown();
            this.intents.set(intentId, 'partial', result.holds);
            return stop(result, true, result.holds);
        }
        if (result.kind === 'expired-hold') {
            if (!validateHolds(result.holds, plan, intentId, afterSubmit, true) || result.holds.length !== plan.courts.length)
                return unknown();
            this.intents.set(intentId, 'held', result.holds);
            return stop(result, true, result.holds);
        }
        if (!validateHolds(result.holds, plan, intentId, afterSubmit, true) || result.holds.length !== plan.courts.length)
            return unknown();
        this.intents.set(intentId, 'held', result.holds); // Retain evidence before checkout preparation.
        if (result.holds.some(h => Date.parse(h.holdExpiresAt) <= afterSubmit.getTime())) {
            const expired = { kind: 'expired-hold', synthetic: true, holds: result.holds, code: 'HOLD_EXPIRED' };
            return stop(expired, true, result.holds);
        }
        started = performance.now();
        try {
            const beforeCheckout = clock();
            if (result.holds.some(h => Date.parse(h.holdExpiresAt) <= beforeCheckout.getTime()))
                throw Error('HOLD_EXPIRED');
            const handoff = await this.checkout.prepare(result.holds, beforeCheckout);
            const afterCheckout = clock();
            if (handoff.kind !== 'mock-checkout-ready' || handoff.synthetic !== true || handoff.paymentAutomated !== false ||
                handoff.sessions.length !== result.holds.length || new Set(handoff.sessions.map(s => s.holdId)).size !== result.holds.length ||
                new Set(handoff.sessions.map(s => s.sessionId)).size !== result.holds.length ||
                handoff.sessions.some(s => !s.sessionId || s.synthetic !== true || s.action !== 'manual-payment-required' ||
                    !result.holds.some(h => h.holdId === s.holdId && Date.parse(s.expiresAt) <= Date.parse(h.holdExpiresAt)) ||
                    !Number.isFinite(Date.parse(s.expiresAt)) || Date.parse(s.expiresAt) <= afterCheckout.getTime()))
                throw Error('CHECKOUT_HANDOFF_INVALID');
            this.intents.set(intentId, 'handoff-ready', result.holds);
            return { kind: 'manual-payment-required', synthetic: true, plan, holds: result.holds, handoff, timings };
        }
        catch {
            this.intents.set(intentId, 'checkout-failed', result.holds);
            return { kind: 'stopped', synthetic: true, reason: 'checkout-preparation-failed', reservation: result,
                holds: result.holds, reconciliationRequired: true, timings };
        }
        finally {
            timings.checkoutMs = performance.now() - started;
        }
    }
}
//# sourceMappingURL=booking-coordinator.js.map