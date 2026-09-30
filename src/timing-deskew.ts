import type { FanOutTimingPlan } from './fanout-timing.js';
import { evidenceStrength, type LiveAnchorCalibration, type LiveAnchorEvidenceStrength, type LiveTimingSample } from './live-anchor-calibration.js';
import { RELEASE_OFFSET_MAX_MS, RELEASE_OFFSET_MIN_MS } from './release-offset.js';

/** A de-skew is intentionally much smaller than the operator's legal two-second strategy range. */
export const TIMING_DESKEW_CAP_MS = 12;

export interface TimingDeskewCorrection {
  workerId: string;
  fanOutIndex: number;
  workerCorrectionMs: number;
  fanOutIndexCorrectionMs: number;
  correctionMs: number;
  matchingReleases: number;
  evidenceStrength: LiveAnchorEvidenceStrength;
}
export interface TimingDeskewCalibration {
  generatedAt: string;
  capMs: number;
  corrections: TimingDeskewCorrection[];
}
export interface DeskewedTimingPlan extends FanOutTimingPlan {
  children: Array<FanOutTimingPlan['children'][number] & TimingDeskewCorrection & { baseConfiguredOffsetMs: number; finalConfiguredOffsetMs: number }>;
}

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)]! : 0;
};
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const localLag = (sample: LiveTimingSample) => sample.invokeToChromeLagMs as number;
const releaseMedians = (samples: readonly LiveTimingSample[], key: (sample: LiveTimingSample) => boolean) => {
  const runs = new Map<string, number[]>();
  for (const sample of samples.filter(key)) runs.set(sample.runId, [...(runs.get(sample.runId) ?? []), localLag(sample)]);
  return [...runs.values()].map(median);
};

/**
 * Builds deterministic LOCAL corrections from the same fresh/compatible releases used by the anchor.
 *
 * Only worker-invocation -> Chrome-start lag is used. Configured-trigger -> Chrome lag also contains the time a child
 * waited behind earlier children in the central dispatcher queue (offline 7x1/7x2 benchmarks: A..G rises ~0.4 ms per
 * queue position while invocation -> Chrome is flat). Retiming cannot remove that serialization: moving G earlier
 * only makes it fire alone, and the next calibration would undo the move. The whole-group anchor absorbs it instead.
 *
 * The release-level baseline is subtracted first, so de-skew changes relative alignment rather than silently
 * moving the whole group. Two real releases are required; smaller datasets remain visible but zero.
 */
export function calibrateTimingDeskew(samples: readonly LiveTimingSample[], anchor: LiveAnchorCalibration,
  identity: { dispatchMode: string; fanOutWidth: number; machineKey?: string | null; runtimeKey?: string | null }, now = Date.now()): TimingDeskewCalibration {
  const freshRunIds = new Set(anchor.releaseMedians.map(value => value.runId));
  const selected = samples.filter(sample => freshRunIds.has(sample.runId) && sample.origin === 'REAL_RELEASE' && sample.trustedClockValid && sample.dispatched
    && sample.dispatchMode === identity.dispatchMode && sample.fanOutCount === identity.fanOutWidth
    && (!identity.machineKey || !sample.machineKey || sample.machineKey === identity.machineKey)
    && (!identity.runtimeKey || !sample.runtimeKey || sample.runtimeKey === identity.runtimeKey)
    && typeof sample.invokeToChromeLagMs === 'number' && Number.isFinite(sample.invokeToChromeLagMs));
  const workers = [...new Set(selected.map(value => value.workerId))].sort();
  const indices = [...new Set(selected.map(value => value.fanOutIndex).filter((value): value is number => value !== null))].sort((a, b) => a - b);
  const baseline = median(releaseMedians(selected, () => true));
  const correction = (values: number[], releases: number) => releases < 2 ? 0 : clamp(Math.round(baseline - median(values)), -TIMING_DESKEW_CAP_MS, TIMING_DESKEW_CAP_MS);
  const workerValues = new Map(workers.map(workerId => { const values = releaseMedians(selected, sample => sample.workerId === workerId); return [workerId, { values, correction: correction(values, values.length) }] as const; }));
  const indexValues = new Map(indices.map(fanOutIndex => { const values = releaseMedians(selected, sample => sample.fanOutIndex === fanOutIndex); return [fanOutIndex, { values, correction: correction(values, values.length) }] as const; }));
  const corrections: TimingDeskewCorrection[] = [];
  for (const workerId of workers) for (const fanOutIndex of indices) {
    const worker = workerValues.get(workerId)!, index = indexValues.get(fanOutIndex)!;
    const matchingReleases = Math.min(worker.values.length, index.values.length);
    const usable = matchingReleases >= 2;
    const workerCorrectionMs = usable ? worker.correction : 0, fanOutIndexCorrectionMs = usable ? index.correction : 0;
    corrections.push({ workerId, fanOutIndex, workerCorrectionMs, fanOutIndexCorrectionMs,
      correctionMs: clamp(workerCorrectionMs + fanOutIndexCorrectionMs, -TIMING_DESKEW_CAP_MS, TIMING_DESKEW_CAP_MS),
      matchingReleases, evidenceStrength: evidenceStrength(matchingReleases) });
  }
  return { generatedAt: new Date(now).toISOString(), capMs: TIMING_DESKEW_CAP_MS, corrections };
}

/** Applies corrections to already anchored base offsets; the saved literal offset remains the authority. */
export function applyTimingDeskew(base: FanOutTimingPlan, calibration: TimingDeskewCalibration, workerId: string): DeskewedTimingPlan {
  return { ...base, children: base.children.map(child => {
    const found = calibration.corrections.find(value => value.workerId === workerId && value.fanOutIndex === child.fanOutIndex)
      ?? { workerId, fanOutIndex: child.fanOutIndex, workerCorrectionMs: 0, fanOutIndexCorrectionMs: 0, correctionMs: 0, matchingReleases: 0, evidenceStrength: 'NONE' as const };
    const finalConfiguredOffsetMs = clamp(child.configuredOffsetMs + found.correctionMs, RELEASE_OFFSET_MIN_MS, RELEASE_OFFSET_MAX_MS);
    const actualCorrection = finalConfiguredOffsetMs - child.configuredOffsetMs;
    return { ...child, ...found, correctionMs: actualCorrection, baseConfiguredOffsetMs: child.configuredOffsetMs, configuredOffsetMs: finalConfiguredOffsetMs,
      finalConfiguredOffsetMs, predictedChromeStartMs: child.predictedChromeStartMs
        ? [child.predictedChromeStartMs[0] + actualCorrection, child.predictedChromeStartMs[1] + actualCorrection] as [number, number] : null };
  }) };
}
