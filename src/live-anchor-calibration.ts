import type { FanOutTimingPlan } from './fanout-timing.js';

export const LIVE_ANCHOR_SCHEMA = 'live-anchor-calibration/v1' as const;
export const LIVE_ANCHOR_STALE_DAYS = 30;
export type LiveTimingOrigin = 'REAL_RELEASE' | 'SYNTHETIC' | 'OFFLINE_BENCHMARK';
export type LiveAnchorEvidenceStrength = 'NONE' | 'LIMITED' | 'USABLE' | 'STRONG';

/**
 * One local configured-trigger -> Chrome-request-start measurement. Response duration, response order, provider
 * outcome and the undocumented x-vercel-id timestamp are diagnostics only and are deliberately not calibration
 * inputs. `observedChromeStartMs` is release-relative on the trusted clock; it is not network arrival time.
 */
export interface LiveTimingSample {
  runId: string;
  releaseMs: number;
  configuredOffsetMs: number;
  observedChromeStartMs: number;
  triggerToChromeLagMs: number;
  /**
   * Worker invocation -> Chrome request start. Unlike triggerToChromeLagMs it excludes the time a child waited behind
   * earlier children in the central dispatcher queue, so it is the only lag that local de-skew may learn from.
   */
  invokeToChromeLagMs?: number | null;
  workerId: string;
  fanOutIndex: number | null;
  fanOutCount: number;
  dispatchMode: string;
  origin: LiveTimingOrigin;
  trustedClockValid: boolean;
  dispatched: boolean;
  recordedAt: string;
  machineKey?: string | null;
  runtimeKey?: string | null;
  outcome?: string;
  responseDurationMs?: number | null;
  providerEmbeddedTimestampCandidateMs?: number | null;
}

export interface LiveAnchorIdentity {
  dispatchMode: string;
  fanOutWidth: number;
  machineKey?: string | null;
  runtimeKey?: string | null;
}

export interface LiveAnchorCalibration {
  version: typeof LIVE_ANCHOR_SCHEMA;
  sampleCount: number;
  releaseCount: number;
  medianLagMs: number | null;
  p50LagMs: number | null;
  p95LagMs: number | null;
  minLagMs: number | null;
  maxLagMs: number | null;
  perChildIndex: Array<{ fanOutIndex: number; sampleCount: number; p50LagMs: number | null; p95LagMs: number | null }>;
  mode: string;
  fanOutWidth: number;
  evidenceStrength: LiveAnchorEvidenceStrength;
  generatedAt: string;
  latestSampleAt: string | null;
  stale: boolean;
  machineKey: string | null;
  runtimeKey: string | null;
  /** Compatible samples excluded from Auto because they predate the freshness horizon. */
  staleSampleCount: number;
  /** Compatible releases represented by those old samples. */
  staleReleaseCount: number;
  /** One robust vote per release, rather than one vote per fan-out child. */
  releaseMedians: Array<{ runId: string; recordedAt: string; sampleCount: number; medianLagMs: number }>;
}

export type LiveAnchorSource = 'LIVE_CALIBRATION' | 'RELEASE_CENTERED_FALLBACK' | 'OPERATOR_OVERRIDE';
export interface AnchoredTimingPlan extends FanOutTimingPlan {
  /** Release-relative shift applied equally to every spacing-generated child offset. */
  groupShiftMs: number;
  anchorSource: LiveAnchorSource;
  calibration: LiveAnchorCalibration;
  matchingSamples: number;
  matchingReleases: number;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const roundTenth = (value: number) => Math.round(value * 10) / 10;
const dayMs = 86_400_000;
const percentile = (values: readonly number[], p: number) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.max(0, Math.ceil(p / 100 * values.length) - 1))]! : null;

