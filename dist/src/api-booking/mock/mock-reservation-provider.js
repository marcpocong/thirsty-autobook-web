export class MockReservationProvider {
    scenario;
    now;
    holdDurationMs;
    kind = 'mock-reservation-provider';
    submissions = [];
    constructor(scenario, now, holdDurationMs = 600_000) {
        this.scenario = scenario;
        this.now = now;
        this.holdDurationMs = holdDurationMs;
    }
    async submit(submission) {
        this.submissions.push(structuredClone(submission));
        const expiration = new Date(this.now.getTime() + this.holdDurationMs).toISOString();
        const holds = submission.plan.chunks.flatMap((chunk, chunkIndex) => chunk.courts.map(court => ({
            synthetic: true, holdId: `synthetic-hold-${submission.runId}-${chunkIndex}-${court.court}`,
            intentId: submission.intentId, facilityId: 'offline-fixture-facility', chunkIndex, court: court.court,
            spaceId: court.spaceId, date: court.date, startTime: court.startTime, endTime: court.endTime,
            durationMinutes: court.durationMinutes, currency: court.currency, amount: court.price,
            status: 'pending', paymentStatus: 'pending', holdExpiresAt: expiration,
        })));
        switch (this.scenario) {
            case 'verified': return { kind: 'verified-pending-hold', synthetic: true, holds };
            case 'conflict': return { kind: 'conflict', synthetic: true, code: 'RESERVATION_CONFLICT' };
            case 'validation-failure': return { kind: 'validation-failure', synthetic: true, code: 'RESERVATION_VALIDATION_FAILED' };
            case 'unknown': return { kind: 'unknown-outcome', synthetic: true, code: 'SUBMISSION_OUTCOME_UNKNOWN', reconciliationRequired: true };
            case 'partial': return { kind: 'partial-success', synthetic: true, holds: holds.slice(0, 1), failedCourts: holds.slice(1).map(hold => ({ chunkIndex: hold.chunkIndex, court: hold.court })), reconciliationRequired: true };
            case 'expired': return { kind: 'expired-hold', synthetic: true, holds: holds.map(hold => ({ ...hold, holdExpiresAt: new Date(this.now.getTime() - 1).toISOString() })), code: 'HOLD_EXPIRED' };
        }
    }
}
//# sourceMappingURL=mock-reservation-provider.js.map