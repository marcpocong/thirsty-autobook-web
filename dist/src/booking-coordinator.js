import { resolveBookingPlan, bookingPlanKey } from './booking-plan.js';
import { selectCheckoutBundle } from './checkout-selection.js';
import { cleanupOwned } from './dual-coordinator.js';
export async function coordinateBooking(workers, request, grids, maximum, attempts, mode, confirm) {
    if (workers.some((w, i) => w.id !== (i === 0 ? 'A' : 'B')) || workers.length !== (request.strategy === 'standard' ? 1 : 2) || new Set(workers.map(w => w.safety)).size !== workers.length || new Set(workers.map(w => w.port)).size !== workers.length)
        throw Error('BOOKING_ISOLATION_REQUIRED');
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5)
        throw Error('INVALID_SELECTION_LIMIT');
    const excluded = new Set();
    let confirmed = false;
    for (let attempt = 1; attempt <= (request.exact ? 1 : attempts); attempt++) {
        workers.forEach(w => w.safety.fallback());
        const plan = resolveBookingPlan(request, grids, excluded);
        if (!plan)
            throw Error('TARGET_NOT_AVAILABLE');
        if (mode === 'dry')
            return { status: 'AVAILABLE', plan };
        if (confirm && !confirmed) {
            if (!await confirm(plan))
                return { status: 'CANCELLED', plan };
            confirmed = true;
        }
        excluded.add(bookingPlanKey(plan));
        const dispatched = workers.map(() => new Set());
        workers.forEach(w => w.telemetry.mark(attempt === 1 ? 'preferenceResolved' : 'fallbackResolved'));
        const selections = await Promise.allSettled(workers.map((w, i) => selectCheckoutBundle(w.port, request.date, grids[i], plan.chunks[i], maximum, w.safety, dispatched[i], w.telemetry)));
        if (selections.some(s => s.status === 'rejected')) {
            // Unknown state, foreign selection, price and authorization failures never clean up.
            const errors = selections.filter(s => s.status === 'rejected');
            const unsafe = selections.find(s => s.status === 'rejected' && s.reason?.message !== 'SELECTION_CONFLICT');
            if (unsafe?.status === 'rejected') {
                const unsafeIndex = selections.indexOf(unsafe);
                workers[unsafeIndex].telemetry.recordSelectionFailure('SELECTION_COORDINATION', unsafe.reason);
                throw Error('SELECTION_UNSAFE_FOR_RECOVERY', { cause: unsafe.reason });
            }
            const cleaned = await Promise.allSettled(workers.map((w, i) => cleanupOwned(w, request.date, dispatched[i])));
            if (cleaned.some(c => c.status === 'rejected'))
                throw Error('CLEANUP_NOT_VERIFIED');
            grids = await Promise.all(workers.map(w => w.port.read()));
            continue;
        }
        const selected = selections.map(s => { if (s.status !== 'fulfilled')
            throw Error('SELECTION_UNVERIFIED'); return s.value; });
        if (mode === 'selection')
            return { status: 'SELECTION_VERIFIED', plan };
        workers.forEach(w => w.safety.check());
        const holds = await Promise.allSettled(workers.map((w, i) => w.checkout(selected[i])));
        const outcomes = holds.map(h => h.status === 'fulfilled' ? 'PAYMENT HOLD ACTIVE' : 'FAILED');
        const count = holds.filter(h => h.status === 'fulfilled').length;
        return { status: count === workers.length ? 'PAYMENT HOLD ACTIVE' : count ? 'PARTIAL SUCCESS' : 'BOOKING FAILED', plan, outcomes };
    }
    throw Error('SELECTION_ATTEMPTS_EXHAUSTED');
}
//# sourceMappingURL=booking-coordinator.js.map