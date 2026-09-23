import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { OndaLiveAvailabilityProvider } from './api-booking/live-availability-provider.js';
import { parseAvailability } from './api-booking/availability-parser.js';
import { readPublicBookingRecords } from './api-booking/public-bookings.js';
import { MATRIX_COURTS, MATRIX_HOURS, SLOT_STATE_CODE, countCourtHourStates, courtHourStates, encodeCourtHourStates } from './api-booking/court-hour-matrix.js';
/**
 * Release slot watch: a read-only observer that records the exact state of all
 * 112 court-hours around a release so the operator can see when each slot
 * opened and how quickly it was taken. It uses only Onda's public, credential-free
 * availability and booking-record endpoints and never touches a browser, lock,
 * hold, or checkout.
 */
export const SLOT_WATCH_BEFORE_MS = 60_000;
export const SLOT_WATCH_AFTER_MS = 15 * 60_000;
const TIMELINE_LIMIT = 600;
/** Dense right after release (0.5 s), sparse later; booking records at key moments. */
export function slotWatchSchedule() {
    const plan = new Map();
    const add = (offsetMs, bookings = false) => plan.set(offsetMs, (plan.get(offsetMs) ?? false) || bookings);
    for (let t = -SLOT_WATCH_BEFORE_MS; t < 0; t += 10_000)
        add(t);
    add(-2_000);
    for (let t = 250; t < 10_000; t += 500)
        add(t);
    for (let t = 10_000; t <= 60_000; t += 1_000)
        add(t);
    for (let t = 65_000; t <= 300_000; t += 5_000)
        add(t);
    for (let t = 330_000; t <= SLOT_WATCH_AFTER_MS; t += 30_000)
        add(t);
    for (const t of [-SLOT_WATCH_BEFORE_MS, 2_000, 10_000, 30_000, 60_000, 120_000, 300_000, 600_000, SLOT_WATCH_AFTER_MS])
        add(t, true);
    return [...plan.entries()].sort((a, b) => a[0] - b[0]).map(([offsetMs, bookings]) => ({ offsetMs, bookings }));
}
async function liveAvailability(date) {
    const envelope = await new OndaLiveAvailabilityProvider({ allowIncompleteRange: true, timeoutMs: 5_000 })
        .getAvailability({ startDate: date, endDate: date });
    return parseAvailability(envelope.raw, { startDate: date, endDate: date, capturedAt: envelope.capturedAt,
        fixtureKind: envelope.fixtureKind, label: envelope.label, now: new Date(), maximumAgeMs: 15_000, requireCompleteRange: false });
}
const abortableSleep = (ms, signal) => new Promise(done => {
    if (signal.aborted) {
        done();
        return;
    }
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); done(); }, Math.max(0, ms));
    const onAbort = () => { clearTimeout(timer); done(); };
    signal.addEventListener('abort', onAbort, { once: true });
});
const key = (court, hour) => `${court}/${hour}`;
const safeCode = (error) => error instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.message) ? error.message : 'READ_FAILED';
/** Manila wall time with milliseconds, e.g. 2026-09-24 08:00:00.412. */
export function manilaStamp(ms) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}.${String(Math.floor(((ms % 1000) + 1000) % 1000)).padStart(3, '0')}`;
}
/** Signed seconds relative to release with millisecond precision, e.g. +0.412 s. */
export function relativeSeconds(ms) { return `${ms < 0 ? '−' : '+'}${(Math.abs(ms) / 1000).toFixed(3)} s`; }
export class SlotWatch {
    options;
    id = randomUUID();
    path;
    done;
    handle;
    abort = new AbortController();
    now;
    startedMs;
    stopReason = 'window complete';
    status = 'waiting';
    states;
    dateReleased = null;
    records = new Set();
    recordsKnown = false;
    polls = 0;
    failedPolls = 0;
    latencies = [];
    lastObservedMs;
    lastError;
    timeline = [];
    changedAt = new Map();
    openedAt = new Map();
    takes = new Map();
    recordAt = new Map();
    firstPublished = new Map();
    reopened = [];
    releaseVisibleSinceReleaseMs = null;
    openAtFirstRead;
    summary;
    constructor(options) {
        this.options = options;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date) || !Number.isSafeInteger(options.releaseMs))
            throw Error('SLOT_WATCH_INPUT_INVALID');
        this.now = options.now ?? Date.now;
        this.startedMs = this.now();
        mkdirSync(options.directory, { recursive: true, mode: 0o700 });
        this.path = join(options.directory, `${options.date}_${this.id}.ndjson`);
        this.handle = openSync(this.path, 'wx', 0o600);
        this.write({ type: 'header', version: 1, id: this.id, date: options.date, releaseAt: new Date(options.releaseMs).toISOString(),
            releaseManila: manilaStamp(options.releaseMs), startedAt: new Date(this.startedMs).toISOString(),
            clockOffsetMs: options.clockOffsetMs ?? 0, clockSynced: options.clockSynced ?? false,
            legend: { O: 'open', X: 'taken / unavailable', U: 'date not released yet', '?': 'unknown (not published or read failed)' },
            note: 'Times are network-clock corrected. A change happened between the previous read and observedAt (windowMs).' });
        this.done = this.run();
    }
    /** Stops early; resolves with the summary written so far. */
    stop(reason) { if (!this.abort.signal.aborted) {
        this.stopReason = reason;
        this.abort.abort();
    } return this.done; }
    view() {
        const cells = MATRIX_COURTS.flatMap(court => MATRIX_HOURS.map(hour => {
            const changed = this.changedAt.get(key(court, hour));
            return { court, hour, state: this.states?.[court]?.[hour] ?? 'UNKNOWN', record: this.records.has(key(court, hour)),
                ...(changed === undefined ? {} : { changedSinceReleaseMs: changed }) };
        }));
        return { id: this.id, date: this.options.date, releaseMs: this.options.releaseMs, status: this.status,
            startedAt: new Date(this.startedMs).toISOString(), endsAtMs: this.options.releaseMs + SLOT_WATCH_AFTER_MS,
            polls: this.polls, failedPolls: this.failedPolls, dateReleased: this.dateReleased, cells, timeline: this.timeline.slice(-300),
            logPath: this.path, ...(this.lastObservedMs !== undefined ? { lastPollAt: new Date(this.lastObservedMs).toISOString() } : {}),
            ...(this.latencies.length ? { lastLatencyMs: this.latencies.at(-1) } : {}), ...(this.lastError ? { lastError: this.lastError } : {}),
            ...(this.summary ? { summary: this.summary } : {}) };
    }
    write(value) { try {
        writeSync(this.handle, `${JSON.stringify(value)}\n`);
    }
    catch { /* Observation must never fail a booking. */ } }
    publish() { try {
        this.options.onUpdate?.(this.view());
    }
    catch { /* UI updates are best-effort. */ } }
    async run() {
        const sleep = this.options.sleep ?? abortableSleep, signal = this.abort.signal;
        try {
            this.publish();
            for (const entry of this.options.schedule ?? slotWatchSchedule()) {
                if (signal.aborted)
                    break;
                const target = this.options.releaseMs + entry.offsetMs;
                // A late start or a slow read skips reads that are already in the past.
                if (target < this.now() - 1_000)
                    continue;
                // Re-check the clock after each wait so PC sleep or a clock resync cannot fire a read early.
                while (!signal.aborted && this.now() < target)
                    await sleep(Math.min(target - this.now(), 60_000), signal);
                if (signal.aborted)
                    break;
                this.status = 'watching';
                await this.poll(entry.bookings);
            }
        }
        catch {
            this.stopReason = 'internal error';
        }
        this.status = signal.aborted ? 'stopped' : 'finished';
        return this.finish();
    }
    async poll(withBookings) {
        const date = this.options.date, releaseMs = this.options.releaseMs;
        const requestedMs = this.now();
        const [availability, bookings] = await Promise.allSettled([
            (this.options.readAvailability ?? liveAvailability)(date),
            withBookings ? (this.options.readBookings ?? (value => readPublicBookingRecords(value)))(date) : Promise.resolve(undefined),
        ]);
        const respondedMs = this.now(), seq = ++this.polls, latencyMs = Math.max(0, Math.round(respondedMs - requestedMs));
        const observedAt = new Date(respondedMs).toISOString(), sinceReleaseMs = Math.round(respondedMs - releaseMs);
        const windowMs = this.lastObservedMs === undefined ? null : Math.round(respondedMs - this.lastObservedMs);
        // Every transition goes to the log; the UI timeline gets real open/taken changes plus one
        // summary per read in which cells first appeared, so release publication is not 112 rows.
        const changes = [], timeline = [];
        let publishedOpen = 0, publishedTaken = 0;
        let states;
        if (availability.status === 'fulfilled') {
            states = courtHourStates(availability.value, date);
            this.dateReleased = availability.value.returnedDates[date] === true ? true : availability.value.returnedDates[date] === false ? false : null;
            if (this.dateReleased && sinceReleaseMs >= 0 && this.releaseVisibleSinceReleaseMs === null)
                this.releaseVisibleSinceReleaseMs = sinceReleaseMs;
            for (const court of MATRIX_COURTS)
                for (const hour of MATRIX_HOURS) {
                    const cell = key(court, hour), next = states[court][hour], previous = this.states?.[court]?.[hour];
                    if ((next === 'OPEN' || next === 'TAKEN') && !this.firstPublished.has(cell))
                        this.firstPublished.set(cell, next);
                    if (next === 'OPEN' && !this.openedAt.has(cell))
                        this.openedAt.set(cell, sinceReleaseMs);
                    if (previous === undefined || previous === next)
                        continue;
                    const change = { seq, court, hour, kind: 'state', from: previous, to: next, observedAt, sinceReleaseMs, windowMs };
                    changes.push(change);
                    if (previous === 'OPEN' || previous === 'TAKEN') {
                        timeline.push(change);
                        this.changedAt.set(cell, sinceReleaseMs);
                    }
                    else if (next === 'OPEN')
                        publishedOpen++;
                    else if (next === 'TAKEN')
                        publishedTaken++;
                    if (previous === 'OPEN' && next === 'TAKEN' && !this.takes.has(cell))
                        this.takes.set(cell, { court, hour, openedSinceReleaseMs: this.openedAt.get(cell) ?? sinceReleaseMs, takenSinceReleaseMs: sinceReleaseMs, windowMs, recordSinceReleaseMs: null });
                    if (previous === 'TAKEN' && next === 'OPEN')
                        this.reopened.push({ court, hour, sinceReleaseMs });
                }
            if (this.openAtFirstRead === undefined && this.dateReleased && sinceReleaseMs >= 0)
                this.openAtFirstRead = countCourtHourStates(states).OPEN;
            this.states = states;
            this.lastObservedMs = respondedMs;
            this.latencies.push(latencyMs);
            this.lastError = undefined;
        }
        else {
            this.failedPolls++;
            this.lastError = safeCode(availability.reason);
        }
        let bookingSummary;
        if (bookings.status === 'fulfilled' && bookings.value) {
            const failed = new Set(bookings.value.failedCourts), next = new Set();
            for (const block of bookings.value.blocks)
                for (const hour of MATRIX_HOURS) {
                    const end = `${String(Number(hour.slice(0, 2)) + 1).padStart(2, '0')}:00`;
                    if (block.startTime < end && block.endTime > hour)
                        next.add(key(block.court, hour));
                }
            // A court whose record query failed keeps its last known records.
            for (const cell of this.records)
                if (failed.has(Number(cell.split('/')[0])))
                    next.add(cell);
            if (this.recordsKnown) {
                for (const cell of next)
                    if (!this.records.has(cell)) {
                        const entry = this.recordEntry(seq, cell, true, observedAt, sinceReleaseMs, windowMs);
                        changes.push(entry);
                        timeline.push(entry);
                    }
                for (const cell of this.records)
                    if (!next.has(cell)) {
                        const entry = this.recordEntry(seq, cell, false, observedAt, sinceReleaseMs, windowMs);
                        changes.push(entry);
                        timeline.push(entry);
                    }
            }
            for (const cell of next)
                if (!this.recordAt.has(cell))
                    this.recordAt.set(cell, sinceReleaseMs);
            this.records = next;
            this.recordsKnown = true;
            bookingSummary = { failedCourts: [...failed], records: next.size };
        }
        else if (bookings.status === 'rejected')
            bookingSummary = { failedCourts: [...MATRIX_COURTS], records: this.records.size };
        this.write({ type: 'poll', seq, requestedAt: new Date(requestedMs).toISOString(), respondedAt: observedAt,
            requestedManila: manilaStamp(requestedMs), respondedManila: manilaStamp(respondedMs), latencyMs,
            sinceReleaseMs, availability: availability.status === 'fulfilled' ? 'ok' : 'failed',
            ...(availability.status === 'rejected' ? { code: safeCode(availability.reason) } : {}),
            ...(states ? { dateReleased: this.dateReleased, counts: countCourtHourStates(states), matrix: encodeCourtHourStates(states) } : {}),
            ...(bookingSummary ? { bookingRecords: bookingSummary } : {}) });
        for (const change of changes)
            this.write({ type: 'change', ...change, observedManila: manilaStamp(respondedMs) });
        if (publishedOpen || publishedTaken)
            timeline.unshift({ seq, court: 0, hour: '', kind: 'published', openCount: publishedOpen,
                takenCount: publishedTaken, observedAt, sinceReleaseMs, windowMs });
        this.timeline.push(...timeline);
        if (this.timeline.length > TIMELINE_LIMIT)
            this.timeline.splice(0, this.timeline.length - TIMELINE_LIMIT);
        this.publish();
    }
    recordEntry(seq, cell, appeared, observedAt, sinceReleaseMs, windowMs) {
        const [court, hour] = cell.split('/');
        return { seq, court: Number(court), hour: hour, kind: 'record', appeared, observedAt, sinceReleaseMs, windowMs };
    }
    finish() {
        const endedMs = this.now(), cells = MATRIX_COURTS.flatMap(court => MATRIX_HOURS.map(hour => ({ court, hour })));
        const taken = [...this.takes.values()].map(take => ({ ...take, recordSinceReleaseMs: this.recordAt.get(key(take.court, take.hour)) ?? null }))
            .sort((a, b) => a.takenSinceReleaseMs - b.takenSinceReleaseMs || a.court - b.court || a.hour.localeCompare(b.hour));
        const sorted = [...this.latencies].sort((a, b) => a - b);
        const reportPath = this.path.replace(/\.ndjson$/, '.txt');
        const summary = { version: 1, id: this.id, date: this.options.date, releaseAt: new Date(this.options.releaseMs).toISOString(),
            releaseMs: this.options.releaseMs, startedAt: new Date(this.startedMs).toISOString(), endedAt: new Date(endedMs).toISOString(),
            status: this.status === 'stopped' ? 'stopped' : 'finished', reason: this.stopReason,
            clockOffsetMs: this.options.clockOffsetMs ?? 0, clockSynced: this.options.clockSynced ?? false,
            polls: this.polls, failedPolls: this.failedPolls, medianLatencyMs: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
            releaseVisibleSinceReleaseMs: this.releaseVisibleSinceReleaseMs, openAtFirstRead: this.openAtFirstRead ?? 0, taken,
            neverOpen: cells.filter(({ court, hour }) => this.firstPublished.get(key(court, hour)) === 'TAKEN' && !this.openedAt.has(key(court, hour)))
                .map(({ court, hour }) => ({ court, hour, record: this.recordAt.has(key(court, hour)) })),
            reopened: this.reopened, stillOpen: this.states ? countCourtHourStates(this.states).OPEN : 0,
            fastestTakeMs: taken.length ? Math.min(...taken.map(take => take.takenSinceReleaseMs)) : null,
            finalMatrix: this.states ? encodeCourtHourStates(this.states) : '', timeline: this.timeline, logPath: this.path, reportPath };
        this.summary = summary;
        this.write({ type: 'summary', ...summary, timeline: undefined });
        try {
            closeSync(this.handle);
        }
        catch { /* already closed */ }
        try {
            writeFileSync(reportPath, slotWatchReport(summary), { encoding: 'utf8', mode: 0o600 });
            const summaryPath = this.path.replace(/\.ndjson$/, '.summary.json'), temporary = `${summaryPath}.tmp`;
            writeFileSync(temporary, JSON.stringify(summary), { encoding: 'utf8', mode: 0o600 });
            renameSync(temporary, summaryPath);
        }
        catch { /* The NDJSON log already holds every read. */ }
        this.publish();
        return summary;
    }
}
const hourLabel = (hour) => { const h = Number(hour.slice(0, 2)); return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`; };
/** Plain-text report for reading the release outcome without tools. */
export function slotWatchReport(summary) {
    const lines = [`RELEASE SLOT WATCH — target ${summary.date}`,
        `Release: ${manilaStamp(summary.releaseMs)} Manila · network clock ${summary.clockSynced ? `synchronized (offset ${summary.clockOffsetMs.toFixed(1)} ms)` : 'NOT synchronized'}`,
        `Watch ${summary.status}: ${summary.reason} · ${summary.polls} reads (${summary.failedPolls} failed) · median read ${summary.medianLatencyMs ?? '?'} ms`,
        `Target date first visible: ${summary.releaseVisibleSinceReleaseMs === null ? 'not observed after release' : relativeSeconds(summary.releaseVisibleSinceReleaseMs)}`,
        `Open at first read: ${summary.openAtFirstRead} · still open at end: ${summary.stillOpen}`,
        `Fastest take: ${summary.fastestTakeMs === null ? 'none observed' : relativeSeconds(summary.fastestTakeMs)}`, '',
        'TAKEN AFTER OPENING (a slot changed between the previous read and the time shown)'];
    if (!summary.taken.length)
        lines.push('  none observed');
    for (const take of summary.taken)
        lines.push(`  ${relativeSeconds(take.takenSinceReleaseMs).padStart(11)}  Court ${take.court} ${hourLabel(take.hour).padEnd(5)} open ${relativeSeconds(take.openedSinceReleaseMs)} → taken${take.windowMs === null ? '' : ` (±${(take.windowMs / 1000).toFixed(3)} s)`}${take.recordSinceReleaseMs === null ? '' : ` · booking record seen ${relativeSeconds(take.recordSinceReleaseMs)}`}`);
    lines.push('', 'NEVER OPEN (already unavailable at the first published read)');
    if (!summary.neverOpen.length)
        lines.push('  none');
    for (const court of MATRIX_COURTS) {
        const cells = summary.neverOpen.filter(cell => cell.court === court);
        if (cells.length)
            lines.push(`  Court ${court}: ${cells.map(cell => `${hourLabel(cell.hour)}${cell.record ? ' (booked)' : ' (no booking record — likely venue block)'}`).join(', ')}`);
    }
    lines.push('', 'REOPENED LATER (for example an unpaid hold expiring)');
    if (!summary.reopened.length)
        lines.push('  none');
    for (const cell of summary.reopened)
        lines.push(`  ${relativeSeconds(cell.sinceReleaseMs).padStart(11)}  Court ${cell.court} ${hourLabel(cell.hour)}`);
    lines.push('', `FINAL MATRIX (${Object.entries(SLOT_STATE_CODE).map(([state, code]) => `${code} ${state.toLowerCase()}`).join(', ')})`, `       ${MATRIX_HOURS.map(hour => hour.slice(0, 2)).join(' ')}`);
    for (const row of summary.finalMatrix.split(',').filter(Boolean)) {
        const [court, codes] = row.split(':');
        lines.push(`  C${court}   ${[...codes].map(code => ` ${code}`).join(' ')}`);
    }
    lines.push('', `Full read-by-read log: ${summary.logPath}`);
    return `${lines.join('\n')}\n`;
}
/** Newest-first summaries of finished watches, for the Runs history. */
export function readSlotWatchHistory(directory, limit = 20) {
    if (!existsSync(directory))
        return [];
    return readdirSync(directory).filter(name => name.endsWith('.summary.json'))
        .map(name => ({ name, mtime: statSync(join(directory, name)).mtimeMs })).sort((a, b) => b.mtime - a.mtime).slice(0, limit)
        .flatMap(({ name }) => {
        try {
            const value = JSON.parse(readFileSync(join(directory, name), 'utf8'));
            return value.version === 1 && typeof value.id === 'string' && typeof value.date === 'string' && Array.isArray(value.taken) ? [value] : [];
        }
        catch {
            return [];
        }
    });
}
//# sourceMappingURL=slot-watch.js.map