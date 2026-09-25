import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkoutSamples, commitEvidence, compareLanes, congestionEvidence, orderingEvidence, parseNdjson, parseSlotWatch, providerEvidence, staleReadEvidence,
  releaseAttempts, runTrace, vercelIdConsistency } from '../../src/arbitration/archive-evidence.js';
import { buildReleaseTimeline } from '../../src/arbitration/release-timeline.js';
import { clusters, kendallTau, mannWhitney, percentile, seededRandom, summarize } from '../../src/arbitration/stats.js';

const repo = resolve(import.meta.dirname, '../..');
const archive = join(repo, 'diagnostics-archive/2026-09-25/local');
const lines = (path: string) => parseNdjson(readFileSync(join(archive, path), 'utf8'));
const SEP25 = 'fc62669a-bfe5-4726-998a-fa0616bd1e19';

describe('statistics helpers', () => {
  it('computes nearest-rank percentiles, rank correlation, Mann–Whitney and clusters deterministically', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(summarize([1, 2, 3, 4, 100])).toMatchObject({ n: 5, p50: 3, max: 100 });
    expect(kendallTau([1, 2, 3], [3, 2, 1])).toBe(-1);
    expect(kendallTau([1, 2, 3], [1, 2, 3])).toBe(1);
    expect(mannWhitney([1, 2, 3, 4], [5, 6, 7, 8])!.probabilityAGreater).toBe(0);
    expect(mannWhitney([1, 1, 1], [1, 1, 1])!.pTwoSided).toBe(1);
    expect(clusters([{ id: 'a', at: 0 }, { id: 'b', at: 100 }, { id: 'c', at: 1000 }], 150).map(group => group.ids)).toEqual([['a', 'b'], ['c']]);
    const first = seededRandom(7), second = seededRandom(7);
    expect(Array.from({ length: 5 }, first)).toEqual(Array.from({ length: 5 }, second));
  });
});

describe('synthetic traces', () => {
  const base = { runId: 'r1', mode: 'live-now', targetDate: '2026-10-01' };
  const trace = runTrace([
    { ...base, stage: 'RUN_CONFIGURATION', at: '2026-09-30T00:00:00.000Z', bookingMethod: 'proofless' },
    { ...base, stage: 'CHECKOUT_HTTP_POST_INITIATED', workerId: 'A', eventAt: '2026-09-30T00:00:01.000Z' },
    { ...base, stage: 'CHECKOUT_HTTP_POST_INITIATED', workerId: 'B', eventAt: '2026-09-30T00:00:01.004Z' },
    { ...base, stage: 'CHECKOUT_RESPONSE_COMPLETED', workerId: 'B', eventAt: '2026-09-30T00:00:02.000Z', networkDurationMs: 996, statusCode: 200 },
    { ...base, stage: 'CHECKOUT_RESPONSE_COMPLETED', workerId: 'A', eventAt: '2026-09-30T00:00:02.200Z', networkDurationMs: 1200, statusCode: 200 },
    { ...base, stage: 'PENDING_HOLD', workerId: 'B', holdExpiresAt: '2026-09-30T00:10:01.950Z' },
    { ...base, stage: 'PENDING_HOLD', workerId: 'A', holdExpiresAt: '2026-09-30T00:10:02.150Z' },
  ]);

  it('extracts samples, locates the hold commit inside each request and keeps offset-free spreads', () => {
    const samples = checkoutSamples(trace);
    expect(samples.map(sample => [sample.workerId, sample.postMs, sample.concurrentSends])).toEqual([['A', 1200, 2], ['B', 996, 2]]);
    const [run] = commitEvidence(samples);
    expect(run).toMatchObject({ holds: 2, simultaneous: true, sendSpreadMs: 4, commitSpreadMs: 200, commitVsResponseTau: 1 });
    expect(run!.perHold.find(hold => hold.workerId === 'A')).toEqual({ workerId: 'A', durationMs: 1200, commitMinusSendPcMs: 1150, responseMinusCommitPcMs: 50 });
    expect(compareLanes(samples).proofless.n).toBe(2);
  });

  it('computes release ordering from the pre-POST mark plus the measured network duration', () => {
    const release = runTrace([
      { ...base, mode: 'live', stage: 'CHECKOUT_PRE_POST', workerId: 'D', releaseLatenessMs: 1 },
      { ...base, mode: 'live', stage: 'CHECKOUT_HTTP_POST_INITIATED', workerId: 'D', releaseLatenessMs: 10 },
      { ...base, mode: 'live', stage: 'CHECKOUT_RESPONSE_COMPLETED', workerId: 'D', networkDurationMs: 30_000, statusCode: 409 },
      { ...base, mode: 'live', stage: 'CHECKOUT_PRE_POST', workerId: 'A', releaseLatenessMs: 3 },
      { ...base, mode: 'live', stage: 'CHECKOUT_HTTP_POST_INITIATED', workerId: 'A', releaseLatenessMs: 12 },
      { ...base, mode: 'live', stage: 'CHECKOUT_RESPONSE_COMPLETED', workerId: 'A', networkDurationMs: 20_000, statusCode: 409 },
    ]);
    const attempts = releaseAttempts(release);
    expect(attempts.map(attempt => [attempt.workerId, attempt.responseOffsetMs])).toEqual([['D', 30_001], ['A', 20_003]]);
    expect(orderingEvidence(attempts)).toMatchObject({ sendOrder: ['D', 'A'], responseOrder: ['A', 'D'], sendVsResponseTau: -1 });
  });
});

