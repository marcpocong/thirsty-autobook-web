import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FanOutProfileSchema, profileCompatibility, readLatestCompatibleFanOutProfile, recommendFanOutWidth, summarizeWidth,
  type ChildSample, type FanOutProfile, type RunSample, type WidthSummary } from '../src/fanout-capacity.js';
import { customFanOutTiming, describeChildTiming, fanOutTimingPlan, minimumMeaningfulSpacingMs } from '../src/fanout-timing.js';
import { readSecurityPrepSamples, securityPrepHistory } from '../src/security-prep-history.js';
import { CriticalPathRecorder } from '../src/api-booking/critical-path.js';

/** Synthetic runs: child j of worker w starts `base + w*perWorker + j*perChild (+jitter)` ms after its configured trigger. */
function runs(width: number, options: { base: number; perWorker: number; perChild: number; jitter?: number; count?: number; workers?: number; outlier?: number }): RunSample[] {
  const workers = options.workers ?? 7;
  return Array.from({ length: options.count ?? 40 }, (_, run) => ({ run, width, workers, firstTriggerOffsetMs: 0, nodeCpuMs: 50 + run, systemBusyPct: 10 + (run % 5),
    children: Array.from({ length: workers * width }, (_, index): ChildSample => {
      const worker = Math.floor(index / width), child = index % width;
      const lag = options.base + worker * options.perWorker + child * options.perChild + ((run * 7 + index * 3) % 10) / 10 * (options.jitter ?? 1)
        + (run === 39 && index === 0 ? options.outlier ?? 0 : 0);
      return { run, workerIndex: worker, workerId: String.fromCharCode(65 + worker), fanOutIndex: child, fanOutCount: width, configuredOffsetMs: 0,
        schedulerWakeMs: 0.1, workerInvokedMs: 0.5, transportEnteredMs: 0.6, prePostMs: 0.7, evaluateEnteredMs: lag - 2, fetchInvokedMs: lag - 1,
        chromeStartMs: lag, requestEventMs: lag + 3, responseMs: lag + 10, state: 'REJECTED', prewarmDurationMs: 6, prewarmReadyMs: -1_490 };
    }) }));
}
const summaries = (perChild: number, outlierAt?: number): WidthSummary[] =>
  [1, 2, 3, 4].map(width => summarizeWidth(width, runs(width, { base: 3, perWorker: 0.4, perChild, outlier: width === outlierAt ? 60 : 0 })));

