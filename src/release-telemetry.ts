import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { stats, type Stats } from './fanout-capacity.js';

/**
 * Release dispatch telemetry for History & Insights (Phase 13), derived only from local files written after each run:
 * .local/release-forensics/<runId>/critical-path.ndjson (one row per attempt, with per-child identity and configured offset)
 * and .local/api-booking/run-progress/<runId>.ndjson (adaptive selection/dispatch and Rescue prediction stages).
 * Rows carry no tokens, cookies or customer data. Nothing here predicts a booking outcome.
 */
export interface TelemetryChild { attemptId: string; label: string; workerId: string; parentGoalId: string | null; fanOutIndex: number; fanOutCount: number;
  configuredOffsetMs: number | null; workerInvokedMs: number | null; fetchInvokedMs: number | null; chromeStartMs: number | null; requestEventMs: number | null;
  responseMs: number | null; errorMs: number | null; prewarmReadyMs: number | null; finalState: string | null }
export interface RunTelemetry {
  runId: string; date: string | null; generatedAt: string;
  children: TelemetryChild[];
  summary: {
    /** configured trigger → Chrome request start, over every child with both. */
    configuredToChrome: Stats;
    /** Per fan-out position: the same error (index 0 = Tier 1). */
    perChildIndex: Array<{ fanOutIndex: number; error: Stats }>;
    perWorker: Record<string, Stats>;
    /** First to last Chrome request start. */
    spreadMs: number | null;
    /** Actual Chrome-start spread / configured spread (1 = offsets preserved, 0 = fully compressed); null without configured spread. */
    compression: number | null;
    /** How long before its configured trigger each child's security was ready. */
    prewarmHeadroomMs: Stats;
    /** Wave 2 / Rescue: selection → POST request (ms), and predicted → observed reopening error (ms). */
    adaptiveSelectionToPost: Stats; reopenPredictionErrorMs: Stats;
  };
}

const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const str = (value: unknown) => typeof value === 'string' ? value : null;
const readLines = (path: string) => { try { return readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line) as Record<string, unknown>]; } catch { return []; } }); } catch { return []; } };

export function summarizeRun(runId: string, rows: Array<Record<string, unknown>>, progress: Array<Record<string, unknown>>): RunTelemetry {
  const header = rows.find(row => row.type === 'header');
  const children: TelemetryChild[] = rows.filter(row => row.schema === 'critical-path/v1' && row.type !== 'header' && row.workerId !== '*').map(row => {
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    const configured = num(meta.configuredOffsetMs), chrome = num(row.browserRequestStartMs);
    const workerId = str(meta.workerId) ?? String(row.workerId).slice(0, 1), index = num(meta.fanOutIndex) ?? 0, count = num(meta.fanOutCount) ?? 1;
    return { attemptId: String(row.workerId), label: `${workerId}${count > 1 ? index : ''}`, workerId, parentGoalId: str(meta.parentGoalId), fanOutIndex: index, fanOutCount: count,
      configuredOffsetMs: configured, workerInvokedMs: num(row.workerInvokedMs), fetchInvokedMs: num((row.fetchInvokedMs as { ms?: unknown } | null)?.ms),
      chromeStartMs: chrome, requestEventMs: num(row.requestObservedMs), responseMs: num(row.responseObservedMs),
      errorMs: configured !== null && chrome !== null ? Math.round((chrome - configured) * 100) / 100 : null, prewarmReadyMs: num(meta.prewarmReadyMs), finalState: str(meta.finalState) };
  }).sort((a, b) => a.workerId.localeCompare(b.workerId) || a.fanOutIndex - b.fanOutIndex);
  const starts = children.map(child => child.chromeStartMs).filter((value): value is number => value !== null);
  const configured = children.map(child => child.configuredOffsetMs).filter((value): value is number => value !== null);
  const spread = starts.length > 1 ? Math.max(...starts) - Math.min(...starts) : null;
  const configuredSpread = configured.length > 1 ? Math.max(...configured) - Math.min(...configured) : 0;
  const indices = [...new Set(children.map(child => child.fanOutIndex))].sort((a, b) => a - b);
  const workers = [...new Set(children.map(child => child.workerId))].sort();
  // Adaptive selection → POST, per (worker, candidate, wave), and prediction errors, from the run's progress log.
  const selected = new Map<string, number>(), posts: number[] = [], errors: number[] = [];
  for (const line of progress) {
    const at = Date.parse(String(line.at ?? '')), key = `${line.workerId}/${line.candidateId}/${line.wave}`;
    if (line.stage === 'PHASE3_ADAPTIVE_SELECTED' && Number.isFinite(at)) selected.set(key, at);
    if (line.stage === 'PHASE3_DISPATCH' && line.wave !== 'WAVE_1' && selected.has(key) && Number.isFinite(at)) { posts.push(at - selected.get(key)!); selected.delete(key); }
    if (line.stage === 'RESCUE_PREDICTION_OUTCOME' && num(line.errorMs) !== null) errors.push(num(line.errorMs)!);
  }
  return { runId, date: str(header?.targetDate) ?? str(progress[0]?.targetDate), generatedAt: str(header?.generatedAt) ?? new Date(0).toISOString(), children,
    summary: { configuredToChrome: stats(children.map(child => child.errorMs)), perChildIndex: indices.map(fanOutIndex =>
      ({ fanOutIndex, error: stats(children.filter(child => child.fanOutIndex === fanOutIndex).map(child => child.errorMs)) })),
      perWorker: Object.fromEntries(workers.map(worker => [worker, stats(children.filter(child => child.workerId === worker).map(child => child.errorMs))])),
      spreadMs: spread === null ? null : Math.round(spread * 100) / 100,
      compression: spread !== null && configuredSpread > 0 ? Math.round(spread / configuredSpread * 100) / 100 : null,
      prewarmHeadroomMs: stats(children.map(child => child.prewarmReadyMs !== null && child.configuredOffsetMs !== null ? child.configuredOffsetMs - child.prewarmReadyMs : null)),
      adaptiveSelectionToPost: stats(posts), reopenPredictionErrorMs: stats(errors) } };
}

/** The newest runs with a critical-path file, newest first. */
export function readReleaseTelemetry(root: string, limit = 8): RunTelemetry[] {
  const directory = join(root, '.local/release-forensics');
  if (!existsSync(directory)) return [];
  const runs = readdirSync(directory).filter(name => /^[A-Za-z0-9-]{8,80}$/.test(name) && existsSync(join(directory, name, 'critical-path.ndjson')))
    .map(name => ({ name, mtime: statSync(join(directory, name, 'critical-path.ndjson')).mtimeMs })).sort((a, b) => b.mtime - a.mtime).slice(0, limit);
  return runs.map(run => summarizeRun(run.name, readLines(join(directory, run.name, 'critical-path.ndjson')),
    readLines(join(root, '.local/api-booking/run-progress', `${run.name}.ndjson`))));
}
