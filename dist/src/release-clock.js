import { performance } from 'node:perf_hooks';
/** Samples slower than this are never used; Google NTP from Manila is normally 30-60 ms. */
export const CONSENSUS_RTT_CEILING_MS = 250;
/** A near-release round needs this many consistent samples to be adopted. */
export const CONSENSUS_MIN_KEPT = 3;
const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const tenth = (value) => Math.round(value * 10) / 10;
/**
 * Deterministic consensus: drop failed/slow samples, keep round trips within
 * max(2 x fastest, fastest + 15 ms), then keep only samples whose +/- r/2
 * interval (plus 2 ms server-timestamp slack) contains the provisional median.
 * The selected offset is the median of what remains.
 */
export function clockConsensus(samples, minKept = CONSENSUS_MIN_KEPT) {
    const valid = samples.filter(sample => Number.isFinite(sample.offsetMs) && Number.isFinite(sample.roundTripMs) &&
        sample.roundTripMs >= 0 && sample.roundTripMs <= CONSENSUS_RTT_CEILING_MS && Math.abs(sample.offsetMs) <= 5 * 60_000);
    if (!valid.length)
        throw Error('NETWORK_CLOCK_SYNC_FAILED');
    const fastest = Math.min(...valid.map(sample => sample.roundTripMs));
    const rttCutoff = Math.max(fastest * 2, fastest + 15);
    const quick = valid.filter(sample => sample.roundTripMs <= rttCutoff);
    const provisional = median(quick.map(sample => sample.offsetMs));
    let kept = quick.filter(sample => Math.abs(sample.offsetMs - provisional) <= sample.roundTripMs / 2 + 2);
    if (!kept.length)
        kept = quick;
    const offsetMs = median(kept.map(sample => sample.offsetMs));
    const keptSet = new Set(kept);
    const rtts = valid.map(sample => sample.roundTripMs);
    const best = [...kept].sort((a, b) => a.roundTripMs - b.roundTripMs || a.host.localeCompare(b.host))[0];
    return {
        method: 'ntp-consensus-v1', offsetMs, sampleCount: valid.length, keptCount: kept.length, rejectedCount: samples.length - kept.length,
        minRoundTripMs: fastest, medianRoundTripMs: median(rtts), maxRoundTripMs: Math.max(...rtts),
        spreadMs: Math.max(...kept.map(sample => sample.offsetMs)) - Math.min(...kept.map(sample => sample.offsetMs)),
        uncertaintyMs: Math.min(...kept.map(sample => Math.abs(offsetMs - sample.offsetMs) + sample.roundTripMs / 2)),
        quality: kept.length >= minKept ? 'GOOD' : 'DEGRADED', bestHost: best.host,
        samples: samples.map(sample => ({ host: sample.host, offsetMs: tenth(sample.offsetMs), roundTripMs: tenth(sample.roundTripMs), kept: keptSet.has(sample) })),
    };
}
/**
 * Network-corrected time carried by the monotonic clock. At anchoring the
 * network time is wall + offset; afterwards it advances with performance.now(),
 * so a Windows wall-clock step after sampling cannot move the release instant.
 * The final wait and the final no-early check read the same anchored clock.
 */
export class TrustedReleaseClock {
    anchorPerf;
    anchorEpoch;
    offsetMs;
    evidence;
    perf;
    wall;
    constructor(anchorPerf, anchorEpoch, offsetMs, evidence, perf, wall) {
        this.anchorPerf = anchorPerf;
        this.anchorEpoch = anchorEpoch;
        this.offsetMs = offsetMs;
        this.evidence = evidence;
        this.perf = perf;
        this.wall = wall;
    }
    static fromOffset(offsetMs, evidence, perf = () => performance.now(), wall = Date.now) {
        if (!Number.isFinite(offsetMs))
            throw Error('NETWORK_CLOCK_OFFSET_INVALID');
        const anchorPerf = perf();
        return new TrustedReleaseClock(anchorPerf, wall() + offsetMs, offsetMs, evidence, perf, wall);
    }
    nowMs() { return this.anchorEpoch + (this.perf() - this.anchorPerf); }
    /** performance.now() value at which the trusted clock reads epochMs. */
    monotonicDeadline(epochMs) { return this.anchorPerf + (epochMs - this.anchorEpoch); }
    /** How far the wall clock (plus the same offset) has moved away from the anchored clock; non-zero after a wall-clock step. */
    wallDisagreementMs() { return this.wall() + this.offsetMs - this.nowMs(); }
}
/** Rounds before the final release deadline. A refresh re-anchors and the deadline is recomputed. */
export const RELEASE_CLOCK_ROUNDS = [{ label: 'T-60S', beforeMs: 60_000 }, { label: 'T-30S', beforeMs: 30_000 }];
/** A consensus that moves the release instant by more than this between rounds is not trusted to move it EARLIER. */
export const CLOCK_JUMP_LIMIT_MS = 100;
/**
 * Chooses the clock for the final wait after a new consensus. A small change is adopted.
 * A large change is adopted only if it makes release happen later (never earlier), since
 * one inconsistent round must not cause an early send.
 */
export function adoptConsensus(previous, next, releaseMs) {
    if (!previous)
        return { clock: next, jumpRejected: false };
    const delta = next.monotonicDeadline(releaseMs) - previous.monotonicDeadline(releaseMs);
    if (Math.abs(delta) <= CLOCK_JUMP_LIMIT_MS || delta > 0)
        return { clock: next, jumpRejected: false };
    return { clock: previous, jumpRejected: true };
}
/** Chosen by benchmark (see RELEASE_LATENCY_PHASE1.md); larger than the ~15.6 ms Windows timer quantum. */
export const DEFAULT_SPIN_TAIL_MS = 50;
/**
 * Waits until performance.now() >= deadline(). Timers only sleep until
 * deadline - spinTailMs (Windows timers overshoot by up to one timer quantum);
 * the rest is a setImmediate spin, which keeps abort and I/O responsive.
 * The deadline is re-read every iteration so a clock refresh moves it.
 */
export async function waitForMonotonicDeadline(deadline, options) {
    const perf = options.perf ?? (() => performance.now());
    const sleep = options.sleep ?? (ms => new Promise(done => setTimeout(done, ms)));
    const spin = options.spin ?? (() => new Promise(done => setImmediate(done)));
    while (true) {
        if (options.isAborted())
            throw Error('USER_ABORT');
        const remaining = deadline() - perf();
        if (remaining <= 0)
            return;
        if (remaining > options.spinTailMs)
            await sleep(Math.min(500, Math.max(1, remaining - options.spinTailMs)));
        else
            await spin();
    }
}
//# sourceMappingURL=release-clock.js.map