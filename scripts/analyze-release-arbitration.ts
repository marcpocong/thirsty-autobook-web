/**
 * Offline arbitration analysis of archived release evidence. Read-only: no network, browser or checkout.
 *
 *   npx tsx scripts/analyze-release-arbitration.ts                     (defaults: the 2026-09-25 archive)
 *   npx tsx scripts/analyze-release-arbitration.ts --archive <dir> --out <dir> --run <runId> --watch <slot-watch.ndjson>
 *
 * Writes (deterministically; re-running on the same archive gives byte-identical files):
 *   <out>/release-2026-09-25.timeline.jsonl   one normalized event per line (schema release-timeline/v1)
 *   <out>/arbitration-evidence.json           lane comparison, hold-commit position, congestion, ordering, x-vercel-id, 409 sizes
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { checkoutSamples, commitEvidence, compareLanes, congestionEvidence, holdReopenings, orderingEvidence, parseNdjson, parseSlotWatch, providerEvidence, staleReadEvidence,
  readRunTraces, releaseAttempts, vercelIdConsistency, type Line } from '../src/arbitration/archive-evidence.js';
import { buildReleaseTimeline } from '../src/arbitration/release-timeline.js';
import { summarize } from '../src/arbitration/stats.js';

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index]!.replace(/^--/, ''), process.argv[index + 1] ?? '');
const repo = resolve(import.meta.dirname, '..');
const archive = resolve(args.get('archive') ?? join(repo, 'diagnostics-archive/2026-09-25/local'));
const out = resolve(args.get('out') ?? join(repo, 'diagnostics-archive/2026-09-25/arbitration'));
const runId = args.get('run') ?? 'fc62669a-bfe5-4726-998a-fa0616bd1e19';
const watchFile = args.get('watch') ?? '2026-09-27_60d68777-0022-471a-99aa-3a47543858f4.ndjson';
const rel = (path: string) => relative(repo, path).split('\\').join('/');
const read = (path: string) => parseNdjson(readFileSync(path, 'utf8'));

// ---- Sept 25 timeline -------------------------------------------------------------------------
const runnerPath = join(archive, 'api-booking/run-progress', `${runId}.ndjson`);
const watchPath = join(archive, 'slot-watch', watchFile);
const providerPath = join(archive, 'release-forensics', runId, 'provider-trace.ndjson');
const runnerLines = read(runnerPath);
const journalRoot = join(archive, 'api-booking/api-first-journals');
const release = Number((runnerLines.find(line => line.stage === 'RUN_CONFIGURATION') as Line).releaseMs);
const journals = existsSync(journalRoot) ? readdirSync(journalRoot).sort().flatMap(directory => {
  const file = join(journalRoot, directory, `${directory}.json`);
  if (!existsSync(file)) return [];
  const record = JSON.parse(readFileSync(file, 'utf8')) as Line;
  return (record.attempt as Line | undefined)?.releaseMs === release ? [{ file: rel(file), record }] : [];
}) : [];
const timeline = buildReleaseTimeline({ runnerLines, runnerFile: rel(runnerPath), slotWatchLines: read(watchPath), slotWatchFile: rel(watchPath),
  providerLines: existsSync(providerPath) ? read(providerPath) : [], providerFile: rel(providerPath), journals });

// ---- Cross-run evidence ------------------------------------------------------------------------
const traces = readRunTraces(join(archive, 'api-booking/run-progress'));
const samples = traces.flatMap(checkoutSamples);
const lanes = compareLanes(samples);
const commits = commitEvidence(samples.filter(sample => sample.mode === 'live-now'));

const requestEvents = new Map(runnerLines.filter(line => line.stage === 'CHECKOUT_HTTP_POST_INITIATED')
  .map(line => [String(line.workerId), Number(line.releaseLatenessMs)] as const));
const provider = existsSync(providerPath) ? providerEvidence(read(providerPath), release, requestEvents) : [];
const sep25Trace = traces.find(trace => trace.runId === runId)!;
const sep25Attempts = releaseAttempts(sep25Trace);
const sep24Trace = traces.find(trace => trace.runId.startsWith('8bcc1790'));
const sep23Trace = traces.find(trace => trace.runId.startsWith('88473147'));

const watch25 = parseSlotWatch(read(watchPath))!;
const watch24Path = join(archive, 'slot-watch', '2026-09-26_d4cc58f6-2624-48fa-a60e-40736380511d.ndjson');
const watch24 = existsSync(watch24Path) ? parseSlotWatch(read(watch24Path)) : null;
/** Reopened cells around +10 min (observer clock; ±tens of ms against the dispatch clock is irrelevant at this scale). */
function holdExpirySummary(log: NonNullable<ReturnType<typeof parseSlotWatch>>) {
  const reopenings = holdReopenings(log.reads.filter(read => read.kind === 'availability' && read.outcome === 'ok'));
  const bounds = reopenings.map(value => value.commitNoLaterThanMs);
  return { provenance: 'FACT: cells taken then open in our own reads around +10 min. INFERENCE: pending holds reaching hold_expires_at (commit + 10 min); a cancellation looks the same.',
    reopenedCells: reopenings.length, commitNoLaterThanMs: bounds.length ? { min: Math.min(...bounds), max: Math.max(...bounds) } : null,
    retakenCells: reopenings.filter(value => value.retakenBy).length, cells: reopenings };
}
const sep23Release = Date.parse('2026-09-23T00:00:00.000Z');
const sep23Reads = (sep23Trace?.lines ?? []).filter(line => line.stage === 'SPECIAL_AVAILABILITY_SAMPLE').map(line => {
  const at = Date.parse(String(line.at)), duration = Number(line.durationMs);
  return { requestOffsetMs: at - duration - sep23Release, responseOffsetMs: at - sep23Release, durationMs: duration, published: line.dateReturned === true };
}).filter(read => read.requestOffsetMs >= 0 && read.requestOffsetMs < 120_000);
const sep23Attempts = existsSync(journalRoot) ? readdirSync(journalRoot).sort().flatMap(directory => {
  const file = join(journalRoot, directory, `${directory}.json`);
  if (!existsSync(file)) return [];
  const record = JSON.parse(readFileSync(file, 'utf8')) as Line, attempt = (record.attempt ?? {}) as Line;
  if (attempt.targetDate !== '2026-09-25' || record.state !== 'rejected') return [];
  const created = Date.parse(String(record.createdAt)), updated = Date.parse(String(record.updatedAt));
  if (created < sep23Release - 60_000 || created > sep23Release + 60_000) return [];
  return [{ courtIds: attempt.courtIds, hours: (attempt.hourlyBoundaries as Line[] | undefined)?.map(value => value.startTime), sendOffsetMs: created - sep23Release,
    responseOffsetMs: updated - sep23Release, diagnostic: record.diagnostic, provenance: 'FACT: journal createdAt/updatedAt on the runner network-corrected clock (1 ms); createdAt precedes the POST by < 1 ms of in-memory work' }];
}) : [];