describe('Fan-out Capacity Profile', () => {
  it('summarizes configured-trigger → Chrome start per width, child index, worker and spread', () => {
    const [one, , , four] = summaries(1.5);
    expect(one!.attempts).toBe(7);
    expect(four!.attempts).toBe(28);
    expect(four!.perChildIndex.map(value => value.fanOutIndex)).toEqual([0, 1, 2, 3]);
    expect(four!.perChildIndex[3]!.triggerToChromeStart.p95!).toBeGreaterThan(four!.perChildIndex[0]!.triggerToChromeStart.p95!);
    expect(Object.keys(four!.perWorker)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    expect(four!.spread.p95!).toBeGreaterThan(one!.spread.p95!);
    expect(four!.earlyTransmissions).toBe(0);
    expect(four!.prewarm.lastReadyMarginMs.min).toBeCloseTo(1_490);
  });

  it('recommends the widest width that stays inside the local regression gates, and explains why', () => {
    const cheap = recommendFanOutWidth(summaries(0.3));
    expect(cheap.width).toBe(4);
    expect(cheap.localDispatchOnly).toBe(true);
    const costly = recommendFanOutWidth(summaries(4));
    expect(costly.width).toBe(2);
    expect(costly.reasons.join('\n')).toMatch(/14-way fan-out \(2 per target\) stays inside the local dispatch regression gates/);
    expect(costly.reasons.join('\n')).toMatch(/21-way fan-out \(3 per target\) exceeds the local gates/);
  });

  it('a single tail outlier at a width fails its p99/max-sensitive gate even when the median is fine', () => {
    const recommendation = recommendFanOutWidth(summaries(0.3, 3));
    expect(recommendation.width).toBe(2);
    expect(recommendation.gates.some(gate => gate.width === 3 && !gate.pass && gate.gate.includes('.max'))).toBe(true);
  });

  it('never recommends fan-out when a safety or readiness gate fails', () => {
    const unsafe = summaries(0.3);
    unsafe[1]!.states = { REJECTED: 500, UNKNOWN: 1 };
    expect(recommendFanOutWidth(unsafe).width).toBe(1);
    const late = summaries(0.3);
    late[2]!.prewarm = { ...late[2]!.prewarm, notReady: 3 };
    expect(recommendFanOutWidth(late).width).toBe(2);
    expect(recommendFanOutWidth([]).width).toBe(1);
  });
});

const machine = { cpuModel: 'Test CPU', logicalCores: 20, totalMemGb: 32, platform: 'win32', osRelease: '10.0', chromeVersion: 'Chrome/154' };
function profile(createdAt: string, extra: Partial<FanOutProfile> = {}): FanOutProfile {
  const widths = summaries(2.5);
  return FanOutProfileSchema.parse({ schema: 'fanout-capacity-profile/v1', createdAt, build: { gitSha: 'a'.repeat(40), buildId: 'aaaaaaa', dirty: false }, machine,
    config: { workers: 7, widths: [1, 2, 3, 4], runsPerWidth: 40, pattern: 'burst', dispatcher: 'central', prewarmLeadMs: 1500, prewarmConcurrency: null, headed: false,
      syntheticPrewarm: 'cpu:0,wait:0', pageBusy: '0' }, widths, recommendation: recommendFanOutWidth(widths), ...extra });
}
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

describe('machine profile selection', () => {
  it('reads the newest compatible profile and skips other machines, dispatchers and malformed files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'profiles-')); directories.push(root);
    await mkdir(join(root, '.local/fanout-capacity'), { recursive: true });
    const write = (name: string, value: unknown) => writeFile(join(root, '.local/fanout-capacity', name), typeof value === 'string' ? value : JSON.stringify(value));
    await write('profile-1.json', profile('2026-09-20T00:00:00.000Z'));
    await write('profile-2.json', profile('2026-09-28T00:00:00.000Z', { machine: { ...machine, cpuModel: 'Other CPU' } }));
    const coordinator = profile('2026-09-29T00:00:00.000Z'); coordinator.config.dispatcher = 'coordinator';
    await write('profile-3.json', coordinator);
    await write('profile-4.json', '{ not json');
    const found = readLatestCompatibleFanOutProfile(root, { machine, now: Date.parse('2026-09-29T06:00:00.000Z') });
    expect(found?.profile.createdAt).toBe('2026-09-20T00:00:00.000Z');
    expect(found?.compatibility).toMatchObject({ compatible: true, stale: false });
    expect(readLatestCompatibleFanOutProfile(root, { machine: { ...machine, logicalCores: 8 } })).toBeNull();
  });
  it('flags old profiles, other builds and a changed Chrome', () => {
    const value = profileCompatibility(profile('2026-08-01T00:00:00.000Z'), { machine: { ...machine, chromeVersion: 'Chrome/155' }, gitSha: 'b'.repeat(40), now: Date.parse('2026-09-29T00:00:00Z') });
    expect(value.compatible).toBe(true);
    expect(value.stale).toBe(true);
    expect(value.notes.join(' ')).toMatch(/30 days/);
    expect(value.notes.join(' ')).toMatch(/Chrome changed/);
  });
});

