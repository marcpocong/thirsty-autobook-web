import { MATRIX_COURTS, MATRIX_HOURS } from './api-booking/court-hour-matrix.js';
const ref = (value) => ({ seq: value.seq, requestOffsetMs: value.requestOffsetMs, responseOffsetMs: value.responseOffsetMs });
export const cellKey = (court, hour) => `${court}/${hour}`;
const overlapping = (before, after) => before.responseOffsetMs > after.requestOffsetMs;
/** Decodes one matrix string into code lookups by cell key; unknown or malformed rows stay absent. */
export function decodeMatrix(matrix) {
    const cells = new Map();
    for (const row of (matrix ?? '').split(',')) {
        const [court, codes] = row.split(':');
        if (!court || !codes || !MATRIX_COURTS.includes(Number(court)))
            continue;
        MATRIX_HOURS.forEach((hour, index) => { const code = codes[index]; if (code)
            cells.set(cellKey(Number(court), hour), code); });
    }
    return cells;
}
const evidenceState = (code) => code === 'O' ? 'OPEN' : code === 'X' ? 'UNAVAILABLE' : 'UNKNOWN';
const priceAt = (observation, court, hour) => {
    const value = observation.prices?.[court - 1]?.[MATRIX_HOURS.indexOf(hour)];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
};
const byRequest = (values) => [...values].sort((a, b) => a.seq - b.seq);
/** Derives every cell's first-published state, changes and public-record evidence. */
export function deriveSlotEvidence(availability, bookings = []) {
    const answered = byRequest(availability.filter(value => value.outcome === 'ok'));
    const published = answered.filter(value => value.targetDatePresent);
    const first = published[0];
    const firstResponse = [...published].sort((a, b) => a.responseOffsetMs - b.responseOffsetMs || a.seq - b.seq)[0];
    const lastUnpublished = first ? answered.filter(value => !value.targetDatePresent && value.seq < first.seq).at(-1) : answered.filter(value => !value.targetDatePresent).at(-1);
    const current = answered.at(-1);
    const decoded = new Map(published.map(value => [value.seq, decodeMatrix(value.matrix)]));
    const answeredBookings = byRequest(bookings.filter(value => value.outcome === 'ok'));
    const bookingSets = new Map(answeredBookings.map(value => [value.seq, new Set(value.cells)]));
    const currentCells = current?.targetDatePresent ? decoded.get(current.seq) : undefined;
    const cells = MATRIX_COURTS.flatMap(court => MATRIX_HOURS.map((hour) => {
        const key = cellKey(court, hour);
        let firstPublished = null, firstOpen = null, firstUnavailable = null;
        let openToUnavailable = null, unavailableToOpen = null, changes = 0;
        let previous;
        if (first)
            firstPublished = { state: evidenceState(decoded.get(first.seq).get(key)), price: priceAt(first, court, hour), observation: ref(first) };
        for (const observation of published) {
            const state = evidenceState(decoded.get(observation.seq).get(key));
            if (state === 'UNKNOWN')
                continue; // a missing cell is not evidence either way
            if (state === 'OPEN')
                firstOpen ??= ref(observation);
            else
                firstUnavailable ??= ref(observation);
            if (previous && previous.state !== state) {
                changes++;
                const change = { before: ref(previous.observation), after: ref(observation), overlapping: overlapping(previous.observation, observation) };
                if (state === 'UNAVAILABLE')
                    openToUnavailable ??= change;
                else
                    unavailableToOpen ??= change;
            }
            previous = { state, observation };
        }
        let firstRecord = null, recordRemoved = null;
        let lastKnown;
        for (const observation of answeredBookings) {
            if (observation.failedCourts.includes(court))
                continue; // unknown for this court, never "no record"
            const present = bookingSets.get(observation.seq).has(key);
            if (present && !firstRecord)
                firstRecord = { observation: ref(observation), previous: lastKnown && !lastKnown.present ? ref(lastKnown.observation) : null };
            if (!present && lastKnown?.present && !recordRemoved)
                recordRemoved = { observation: ref(observation), previous: ref(lastKnown.observation) };
            lastKnown = { present, observation };
        }
        return { court, hour, firstPublished, firstOpen, firstUnavailable, openToUnavailable, unavailableToOpen, changes, firstRecord, recordRemoved,
            latest: { state: evidenceState(currentCells?.get(key)), observation: current ? ref(current) : null, record: lastKnown ? lastKnown.present : null } };
    }));
    return {
        publication: { lastUnpublished: lastUnpublished ? ref(lastUnpublished) : null,
            firstPublished: first ? { ...ref(first), ...(first.cache ? { cache: first.cache } : {}) } : null,
            firstPublishedResponse: firstResponse ? ref(firstResponse) : null },
        current: current ? ref(current) : null, currentMatrix: current?.matrix ?? null,
        firstPublishedMatrix: first?.matrix ?? null, cells,
    };
}
/** Every observed change in request order (newest `limit` kept): publication, OPEN ↔ unavailable, public records. */
export function deriveTimeline(availability, bookings = [], limit = 600) {
    const entries = [];
    const answered = byRequest(availability.filter(value => value.outcome === 'ok'));
    const published = answered.filter(value => value.targetDatePresent);
    const first = published[0];
    if (first) {
        const codes = [...decodeMatrix(first.matrix).values()], before = answered.filter(value => !value.targetDatePresent && value.seq < first.seq).at(-1);
        entries.push({ kind: 'published', court: 0, hour: '', openCount: codes.filter(code => code === 'O').length,
            unavailableCount: codes.filter(code => code === 'X').length, unknownCount: 112 - codes.filter(code => code === 'O' || code === 'X').length,
            before: before ? ref(before) : null, after: ref(first), overlapping: before ? overlapping(before, first) : false });
    }
    const previous = new Map();
    for (const observation of published) {
        const cells = decodeMatrix(observation.matrix);
        for (const court of MATRIX_COURTS)
            for (const hour of MATRIX_HOURS) {
                const key = cellKey(court, hour), state = evidenceState(cells.get(key));
                if (state === 'UNKNOWN')
                    continue;
                const prior = previous.get(key);
                if (prior && prior.state !== state)
                    entries.push({ kind: 'state', court, hour, from: prior.state, to: state,
                        before: ref(prior.observation), after: ref(observation), overlapping: overlapping(prior.observation, observation) });
                previous.set(key, { state, observation });
            }
    }
    const known = new Map();
    for (const observation of byRequest(bookings.filter(value => value.outcome === 'ok'))) {
        const cells = new Set(observation.cells);
        for (const court of MATRIX_COURTS) {
            if (observation.failedCourts.includes(court))
                continue;
            for (const hour of MATRIX_HOURS) {
                const key = cellKey(court, hour), present = cells.has(key), prior = known.get(key);
                if (prior && prior.present !== present)
                    entries.push({ kind: 'record', court, hour, appeared: present,
                        before: ref(prior.observation), after: ref(observation), overlapping: overlapping(prior.observation, observation) });
                known.set(key, { present, observation });
            }
        }
    }
    entries.sort((a, b) => a.after.requestOffsetMs - b.after.requestOffsetMs || (a.kind === 'published' ? -1 : b.kind === 'published' ? 1 : 0) ||
        a.court - b.court || a.hour.localeCompare(b.hour));
    return entries.slice(-limit);
}
/** A multi-hour range is FULLY_OPEN only when every hour is OPEN; any unknown hour makes it UNKNOWN_INCOMPLETE. */
export function rangeState(states) {
    if (!states.length || states.some(state => state === 'UNKNOWN'))
        return 'UNKNOWN_INCOMPLETE';
    if (states.every(state => state === 'OPEN'))
        return 'FULLY_OPEN';
    if (states.every(state => state === 'UNAVAILABLE'))
        return 'FULLY_UNAVAILABLE';
    return 'PARTIALLY_UNAVAILABLE';
}
/** The whole hours a court range covers, e.g. 15:00–18:00 → 15:00, 16:00, 17:00. */
export function rangeHours(startTime, endTime) {
    const start = Number(startTime.slice(0, 2)), end = endTime === '00:00' ? 24 : Number(endTime.slice(0, 2));
    if (!/^\d{2}:00$/.test(startTime) || !/^\d{2}:00$/.test(endTime) || !(start < end))
        return [];
    return Array.from({ length: end - start }, (_, index) => `${String(start + index).padStart(2, '0')}:00`).filter(hour => MATRIX_HOURS.includes(hour));
}
/** Range-level evidence for one exact target. Forensic only: never used to choose or send a checkout. */
export function targetEvidence(availability, bookings, target) {
    const hours = rangeHours(target.startTime, target.endTime);
    const published = byRequest(availability.filter(value => value.outcome === 'ok' && value.targetDatePresent));
    const answered = byRequest(availability.filter(value => value.outcome === 'ok'));
    const statesOf = (observation) => { const cells = decodeMatrix(observation.matrix); return hours.map(hour => evidenceState(cells.get(cellKey(target.court, hour)))); };
    const first = published[0];
    let firstFullyOpen = null, firstUnavailable = null, reopen = null;
    let lastUnavailable;
    for (const observation of published) {
        const states = statesOf(observation), state = rangeState(states);
        if (state === 'FULLY_OPEN') {
            firstFullyOpen ??= ref(observation);
            if (lastUnavailable && !reopen)
                reopen = { before: ref(lastUnavailable), after: ref(observation), overlapping: overlapping(lastUnavailable, observation) };
            lastUnavailable = undefined;
        }
        else if (states.includes('UNAVAILABLE')) {
            firstUnavailable ??= { observation: ref(observation), hours: hours.filter((_, index) => states[index] === 'UNAVAILABLE') };
            lastUnavailable = observation;
        }
    }
    let firstRecord = null;
    for (const observation of byRequest(bookings.filter(value => value.outcome === 'ok'))) {
        if (observation.failedCourts.includes(target.court))
            continue;
        const matched = hours.filter(hour => observation.cells.includes(cellKey(target.court, hour)));
        if (matched.length) {
            firstRecord = { observation: ref(observation), hours: matched };
            break;
        }
    }
    const current = answered.at(-1);
    return { hours,
        firstPublished: first ? { observation: ref(first), state: rangeState(statesOf(first)),
            hours: hours.map((hour, index) => ({ hour, state: statesOf(first)[index], price: priceAt(first, target.court, hour) })) } : null,
        firstFullyOpen, firstUnavailable, firstRecord, reopen,
        latest: { observation: current ? ref(current) : null, state: current?.targetDatePresent ? rangeState(statesOf(current)) : 'UNKNOWN_INCOMPLETE' } };
}
export const RANGE_STATE_LABEL = {
    FULLY_OPEN: 'FULLY OPEN', PARTIALLY_UNAVAILABLE: 'PARTIALLY UNAVAILABLE', FULLY_UNAVAILABLE: 'FULLY UNAVAILABLE', UNKNOWN_INCOMPLETE: 'UNKNOWN / INCOMPLETE',
};
/** Signed seconds with millisecond precision, e.g. +0.412 s. */
export function relativeSeconds(ms) { return `${ms < 0 ? '−' : '+'}${(Math.abs(ms) / 1000).toFixed(3)} s`; }
/** `#12 request +0.250 s → response +0.880 s` */
export function describeRead(value, prefix = '#') {
    return `${prefix}${value.seq} request ${relativeSeconds(value.requestOffsetMs)} → response ${relativeSeconds(value.responseOffsetMs)}`;
}
//# sourceMappingURL=slot-evidence.js.map