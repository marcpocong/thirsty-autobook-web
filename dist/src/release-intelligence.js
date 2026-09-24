import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { MATRIX_COURTS, MATRIX_HOURS } from './api-booking/court-hour-matrix.js';
import { readObserverLog } from './release-forensics.js';
import { cellKey, decodeMatrix, deriveSlotEvidence, rangeState } from './slot-evidence.js';
/**
 * Phase 4 Release Intelligence: a versioned, rebuildable layer DERIVED from raw local artifacts.
 *
 * Raw artifacts stay authoritative and are never modified: Slot Watch logs (.local/slot-watch),
 * runner traces (.local/api-booking/run-progress), post-run forensics (.local/release-forensics),
 * UI run journals (.local/booking-runs, run-start/run-end lines only) and offline benchmarks
 * (.local/benchmarks, listed only). Output goes to .local/release-intelligence and can be deleted
 * and rebuilt at any time.
 *
 * Only whitelisted, non-identifying fields are copied: no names, emails, phones, customer IDs,
 * cookies, security tokens, fingerprints, checkout tokens, booking numbers or QR/payment values,
 * and no absolute local paths (sources are referenced by file name).
 *
 * Nothing here reads the network, and nothing runs in the release runner (test-enforced).
 * Wording is evidence-only: counts of what was observed, never a probability of winning.
 */
export const INTELLIGENCE_VERSION = 1;
export const INTELLIGENCE_DIRECTORY = '.local/release-intelligence';
/** First 08:00 release that can run the Phase 1-3 architecture; earlier releases are historical pre-Phase 3 evidence. */
export const CURRENT_ARCHITECTURE_FROM_MS = Date.parse('2026-09-25T00:00:00.000Z');
/** Observation-quality rules (see qualityOf). */
export const QUALITY_RULES = Object.freeze({ goodFirstResponseMs: 3_000, fairFirstResponseMs: 10_000 });
/** Survival milestones: "still observed open at +x" uses the first published read REQUESTED in [x, next milestone). */
export const SURVIVAL_MS = [500, 1_000, 2_000, 5_000, 10_000];
const SURVIVAL_END = { 500: 1_000, 1_000: 2_000, 2_000: 5_000, 5_000: 10_000, 10_000: 20_000 };
const SYNTHETIC_RUN = /^00000000-0000-4000-8000-/;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const str = (value) => typeof value === 'string' ? value : undefined;
const num = (value) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; };
function readLines(path) {
    return readFileSync(path, 'utf8').split('\n').flatMap(line => {
        if (!line.trim())
            return [];
        try {
            const value = JSON.parse(line);
            return value && typeof value === 'object' && !Array.isArray(value) ? [value] : [];
        }
        catch {
            return [];
        }
    });
}
const listFiles = (directory, suffix) => existsSync(directory)
    ? readdirSync(directory).filter(name => name.endsWith(suffix)).sort() : [];
