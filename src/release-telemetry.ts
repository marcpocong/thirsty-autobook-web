import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { stats, type Stats } from './fanout-capacity.js';
import { liveTimingSamples, type LiveTimingOrigin } from './live-anchor-calibration.js';
import {denseCoreTimingRegion,shotgunTimingBucket,type DenseCoreTimingRegion,type ShotgunTimingBucket} from './shotgun.js';

/**
 * Release dispatch telemetry for History & Insights (Phase 13), derived only from local files written after each run:
 * .local/release-forensics/<runId>/critical-path.ndjson (one row per attempt, with per-child identity and configured offset)
 * and .local/api-booking/run-progress/<runId>.ndjson (adaptive selection/dispatch and Rescue prediction stages).
 * Rows carry no tokens, cookies or customer data. Nothing here predicts a booking outcome.
 */
export interface TelemetryChild { attemptId: string; label: string; workerId: string; parentGoalId: string | null; fanOutIndex: number; fanOutCount: number;
  shotIndex:number|null;shotCount:number|null;workerGroupIndex:number|null;timingBucket:ShotgunTimingBucket|null;denseCoreRegion:DenseCoreTimingRegion|null;suppressionReason:string|null;
  httpStatus:number|null;providerThrottleSignal:boolean;logicalTargetOutcome:string|null;stopCondition:string|null;
  configuredOffsetMs: number | null; workerInvokedMs: number | null; fetchInvokedMs: number | null; chromeStartMs: number | null; requestEventMs: number | null;
  responseMs: number | null; responseLatencyMs:number|null;triggerToWorkerMs:number|null;errorMs: number | null; prewarmReadyMs: number | null; finalState: string | null;
  dispatchMode?: string; trustedClockValid?: boolean; dispatched?: boolean }
export interface RunTelemetry {
  runId: string; date: string | null; generatedAt: string; releaseMs?: number | null;
  origin?: LiveTimingOrigin; mode?: string | null; machineKey?: string | null; runtimeKey?: string | null;
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
    denseCore: {configuredAttempts:number;actuallyDispatched:number;suppressed:number;rejections:number;successOrHold:number;unknown:number;throttled:number;
      localCollisions:number;chromeStartOrderingPreserved:boolean|null;providerReceiptOrder:'UNKNOWN';regions:Array<{region:DenseCoreTimingRegion;configured:number;dispatched:number;triggerToChrome:Stats}>};
  };
}

const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const str = (value: unknown) => typeof value === 'string' ? value : null;
const readLines = (path: string) => { try { return readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line) as Record<string, unknown>]; } catch { return []; } }); } catch { return []; } };

