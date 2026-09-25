import type { Page } from 'playwright';
// No `performance` import on purpose: functions passed to page.evaluate() are serialized as source, and a
// module-level import binding (rewritten by bundlers/test runners) would not exist in the page. Node's
// global `performance` is the same monotonic clock as perf_hooks.

/**
 * Mapping between a page's `performance.now()` (renderer clock) and Node's `performance.now()`.
 *
 * Both are monotonic readings of the same operating-system clock with different origins, so on one
 * machine they differ by a constant: node = renderer + offset. The offset is bounded by round trips:
 * a renderer reading r taken while Node's clock was between `nodeBefore` and `nodeAfter` gives
 *
 *     nodeBefore − r  ≤  offset  ≤  nodeAfter − r.
 *
 * Intersecting every sample's interval gives [low, high]. An empty intersection means one of the
 * clocks moved (or a sample is corrupt): the calibration is INCONSISTENT and must not be used to time
 * anything. Chrome coarsens performance.now() (≈100 µs without cross-origin isolation), which widens
 * each interval slightly; `resolutionMs` accounts for it.
 */
export interface RendererClockSample { nodeBefore: number; renderer: number; nodeAfter: number }
export interface RendererClockCalibration {
  version: 1;
  samples: number;
  /** node = renderer + offset, with offset in [offsetLowMs, offsetHighMs]. */
  offsetLowMs: number; offsetHighMs: number;
  offsetMs: number;
  /** Half the interval width: the mapping error bound in ms. */
  uncertaintyMs: number;
  minRoundTripMs: number;
  /** Node performance.now() when the last sample finished; used for staleness. */
  calibratedAtNodeMs: number;
  consistent: boolean;
}
export const RENDERER_CLOCK_RESOLUTION_MS = 0.1;

export class RendererClockError extends Error {
  constructor(readonly code: 'RENDERER_CLOCK_NO_SAMPLES' | 'RENDERER_CLOCK_INCONSISTENT' | 'RENDERER_CLOCK_STALE' | 'RENDERER_CLOCK_UNCERTAIN' | 'RENDERER_CLOCK_SAMPLING_FAILED') {
    super(code); this.name = 'RendererClockError';
  }
}

export function calibrateRendererClock(samples: readonly RendererClockSample[], resolutionMs = RENDERER_CLOCK_RESOLUTION_MS): RendererClockCalibration {
  const valid = samples.filter(sample => [sample.nodeBefore, sample.renderer, sample.nodeAfter].every(Number.isFinite) && sample.nodeAfter >= sample.nodeBefore);
  if (!valid.length) throw new RendererClockError('RENDERER_CLOCK_NO_SAMPLES');
  const low = Math.max(...valid.map(sample => sample.nodeBefore - sample.renderer - resolutionMs));
  const high = Math.min(...valid.map(sample => sample.nodeAfter - sample.renderer + resolutionMs));
  const consistent = low <= high;
  return { version: 1, samples: valid.length, offsetLowMs: low, offsetHighMs: high, offsetMs: (low + high) / 2, uncertaintyMs: consistent ? (high - low) / 2 : Infinity,
    minRoundTripMs: Math.min(...valid.map(sample => sample.nodeAfter - sample.nodeBefore)), calibratedAtNodeMs: Math.max(...valid.map(sample => sample.nodeAfter)), consistent };
}

/** Maps a renderer reading onto Node's clock with its error interval. */
export function rendererToNode(calibration: RendererClockCalibration, rendererMs: number): { nodeMs: number; lowMs: number; highMs: number } {
  return { nodeMs: rendererMs + calibration.offsetMs, lowMs: rendererMs + calibration.offsetLowMs, highMs: rendererMs + calibration.offsetHighMs };
}

/**
 * The renderer reading at which Node's clock is CERTAINLY at or past `nodeMs`: using the lowest
 * possible offset makes the renderer wait for the latest possible moment, never an earlier one.
 */
export function earliestSafeRendererTime(calibration: RendererClockCalibration, nodeMs: number): number {
  return nodeMs - calibration.offsetLowMs;
}

export interface CalibrationLimits { maxAgeMs: number; maxUncertaintyMs: number }
/** Throws unless the calibration is consistent, fresh and tight enough. */
export function assertCalibrationUsable(calibration: RendererClockCalibration | undefined, nodeNowMs: number, limits: CalibrationLimits): asserts calibration is RendererClockCalibration {
  if (!calibration || !calibration.samples) throw new RendererClockError('RENDERER_CLOCK_NO_SAMPLES');
  if (!calibration.consistent) throw new RendererClockError('RENDERER_CLOCK_INCONSISTENT');
  if (!(nodeNowMs - calibration.calibratedAtNodeMs <= limits.maxAgeMs) || nodeNowMs < calibration.calibratedAtNodeMs) throw new RendererClockError('RENDERER_CLOCK_STALE');
  if (!(calibration.uncertaintyMs <= limits.maxUncertaintyMs)) throw new RendererClockError('RENDERER_CLOCK_UNCERTAIN');
}

/**
 * Takes `count` sequential round trips of `performance.now()` in the page. Read-only and local: no
 * network request, no page state change. Call it only when no release deadline is imminent (a few ms of CDP use).
 */
export async function sampleRendererClock(page: Pick<Page, 'evaluate'>, count = 8, perf: () => number = () => performance.now()): Promise<RendererClockSample[]> {
  const samples: RendererClockSample[] = [];
  try {
    for (let index = 0; index < count; index++) {
      const nodeBefore = perf();
      const renderer = await page.evaluate(() => performance.now());
      const nodeAfter = perf();
      samples.push({ nodeBefore, renderer, nodeAfter });
    }
  } catch { throw new RendererClockError('RENDERER_CLOCK_SAMPLING_FAILED'); }
  return samples;
}

/** Keeps the tightest samples (smallest round trips); stale or slow samples only widen the interval. */
export function tightestSamples(samples: readonly RendererClockSample[], keep = 4): RendererClockSample[] {
  return [...samples].sort((a, b) => (a.nodeAfter - a.nodeBefore) - (b.nodeAfter - b.nodeBefore)).slice(0, Math.max(1, keep));
}