export const dayOfWeek = (date) => WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()] ?? 'Unknown';
const releaseKey = (date, releaseMs) => `${date}@${new Date(releaseMs).toISOString().replace(/[:.]/g, '-')}`;
const codeOf = (value) => value === 'O' ? 'O' : value === 'X' ? 'X' : '?';
const stateOf = (code) => code === 'O' ? 'OPEN' : code === 'X' ? 'UNAVAILABLE' : 'UNKNOWN';
/** Historical annotations taken from the written run reports; clearly labelled, never turned into grid data. */
export const HISTORICAL_NOTES = Object.freeze({
    '2026-09-23T00:00:00.000Z': [
        'Historical, before the current release architecture (Special Friday run).',
        'The target date was not observed before release, and no court/hour grid was recorded; only runner availability counts exist.',
        'The first useful released availability answered about +6.0 s after release.',
        'The requested plan could not use other open inventory that existed at release. Later openings may be visible in the counts; no win is implied.',
        'Unavailable cells without a public booking record at publication have an unknown cause.',
    ],
    '2026-09-24T00:00:00.000Z': [
        'Historical, before the current release architecture (Precision v1 run).',
        'Worker B was excluded for that run (duplicate customer identity at the time). Workers A, C and D sent about +0.10 s after release.',
        'All sent attempts were rejected after slow provider responses (about 17.5 to 28.3 s).',
        'The release-instant grid was not captured: the old observer answered its first published read long after release.',
        'Later unavailable cells without a public booking record have an unknown cause.',
    ],
});
// ---------------------------------------------------------------------------------------------
// Observation quality
/** Deterministic label from the underlying metrics (reasons explain every downgrade). */
export function qualityOf(metrics, hasGrid) {
    const reasons = [];
    if (metrics.firstPublishedResponseOffsetMs === null)
        return { label: 'NONE', reasons: ['No published availability was observed after release.'], metrics };
    const response = metrics.firstPublishedResponseOffsetMs;
    let label = 'GOOD';
    if (!hasGrid) {
        label = 'POOR';
        reasons.push('Only availability counts were recorded; there is no court/hour grid.');
    }
    if (metrics.firstPublishedComplete === false) {
        label = 'POOR';
        reasons.push('The first published grid was incomplete.');
    }
    if (response > QUALITY_RULES.fairFirstResponseMs) {
        label = 'POOR';
        reasons.push(`The first published read answered at +${(response / 1000).toFixed(1)} s, later than +${QUALITY_RULES.fairFirstResponseMs / 1000} s: it is not release-instant evidence.`);
    }
    else if (response > QUALITY_RULES.goodFirstResponseMs) {
        if (label === 'GOOD')
            label = 'FAIR';
        reasons.push(`The first published read answered at +${(response / 1000).toFixed(1)} s (after +${QUALITY_RULES.goodFirstResponseMs / 1000} s).`);
    }
    if (!metrics.cacheCertain) {
        if (label === 'GOOD')
            label = 'FAIR';
        reasons.push(metrics.firstPublishedCache ? `Cache status ${metrics.firstPublishedCache}: the age of that answer is not bounded.` : 'Cache provenance was not recorded: the age of that answer is uncertain.');
    }
    if (!reasons.length)
        reasons.push(`First published read answered by +${(response / 1000).toFixed(1)} s, complete, uncached.`);
    return { label, reasons, metrics };
}
export const adequate = (quality) => quality === 'GOOD' || quality === 'FAIR';
function decodePublished(log) {
    return log.availability.filter(value => value.outcome === 'ok' && value.targetDatePresent)
        .sort((a, b) => a.seq - b.seq).map(observation => ({ observation, cells: decodeMatrix(observation.matrix) }));
}
const cacheCertain = (observation) => observation?.cache?.status === 'MISS' && !((observation.cache.ageS ?? 0) > 0);
export function observerQuality(log) {
    const answered = log.availability.filter(value => value.outcome === 'ok');
    const after = log.availability.filter(value => value.requestOffsetMs >= 0);
    const published = decodePublished(log), first = published[0]?.observation;
    const evidence = deriveSlotEvidence(log.availability, log.bookings);
    const overlappingChanges = evidence.cells.filter(cell => cell.openToUnavailable?.overlapping || cell.unavailableToOpen?.overlapping).length;
    const metrics = {
        source: 'slot-watch', observerVersion: log.version,
        earliestRequestOffsetMs: after.length ? Math.min(...after.map(value => value.requestOffsetMs)) : null,
        earliestResponseOffsetMs: after.length ? Math.min(...after.filter(value => value.outcome === 'ok').map(value => value.responseOffsetMs)) : null,
        firstPublishedRequestOffsetMs: first?.requestOffsetMs ?? null, firstPublishedResponseOffsetMs: first?.responseOffsetMs ?? null,
        firstPublishedComplete: first ? [...decodeMatrix(first.matrix).values()].filter(code => code === 'O' || code === 'X').length === 112 : null,
        firstPublishedCache: first?.cache?.status ?? null, cacheCertain: cacheCertain(first),
        readsAnswered: answered.length, readsFailed: log.availability.filter(value => value.outcome !== 'ok').length, readsNotLaunched: log.notLaunched,
        bookingReadsAnswered: log.bookings.filter(value => value.outcome === 'ok').length, bookingReadsFailed: log.bookings.filter(value => value.outcome !== 'ok').length,
        failedCourtQueries: log.bookings.reduce((sum, value) => sum + value.failedCourts.length, 0), bookingsItemized: log.bookingsItemized,
        overlappingChanges,
    };
    if (metrics.earliestResponseOffsetMs === Infinity)
        metrics.earliestResponseOffsetMs = null;
    return qualityOf(metrics, true);
}
function cellsFromLog(log) {
    const published = decodePublished(log), first = published[0];
    const evidence = deriveSlotEvidence(log.availability, log.bookings);
    const bySeq = new Map(published.map(read => [read.observation.seq, read.observation]));
    const windowRead = (from) => published.find(read => read.observation.requestOffsetMs >= from && read.observation.requestOffsetMs < SURVIVAL_END[from]);
    const windows = Object.fromEntries(SURVIVAL_MS.map(ms => [ms, windowRead(ms)]));
    let reopenedCacheUncertain = 0;
    const cells = evidence.cells.map((cell) => {
        const key = cellKey(cell.court, cell.hour);
        const at = Object.fromEntries(SURVIVAL_MS.map(ms => { const read = windows[ms]; return [String(ms), read ? codeOf(read.cells.get(key)) : null]; }));
        const reopen = cell.unavailableToOpen;
        const uncertain = !!reopen && (!cacheCertain(bySeq.get(reopen.before.seq)) || !cacheCertain(bySeq.get(reopen.after.seq)));
        if (uncertain)
            reopenedCacheUncertain++;
        return { court: cell.court, hour: cell.hour, first: first ? codeOf(first.cells.get(key)) : '?', price: cell.firstPublished?.price ?? null, at,
            lost: cell.openToUnavailable ? { afterSeq: cell.openToUnavailable.after.seq, afterRequestOffsetMs: cell.openToUnavailable.after.requestOffsetMs, overlapping: cell.openToUnavailable.overlapping } : null,
            reopen: reopen ? { afterSeq: reopen.after.seq, afterRequestOffsetMs: reopen.after.requestOffsetMs, overlapping: reopen.overlapping, cacheUncertain: uncertain } : null,
            record: log.bookingsItemized && log.bookings.some(value => value.outcome === 'ok' && !value.failedCourts.includes(cell.court))
                ? log.bookings.some(value => value.outcome === 'ok' && !value.failedCourts.includes(cell.court) && value.cells.includes(key)) : null };
    });
    return { cells, transitions: { openToUnavailable: cells.filter(cell => cell.lost).length, reopened: cells.filter(cell => cell.reopen).length,
            reopenedCacheUncertain, overlapping: cells.filter(cell => cell.lost?.overlapping || cell.reopen?.overlapping).length } };
}
const emptyCells = () => MATRIX_COURTS.flatMap(court => MATRIX_HOURS.map(hour => ({ court, hour, first: '?', price: null,
    at: Object.fromEntries(SURVIVAL_MS.map(ms => [String(ms), null])), lost: null, reopen: null, record: null })));
