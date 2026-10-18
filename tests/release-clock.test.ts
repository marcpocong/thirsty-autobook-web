import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adoptConsensus, CLOCK_JUMP_LIMIT_MS, clockConsensus, TrustedReleaseClock, waitForMonotonicDeadline, type ClockSample } from '../src/release-clock.js';
import { consensusState, queryGoogleClockConsensus, readNetworkClock, recordClockEvidence, synchronizeNetworkClock } from '../src/network-clock.js';

const sample = (host: string, offsetMs: number, roundTripMs: number): ClockSample => ({ host, offsetMs, roundTripMs });
/** A manual monotonic clock and wall clock for deterministic anchoring. */
function clocks(perf = 1_000, wall = Date.parse('2026-09-24T00:00:00.000Z') - 30_000) {
  const state = { perf, wall };
  return { state, perf: () => state.perf, wall: () => state.wall, advance: (ms: number) => { state.perf += ms; state.wall += ms; } };
}

describe('near-release NTP consensus', () => {
  it('uses several samples and selects the median of the consistent, fast ones', () => {
    const result = clockConsensus([sample('time.google.com', 52, 40), sample('time1.google.com', 50, 38), sample('time2.google.com', 54, 44),
      sample('time3.google.com', 51, 41), sample('time4.google.com', 53, 39)]);
    expect(result).toMatchObject({ method: 'ntp-consensus-v1', offsetMs: 52, sampleCount: 5, keptCount: 5, quality: 'GOOD', spreadMs: 4, minRoundTripMs: 38 });
    expect(result.uncertaintyMs).toBeLessThanOrEqual(21);
    expect(result.uncertaintyMs).toBeGreaterThan(15); // millisecond-scale: never claims better than ~RTT/2
  });
  it('rejects high round-trip outliers instead of trusting them', () => {
    const result = clockConsensus([sample('time.google.com', 50, 40), sample('time1.google.com', 51, 42), sample('time2.google.com', 49, 41),
      sample('time3.google.com', 400, 240), sample('time4.google.com', -300, 900)]);
    expect(result.offsetMs).toBe(50);
    expect(result.samples.filter(value => !value.kept).map(value => value.host).sort()).toEqual(['time3.google.com', 'time4.google.com']);
    expect(result.sampleCount).toBe(4); // the 900 ms sample is beyond the ceiling and never counted
  });
  it('rejects a fast but inconsistent sample whose +/- RTT/2 interval misses the others', () => {
    const result = clockConsensus([sample('time.google.com', 50, 40), sample('time1.google.com', 52, 40), sample('time2.google.com', 51, 42),
      sample('time3.google.com', 130, 41)]);
    expect(result.offsetMs).toBe(51);
    expect(result.samples.find(value => value.host === 'time3.google.com')!.kept).toBe(false);
  });
  it('is deterministic regardless of sample order', () => {
    const values = [sample('time.google.com', -20, 35), sample('time1.google.com', -24, 33), sample('time2.google.com', -21, 50), sample('time3.google.com', -19, 36)];
    const a = clockConsensus(values), b = clockConsensus([...values].reverse());
    expect(a.offsetMs).toBe(b.offsetMs);
    expect(a.bestHost).toBe(b.bestHost);
    expect(a.uncertaintyMs).toBe(b.uncertaintyMs);
  });
  it('handles negative offsets (PC ahead of network time)', () => {
    expect(clockConsensus([sample('time.google.com', -120, 30), sample('time1.google.com', -118, 32), sample('time2.google.com', -121, 31)]).offsetMs).toBe(-120);
  });
  it('degraded when fewer than three consistent samples; fails when none', () => {
    expect(clockConsensus([sample('time.google.com', 50, 40), sample('time1.google.com', 51, 40)]).quality).toBe('DEGRADED');
    expect(() => clockConsensus([])).toThrow('NETWORK_CLOCK_SYNC_FAILED');
    expect(() => clockConsensus([sample('time.google.com', 50, 600)])).toThrow('NETWORK_CLOCK_SYNC_FAILED');
  });
  it('one round samples every approved Google host several times, in parallel, and tolerates failures', async () => {
    const calls: string[] = [];
    const result = await queryGoogleClockConsensus({ spacingMs: 1, sampler: async host => {
      calls.push(host);
      if (host === 'time4.google.com') throw Error('NETWORK_CLOCK_TIMEOUT');
      return sample(host, 40 + calls.length % 3, 40);
    } });
    expect(new Set(calls)).toEqual(new Set(['time.google.com', 'time1.google.com', 'time2.google.com', 'time3.google.com', 'time4.google.com']));
    expect(calls).toHaveLength(10);
    expect(result.sampleCount).toBe(8);
    expect(result.quality).toBe('GOOD');
  });
  it('persists a compatible clock state and sanitized evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'clock-'));
    const consensus = clockConsensus([sample('time2.google.com', 52.0859375, 44), sample('time.google.com', 51, 46), sample('time1.google.com', 53, 45)]);
    const state = await synchronizeNetworkClock(join(directory, 'network-clock.json'), async () => consensus);
    expect(readNetworkClock(join(directory, 'network-clock.json'))).toEqual(state);
    expect(state).toMatchObject({ source: 'time2.google.com', method: 'ntp-consensus-v1', sampleCount: 3, quality: 'GOOD' });
    expect(consensusState(consensus).offsetMs).toBe(consensus.offsetMs);
    recordClockEvidence(consensus, 'T-30S', join(directory, 'evidence'));
    const [file] = await readdir(join(directory, 'evidence'));
    const text = await readFile(join(directory, 'evidence', file!), 'utf8');
    expect(JSON.parse(text)).toMatchObject({ checkpoint: 'T-30S', method: 'ntp-consensus-v1', keptCount: 3 });
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(() => recordClockEvidence(consensus, 'bad checkpoint!', join(directory, 'evidence'))).toThrow('NETWORK_CLOCK_CHECKPOINT_INVALID');
  });
});