describe.runIf(existsSync(archive))('2026-09-25 archive (regression guard for the published findings)', () => {
  const runner = lines(`api-booking/run-progress/${SEP25}.ndjson`);
  const provider = lines(`release-forensics/${SEP25}/provider-trace.ndjson`);
  const watch = lines('slot-watch/2026-09-27_60d68777-0022-471a-99aa-3a47543858f4.ndjson');

  it('reconstructs seven sends within 2 ms and seven HTTP 409 answers after 29–35 s', () => {
    const attempts = releaseAttempts(runTrace(runner));
    expect(attempts).toHaveLength(7);
    const sends = attempts.map(attempt => attempt.sendOffsetMs!);
    expect(Math.min(...sends)).toBeCloseTo(9.8, 1);
    expect(Math.max(...sends) - Math.min(...sends)).toBeCloseTo(1.9, 1);
    expect(attempts.every(attempt => attempt.statusCode === 409 && attempt.errorHint === 'availability')).toBe(true);
    const ordering = orderingEvidence(attempts);
    expect(ordering.responseOrder).toEqual(['D', 'B', 'C', 'E', 'G', 'F', 'A']);
    expect(ordering.sendVsResponseTau!).toBeLessThan(0.2);
  });

  it('bounds Chrome request start and reads the undocumented x-vercel-id number without trusting it', () => {
    const events = new Map(runner.filter(line => line.stage === 'CHECKOUT_HTTP_POST_INITIATED').map(line => [String(line.workerId), Number(line.releaseLatenessMs)] as const));
    const evidence = providerEvidence(provider, 1790294400000, events);
    expect(evidence.map(item => item.embeddedOffsetMs)).toEqual([30, 31, 32, 31, 32, 38, 34]);
    expect(evidence.every(item => item.reused === true && item.protocol === 'h2' && item.functionRegion === 'sin1')).toBe(true);
    expect(Math.max(...evidence.map(item => item.browserRequestStartUpperBoundMs!))).toBeLessThanOrEqual(10.6);
    expect(evidence.filter(item => item.sizeClass === 'SMALL_~220B').map(item => item.workerId)).toEqual(['C', 'D']);
    const consistency = vercelIdConsistency(evidence, events);
    expect(consistency.lagSummary.min).toBeCloseTo(20.2, 1);
    expect(consistency.closerToSendThanResponse).toBe(true);
  });

  it('finds the stall-then-flush read completions and the end of read congestion', () => {
    const congestion = congestionEvidence(parseSlotWatch(watch)!, 'watch');
    expect(congestion.flushes.map(flush => flush.reads)).toEqual([6, 6]);
    expect(congestion.flushes[1]!.startMs).toBeCloseTo(28867.6, 1);
    expect(congestion.lastSlowReadResponseMs).toBeCloseTo(32846.6, 1);
  });

  it('finds reads that were provably stale during the release window', () => {
    const log = parseSlotWatch(watch)!;
    const stale = staleReadEvidence(log);
    // e.g. the +22.0 s read answered in ~90 ms with 10 taken cells after reads that had already completed showed 27.
    expect(stale.examples.some(example => Math.round(example.requestOffsetMs / 1000) === 22 && example.taken === 10 && example.alreadySeenTaken === 27)).toBe(true);
    expect(stale.byDuration.fastUnder500ms.stale).toBeGreaterThan(0);
    expect(stale.provablyStale).toBeLessThan(stale.reads);
  });

  it('builds a deterministic timeline covering every requested category', () => {
    const build = () => buildReleaseTimeline({ runnerLines: runner, runnerFile: 'runner', slotWatchLines: watch, slotWatchFile: 'watch', providerLines: provider, providerFile: 'provider' });
    const timeline = build();
    expect(JSON.stringify(build())).toBe(JSON.stringify(timeline));
    expect(timeline.dispatchOffsetMs).toBe(23.3);
    const categories = new Set(timeline.events.map(event => event.category));
    for (const category of ['release-deadline', 'scheduler-fired', 'worker-invoked', 'transport-invoked', 'evaluate-entered', 'renderer-fetch-invoked',
      'browser-request-observed', 'provider-edge-evidence', 'response-start', 'response-complete', 'availability-observation', 'inventory-disappearance', 'booking-observation'])
      expect(categories.has(category as never)).toBe(true);
    expect(timeline.events.filter(event => event.category === 'provider-edge-evidence').every(event => event.evidence === 'INFERENCE')).toBe(true);
    expect(timeline.events.filter(event => event.category === 'evaluate-entered').every(event => event.evidence === 'UNKNOWN')).toBe(true);
    const disappearance = timeline.events.filter(event => event.category === 'inventory-disappearance');
    expect(disappearance.map(event => event.subject.split(':')[1]).sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    expect(Math.min(...disappearance.map(event => event.tEndMs!))).toBeLessThan(17_100);
    // Taken cells that reopened: 31 between the +10:00 and +10:30 reads (first-wave holds reaching hold_expires_at; G's whole
    // target among them), plus 6 at +6.5–7 min and 1 at +14 min that cannot all be expiries (the +6.5 min cells were open at publication).
    const expiry = timeline.events.filter(event => event.category === 'hold-expiry');
    expect(expiry).toHaveLength(38);
    const cluster = expiry.filter(event => event.tMs! >= 599_000 && event.tEndMs! <= 631_000);
    expect(cluster).toHaveLength(31);
    const forG = cluster.filter(event => (event.data.targetOf as string[]).includes('G'));
    expect(forG.map(event => event.data.hour)).toEqual(['15:00', '16:00', '17:00']);
    for (const event of forG) {
      expect(event.data.commitNoLaterThanMs as number).toBeGreaterThan(29_000);
      expect(event.data.commitNoLaterThanMs as number).toBeLessThan(31_000);
      expect(event.data.retakenBy).not.toBeNull();
    }
  });
});
