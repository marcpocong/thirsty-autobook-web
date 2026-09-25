/**
 * Critical-path telemetry overhead (src/api-booking/critical-path.ts). Offline and CPU-only.
 *
 * It times exactly the calls the runner adds between the release instant and the POSTs, per release:
 *   one mark('*', 'schedulerFired'), then per worker mark(worker, 'workerInvoked') and
 *   observeTransport(worker, CHECKOUT_FUNCTION_ENTERED) and observeTransport(worker, CHECKOUT_PRE_POST).
 * The observation objects already exist in production (the transport builds them for diagnostics), so they
 * are built outside the timed region. Two regimes:
 *   warm  one process, many releases: JIT-optimized steady state;
 *   cold  a fresh process per sample, first release only: what a real release pays once;
 *   cold after warm-up  the same, after warmUpCriticalPath() (what the runner does before release).
 * The timer's own cost (an empty timed region) is measured the same way and reported alongside.
 *
 * Usage: npx tsx scripts/benchmark-critical-path-overhead.ts [--workers 7] [--warm 20000] [--cold 30] [--out file.json]
 */
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { CriticalPathRecorder, warmUpCriticalPath } from '../src/api-booking/critical-path.js';
import type { BrowserTransportObservation } from '../src/api-booking/browser-session-transport.js';
import { summarize } from '../src/arbitration/stats.js';

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index]!.replace(/^--/, ''), process.argv[index + 1] ?? '');
const workerCount = Number(args.get('workers') ?? 7), warmRuns = Number(args.get('warm') ?? 20_000), coldRuns = Number(args.get('cold') ?? 30);
if (![1, 2, 3, 4, 5, 6, 7].includes(workerCount) || !(warmRuns >= 1) || !(coldRuns >= 0)) throw Error('BENCH_ARGS_INVALID');
const workers = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].slice(0, workerCount);
const entered: BrowserTransportObservation = { event: 'CHECKOUT_FUNCTION_ENTERED', preparedContextAgeMs: 1_000, securitySource: 'PREPARED_CONTEXT' };
const prePost: BrowserTransportObservation = { event: 'CHECKOUT_PRE_POST', preparedContextAgeMs: 1_000, securitySource: 'PREPARED_CONTEXT' };

/** Nanoseconds for one release's hot-path telemetry calls. */
function release(): number {
  const recorder = new CriticalPathRecorder(0, 0, 0, workers);
  const start = process.hrtime.bigint();
  recorder.mark('*', 'schedulerFired');
  for (const worker of workers) {
    recorder.mark(worker, 'workerInvoked');
    recorder.observeTransport(worker, entered);
    recorder.observeTransport(worker, prePost);
  }
  return Number(process.hrtime.bigint() - start);
}
function emptyRegion(): number {
  const start = process.hrtime.bigint();
  return Number(process.hrtime.bigint() - start);
}

if (args.get('child') === 'cold' || args.get('child') === 'warmed') {
  // One cold sample: the very first release in a fresh process (optionally after the runner's pre-release warm-up).
  if (args.get('child') === 'warmed') warmUpCriticalPath();
  process.stdout.write(`${JSON.stringify({ releaseNs: release(), emptyNs: emptyRegion() })}\n`);
} else {
  const warm: number[] = [], empty: number[] = [];
  for (let index = 0; index < 2_000; index++) release(); // warm-up, discarded
  for (let index = 0; index < warmRuns; index++) { warm.push(release()); empty.push(emptyRegion()); }
  const children = (mode: 'cold' | 'warmed') => {
    const release: number[] = [], empty: number[] = [];
    for (let index = 0; index < coldRuns; index++) {
      const child = spawnSync(process.execPath, [...process.execArgv, process.argv[1]!, '--workers', String(workerCount), '--child', mode], { encoding: 'utf8' });
      if (child.status !== 0) throw Error(`BENCH_COLD_CHILD_FAILED ${child.stderr}`);
      const sample = JSON.parse(child.stdout.trim().split('\n').at(-1)!) as { releaseNs: number; emptyNs: number };
      release.push(sample.releaseNs); empty.push(sample.emptyNs);
    }
    return { release, empty };
  };
  const { release: cold, empty: coldEmpty } = children('cold'), warmed = children('warmed');
  const us = (values: number[]) => summarize(values.map(value => value / 1_000), 3);
  const report = {
    schema: 'critical-path-overhead/v1', workers: workerCount, callsPerRelease: 1 + 3 * workerCount, host: { platform: process.platform, node: process.version },
    unit: 'microseconds per release (all hot-path telemetry calls of one release, summed across workers)',
    warm: { runs: warmRuns, release: us(warm), emptyTimedRegion: us(empty) },
    cold: { runs: coldRuns, release: us(cold), emptyTimedRegion: us(coldEmpty) },
    coldAfterWarmUp: { runs: coldRuns, release: us(warmed.release), emptyTimedRegion: us(warmed.empty) },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (args.get('out')) await writeFile(args.get('out')!, `${JSON.stringify(report, null, 2)}\n`);
}
