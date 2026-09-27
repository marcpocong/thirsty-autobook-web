/** Generic, offline Wave 1 arbitration analyzer. Performs no network/browser/checkout work. */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseNdjson } from '../src/arbitration/archive-evidence.js';
import { assertSanitizedOutput, buildWave1Analysis, discoverEvidence, renderReport, renderTimelineMarkdown, type EvidencePaths } from '../src/arbitration/wave1-analysis.js';

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index]!;
  if (!key.startsWith('--')) continue;
  args.set(key.slice(2), process.argv[index + 1]?.startsWith('--') ? '' : process.argv[++index] ?? '');
}
const repo = resolve(import.meta.dirname, '..'), runId = args.get('run');
if (!runId) throw Error('ARBITRATION_RUN_REQUIRED: use --run <run-id>');
const overrides = { ...(args.get('runner') ? { runner: args.get('runner')! } : {}), ...(args.get('watch') ? { watch: args.get('watch')! } : {}),
  ...(args.get('provider') ? { provider: args.get('provider')! } : {}), ...(args.get('critical') ? { critical: args.get('critical')! } : {}),
  ...(args.get('manifest') ? { manifest: args.get('manifest')! } : {}) };
const roots = args.get('archive') ? [resolve(args.get('archive')!)] : [resolve(repo, '..', '.local'), resolve(repo, 'diagnostics-archive')];
let paths: EvidencePaths | null = null, lastError: unknown;
for (const root of roots) {
  // Only a missing run moves on to the next root; an incompatible explicit file must fail as itself.
  try { paths = discoverEvidence(root, runId, overrides); break; } catch (error) {
    if (!String((error as Error)?.message).startsWith('RUN_NOT_FOUND')) throw error;
    lastError = error;
  }
}
if (!paths) throw lastError;
const analysis = buildWave1Analysis(paths);

