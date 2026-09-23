import { z } from 'zod';
import { emitUiEvent } from '../ui-events.js';
import { OndaLiveAvailabilityProvider } from './live-availability-provider.js';
import { COURT_TO_SPACE_ID, parseAvailability } from './availability-parser.js';
import { prooflessCourtHourStatuses } from './special-direct-checkout.js';
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
async function readPublicBlocks(date) {
    const results = await Promise.all(Array.from({ length: 7 }, (_, index) => index + 1).map(async (court) => {
        const spaceId = COURT_TO_SPACE_ID[court];
        try {
            const url = new URL('/api/public/spaces/bookings', 'https://app.onda.fit');
            url.searchParams.set('spaceIds', spaceId);
            url.searchParams.set('date', date);
            const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store',
                signal: AbortSignal.timeout(5_000) });
            if (!response.ok)
                throw Error(`HTTP_${response.status}`);
            const value = await response.json();
            const raw = value.data && typeof value.data === 'object' && !Array.isArray(value.data)
                ? value.data[spaceId] : value.data;
            const blocks = (Array.isArray(raw) ? raw : []).flatMap(record => {
                if (!record || typeof record !== 'object')
                    return [];
                const item = record;
                const start = typeof item.startTime === 'string' ? item.startTime.slice(0, 5) : '';
                const end = typeof item.endTime === 'string' ? item.endTime.slice(0, 5) : '';
                return item.date === date && /^([01]\d|2[0-3]):[0-5]\d$/.test(start) &&
                    /^([01]\d|2[0-3]):[0-5]\d$/.test(end) && start < end
                    ? [{ court, startTime: start, endTime: end }] : [];
            });
            return { court, blocks, failed: false };
        }
        catch {
            return { court, blocks: [], failed: true };
        }
    }));
    return { blocks: results.flatMap(result => result.blocks),
        failedCourts: results.filter(result => result.failed).map(result => result.court) };
}
async function main() {
    const [snapshot, publicRecords] = await Promise.all([readAvailability(input.date), readPublicBlocks(input.date)]);
    const cells = prooflessCourtHourStatuses(snapshot, input.date, publicRecords.blocks, publicRecords.failedCourts);
    emitUiEvent({ type: 'blockAudit', date: input.date, cells });
}
main().catch(error => {
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.message)
        ? error.message : 'BLOCK_AUDIT_FAILED';
    console.error(code);
    process.exitCode = 1;
});
//# sourceMappingURL=block-audit-runner.js.map