describe('monotonic release deadline', () => {
  const releaseMs = Date.parse('2026-09-24T00:00:00.000Z');
  it('maps the release epoch onto performance.now() using the consensus offset (positive and negative)', () => {
    for (const offset of [52.1, -73.4, 0]) {
      const c = clocks(5_000, releaseMs - 30_000 - offset);
      const clock = TrustedReleaseClock.fromOffset(offset, { method: 'test', sampleCount: 5 }, c.perf, c.wall);
      // wall + offset = release - 30 s at anchor, so the deadline is 30 s of monotonic time later.
      expect(clock.monotonicDeadline(releaseMs)).toBeCloseTo(5_000 + 30_000, 6);
      c.advance(30_000);
      expect(clock.nowMs()).toBeCloseTo(releaseMs, 6);
    }
  });
  it('is immune to a wall-clock step after anchoring (and reports the disagreement)', () => {
    const c = clocks(0, releaseMs - 10_000);
    const clock = TrustedReleaseClock.fromOffset(0, { method: 'test', sampleCount: 5 }, c.perf, c.wall);
    c.state.wall -= 250; // Windows steps the wall clock back
    expect(clock.monotonicDeadline(releaseMs)).toBe(10_000);
    expect(clock.wallDisagreementMs()).toBe(-250);
  });
  it('a refreshed consensus re-anchors and the wait re-reads the recomputed deadline', async () => {
    const c = clocks(0, releaseMs - 1_000);
    let clock = TrustedReleaseClock.fromOffset(0, { method: 'first', sampleCount: 5 }, c.perf, c.wall);
    const sleeps: number[] = [];
    let refreshed = false;
    await waitForMonotonicDeadline(() => clock.monotonicDeadline(releaseMs), { spinTailMs: 20, isAborted: () => false, perf: c.perf,
      sleep: async ms => { sleeps.push(ms); c.advance(ms);
        // A later round finds the PC 30 ms behind: the release instant moves 30 ms earlier in monotonic time.
        if (!refreshed) { refreshed = true; clock = adoptConsensus(clock, TrustedReleaseClock.fromOffset(30, { method: 'second', sampleCount: 5 }, c.perf, c.wall), releaseMs).clock; } },
      spin: async () => { c.advance(0.25); } });
    expect(refreshed).toBe(true);
    expect(c.perf()).toBeGreaterThanOrEqual(clock.monotonicDeadline(releaseMs));
    expect(c.perf() - clock.monotonicDeadline(releaseMs)).toBeLessThan(0.3);
    expect(sleeps[0]).toBe(500);
  });
  it('never returns before the deadline, sleeps only until deadline - tail, then spins', async () => {
    const c = clocks(0, 0);
    const events: string[] = [];
    await waitForMonotonicDeadline(() => 137.5, { spinTailMs: 50, isAborted: () => false, perf: c.perf,
      sleep: async ms => { events.push(`sleep:${ms}`); c.advance(ms + 15.6); }, // a Windows timer that overshoots by a full quantum
      spin: async () => { events.push('spin'); c.advance(0.5); } });
    expect(c.perf()).toBeGreaterThanOrEqual(137.5);
    expect(events[0]).toBe('sleep:87.5');
    expect(events.slice(1).every(event => event === 'spin')).toBe(true);
  });
  it('abort stops the wait', async () => {
    let aborted = false;
    const c = clocks(0, 0);
    await expect(waitForMonotonicDeadline(() => 1_000, { spinTailMs: 20, isAborted: () => aborted, perf: c.perf,
      sleep: async ms => { c.advance(ms); aborted = true; } })).rejects.toThrow('USER_ABORT');
  });
  it('a large EARLIER jump between rounds is not adopted; a later or small change is', () => {
    const c = clocks(0, releaseMs - 60_000);
    const base = TrustedReleaseClock.fromOffset(50, { method: 'a', sampleCount: 5 }, c.perf, c.wall);
    const earlier = TrustedReleaseClock.fromOffset(50 + CLOCK_JUMP_LIMIT_MS + 50, { method: 'b', sampleCount: 5 }, c.perf, c.wall);
    const later = TrustedReleaseClock.fromOffset(-400, { method: 'c', sampleCount: 5 }, c.perf, c.wall);
    const small = TrustedReleaseClock.fromOffset(70, { method: 'd', sampleCount: 5 }, c.perf, c.wall);
    expect(adoptConsensus(base, earlier, releaseMs)).toEqual({ clock: base, jumpRejected: true });
    expect(adoptConsensus(base, later, releaseMs).clock).toBe(later);
    expect(adoptConsensus(base, small, releaseMs).clock).toBe(small);
    expect(adoptConsensus(undefined, earlier, releaseMs).clock).toBe(earlier);
  });
  it('rejects a non-finite offset (a failed sync can never anchor the release clock)', () => {
    expect(() => TrustedReleaseClock.fromOffset(Number.NaN, { method: 'x', sampleCount: 0 })).toThrow('NETWORK_CLOCK_OFFSET_INVALID');
  });
  it('updates a shared prewarm clock without permitting a large earlier release jump', () => {
    const c = clocks(0, releaseMs - 120_000);
    const clock = TrustedReleaseClock.fromOffset(50, { method: 'initial', sampleCount: 5 }, c.perf, c.wall);
    const shared = clock;
    const deadline = clock.monotonicDeadline(releaseMs);
    expect(clock.adopt(TrustedReleaseClock.fromOffset(500, { method: 'bad', sampleCount: 5 }, c.perf, c.wall), releaseMs)).toBe(false);
    expect(shared.monotonicDeadline(releaseMs)).toBe(deadline);
    expect(clock.adopt(TrustedReleaseClock.fromOffset(70, { method: 'final', sampleCount: 10 }, c.perf, c.wall), releaseMs)).toBe(true);
    expect(shared).toBe(clock);
    expect(shared.offsetMs).toBe(70);
    expect(shared.evidence.method).toBe('final');
    expect(shared.monotonicDeadline(releaseMs)).toBe(deadline - 20);
  });
});