/** Browser-safe projection from the sanitized telemetry DTO; kept here so renderer code never imports Node file APIs. */
export function liveTimingSamples(runs: ReadonlyArray<{
  runId: string; generatedAt: string; releaseMs?: number | null; origin?: LiveTimingOrigin; machineKey?: string | null; runtimeKey?: string | null;
  children: ReadonlyArray<{ workerId: string; fanOutIndex: number; fanOutCount: number; configuredOffsetMs: number | null; chromeStartMs: number | null;
    errorMs: number | null; responseMs: number | null; finalState: string | null; dispatchMode?: string; trustedClockValid?: boolean; dispatched?: boolean;
    workerInvokedMs?: number | null }>;
}>): LiveTimingSample[] {
  return runs.flatMap(run => run.children.flatMap(child => {
    if (!finite(run.releaseMs) || child.configuredOffsetMs === null || child.chromeStartMs === null || child.errorMs === null) return [];
    const invokeToChrome = finite(child.workerInvokedMs) ? Math.round((child.chromeStartMs - child.workerInvokedMs) * 100) / 100 : null;
    return [{ runId: run.runId, releaseMs: run.releaseMs, configuredOffsetMs: child.configuredOffsetMs, observedChromeStartMs: child.chromeStartMs,
      triggerToChromeLagMs: child.errorMs, invokeToChromeLagMs: invokeToChrome !== null && invokeToChrome >= 0 && invokeToChrome <= 2_000 ? invokeToChrome : null,
      workerId: child.workerId, fanOutIndex: child.fanOutIndex, fanOutCount: child.fanOutCount,
      dispatchMode: child.dispatchMode ?? 'unknown', origin: run.origin ?? 'SYNTHETIC', trustedClockValid: child.trustedClockValid === true,
      dispatched: child.dispatched === true, recordedAt: run.generatedAt, machineKey: run.machineKey, runtimeKey: run.runtimeKey,
      outcome: child.finalState ?? undefined, responseDurationMs: child.responseMs === null ? null : child.responseMs - child.chromeStartMs } satisfies LiveTimingSample];
  }));
}

export function evidenceStrength(releases: number): LiveAnchorEvidenceStrength {
  return releases <= 0 ? 'NONE' : releases === 1 ? 'LIMITED' : releases <= 3 ? 'USABLE' : 'STRONG';
}

function compatible(sample: LiveTimingSample, identity: LiveAnchorIdentity): boolean {
  if (sample.origin !== 'REAL_RELEASE' || !sample.trustedClockValid || !sample.dispatched) return false;
  if (sample.dispatchMode !== identity.dispatchMode || sample.fanOutCount !== identity.fanOutWidth) return false;
  if (identity.machineKey && sample.machineKey && identity.machineKey !== sample.machineKey) return false;
  if (identity.runtimeKey && sample.runtimeKey && identity.runtimeKey !== sample.runtimeKey) return false;
  if (![sample.configuredOffsetMs, sample.observedChromeStartMs, sample.triggerToChromeLagMs].every(finite)) return false;
  return sample.configuredOffsetMs >= -2_000 && sample.configuredOffsetMs <= 0 && Math.abs(sample.triggerToChromeLagMs) <= 2_000;
}

/** Operational evidence gates, not formal statistical confidence: 0/1/2-3/4+ matching real releases. */
export function calibrateLiveAnchor(samples: readonly LiveTimingSample[], identity: LiveAnchorIdentity, options: { now?: number; staleDays?: number } = {}): LiveAnchorCalibration {
  const now = options.now ?? Date.now(), staleDays = options.staleDays ?? LIVE_ANCHOR_STALE_DAYS;
  const horizon = now - staleDays * dayMs;
  const compatibleSamples = samples.filter(sample => compatible(sample, identity));
  // Freshness is an input filter, not a label applied after calculation. One new row must never
  // resurrect years of otherwise compatible data into Auto.
  const selected = compatibleSamples.filter(sample => { const at = Date.parse(sample.recordedAt); return Number.isFinite(at) && at >= horizon && at <= now + dayMs; });
  const staleSamples = compatibleSamples.filter(sample => !selected.includes(sample));
  const rounded = (value: number | null) => value === null ? null : Math.round(value * 100) / 100;
  const byRelease = new Map<string, LiveTimingSample[]>();
  for (const sample of selected) byRelease.set(sample.runId, [...(byRelease.get(sample.runId) ?? []), sample]);
  const releaseMedians = [...byRelease.entries()].map(([runId, rows]) => ({ runId,
    recordedAt: rows.map(row => row.recordedAt).sort().at(-1)!, sampleCount: rows.length,
    medianLagMs: rounded(percentile(rows.map(row => row.triggerToChromeLagMs), 50))! })).sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  const releases = releaseMedians.length;
  const values = selected.map(sample => sample.triggerToChromeLagMs);
  // Whole-group anchor: every release receives one vote regardless of its fan-out width/row count.
  const releaseValues = releaseMedians.map(value => value.medianLagMs);
  const p50 = rounded(percentile(releaseValues, 50)), p95 = rounded(percentile(releaseValues, 95));
  const indices = [...new Set(selected.map(sample => sample.fanOutIndex).filter((value): value is number => value !== null))].sort((a, b) => a - b);
  const latest = selected.map(sample => Date.parse(sample.recordedAt)).filter(Number.isFinite).sort((a, b) => b - a)[0] ?? null;
  return { version: LIVE_ANCHOR_SCHEMA, sampleCount: selected.length, releaseCount: releases, medianLagMs: p50, p50LagMs: p50,
    p95LagMs: p95, minLagMs: values.length ? rounded(Math.min(...values)) : null, maxLagMs: values.length ? rounded(Math.max(...values)) : null, mode: identity.dispatchMode, fanOutWidth: identity.fanOutWidth,
    perChildIndex: indices.map(fanOutIndex => { const childRows = selected.filter(sample => sample.fanOutIndex === fanOutIndex), childRuns = new Map<string, number[]>();
      for (const sample of childRows) childRuns.set(sample.runId,[...(childRuns.get(sample.runId)??[]),sample.triggerToChromeLagMs]);
      const releaseVotes=[...childRuns.values()].map(values=>percentile(values,50)!);
      return { fanOutIndex, sampleCount: childRows.length, p50LagMs: rounded(percentile(releaseVotes, 50)), p95LagMs: rounded(percentile(releaseVotes, 95)) }; }),
    evidenceStrength: evidenceStrength(releases), generatedAt: new Date(now).toISOString(), latestSampleAt: latest === null ? null : new Date(latest).toISOString(),
    stale: selected.length === 0, machineKey: identity.machineKey ?? null, runtimeKey: identity.runtimeKey ?? null,
    staleSampleCount: staleSamples.length, staleReleaseCount: new Set(staleSamples.map(sample => sample.runId)).size, releaseMedians };
}

