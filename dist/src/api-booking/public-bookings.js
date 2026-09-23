import { COURT_TO_SPACE_ID } from './availability-parser.js';
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/**
 * Reads Onda's public per-court booking list for one date. Only the court and
 * time range of each record are kept. A failed court is reported, never assumed empty.
 */
export async function readPublicBookingRecords(date, options = {}) {
    const fetcher = options.fetcher ?? fetch, timeoutMs = options.timeoutMs ?? 5_000;
    const results = await Promise.all(Array.from({ length: 7 }, (_, index) => index + 1).map(async (court) => {
        const spaceId = COURT_TO_SPACE_ID[court];
        try {
            const url = new URL('/api/public/spaces/bookings', 'https://app.onda.fit');
            url.searchParams.set('spaceIds', spaceId);
            url.searchParams.set('date', date);
            const response = await fetcher(url, { headers: { Accept: 'application/json' }, cache: 'no-store',
                signal: AbortSignal.timeout(timeoutMs) });
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
                return item.date === date && HHMM.test(start) && HHMM.test(end) && start < end
                    ? [{ court, startTime: start, endTime: end }] : [];
            });
            options.onCourt?.(court, { status: 'SUCCESS', recordCount: blocks.length });
            return { court, blocks, failed: false };
        }
        catch {
            options.onCourt?.(court, { status: 'FAILED', recordCount: 0 });
            return { court, blocks: [], failed: true };
        }
    }));
    return { blocks: results.flatMap(result => result.blocks),
        failedCourts: results.filter(result => result.failed).map(result => result.court) };
}
//# sourceMappingURL=public-bookings.js.map