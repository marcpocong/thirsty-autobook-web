import dc from 'node:diagnostics_channel';
import { lookup } from 'node:dns/promises';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseAvailability } from './api-booking/availability-parser.js';
import { OndaLiveAvailabilityProvider } from './api-booking/live-availability-provider.js';
import { queryGoogleClockConsensus } from './network-clock.js';
/**
 * Network Readiness: a bounded, read-only check of this PC's path to Onda's PUBLIC availability
 * endpoint (the same GET the Slot Watch uses) plus one Google NTP consensus round.
 *
 * It sends at most NETWORK_CHECK_MAX_REQUESTS sequential GETs, never acquires checkout security,
 * never opens a browser, never changes network settings or the system/app clock, and creates no
 * booking or hold. Timings describe Node's fetch path (not the browser's checkout connection).
 */
export const NETWORK_CHECK_MAX_REQUESTS = 10;
export const NETWORK_CHECK_DEFAULT_REQUESTS = 5;
export const NETWORK_READINESS_DIRECTORY = '.local/network-readiness';
/** Verdict rules (see verdictOf). */
export const READINESS_RULES = Object.freeze({ minSuccesses: 3, minClockSamples: 3, medianMs: 1_500, maxMs: 5_000 });
const percentile = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : null;
const round = (value) => Math.round(value * 10) / 10;
const manilaDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
export function verdictOf(result) {
    const reasons = [];
    if (result.succeeded < READINESS_RULES.minSuccesses || result.clock.kept < READINESS_RULES.minClockSamples) {
        if (result.succeeded < READINESS_RULES.minSuccesses)
            reasons.push(`Only ${result.succeeded} of ${result.requests} availability reads succeeded (need ${READINESS_RULES.minSuccesses}).`);
        if (result.clock.kept < READINESS_RULES.minClockSamples)
            reasons.push(`Only ${result.clock.kept} consistent network-clock samples (need ${READINESS_RULES.minClockSamples}).`);
        return { verdict: 'INSUFFICIENT_DATA', reasons };
    }
    if (result.failed)
        reasons.push(`${result.failed} of ${result.requests} availability reads failed.`);
    if (result.complete < result.succeeded)
        reasons.push(`${result.succeeded - result.complete} answer${result.succeeded - result.complete === 1 ? ' was' : 's were'} incomplete.`);
    if (result.medianMs !== null && result.medianMs > READINESS_RULES.medianMs)
        reasons.push(`Median read time ${result.medianMs} ms is above ${READINESS_RULES.medianMs} ms.`);
    if (result.maxMs !== null && result.maxMs > READINESS_RULES.maxMs)
        reasons.push(`Slowest read ${result.maxMs} ms is above ${READINESS_RULES.maxMs} ms.`);
    if (result.clock.quality !== 'GOOD')
        reasons.push(`Network clock quality is ${result.clock.quality}.`);
    if (reasons.length)
        return { verdict: 'NEEDS_ATTENTION', reasons };
    return { verdict: 'READY', reasons: [`${result.succeeded} of ${result.requests} reads succeeded and were complete; median ${result.medianMs} ms; network clock GOOD from ${result.clock.kept} samples.`] };
}
export async function runNetworkReadiness(options = {}) {
    const requests = Math.min(NETWORK_CHECK_MAX_REQUESTS, Math.max(1, Math.floor(options.requests ?? NETWORK_CHECK_DEFAULT_REQUESTS)));
    const spacingMs = Math.min(2_000, Math.max(0, options.spacingMs ?? 300)), now = options.now ?? Date.now, date = options.date ?? manilaDate(now());
    let fetcherCache = null;
    const baseFetch = options.fetcher ?? fetch;
    const fetcher = async (input, init) => {
        if ((init?.method ?? 'GET') !== 'GET')
            throw Error('NETWORK_CHECK_READ_ONLY');
        const response = await baseFetch(input, init);
        const status = response.headers.get('x-vercel-cache');
        fetcherCache = status && /^[A-Z_]{2,16}$/.test(status) ? status : null;
        return response;
    };
    // Connection setup events from Node's fetch (DNS + TCP + TLS for each new connection).
    let connecting = null, connectedDuring = [];
    const onBefore = () => { connecting = performance.now(); };
    const onConnected = () => { if (connecting !== null)
        connectedDuring.push(round(performance.now() - connecting)); connecting = null; };
    dc.subscribe('undici:client:beforeConnect', onBefore);
    dc.subscribe('undici:client:connected', onConnected);
    const samples = [];
    let dnsMs = null;
    try {
        try {
            const started = performance.now();
            await (options.dns ?? (host => lookup(host)))('app.onda.fit');
            dnsMs = round(performance.now() - started);
        }
        catch {
            dnsMs = null;
        }
        const provider = new OndaLiveAvailabilityProvider({ allowIncompleteRange: true, timeoutMs: options.timeoutMs ?? 15_000, fetcher });
        for (let index = 0; index < requests; index++) {
            if (index && spacingMs)
                await new Promise(done => setTimeout(done, spacingMs));
            connectedDuring = [];
            fetcherCache = null;
            const started = performance.now();
            try {
                const envelope = await provider.getAvailability({ startDate: date, endDate: date });
                const durationMs = round(performance.now() - started);
                const snapshot = parseAvailability(envelope.raw, { startDate: date, endDate: date, capturedAt: envelope.capturedAt, fixtureKind: 'live', label: envelope.label,
                    now: new Date(), maximumAgeMs: 60_000, requireCompleteRange: false });
                const cells = new Set(snapshot.slots.filter(slot => slot.date === date).map(slot => `${slot.court}/${slot.startTime}`));
                samples.push({ index, ok: true, code: null, durationMs, complete: !!snapshot.returnedDates[date] && cells.size === 112, cache: fetcherCache,
                    newConnection: connectedDuring.length > 0, connectMs: connectedDuring[0] ?? null });
            }
            catch (error) {
                const code = error instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.message) ? error.message : 'READ_FAILED';
                samples.push({ index, ok: false, code, durationMs: round(performance.now() - started), complete: null, cache: fetcherCache, newConnection: connectedDuring.length > 0, connectMs: connectedDuring[0] ?? null });
            }
        }
    }
    finally {
        dc.unsubscribe('undici:client:beforeConnect', onBefore);
        dc.unsubscribe('undici:client:connected', onConnected);
    }
    let consensus = null;
    try {
        consensus = await (options.clockRound ?? (() => queryGoogleClockConsensus()))();
    }
    catch {
        consensus = null;
    }
    const kept = consensus?.samples.filter(sample => sample.kept) ?? [];
    const trips = kept.map(sample => sample.roundTripMs).sort((a, b) => a - b);
    const durations = samples.filter(sample => sample.ok).map(sample => sample.durationMs).sort((a, b) => a - b);
    const kinds = Object.entries((options.interfaces ?? networkInterfaces)()).filter(([, entries]) => entries?.some(entry => !entry.internal))
        .map(([name]) => ({ name: name.replace(/[^\w .()-]/g, '').slice(0, 40), kind: /wi-?fi|wlan|wireless/i.test(name) ? 'Wi-Fi' : /ethernet|^eth|^en\d|lan/i.test(name) ? 'Ethernet' : 'Other' }))
        .sort((a, b) => a.name.localeCompare(b.name));
    const history = options.history ?? [];
    const previousMedians = history.map(value => value.medianMs).filter((value) => value !== null).sort((a, b) => a - b);
    const base = { version: 1, measuredAt: new Date(now()).toISOString(), target: 'Onda public availability (read-only GET)',
        requests, succeeded: durations.length, failed: samples.length - durations.length, complete: samples.filter(sample => sample.complete).length,
        medianMs: percentile(durations, 50), p90Ms: durations.length >= 10 ? percentile(durations, 90) : null, p95Ms: durations.length >= 20 ? percentile(durations, 95) : null,
        maxMs: durations.at(-1) ?? null, protocol: 'HTTP/1.1 (Node fetch; the browser checkout may differ)',
        newConnections: samples.filter(sample => sample.newConnection).length, reusedRequests: samples.filter(sample => !sample.newConnection).length,
        connectMs: samples.map(sample => sample.connectMs).filter((value) => value !== null), dnsMs, samples,
        clock: { samples: consensus?.sampleCount ?? 0, kept: kept.length, offsetMs: consensus ? round(consensus.offsetMs) : null, minRoundTripMs: trips[0] ?? null,
            medianRoundTripMs: percentile(trips, 50), spreadMs: consensus ? round(consensus.spreadMs) : null, quality: consensus?.quality ?? 'UNAVAILABLE' },
        interfaces: kinds, history: { previousRuns: history.length, previousMedianMs: percentile(previousMedians, 50) } };
    return { ...base, ...verdictOf(base) };
}
/** Sanitized history: timings, counts, cache status and interface names only (no addresses, headers or bodies). */
export function saveNetworkReadiness(root, result) {
    const directory = join(root, NETWORK_READINESS_DIRECTORY);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, `${result.measuredAt.replace(/[:.]/g, '-')}.json`);
    writeFileSync(path, JSON.stringify(result, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return path;
}
export function readNetworkReadinessHistory(root, limit = 20) {
    const directory = join(root, NETWORK_READINESS_DIRECTORY);
    if (!existsSync(directory))
        return [];
    return readdirSync(directory).filter(name => name.endsWith('.json')).sort().reverse().slice(0, limit).flatMap(name => {
        try {
            const value = JSON.parse(readFileSync(join(directory, name), 'utf8'));
            return value?.version === 1 ? [value] : [];
        }
        catch {
            return [];
        }
    });
}
//# sourceMappingURL=network-readiness.js.map