describe('clock and arm stage events reach the operator UI', () => {
  it('the strict UI event schema accepts consensus evidence and the armed stage', async () => {
    const { UiEventSchema } = await import('../src/ui-events.js');
    expect(UiEventSchema.parse({ type: 'apiStage', stage: 'NETWORK_CLOCK_CONSENSUS', elapsedMs: 1, checkpoint: 'T-30S', offsetMs: 52.1, roundTripMs: 38,
      deltaMs: 1.2, sampleCount: 10, spreadMs: 3.2, uncertaintyMs: 19.4 })).toMatchObject({ sampleCount: 10, uncertaintyMs: 19.4 });
    expect(UiEventSchema.parse({ type: 'apiStage', stage: 'PRECISION_ARMED', elapsedMs: 2, frozenCount: 7, unsentCount: 0, releaseMs: 1_790_208_000_000 }))
      .toMatchObject({ frozenCount: 7 });
    expect(UiEventSchema.parse({type:'apiStage',stage:'CRITICAL_PATH_SAVED',elapsedMs:3,workerCount:7,maxPrePostMs:1.1,
      maxFetchInvokedMs:2.2,maxBrowserRequestStartMs:3.3,maxRequestObservedMs:4.4})).toMatchObject({maxRequestObservedMs:4.4});
    expect(UiEventSchema.safeParse({type:'apiStage',stage:'CRITICAL_PATH_SAVED',elapsedMs:3,maxUnknownTimingMs:1}).success).toBe(false);
    expect(UiEventSchema.safeParse({ type: 'apiStage', stage: 'NETWORK_CLOCK_CONSENSUS', elapsedMs: 1, spreadMs: -1 }).success).toBe(false);
  });
});
