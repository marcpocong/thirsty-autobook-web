import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const num = (value) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const readLines = (path) => readFileSync(path, 'utf8').split('\n').flatMap(line => { try {
    const value = JSON.parse(line);
    return value && typeof value === 'object' ? [value] : [];
}
catch {
    return [];
} });
/** One complete-path sample per checkout in a trace (first POST/response pair per worker for proofless). */
export function pathSamplesFromTrace(lines, runId) {
    const mode = String(lines[0]?.mode ?? 'unknown'), elapsed = (line) => num(line?.elapsedMs);
    const samples = [];
    const dispatching = lines.find(line => line.stage === 'PRIMARY_PROOFLESS_DISPATCHING');
    if (dispatching)
        for (const post of lines.filter(line => line.stage === 'CHECKOUT_HTTP_POST_INITIATED')) {
            const response = lines.find(line => line.stage === 'CHECKOUT_RESPONSE_COMPLETED' && line.workerId === post.workerId && (elapsed(line) ?? -1) >= (elapsed(post) ?? Infinity));
            const start = elapsed(dispatching), posted = elapsed(post), network = num(response?.networkDurationMs);
            if (start === undefined || posted === undefined || network === undefined)
                continue;
            const toPost = Math.max(0, posted - start);
            samples.push({ runId, mode, method: 'proofless', opportunityToPostMs: toPost, proofMs: null, securityMs: null, postToOutcomeMs: network,
                completeMs: toPost + network, completeWithoutSecurityMs: toPost + network, statusCode: num(response?.statusCode) ?? null });
        }
    const candidate = lines.find(line => line.stage === 'CANDIDATE_READY'), proofsStart = lines.find(line => line.stage === 'FRESH_VERIFICATION_AND_PROOFS');
    const proofs = lines.filter(line => line.stage === 'SLOT_PROOFS_READY'), security = lines.filter(line => line.stage === 'SECURITY_CONTEXT_READY');
    const response = lines.find(line => (line.stage === 'CHECKOUT_RESPONSE_RECEIVED' || line.stage === 'CHECKOUT_RESPONSE_COMPLETED') && (elapsed(line) ?? -1) > (elapsed(proofs.at(-1)) ?? Infinity));
    if (!dispatching && candidate && proofsStart && proofs.length && response) {
        const opportunity = elapsed(candidate), proofsReady = elapsed(proofs.at(-1)), outcome = elapsed(response);
        const securityMs = security.length ? Math.max(0, elapsed(security.at(-1)) - elapsed(proofsStart)) : null;
        const proofMs = proofsReady - opportunity;
        samples.push({ runId, mode, method: 'proof-based', opportunityToPostMs: null, proofMs, securityMs, postToOutcomeMs: outcome - proofsReady,
            completeMs: outcome - opportunity, completeWithoutSecurityMs: outcome - opportunity - (securityMs ?? 0), statusCode: num(response.statusCode) ?? null });
    }
    return samples;
}
export function collectPathSamples(runProgressDirectory) {
    if (!existsSync(runProgressDirectory))
        return [];
    return readdirSync(runProgressDirectory).filter(name => name.endsWith('.ndjson')).sort().flatMap(name => {
        try {
            return pathSamplesFromTrace(readLines(join(runProgressDirectory, name)), name.replace(/\.ndjson$/, ''));
        }
        catch {
            return [];
        }
    });
}
const stats = (values) => {
    const sorted = [...values].sort((a, b) => a - b), at = (p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : null;
    return { n: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted.at(-1) ?? null };
};
/** Release-time inputs come from intelligence records (real releases only); nothing is sent. */
export function compareCheckoutPaths(samples, records) {
    const real = records.filter(record => record.origin === 'REAL_RELEASE' || record.origin === 'HISTORICAL_PRE_PHASE3');
    const proofless = samples.filter(sample => sample.method === 'proofless'), proofBased = samples.filter(sample => sample.method === 'proof-based');
    const readMs = real.flatMap(record => record.coarseSamples.filter(sample => sample.published && sample.responseOffsetMs >= 0 && sample.responseOffsetMs < 60_000 && sample.durationMs !== null).map(sample => sample.durationMs));
    const releaseResponses = real.flatMap(record => record.attempts.map(attempt => attempt.networkDurationMs).filter((value) => value !== null));
    const result = {
        offPeak: { proofless: stats(proofless.map(sample => sample.completeMs)), proofBased: stats(proofBased.map(sample => sample.completeMs)),
            proofBasedWithoutSecurity: stats(proofBased.map(sample => sample.completeWithoutSecurityMs)), proofAcquisition: stats(proofBased.map(sample => sample.proofMs)) },
        release: { availabilityReadMs: stats(readMs), postToOutcomeMs: stats(releaseResponses) }, findings: [], strategyChanged: false
    };
    const f = result.findings, o = result.offPeak;
    f.push(o.proofless.n ? `Off-peak proofless complete path (decision → response): p50 ${o.proofless.p50} ms, p95 ${o.proofless.p95} ms (n=${o.proofless.n}).` : 'No off-peak proofless trace is available.');
    f.push(o.proofBased.n ? `Off-peak proof-based complete path (candidate → response): p50 ${o.proofBased.p50} ms, p95 ${o.proofBased.p95} ms (n=${o.proofBased.n}); without in-path security preparation p50 ${o.proofBasedWithoutSecurity.p50} ms.` : 'No off-peak proof-based trace is available.');
    if (result.release.availabilityReadMs.n)
        f.push(`At recorded releases, a published availability read took p50 ${result.release.availabilityReadMs.p50} ms, max ${result.release.availabilityReadMs.max} ms (n=${result.release.availabilityReadMs.n}). A proof-based path must wait for reads like these before its POST.`);
    if (result.release.postToOutcomeMs.n)
        f.push(`At recorded releases, POST → response took p50 ${result.release.postToOutcomeMs.p50} ms, max ${result.release.postToOutcomeMs.max} ms (n=${result.release.postToOutcomeMs.n}); both methods wait for this.`);
    f.push('Slot-proof requests at a real release were not measured (none recorded); no live proof acquisition or hold-producing comparison was run. The live strategy is unchanged.');
    return result;
}
/**
 * Uses only real-release provider traces. A warm-up is never recommended from this alone: a benefit
 * must also be shown by a repeatable measurement of a legitimate read-only route (not done here).
 */
export function connectionWarmth(records) {
    const real = records.filter(record => record.origin === 'REAL_RELEASE');
    const traced = real.flatMap(record => record.attempts.filter(attempt => attempt.reused !== null).map(attempt => ({ record: record.key, attempt })));
    const reused = traced.filter(value => value.attempt.reused).length, fresh = traced.length - reused;
    const releases = new Set(traced.map(value => value.record)).size;
    if (releases < 2 || traced.length < 3)
        return { verdict: 'INSUFFICIENT EVIDENCE', traced: traced.length, reused, fresh, releases,
            reasons: [`${traced.length} traced checkout POST${traced.length === 1 ? '' : 's'} from ${releases} real release${releases === 1 ? '' : 's'} with the current architecture (need at least 3 across 2 releases).`,
                'The historical releases predate the provider trace, so connection reuse at 08:00 was not recorded.'] };
    if (!fresh)
        return { verdict: 'ALREADY WARM — NO EXTRA WARM-UP', traced: traced.length, reused, fresh, releases, reasons: [`All ${traced.length} traced POSTs reused an existing connection.`] };
    return { verdict: 'INSUFFICIENT EVIDENCE', traced: traced.length, reused, fresh, releases,
        reasons: [`${fresh} of ${traced.length} traced POSTs opened a fresh connection. A warm-up is only added after a repeatable read-only measurement shows a material benefit; none has been run.`] };
}
//# sourceMappingURL=checkout-path-research.js.map