/**
 * Centers predicted local Chrome starts around release: groupShift = -(midpoint(base offsets) + median local lag).
 * The integer shift is clamped so every final configured offset remains in [-2000, 0]. Width > 1 requires at least
 * two matching releases; width 1 may use its direct one-release calibration. Stale evidence always falls back to 0.
 */
export function recommendGroupShiftMs(base: FanOutTimingPlan, calibration: LiveAnchorCalibration): number {
  const median = calibration.medianLagMs;
  const usable = !calibration.stale && median !== null &&
    (calibration.evidenceStrength === 'USABLE' || calibration.evidenceStrength === 'STRONG' || (base.width === 1 && calibration.evidenceStrength === 'LIMITED'));
  if (!usable || !base.children.length) return 0;
  const offsets = base.children.map(child => child.configuredOffsetMs);
  const midpoint = (Math.min(...offsets) + Math.max(...offsets)) / 2;
  const wanted = Math.round(-(midpoint + median!));
  const low = -2_000 - Math.min(...offsets), high = -Math.max(...offsets);
  return Math.min(high, Math.max(low, wanted)) + 0;
}

/** Compose group anchoring with spacing. `groupShiftMs` means the signed release-relative shift applied to every child. */
export function applyLiveAnchor(base: FanOutTimingPlan, calibration: LiveAnchorCalibration, manualGroupShiftMs?: number): AnchoredTimingPlan {
  const automatic = recommendGroupShiftMs(base, calibration);
  const manual = manualGroupShiftMs !== undefined;
  const requested = manual ? manualGroupShiftMs : automatic;
  if (!Number.isSafeInteger(requested)) throw Error('GROUP_SHIFT_INVALID');
  const offsets = base.children.map(child => child.configuredOffsetMs);
  const low = -2_000 - Math.min(...offsets), high = -Math.max(...offsets);
  if (requested < low || requested > high) throw Error('GROUP_SHIFT_OUT_OF_RANGE');
  const useLive = !manual && !calibration.stale && calibration.medianLagMs !== null &&
    (calibration.evidenceStrength === 'USABLE' || calibration.evidenceStrength === 'STRONG' || (base.width === 1 && calibration.evidenceStrength === 'LIMITED'));
  return { ...base, groupShiftMs: requested, anchorSource: manual ? 'OPERATOR_OVERRIDE' : useLive ? 'LIVE_CALIBRATION' : 'RELEASE_CENTERED_FALLBACK',
    calibration, matchingSamples: calibration.sampleCount, matchingReleases: calibration.releaseCount,
    children: base.children.map(child => { const configured = child.configuredOffsetMs + requested, position = calibration.perChildIndex.find(value => value.fanOutIndex === child.fanOutIndex);
      const lagLow = calibration.stale ? null : position?.p50LagMs ?? calibration.p50LagMs, lagHigh = calibration.stale ? null : position?.p95LagMs ?? calibration.p95LagMs;
      return { ...child, configuredOffsetMs: configured, predictedChromeStartMs: lagLow === null || lagHigh === null
        ? child.predictedChromeStartMs ? [roundTenth(child.predictedChromeStartMs[0] + requested), roundTenth(child.predictedChromeStartMs[1] + requested)] : null
        : [roundTenth(configured + Math.min(lagLow, lagHigh)), roundTenth(configured + Math.max(lagLow, lagHigh))] as [number, number] }; }) };
}
