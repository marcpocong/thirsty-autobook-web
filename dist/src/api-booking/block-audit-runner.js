import { z } from 'zod';
import { emitUiEvent } from '../ui-events.js';
import { OndaLiveAvailabilityProvider } from './live-availability-provider.js';
import { parseAvailability } from './availability-parser.js';
import { prooflessCourtHourStatuses } from './proofless-checkout.js';
import { readPublicBookingRecords } from './public-bookings.js';
import { loadObservationConfig, releaseMsForTargetDate } from '../config.js';
import { networkNowMs } from '../network-clock.js';
const input = z.object({ date: z.iso.date() }).strict().parse(JSON.parse(process.argv[2] ?? '{}'));
async function readAvailability(date) {
    try {
        const envelope = await new OndaLiveAvailabilityProvider({ allowIncompleteRange: true })
            .getAvailability({ startDate: date, endDate: date });
        return parseAvailability(envelope.raw, { startDate: date, endDate: date, capturedAt: envelope.capturedAt,
            fixtureKind: envelope.fixtureKind, label: envelope.label, now: new Date(), maximumAgeMs: 15_000,
            requireCompleteRange: false });
    }
    catch {
        return undefined;
    }
}
async function main() {
    // A missing date is "not yet published" only for Onda's empty response observed before its release instant.
    const releaseMs = releaseMsForTargetDate(loadObservationConfig(), input.date);
    const [read, publicRecords] = await Promise.all([
        readAvailability(input.date).then(snapshot => ({ snapshot, observedAtMs: networkNowMs() })), readPublicBookingRecords(input.date)
    ]);
    const cells = prooflessCourtHourStatuses(read.snapshot, input.date, publicRecords.blocks, publicRecords.failedCourts, { releaseMs, observedAtMs: read.observedAtMs });
    emitUiEvent({ type: 'blockAudit', date: input.date, cells });
}
main().catch(error => {
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.message)
        ? error.message : 'BLOCK_AUDIT_FAILED';
    console.error(code);
    process.exitCode = 1;
});
//# sourceMappingURL=block-audit-runner.js.map