export function readRunEvidence(path, forensicsSummary) {
    const lines = readLines(path), first = lines[0] ?? {};
    const runId = str(first.runId), targetDate = str(first.targetDate);
    const releaseMs = lines.map(line => num(line.releaseMs)).find(value => value !== undefined);
    if (!runId || !targetDate || str(first.mode) !== 'live' || releaseMs === undefined)
        return undefined;
    const at = (line) => { const ms = Date.parse(String(line.at)); return Number.isFinite(ms) ? ms - releaseMs : null; };
    const targets = new Map();
    for (const line of lines)
        if (['PRECISION_TARGET', 'DIRECT_LANE_PREPARED'].includes(String(line.stage)) && str(line.workerId))
            targets.set(str(line.workerId), { court: num(line.court) ?? null, startTime: str(line.startTime) ?? null, endTime: str(line.endTime) ?? null });
    const attempts = new Map();
    const attemptFor = (key, workerId, wave = 'IMMEDIATE') => {
        let value = attempts.get(key);
        if (!value) {
            const target = targets.get(workerId);
            value = { wave, workerId, court: target?.court ?? null, startTime: target?.startTime ?? null, endTime: target?.endTime ?? null, postOffsetMs: null, responseOffsetMs: null,
                networkDurationMs: null, statusCode: null, result: null, expectedAmount: null, rateStatus: null, protocol: null, reused: null };
            attempts.set(key, value);
        }
        return value;
    };
    const waveOf = (value) => value === 'WAVE_2' ? 'BACKUP' : value === 'RESCUE' ? 'REOPENED' : 'IMMEDIATE';
    const keyOf = (line) => str(line.attemptId) ?? `worker:${str(line.workerId)}`;
    for (const line of lines) {
        const stage = str(line.stage), workerId = str(line.workerId);
        if (!stage || !workerId || !/^[A-H]$/.test(workerId))
            continue;
        if (stage === 'PHASE3_WAVE1_STARTED' || stage === 'PHASE3_ATTEMPT_RESERVED') {
            const value = attempts.get(keyOf(line)) ?? (line.wave === 'WAVE_1' ? attempts.get(`worker:${workerId}`) : undefined) ?? attemptFor(keyOf(line), workerId, waveOf(line.wave));
            attempts.set(keyOf(line), value);
            Object.assign(value, { wave: waveOf(line.wave), court: num(line.court) ?? value.court, startTime: str(line.startTime) ?? value.startTime,
                endTime: str(line.endTime) ?? value.endTime, expectedAmount: num(line.amount) ?? value.expectedAmount });
            attempts.set(`worker:${workerId}`, value);
        }
        else if (stage === 'PHASE3_WAVE1_PRICE') {
            const value = attemptFor(`worker:${workerId}`, workerId);
            value.expectedAmount = num(line.amount) ?? null;
            value.rateStatus = /^[A-Z_]{1,40}$/.test(String(line.rateStatus)) ? String(line.rateStatus) : null;
        }
        else if (stage === 'PRECISION_TARGET') {
            attemptFor(`worker:${workerId}`, workerId).expectedAmount = num(line.assumedPrice) ?? null;
        }
        else if (stage === 'CHECKOUT_HTTP_POST_INITIATED') {
            const value = attempts.get(keyOf(line)) ?? attemptFor(`worker:${workerId}`, workerId);
            value.postOffsetMs = num(line.releaseLatenessMs) ?? at(line);
        }
        else if (stage === 'CHECKOUT_RESPONSE_COMPLETED') {
            const value = attempts.get(keyOf(line)) ?? attemptFor(`worker:${workerId}`, workerId);
            Object.assign(value, { statusCode: num(line.statusCode) ?? null, responseOffsetMs: at(line), networkDurationMs: num(line.networkDurationMs) ?? null });
        }
        else if (stage === 'PRECISION_ATTEMPT_STATE' && /^[A-Z_]{1,60}$/.test(String(line.attemptState))) {
            if (targets.has(workerId) || attempts.has(`worker:${workerId}`))
                attemptFor(`worker:${workerId}`, workerId).result = String(line.attemptState);
        }
        else if (stage === 'PHASE3_SETTLED' && /^[A-Z_]{1,60}$/.test(String(line.state))) {
            (attempts.get(keyOf(line)) ?? attemptFor(`worker:${workerId}`, workerId)).result = String(line.state);
        }
        else if (stage === 'DIRECT_WORKER_OUTCOME') {
            const value = attemptFor(`worker:${workerId}`, workerId);
            value.result = /^[a-z_-]{1,30}$/i.test(String(line.status)) ? String(line.status).toUpperCase() : null;
            value.responseOffsetMs = at(line);
        }
    }
    // Provider trace enrichment from the post-run forensic summary (protocol / connection reuse only).
    for (const target of (Array.isArray(forensicsSummary?.targets) ? forensicsSummary.targets : [])) {
        const provider = target.provider, workerId = str(target.workerId);
        const value = workerId ? attempts.get(`worker:${workerId}`) : undefined;
        if (value && provider) {
            value.protocol = /^[a-z0-9./-]{1,16}$/i.test(String(provider.protocol)) ? String(provider.protocol) : null;
            value.reused = typeof provider.reused === 'boolean' ? provider.reused : null;
        }
    }
    const unique = [...new Set(attempts.values())].filter(value => value.postOffsetMs !== null || value.result !== null || value.statusCode !== null);
    const outcomeLine = [...lines].reverse().find(line => ['PHASE3_OUTCOME', 'PRECISION_OUTCOME'].includes(String(line.stage)))
        ?? [...lines].reverse().find(line => line.stage === 'FAILED' || line.stage === 'COMPLETED');
    const outcome = str(outcomeLine?.outcome) ?? str(outcomeLine?.code) ?? str(outcomeLine?.stage) ?? null;
    const clocks = lines.filter(line => line.stage === 'NETWORK_CLOCK_REFRESHED');
    const lastClock = clocks.at(-1);
    const coarse = lines.filter(line => ['SPECIAL_AVAILABILITY_SAMPLE', 'AVAILABILITY_REQUEST_COMPLETED'].includes(String(line.stage)))
        .map(line => ({ responseOffsetMs: at(line) ?? NaN, durationMs: num(line.durationMs) ?? null,
        published: line.dateReturned === true || line.targetDatePresent === true, open: num(line.availableCount) ?? null, total: num(line.slotCount) ?? null }))
        .filter(sample => Number.isFinite(sample.responseOffsetMs) && sample.responseOffsetMs > -120_000 && sample.responseOffsetMs < 15 * 60_000);
    const times = lines.map(line => Date.parse(String(line.at))).filter(Number.isFinite);
    const startedMs = times.length ? Math.min(...times) : releaseMs, reachedRelease = times.length > 0 && Math.max(...times) >= releaseMs - 5_000;
    return { runId, targetDate, releaseMs, synthetic: SYNTHETIC_RUN.test(runId), startedMs, reachedRelease, attempts: unique,
        outcome: outcome && /^[A-Z0-9_]{1,80}$/.test(outcome) ? outcome : null,
        clock: { offsetMs: num(lastClock?.offsetMs) ?? null, roundTripMs: num(lastClock?.roundTripMs) ?? null, rounds: clocks.length }, coarse };
}
/** Reads raw artifacts under `root` and derives one record per observed release. Never throws for a bad file. */
export function deriveReleaseIntelligence(root, nowMs = Date.now()) {
    const local = join(root, '.local'), skipped = [], sources = [];
    const fingerprint = (kind, path) => { try {
        const data = readFileSync(path);
        sources.push({ kind, name: basename(path), bytes: data.length, sha256: sha256(data) });
    }
    catch { /* listed as skipped below */ } };
    const groups = new Map();
    // Synthetic fixtures get their own group, so they can never mix into a real release with the same timestamp.
    const group = (targetDate, releaseMs, synthetic) => {
        const key = `${releaseKey(targetDate, releaseMs)}${synthetic ? '-synthetic' : ''}`;
        if (!groups.has(key))
            groups.set(key, { targetDate, releaseMs, synthetic, logs: [], runs: [], forensics: [], bookingRuns: [] });
        return groups.get(key);
    };
    const watchDir = join(local, 'slot-watch');
    for (const name of listFiles(watchDir, '.ndjson')) {
        const path = join(watchDir, name);
        let log;
        try {
            log = readObserverLog(path);
        }
        catch {
            log = undefined;
        }
        if (!log || !/^\d{4}-\d{2}-\d{2}$/.test(log.date) || !Number.isFinite(log.releaseMs)) {
            skipped.push({ source: name, code: 'UNREADABLE_OR_UNSUPPORTED' });
            continue;
        }
        fingerprint('slot-watch', path);
        const answered = log.availability.filter(value => value.outcome === 'ok' && value.requestOffsetMs >= -120_000).length;
        if (!answered) {
            skipped.push({ source: name, code: 'NO_READS' });
            continue;
        }
        if (log.releaseMs > nowMs) {
            skipped.push({ source: name, code: 'RELEASE_NOT_REACHED' });
            continue;
        }
        group(log.date, log.releaseMs, /synthetic/i.test(name)).logs.push({ name, log, answered, synthetic: /synthetic/i.test(name) });
    }
    const forensicsDir = join(local, 'release-forensics'), summaries = new Map();
    if (existsSync(forensicsDir))
        for (const runId of readdirSync(forensicsDir).sort()) {
            const path = join(forensicsDir, runId, 'summary.json');
            if (!existsSync(path))
                continue;
            try {
                const value = JSON.parse(readFileSync(path, 'utf8'));
                if (value && typeof value === 'object') {
                    summaries.set(runId, value);
                    fingerprint('forensics', path);
                }
            }
            catch {
                skipped.push({ source: `${runId}/summary.json`, code: 'UNREADABLE' });
            }
        }
    const progressDir = join(local, 'api-booking', 'run-progress');
    for (const name of listFiles(progressDir, '.ndjson')) {
        const path = join(progressDir, name), runId = name.replace(/\.ndjson$/, '');
        let run;
        try {
            run = readRunEvidence(path, summaries.get(runId));
        }
        catch {
            skipped.push({ source: name, code: 'UNREADABLE' });
            continue;
        }
        if (!run || run.releaseMs > nowMs)
            continue;
        fingerprint('run-progress', path);
        const target = group(run.targetDate, run.releaseMs, run.synthetic);
        target.runs.push(run);
        if (summaries.has(run.runId))
            target.forensics.push(run.runId);
    }
    const bookingDir = join(local, 'booking-runs'), bookingEnds = [];
    for (const name of listFiles(bookingDir, '.ndjson')) {
        try {
            const end = readLines(join(bookingDir, name)).find(line => line.type === 'run-end');
            const atMs = Date.parse(String(end?.at)), runId = str(end?.runId);
            if (runId && Number.isFinite(atMs))
                bookingEnds.push({ runId, atMs });
        }
        catch {
            skipped.push({ source: name, code: 'UNREADABLE' });
        }
    }
    for (const value of groups.values())
        if (!value.synthetic)
            value.bookingRuns = bookingEnds.filter(end => end.atMs >= value.releaseMs - 30 * 60_000 && end.atMs <= value.releaseMs + 30 * 60_000)
                .map(end => end.runId).sort();
    const benchDir = join(local, 'benchmarks');
    const benchmarks = listFiles(benchDir, '-summary.json').map(name => {
        let label = null;
        try {
            const value = JSON.parse(readFileSync(join(benchDir, name), 'utf8'));
            label = str(value.label) && /^[\w.-]{1,80}$/.test(str(value.label)) ? str(value.label) : null;
        }
        catch {
            skipped.push({ source: name, code: 'UNREADABLE' });
        }
        return { name, origin: 'OFFLINE_BENCHMARK', label };
    });
    for (const [key, value] of groups)
        if (!value.logs.length && !value.runs.some(run => run.reachedRelease) &&
            !value.runs.some(run => run.coarse.some(sample => sample.published && sample.responseOffsetMs >= 0))) {
            groups.delete(key);
            skipped.push({ source: key, code: 'NOT_OBSERVED_OR_DISPATCHED' });
        }
    const records = [...groups.entries()].sort(([, a], [, b]) => a.releaseMs - b.releaseMs || a.targetDate.localeCompare(b.targetDate)).map(([key, value]) => {
        const logs = [...value.logs].sort((a, b) => b.answered - a.answered || a.name.localeCompare(b.name));
        const chosen = logs[0], runs = [...value.runs].sort((a, b) => a.startedMs - b.startedMs || a.runId.localeCompare(b.runId));
        const active = runs.filter(run => run.reachedRelease);
        const synthetic = value.synthetic;
        const historical = value.releaseMs < CURRENT_ARCHITECTURE_FROM_MS || chosen?.log.version === 1;
        const origin = synthetic ? 'SYNTHETIC' : historical ? 'HISTORICAL_PRE_PHASE3' : 'REAL_RELEASE';
        const coarse = runs.flatMap(run => run.coarse).sort((a, b) => a.responseOffsetMs - b.responseOffsetMs);
        let quality, cells, transitions, firstPublished = null;
        if (chosen) {
            quality = observerQuality(chosen.log);
            ({ cells, transitions } = cellsFromLog(chosen.log));
            const first = decodePublished(chosen.log)[0];
            if (first) {
                const codes = [...first.cells.values()];
                firstPublished = { requestOffsetMs: first.observation.requestOffsetMs, responseOffsetMs: first.observation.responseOffsetMs,
                    open: codes.filter(code => code === 'O').length, unavailable: codes.filter(code => code === 'X').length, unknown: 112 - codes.filter(code => code === 'O' || code === 'X').length };
            }
        }
        else {
            cells = emptyCells();
            transitions = { openToUnavailable: 0, reopened: 0, reopenedCacheUncertain: 0, overlapping: 0 };
            const released = coarse.filter(sample => sample.published && sample.responseOffsetMs >= 0);
            const firstSample = released[0];
            quality = qualityOf({ source: coarse.length ? 'runner-samples' : 'none', observerVersion: null,
                earliestRequestOffsetMs: null, earliestResponseOffsetMs: coarse.filter(sample => sample.responseOffsetMs >= 0)[0]?.responseOffsetMs ?? null,
                firstPublishedRequestOffsetMs: firstSample && firstSample.durationMs !== null ? firstSample.responseOffsetMs - firstSample.durationMs : null,
                firstPublishedResponseOffsetMs: firstSample?.responseOffsetMs ?? null, firstPublishedComplete: firstSample ? firstSample.total === 112 : null,
                firstPublishedCache: null, cacheCertain: false, readsAnswered: coarse.length, readsFailed: 0, readsNotLaunched: 0,
                bookingReadsAnswered: 0, bookingReadsFailed: 0, failedCourtQueries: 0, bookingsItemized: false, overlappingChanges: 0 }, false);
        }
        const attempts = active.flatMap(run => run.attempts).sort((a, b) => (a.postOffsetMs ?? Infinity) - (b.postOffsetMs ?? Infinity) || a.workerId.localeCompare(b.workerId));
        const posts = attempts.map(attempt => attempt.postOffsetMs).filter((ms) => ms !== null && isWave1Window(ms));
        const firstPost = posts.length ? Math.min(...posts) : null, lastPost = posts.length ? Math.max(...posts) : null;
        const withRecord = cells.filter(cell => cell.record !== null);
        const clock = active.map(run => run.clock).filter(entry => entry.rounds).at(-1) ?? { offsetMs: null, roundTripMs: null, rounds: 0 };
        const releaseAt = new Date(value.releaseMs).toISOString();
        return { version: INTELLIGENCE_VERSION, key, origin, targetDate: value.targetDate, dayOfWeek: dayOfWeek(value.targetDate), releaseMs: value.releaseMs, releaseAt,
            sources: { slotWatch: chosen ? [chosen.name] : [], runProgress: active.map(run => `${run.runId}.ndjson`), stoppedBeforeRelease: runs.filter(run => !run.reachedRelease).map(run => `${run.runId}.ndjson`), forensics: [...value.forensics].sort(),
                bookingRuns: value.bookingRuns, ignoredDuplicates: logs.slice(1).map(log => log.name) },
            quality, firstPublished, coarseSamples: coarse, cells, transitions,
            publicRecords: { itemized: !!chosen?.log.bookingsItemized, cellsWithRecord: withRecord.length ? withRecord.filter(cell => cell.record).length : null,
                unavailableWithoutRecordAtFirst: withRecord.length ? cells.filter(cell => cell.first === 'X' && cell.record === false).length : null },
            attempts, dispatch: { posts: posts.length, firstPostOffsetMs: firstPost, lastPostOffsetMs: lastPost, spreadMs: firstPost !== null && lastPost !== null ? lastPost - firstPost : null },
            outcome: active.map(run => run.outcome).filter(Boolean).at(-1) ?? null, clock, notes: [...(HISTORICAL_NOTES[releaseAt] ?? [])] };
    });
    sources.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
    skipped.sort((a, b) => a.source.localeCompare(b.source) || a.code.localeCompare(b.code));
    return { records, index: { version: INTELLIGENCE_VERSION, rules: { ...QUALITY_RULES, survivalMs: SURVIVAL_MS, architectureFrom: new Date(CURRENT_ARCHITECTURE_FROM_MS).toISOString() },
            sources, releases: records.map(record => ({ key: record.key, origin: record.origin, targetDate: record.targetDate, dayOfWeek: record.dayOfWeek, releaseAt: record.releaseAt,
                quality: record.quality.label, attempts: record.attempts.length, outcome: record.outcome })), benchmarks, skipped } };
}
/** Wave 1 POSTs happen within the first second; later (adaptive) sends are reported per attempt, not in the dispatch spread. */
function isWave1Window(offsetMs) { return offsetMs >= -1_000 && offsetMs <= 1_000; }
const distribution = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return { n: sorted.length, min: sorted[0] ?? null, median: median(sorted), max: sorted.at(-1) ?? null, values: [...new Set(sorted)] };
};
/** Real-release statistics exclude SYNTHETIC and OFFLINE_BENCHMARK records by construction. */
export const statisticalRecords = (records) => records.filter(record => record.origin === 'REAL_RELEASE' || record.origin === 'HISTORICAL_PRE_PHASE3');
export const rangeHoursOf = (start, hours) => Array.from({ length: hours }, (_, offset) => `${String(Number(start.slice(0, 2)) + offset).padStart(2, '0')}:00`);
export function computeMetrics(allRecords) {
    const records = statisticalRecords(allRecords);
    const days = [...new Set(records.map(record => record.dayOfWeek))].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));
    const cells = [], ranges = [];
    const cellMap = (record) => new Map(record.cells.map(cell => [cellKey(cell.court, cell.hour), cell]));
    const maps = new Map(records.map(record => [record.key, cellMap(record)]));
    const survival = () => Object.fromEntries(SURVIVAL_MS.map(ms => [String(ms), { observed: 0, open: 0 }]));
    for (const day of days) {
        const group = records.filter(record => record.dayOfWeek === day);
        const observedGroup = group.filter(record => record.cells.some(cell => cell.first !== '?') || record.quality.label !== 'NONE');
        for (const court of MATRIX_COURTS)
            for (const hour of MATRIX_HOURS) {
                const metric = { dayOfWeek: day, court, hour, releases: observedGroup.length, adequate: 0, firstOpen: 0, firstUnavailable: 0, censored: 0,
                    survival: survival(), reopened: 0, reopenedCacheUncertain: 0, reopenOffsetsMs: [], publicRecordChecked: 0, publicRecordPresent: 0, unavailableWithoutRecord: 0, prices: distribution([]) };
                const prices = [];
                for (const record of observedGroup) {
                    const cell = maps.get(record.key).get(cellKey(court, hour));
                    if (cell.price !== null)
                        prices.push(cell.price);
                    if (cell.reopen) {
                        if (cell.reopen.cacheUncertain)
                            metric.reopenedCacheUncertain++;
                        else
                            metric.reopened++;
                        metric.reopenOffsetsMs.push(cell.reopen.afterRequestOffsetMs);
                    }
                    if (cell.record !== null) {
                        metric.publicRecordChecked++;
                        if (cell.record)
                            metric.publicRecordPresent++;
                    }
                    if (!adequate(record.quality.label) || cell.first === '?') {
                        metric.censored++;
                        continue;
                    }
                    metric.adequate++;
                    if (cell.first === 'O') {
                        metric.firstOpen++;
                        for (const ms of SURVIVAL_MS) {
                            const state = cell.at[String(ms)];
                            if (state === 'O' || state === 'X') {
                                metric.survival[String(ms)].observed++;
                                if (state === 'O')
                                    metric.survival[String(ms)].open++;
                            }
                        }
                    }
                    else {
                        metric.firstUnavailable++;
                        if (cell.record === false)
                            metric.unavailableWithoutRecord++;
                    }
                }
                metric.prices = distribution(prices);
                metric.reopenOffsetsMs.sort((a, b) => a - b);
                cells.push(metric);
            }
        for (const court of MATRIX_COURTS)
            for (const start of MATRIX_HOURS)
                for (const durationHours of [1, 2, 3]) {
                    if (Number(start.slice(0, 2)) + durationHours > 24)
                        continue;
                    const hoursOf = rangeHoursOf(start, durationHours);
                    const metric = { dayOfWeek: day, court, start, durationHours, releases: observedGroup.length, adequate: 0, fullyOpen: 0, partiallyUnavailable: 0,
                        fullyUnavailable: 0, censored: 0, survival: survival(), reopened: 0, prices: distribution([]) };
                    const totals = [];
                    for (const record of observedGroup) {
                        const map = maps.get(record.key), parts = hoursOf.map(hour => map.get(cellKey(court, hour)));
                        const priceParts = parts.map(cell => cell.price);
                        if (priceParts.every(value => value !== null))
                            totals.push(priceParts.reduce((sum, value) => sum + value, 0));
                        if (rangeReopened(parts))
                            metric.reopened++;
                        const state = rangeState(parts.map(cell => stateOf(cell.first)));
                        if (!adequate(record.quality.label) || state === 'UNKNOWN_INCOMPLETE') {
                            metric.censored++;
                            continue;
                        }
                        metric.adequate++;
                        if (state === 'FULLY_OPEN') {
                            metric.fullyOpen++;
                            for (const ms of SURVIVAL_MS) {
                                const states = parts.map(cell => cell.at[String(ms)]);
                                if (states.every(value => value === 'O' || value === 'X')) {
                                    metric.survival[String(ms)].observed++;
                                    if (states.every(value => value === 'O'))
                                        metric.survival[String(ms)].open++;
                                }
                            }
                        }
                        else if (state === 'FULLY_UNAVAILABLE')
                            metric.fullyUnavailable++;
                        else
                            metric.partiallyUnavailable++;
                    }
                    metric.prices = distribution(totals);
                    ranges.push(metric);
                }
    }
    return { version: INTELLIGENCE_VERSION, realReleases: records.length, adequateReleases: records.filter(record => adequate(record.quality.label)).length, cells, ranges };
}
/** A complete-range reopen needs every hour's first reopen to be certain; an hour that never closed does not block it. */
function rangeReopened(parts) {
    return parts.some(cell => cell.reopen && !cell.reopen.cacheUncertain) && parts.every(cell => !cell.reopen?.cacheUncertain) && parts.every(cell => cell.lost === null || cell.reopen !== null);
}
const rangeCells = (range) => rangeHoursOf(range.start, range.durationHours).map(hour => cellKey(range.court, hour));
export function sharedRisk(a, b, records) {
    const cellsA = new Set(rangeCells(a)), cellsB = new Set(rangeCells(b));
    const shared = [...cellsA].filter(cell => cellsB.has(cell)).length, union = new Set([...cellsA, ...cellsB]).size;
    const hoursA = new Set(rangeHoursOf(a.start, a.durationHours)), overlappingHours = rangeHoursOf(b.start, b.durationHours).filter(hour => hoursA.has(hour)).length;
    let bothObserved = 0, coUnavailable = 0, sameEarlyLoss = 0;
    for (const record of statisticalRecords(records)) {
        if (!adequate(record.quality.label))
            continue;
        const map = new Map(record.cells.map(cell => [cellKey(cell.court, cell.hour), cell]));
        const partsA = [...cellsA].map(key => map.get(key)), partsB = [...cellsB].map(key => map.get(key));
        const stateA = rangeState(partsA.map(cell => stateOf(cell.first))), stateB = rangeState(partsB.map(cell => stateOf(cell.first)));
        if (stateA === 'UNKNOWN_INCOMPLETE' || stateB === 'UNKNOWN_INCOMPLETE')
            continue;
        bothObserved++;
        if (stateA !== 'FULLY_OPEN' && stateB !== 'FULLY_OPEN')
            coUnavailable++;
        const lossA = new Set(partsA.map(cell => cell.lost?.afterSeq).filter((seq) => seq !== undefined));
        if (partsB.some(cell => cell.lost && lossA.has(cell.lost.afterSeq)))
            sameEarlyLoss++;
    }
    const jaccard = union ? Math.round((shared / union) * 1000) / 1000 : 0;
    const explanation = [`${shared} shared court-hour${shared === 1 ? '' : 's'} (overlap ${jaccard.toFixed(2)} of the combined hours)`,
        `${overlappingHours} overlapping clock hour${overlappingHours === 1 ? '' : 's'} on any court`,
        bothObserved ? `both unavailable in the first snapshot in ${coUnavailable} of ${bothObserved} well-observed release${bothObserved === 1 ? '' : 's'}; lost in the same observed read window in ${sameEarlyLoss}` : 'no well-observed release covers both'].join('; ');
    return { a, b, sameCourt: a.court === b.court, sharedCells: shared, jaccard, overlappingHours, bothObserved, coUnavailable, sameEarlyLoss, explanation };
}
// ---------------------------------------------------------------------------------------------
// Files
const intelligenceRoot = (root) => resolve(root, INTELLIGENCE_DIRECTORY);
function writeAtomic(path, text) { const temporary = `${path}.tmp`; writeFileSync(temporary, text, { encoding: 'utf8', mode: 0o600 }); renameSync(temporary, path); }
/** Recreates only the derived layer. Raw artifacts are read, never written. */
export function rebuildReleaseIntelligence(root, options = {}) {
    const now = options.now ?? Date.now;
    const derived = deriveReleaseIntelligence(root, now()), metrics = computeMetrics(derived.records);
    const directory = intelligenceRoot(root), releases = join(directory, 'releases');
    clearReleaseIntelligence(root);
    mkdirSync(releases, { recursive: true, mode: 0o700 });
    for (const record of derived.records)
        writeAtomic(join(releases, `${record.key}.json`), JSON.stringify(record, null, 2) + '\n');
    writeAtomic(join(directory, 'metrics.json'), JSON.stringify(metrics) + '\n');
    const index = { ...derived.index, generatedAt: new Date(now()).toISOString() };
    writeAtomic(join(directory, 'summary.txt'), intelligenceReport(derived.records, index));
    writeAtomic(join(directory, 'index.json'), JSON.stringify(index, null, 2) + '\n');
    return { generatedAt: index.generatedAt, releases: derived.records.length, realReleases: metrics.realReleases, adequateReleases: metrics.adequateReleases,
        synthetic: derived.records.filter(record => record.origin === 'SYNTHETIC').length, benchmarks: index.benchmarks.length, skipped: index.skipped.length, directory: INTELLIGENCE_DIRECTORY };
}
/**
 * Deletes only files this module writes (index.json, metrics.json, summary.txt, releases/*.json) inside
 * <root>/.local/release-intelligence, then the emptied folders. Everything else is left untouched.
 */