describe('machine-derived timing presets', () => {
  const measured = profile('2026-09-29T00:00:00.000Z');
  it('derives spacing from measured jitter and never goes below the minimum meaningful spacing', () => {
    const minimum = minimumMeaningfulSpacingMs(measured, 3).spacingMs;
    const tight = fanOutTimingPlan('TIGHT', 3, measured), balanced = fanOutTimingPlan('BALANCED', 3, measured), wide = fanOutTimingPlan('WIDE', 3, measured);
    expect(tight.spacingMs).toBeGreaterThanOrEqual(minimum);
    expect(balanced.spacingMs).toBeGreaterThan(tight.spacingMs);
    expect(wide.spacingMs).toBeGreaterThan(balanced.spacingMs);
    expect(balanced.children.map(child => child.configuredOffsetMs)).toEqual([-2 * balanced.spacingMs, -balanced.spacingMs, 0]);
    expect(balanced.basis).toMatch(/Measured 7×3/);
  });
  it('keeps configured, predicted Chrome start and network arrival distinct', () => {
    const plan = fanOutTimingPlan('BALANCED', 2, measured);
    const child = plan.children[0]!;
    expect(child.predictedChromeStartMs![0]).toBeGreaterThan(child.configuredOffsetMs);
    expect(describeChildTiming(child)).toMatch(/^Configured −\d+ ms · expected Chrome start ≈ .+ \(local prediction, not network arrival\)$/);
  });
  it('without a profile uses a conservative spacing, labelled as not measured', () => {
    const plan = fanOutTimingPlan('TIGHT', 2, null);
    expect(plan.spacingMs).toBe(10);
    expect(plan.warnings.join(' ')).toMatch(/not a measurement/);
    expect(plan.children[0]!.predictedChromeStartMs).toBeNull();
  });
  it('Custom offsets are validated and warned when closer than the machine can keep apart', () => {
    const custom = customFanOutTiming([-2, -1, 0], measured);
    expect(custom.preset).toBe('CUSTOM');
    expect(custom.warnings.join(' ')).toMatch(/cannot reliably keep children closer/);
    expect(() => customFanOutTiming([-3000, 0], measured)).toThrow('FANOUT_OFFSET_INVALID');
    expect(() => customFanOutTiming([1], measured)).toThrow('FANOUT_OFFSET_INVALID');
  });
});

describe('measured security preparation history', () => {
  it('reads FRESH_ACQUISITION durations with their concurrency and ignores failures and other sources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'prep-')); directories.push(root);
    const dir = join(root, '.local/api-booking/run-progress');
    await mkdir(dir, { recursive: true });
    const line = (durationMs: number, activeSecurity: number, extra: Record<string, unknown> = {}) => JSON.stringify({ stage: 'SECURITY_PREPARATION_COMPLETED',
      securitySource: 'FRESH_ACQUISITION', durationMs, activeSecurity, at: '2026-09-29T00:00:00Z', ...extra });
    await writeFile(join(dir, 'run.ndjson'), [line(3000, 0), line(3500, 1), line(4000, 2), line(4200, 3), line(4400, 4), line(9000, 27), line(11800, 27),
      line(100, 0, { failureCategory: 'X' }), line(50, 0, { securitySource: 'RECENT_CONTEXT_REUSE' }), '{torn'].join('\n'));
    expect(readSecurityPrepSamples(root).samples).toHaveLength(7);
    const low = securityPrepHistory(root, 7);
    expect(low).toMatchObject({ samples: 5, atConcurrency: 7, p95Ms: 4400 });
    expect(securityPrepHistory(root, 28).p95Ms).toBe(11800);
  });
});

describe('critical-path rows per fan-out child', () => {
  it('lands a child tab\'s transport observations and the dispatcher marks on the same attempt row', () => {
    let now = 1_000;
    const recorder = new CriticalPathRecorder(0, 1_000, 0, ['attempt-A1'], () => now);
    recorder.alias('A:1', 'attempt-A1');
    now = 1_002; recorder.mark('attempt-A1', 'workerInvoked');
    now = 1_003; recorder.observeTransport('A:1', { event: 'CHECKOUT_PRE_POST', preparedContextAgeMs: 1, securitySource: 'PREPARED_CONTEXT' });
    const rows = recorder.rows();
    expect(rows.map(row => row.workerId)).toEqual(['attempt-A1']);
    expect(rows[0]).toMatchObject({ workerInvokedMs: 2, prePostMs: 3 });
  });
});