// Compact recurrence table. Historical formats without enough evidence remain UNKNOWN rather than guessed.
const historicalRoot = resolve(repo, 'diagnostics-archive'), runnerFiles: string[] = [];
const visit = async (path: string) => {
  const { readdir } = await import('node:fs/promises');
  let entries; try { entries = await readdir(path, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) await visit(child);
    else if (entry.isFile() && entry.name.endsWith('.ndjson') && (child.includes('run-progress') || /logs[/\\]run-progress\.ndjson$/.test(child))) runnerFiles.push(child);
  }
};
await visit(historicalRoot);
const seen = new Set<string>(), crossRelease: Record<string, unknown>[] = [];
const legacyJournalSummary = (archiveRoot: string, releaseMs: number, targetDate: string) => {
  const durations: number[] = [];
  const scan = (path: string) => {
    let entries; try { entries = readdirSync(path, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) scan(child);
      else if (entry.isFile() && entry.name.endsWith('.json') && child.includes('api-first-journals')) {
        try {
          const record = JSON.parse(readFileSync(child, 'utf8')) as any, attempt = record.attempt ?? {};
          const created = Date.parse(String(record.createdAt)), updated = Date.parse(String(record.updatedAt));
          if (attempt.targetDate === targetDate && Number.isFinite(created) && Math.abs(created - releaseMs) <= 60_000 && Number.isFinite(updated)) durations.push(updated - created);
        } catch { /* historical adapter */ }
      }
    }
  };
  scan(archiveRoot);
  return durations;
};
for (const file of runnerFiles.sort()) {
  const lines = parseNdjson(readFileSync(file, 'utf8')), config = lines.find(line => line.stage === 'RUN_CONFIGURATION');
  const candidateRun = typeof config?.runId === 'string' ? config.runId : typeof lines[0]?.runId === 'string' ? lines[0].runId : null;
  if (!candidateRun || seen.has(candidateRun) || config?.mode !== 'live') continue;
  seen.add(candidateRun);
  try {
    const match = /^(.*?diagnostics-archive[/\\]\d{4}-\d{2}-\d{2})/.exec(file);
    const evidenceRoot = match?.[1] ?? historicalRoot;
    if (!lines.some(line => line.stage === 'CHECKOUT_HTTP_POST_INITIATED')) {
      const releaseMs = Number(config.releaseMs), targetDate = String(config.targetDate ?? lines[0]?.targetDate ?? '');
      const durations = legacyJournalSummary(evidenceRoot, releaseMs, targetDate);
      if (durations.length) crossRelease.push({ release: new Date(releaseMs).toISOString().slice(0, 10), runId: candidateRun, attempts: durations.length,
        contestable: 'UNKNOWN', quality: 'UNKNOWN', providerWaitMs: { min: Math.min(...durations), max: Math.max(...durations) },
        stateRegressions: 'UNKNOWN', slowReadFlushes: 'UNKNOWN', adapter: 'legacy journals' });
      continue;
    }
    const item = buildWave1Analysis(discoverEvidence(evidenceRoot, candidateRun));
    const waits = (item.attempts as Array<any>).map(row => row.providerPath.providerWaitMs).filter(Number.isFinite);
    crossRelease.push({ release: String(item.run.releaseUtc).slice(0, 10), runId: candidateRun, attempts: item.run.wave1Attempts,
      contestable: item.experimentQuality.usefulContestSamples, quality: item.experimentQuality.label,
      providerWaitMs: waits.length ? { min: Math.min(...waits), max: Math.max(...waits) } : null,
      stateRegressions: item.readPath.stateRegressionCount, inferredStateRegressions: item.readPath.inferredStateRegressionCount,
      slowReadFlushes: (item.slowReadFlush.flushes as unknown[]).length });
  } catch { /* best-effort historical adapter */ }
}
if (!crossRelease.some(row => row.runId === runId)) {
  const waits = (analysis.attempts as Array<any>).map(row => row.providerPath.providerWaitMs).filter(Number.isFinite);
  crossRelease.push({ release: String(analysis.run.releaseUtc).slice(0, 10), runId, attempts: analysis.run.wave1Attempts,
    contestable: analysis.experimentQuality.usefulContestSamples, quality: analysis.experimentQuality.label,
    providerWaitMs: waits.length ? { min: Math.min(...waits), max: Math.max(...waits) } : null,
    stateRegressions: analysis.readPath.stateRegressionCount, inferredStateRegressions: analysis.readPath.inferredStateRegressionCount,
    slowReadFlushes: (analysis.slowReadFlush.flushes as unknown[]).length });
}
// One compact row per release. Historical pre-v2 days can have several runner processes pointing at the same journals.
const historicalCanonical: Record<string, string> = { '2026-09-23': '88473147-c70a-4417-a352-aed2502bbca4', '2026-09-24': '8bcc1790-2475-4fcf-ba60-96551f7b7fe3' };
const compactCrossRelease = [...new Set(crossRelease.map(row => String(row.release)))].sort().map(release => {
  const group = crossRelease.filter(row => row.release === release);
  const preferred = group.find(row => row.runId === historicalCanonical[release]) ?? group.find(row => typeof row.contestable === 'number') ?? group[0]!;
  const withWait = group.find(row => row.providerWaitMs !== null);
  return { ...preferred, ...(preferred.providerWaitMs === null && withWait ? { providerWaitMs: withWait.providerWaitMs } : {}) };
});

assertSanitizedOutput(analysis);
const out = resolve(args.get('out') ?? join(repo, 'arbitration-forensics', runId));
const replayPath = resolve(args.get('replay') ?? join(out, 'replay.json'));
const replay = existsSync(replayPath) ? JSON.parse(readFileSync(replayPath, 'utf8')) as Record<string, unknown> : null;
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'analysis.json'), `${JSON.stringify(analysis, null, 2)}\n`);
writeFileSync(join(out, 'timeline.json'), `${JSON.stringify({ schema: 'wave1-arbitration-timeline/v2', ...analysis.timeline, attempts: analysis.attempts }, null, 2)}\n`);
writeFileSync(join(out, 'timeline.md'), renderTimelineMarkdown(analysis));
writeFileSync(join(out, 'hypothesis-spec.json'), `${JSON.stringify((analysis.hypotheses as any).specifications, null, 2)}\n`);
writeFileSync(join(out, 'cross-release.json'), `${JSON.stringify({ schema: 'wave1-cross-release/v2', releases: compactCrossRelease }, null, 2)}\n`);
writeFileSync(join(out, 'REPORT.md'), renderReport(analysis, compactCrossRelease, replay));
process.stdout.write(`${JSON.stringify({ runId, out: relative(repo, out).replaceAll('\\', '/'), quality: analysis.experimentQuality,
  attempts: analysis.run.wave1Attempts, missing: analysis.sources.missing }, null, 2)}\n`);
