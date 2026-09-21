import { createHash } from 'node:crypto';
// Offline interface and in-memory implementation. This is not cross-process protection.
export class MemoryIntentStore {
    intents = new Map();
    get(id) { return this.intents.get(id); }
    begin(id, runId) {
        if (this.intents.has(id))
            throw Error('DUPLICATE_LOGICAL_BOOKING_BLOCKED');
        const intent = { id, state: 'submitting', holds: [], runId };
        this.intents.set(id, intent);
        return intent;
    }
    set(id, state, holds = []) {
        const intent = this.intents.get(id);
        if (!intent)
            throw Error('BOOKING_INTENT_MISSING');
        intent.state = state;
        intent.holds = structuredClone(holds);
    }
}
export function logicalBookingId(p) {
    const identity = [p.targetDate, p.mode, p.durationHours, p.courtCount,
        [...new Set(p.preferredStartTimes)], [...new Set(p.fallbackStartTimes)],
        p.exactCourts ?? null, [...new Set(p.courtPriority)], [...new Set(p.fallbackCourts)]];
    return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}
//# sourceMappingURL=intent-store.js.map