export function clearReleaseIntelligence(root) {
    const directory = intelligenceRoot(root), local = resolve(root, '.local');
    if (!directory.startsWith(local + sep) || basename(directory) !== 'release-intelligence' || !existsSync(directory))
        return 0;
    let removed = 0;
    const releases = join(directory, 'releases');
    if (existsSync(releases))
        for (const name of readdirSync(releases))
            if (/\.json(\.tmp)?$/.test(name) && statSync(join(releases, name)).isFile()) {
                unlinkSync(join(releases, name));
                removed++;
            }
    for (const name of ['index.json', 'metrics.json', 'summary.txt', 'index.json.tmp', 'metrics.json.tmp', 'summary.txt.tmp'])
        if (existsSync(join(directory, name))) {
            unlinkSync(join(directory, name));
            removed++;
        }
    for (const folder of [releases, directory])
        try {
            if (existsSync(folder) && !readdirSync(folder).length)
                rmdirSync(folder);
        }
        catch { /* left in place */ }
    return removed;
}
export function readReleaseIntelligence(root) {
    const directory = intelligenceRoot(root);
    try {
        const index = JSON.parse(readFileSync(join(directory, 'index.json'), 'utf8'));
        if (index.version !== INTELLIGENCE_VERSION)
            return null;
        const metrics = JSON.parse(readFileSync(join(directory, 'metrics.json'), 'utf8'));
        const records = index.releases.flatMap(entry => { try {
            return [JSON.parse(readFileSync(join(directory, 'releases', `${entry.key}.json`), 'utf8'))];
        }
        catch {
            return [];
        } });
        return { index, records, metrics };
    }
    catch {
        return null;
    }
}
const seconds = (ms) => ms === null || ms === undefined ? '—' : `${ms < 0 ? '−' : '+'}${(Math.abs(ms) / 1000).toFixed(3)} s`;
export function intelligenceReport(records, index) {
    const lines = [`Release Intelligence v${index.version} · generated ${index.generatedAt}`, 'Derived from local raw artifacts; delete and rebuild at any time. Counts are observations, not probabilities.',
        `Quality: GOOD = first published read answered by +${QUALITY_RULES.goodFirstResponseMs / 1000} s, complete and cache MISS; FAIR = by +${QUALITY_RULES.fairFirstResponseMs / 1000} s and complete; POOR = later, incomplete or counts only; NONE = not observed.`, ''];
    for (const record of records) {
        lines.push(`${record.releaseAt} · target ${record.targetDate} (${record.dayOfWeek}) · ${record.origin} · quality ${record.quality.label}`);
        for (const reason of record.quality.reasons)
            lines.push(`  - ${reason}`);
        if (record.firstPublished)
            lines.push(`  First published grid: requested ${seconds(record.firstPublished.requestOffsetMs)}, answered ${seconds(record.firstPublished.responseOffsetMs)} · ${record.firstPublished.open} open / ${record.firstPublished.unavailable} unavailable / ${record.firstPublished.unknown} unknown`);
        else if (record.coarseSamples.length)
            lines.push(`  Runner availability counts only: first published answer ${seconds(record.quality.metrics.firstPublishedResponseOffsetMs)}`);
        if (record.attempts.length)
            lines.push(`  Attempts: ${record.attempts.map(attempt => `${attempt.wave.toLowerCase()} ${attempt.workerId}${attempt.court ? ` court ${attempt.court} ${attempt.startTime ?? ''}` : ''} POST ${seconds(attempt.postOffsetMs)} → ${attempt.statusCode ?? attempt.result ?? '—'}`).join('; ')}`);
        if (record.outcome)
            lines.push(`  Outcome: ${record.outcome}`);
        lines.push(`  Transitions: ${record.transitions.openToUnavailable} open→unavailable, ${record.transitions.reopened} reopened (${record.transitions.reopenedCacheUncertain} cache-uncertain)`);
        for (const note of record.notes)
            lines.push(`  Note: ${note}`);
        lines.push('');
    }
    if (index.benchmarks.length)
        lines.push(`Offline benchmarks listed (excluded from release statistics): ${index.benchmarks.length}`);
    if (index.skipped.length)
        lines.push(`Skipped artifacts: ${index.skipped.map(value => `${value.source} (${value.code})`).join(', ')}`);
    return lines.join('\n') + '\n';
}
export function intelligenceDigest(loaded) {
    if (!loaded)
        return { generatedAt: null, releases: [], realReleases: 0, adequateReleases: 0, skipped: 0, benchmarks: 0 };
    return { generatedAt: loaded.index.generatedAt, realReleases: loaded.metrics.realReleases, adequateReleases: loaded.metrics.adequateReleases,
        skipped: loaded.index.skipped.length, benchmarks: loaded.index.benchmarks.length,
        releases: [...loaded.records].reverse().map(record => ({ key: record.key, targetDate: record.targetDate, dayOfWeek: record.dayOfWeek, releaseAt: record.releaseAt, origin: record.origin,
            quality: record.quality.label, firstPublishedResponseOffsetMs: record.quality.metrics.firstPublishedResponseOffsetMs,
            attempts: { immediate: record.attempts.filter(value => value.wave === 'IMMEDIATE').length, backup: record.attempts.filter(value => value.wave === 'BACKUP').length,
                reopened: record.attempts.filter(value => value.wave === 'REOPENED').length }, outcome: record.outcome, reopened: record.transitions.reopened,
            notes: record.notes, reasons: record.quality.reasons })) };
}
//# sourceMappingURL=release-intelligence.js.map