export function summarizeRun(runId: string, rows: Array<Record<string, unknown>>, progress: Array<Record<string, unknown>>): RunTelemetry {
  const header = rows.find(row => row.type === 'header');
  const mode = str(progress.find(line => str(line.mode))?.mode) ?? str(header?.mode);
  const origin: LiveTimingOrigin = mode === 'live' && !/synthetic|fixture|benchmark|offline/i.test(runId) ? 'REAL_RELEASE'
    : /benchmark|offline/i.test(mode ?? '') ? 'OFFLINE_BENCHMARK' : 'SYNTHETIC';
  const scheduled = new Map<string, number[]>();
  for (const line of progress.filter(line => line.stage === 'RELEASE_OFFSET_SCHEDULED' && str(line.workerId) && num(line.releaseOffsetMs) !== null)) {
    const worker = str(line.workerId)!; scheduled.set(worker, [...(scheduled.get(worker) ?? []), num(line.releaseOffsetMs)!]);
  }
  const dispatched = new Set(progress.filter(line => line.stage === 'PHASE3_DISPATCH' || line.stage === 'PHASE3_WAVE1_STARTED')
    .flatMap(line => [str(line.attemptId), str(line.workerId)].filter((value): value is string => !!value)));
  const fanOut = new Map(progress.filter(line => line.stage === 'PHASE3_FAN_OUT_CHILD' && str(line.attemptId)).map(line => [str(line.attemptId)!, {
    index: num(line.fanOutIndex) ?? 0, count: num(line.fanOutCount) ?? 1 }] as const));
  const children: TelemetryChild[] = rows.filter(row => row.schema === 'critical-path/v1' && row.type !== 'header' && row.workerId !== '*').map(row => {
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    const legacyChild = /^([A-G]):(\d+)$/.exec(String(row.workerId));
    const workerId = str(meta.workerId) ?? legacyChild?.[1] ?? String(row.workerId).slice(0, 1), childTopology = fanOut.get(String(row.workerId));
    // Pre-fan-out live rows did not copy the configured offset into critical-path metadata. In those rows an explicit
    // RELEASE_OFFSET_SCHEDULED value wins; a dispatched single attempt without that event is the documented normal 0.
    const legacyIndex = legacyChild ? Number(legacyChild[2]) : null, scheduledOffsets = scheduled.get(workerId);
    const observedDispatch = num(row.browserRequestStartMs) !== null && (num(row.prePostMs) !== null || num(row.requestObservedMs) !== null || num(row.responseObservedMs) !== null);
    const didDispatch = dispatched.has(String(row.workerId)) || dispatched.has(workerId) || observedDispatch;
    const configured = num(meta.configuredOffsetMs) ?? (legacyIndex !== null ? scheduledOffsets?.[legacyIndex] ?? null : scheduledOffsets?.[0] ?? (didDispatch ? 0 : null));
    const chrome = num(row.browserRequestStartMs), index = num(meta.fanOutIndex) ?? childTopology?.index ?? legacyIndex ?? 0;
    const count = num(meta.fanOutCount) ?? childTopology?.count ?? (legacyIndex !== null ? scheduledOffsets?.length ?? 1 : 1);
    const calibration = row.calibration as Record<string, unknown> | null | undefined;
    const workerInvoked=num(row.workerInvokedMs),response=num(row.responseObservedMs);
    return { attemptId: String(row.workerId), label: `${workerId}${count > 1 ? index : ''}`, workerId, parentGoalId: str(meta.parentGoalId), fanOutIndex: index, fanOutCount: count,
      shotIndex:num(meta.shotIndex),shotCount:num(meta.shotCount),workerGroupIndex:num(meta.workerGroupIndex),timingBucket:configured===null?null:shotgunTimingBucket(configured),denseCoreRegion:configured===null?null:denseCoreTimingRegion(configured),
      suppressionReason:/^SHOTGUN_/.test(str(meta.finalCode)??'')?str(meta.finalCode):null,
      httpStatus:num(meta.httpStatus),providerThrottleSignal:meta.providerThrottleSignal===true,logicalTargetOutcome:str(meta.finalState),
      stopCondition:/^SHOTGUN_/.test(str(meta.finalCode)??'')?str(meta.finalCode):null,
      configuredOffsetMs: configured, workerInvokedMs:workerInvoked, fetchInvokedMs: num((row.fetchInvokedMs as { ms?: unknown } | null)?.ms),
      chromeStartMs: chrome, requestEventMs: num(row.requestObservedMs), responseMs:response,responseLatencyMs:chrome!==null&&response!==null?Math.round((response-chrome)*100)/100:null,
      triggerToWorkerMs:configured!==null&&workerInvoked!==null?Math.round((workerInvoked-configured)*100)/100:null,
      errorMs: configured !== null && chrome !== null ? Math.round((chrome - configured) * 100) / 100 : null, prewarmReadyMs: num(meta.prewarmReadyMs), finalState: str(meta.finalState),
      dispatchMode: str(row.dispatchMode) ?? 'unknown', trustedClockValid: num(header?.releaseMs) !== null && num(header?.wallToTrustedMs) !== null && calibration?.consistent !== false,
      dispatched: didDispatch };
  }).sort((a, b) => a.workerId.localeCompare(b.workerId) || a.fanOutIndex - b.fanOutIndex);
  const starts = children.map(child => child.chromeStartMs).filter((value): value is number => value !== null);
  const configured = children.map(child => child.configuredOffsetMs).filter((value): value is number => value !== null);
  const spread = starts.length > 1 ? Math.max(...starts) - Math.min(...starts) : null;
  const configuredSpread = configured.length > 1 ? Math.max(...configured) - Math.min(...configured) : 0;
  const indices = [...new Set(children.map(child => child.fanOutIndex))].sort((a, b) => a - b);
  const workers = [...new Set(children.map(child => child.workerId))].sort();
  const shotgunChildren=children.filter(child=>child.shotIndex!==null),regions:DenseCoreTimingRegion[]=['< -500 ms','-500 to -100 ms','-100 to -50 ms','-50 to -20 ms','-20 to -5 ms','-5 to 0 ms'];
  const chromeOrdered=[...shotgunChildren].filter(child=>child.chromeStartMs!==null&&child.configuredOffsetMs!==null).sort((a,b)=>a.configuredOffsetMs!-b.configuredOffsetMs!||a.shotIndex!-b.shotIndex!);
  const chromeStartOrderingPreserved=chromeOrdered.length<2?null:chromeOrdered.every((child,index)=>index===0||child.chromeStartMs!>=chromeOrdered[index-1]!.chromeStartMs!);
  const actualStarts=chromeOrdered.map(child=>child.chromeStartMs!).sort((a,b)=>a-b),localCollisions=actualStarts.slice(1).filter((value,index)=>value-actualStarts[index]!<1).length;
  // Adaptive selection → POST, per (worker, candidate, wave), and prediction errors, from the run's progress log.
  const selected = new Map<string, number>(), posts: number[] = [], errors: number[] = [];
  for (const line of progress) {
    const at = Date.parse(String(line.at ?? '')), key = `${line.workerId}/${line.candidateId}/${line.wave}`;
    if (line.stage === 'PHASE3_ADAPTIVE_SELECTED' && Number.isFinite(at)) selected.set(key, at);
    if (line.stage === 'PHASE3_DISPATCH' && line.wave !== 'WAVE_1' && selected.has(key) && Number.isFinite(at)) { posts.push(at - selected.get(key)!); selected.delete(key); }
    if (line.stage === 'RESCUE_PREDICTION_OUTCOME' && num(line.errorMs) !== null) errors.push(num(line.errorMs)!);
  }
  return { runId, date: str(header?.targetDate) ?? str(progress[0]?.targetDate), generatedAt: str(header?.generatedAt) ?? str(progress[0]?.at) ?? new Date(0).toISOString(),
    releaseMs: num(header?.releaseMs) ?? num(progress.find(line => num(line.releaseMs) !== null)?.releaseMs), origin, mode,
    machineKey: str(header?.machineKey), runtimeKey: str(header?.runtimeKey), children,
    summary: { configuredToChrome: stats(children.map(child => child.errorMs)), perChildIndex: indices.map(fanOutIndex =>
      ({ fanOutIndex, error: stats(children.filter(child => child.fanOutIndex === fanOutIndex).map(child => child.errorMs)) })),
      perWorker: Object.fromEntries(workers.map(worker => [worker, stats(children.filter(child => child.workerId === worker).map(child => child.errorMs))])),
      spreadMs: spread === null ? null : Math.round(spread * 100) / 100,
      compression: spread !== null && configuredSpread > 0 ? Math.round(spread / configuredSpread * 100) / 100 : null,
      prewarmHeadroomMs: stats(children.map(child => child.prewarmReadyMs !== null && child.configuredOffsetMs !== null ? child.configuredOffsetMs - child.prewarmReadyMs : null)),
      adaptiveSelectionToPost: stats(posts), reopenPredictionErrorMs: stats(errors),denseCore:{configuredAttempts:shotgunChildren.length,
        actuallyDispatched:shotgunChildren.filter(child=>child.dispatched).length,suppressed:shotgunChildren.filter(child=>!!child.suppressionReason&&!child.dispatched).length,
        rejections:shotgunChildren.filter(child=>child.finalState==='REJECTED').length,successOrHold:shotgunChildren.filter(child=>['QR_READY','HOLD_VERIFIED','HOLD_VERIFIED_QR_ATTENTION'].includes(child.finalState??'')).length,
        unknown:shotgunChildren.filter(child=>child.finalState==='UNKNOWN').length,throttled:shotgunChildren.filter(child=>child.providerThrottleSignal||child.stopCondition==='SHOTGUN_PROVIDER_THROTTLE_STOP').length,
        localCollisions,chromeStartOrderingPreserved,providerReceiptOrder:'UNKNOWN',regions:regions.map(region=>{const values=shotgunChildren.filter(child=>child.denseCoreRegion===region);return {region,configured:values.length,
          dispatched:values.filter(child=>child.dispatched).length,triggerToChrome:stats(values.map(child=>child.errorMs))};})} } };
}

export { liveTimingSamples };

/** The newest runs with a critical-path file, newest first. */
export function readReleaseTelemetry(root: string, limit = 64): RunTelemetry[] {
  const directory = join(root, '.local/release-forensics');
  if (!existsSync(directory)) return [];
  const runs = readdirSync(directory).filter(name => /^[A-Za-z0-9-]{8,80}$/.test(name) && existsSync(join(directory, name, 'critical-path.ndjson')))
    .map(name => ({ name, mtime: statSync(join(directory, name, 'critical-path.ndjson')).mtimeMs })).sort((a, b) => b.mtime - a.mtime).slice(0, limit);
  return runs.map(run => { const value = summarizeRun(run.name, readLines(join(directory, run.name, 'critical-path.ndjson')),
    readLines(join(root, '.local/api-booking/run-progress', `${run.name}.ndjson`)));
    if (value.generatedAt === new Date(0).toISOString()) value.generatedAt = new Date(run.mtime).toISOString();
    return value; });
}