const round1 = (value: number | null) => value === null ? null : Math.round(value * 10) / 10;
const evidence = {
  schema: 'arbitration-evidence/v1',
  sources: { archive: rel(archive), runner: rel(runnerPath), slotWatch: rel(watchPath), providerTrace: rel(providerPath), runTracesAnalyzed: traces.length },
  clocks: { releaseMs: release, dispatchOffsetMs: timeline.dispatchOffsetMs, observerOffsetMs: timeline.observerOffsetMs, dispatchUncertaintyMs: timeline.dispatchUncertaintyMs,
    note: 'All Sept 25 offsets are on the dispatch clock. Observer (Slot Watch) offsets were shifted by dispatch − observer offset.' },
  sep25: {
    attempts: sep25Attempts, ordering: orderingEvidence(sep25Attempts), provider,
    vercelId: vercelIdConsistency(provider, requestEvents),
    responseSizeClasses: Object.entries(provider.reduce<Record<string, string[]>>((groups, item) => { (groups[item.sizeClass ?? 'UNKNOWN'] ??= []).push(item.workerId); return groups; }, {}))
      .map(([sizeClass, workers]) => ({ sizeClass, workers, bytes: provider.filter(item => workers.includes(item.workerId)).map(item => item.encodedBytes) })),
    congestion: congestionEvidence(watch25, rel(watchPath)),
    holdExpiry: holdExpirySummary(watch25),
    staleReads: staleReadEvidence(watch25),
  },
  sep24: sep24Trace ? { attempts: releaseAttempts(sep24Trace), ordering: orderingEvidence(releaseAttempts(sep24Trace)),
    congestion: watch24 ? congestionEvidence(watch24, rel(watch24Path)) : null, holdExpiry: watch24 ? holdExpirySummary(watch24) : null, staleReads: watch24 ? staleReadEvidence(watch24) : null } : null,
  sep23: { attempts: sep23Attempts, reads: sep23Reads.map(read => ({ ...read, requestOffsetMs: round1(read.requestOffsetMs), responseOffsetMs: round1(read.responseOffsetMs) })),
    note: 'Sept 23 reads are runner SPECIAL_AVAILABILITY_SAMPLE events (PC wall clock; the PC offset that morning was not recorded, typically tens of ms).' },
  offPeak: {
    lanes: { ...lanes, prooflessSamples: undefined, proofBasedSamples: undefined, prooflessMs: lanes.prooflessSamples, proofBasedMs: lanes.proofBasedSamples },
    commitPosition: commits,
    commitSummary: {
      simultaneousRuns: commits.filter(run => run.simultaneous).map(run => ({ runId: run.runId, holds: run.holds, sendSpreadMs: run.sendSpreadMs, commitSpreadMs: run.commitSpreadMs, commitVsResponseTau: run.commitVsResponseTau })),
      commitMinusSendPcMs: summarize(commits.flatMap(run => run.perHold.map(hold => hold.commitMinusSendPcMs)), 0),
      responseMinusCommitPcMs: summarize(commits.flatMap(run => run.perHold.map(hold => hold.responseMinusCommitPcMs)), 0),
      note: 'hold_expires_at − 10 min is the provider-side hold creation time. PC-clock positions shift by the unknown PC offset of each test day (recorded offsets ranged from ~5 ms to ~1 s); spreads and orders within a run are offset free.' },
    releaseCheckoutMs: { sep23: sep23Attempts.map(attempt => attempt.responseOffsetMs - attempt.sendOffsetMs), sep24: sep24Trace ? releaseAttempts(sep24Trace).map(attempt => attempt.networkDurationMs) : [],
      sep25: sep25Attempts.map(attempt => attempt.networkDurationMs) },
  },
};

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'release-2026-09-25.timeline.jsonl'), timeline.events.map(event => JSON.stringify(event)).join('\n') + '\n');
writeFileSync(join(out, 'arbitration-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
process.stdout.write(`${JSON.stringify({ timelineEvents: timeline.events.length, out: rel(out), lanes: { proofless: lanes.proofless, proofBased: lanes.proofBased, mannWhitney: lanes.mannWhitney },
  sep25Ordering: evidence.sep25.ordering, vercel: { lag: evidence.sep25.vercelId.lagSummary, spread: evidence.sep25.vercelId.embeddedSpreadMs, tau: evidence.sep25.vercelId.orderTau },
  congestion25: { lastSlow: evidence.sep25.congestion.lastSlowReadResponseMs, flushes: evidence.sep25.congestion.flushes },
  congestion24: evidence.sep24?.congestion ? { lastSlow: evidence.sep24.congestion.lastSlowReadResponseMs } : null }, null, 2)}\n`);
