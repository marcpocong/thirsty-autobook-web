/**
 * Fan-out timing presets derived from this machine's Fan-out Capacity Profile (fanout-capacity.ts).
 *
 * These are LOCAL DISPATCH profiles. A preset only decides how far apart the children of one target are triggered, so
 * that the local dispatcher can actually keep them apart; it says nothing about how Onda arbitrates. Three different
 * times must never be confused:
 *   configured trigger       the Release Offset the child is scheduled at (negative = before the release instant)
 *   predicted Chrome start   configured trigger + the measured local trigger→Chrome lag of that child position
 *   observed Chrome start    what a real run recorded (critical-path telemetry)
 * None of them is a network arrival time.
 *
 * Dependency-free (types only) so the renderer, the main process and tests share one generator.
 */
import type { FanOutProfile, Stats, WidthSummary } from './fanout-capacity.js';

export type FanOutTimingPreset = 'TIGHT' | 'BALANCED' | 'WIDE' | 'CUSTOM';
export const FANOUT_TIMING_PRESETS: readonly Exclude<FanOutTimingPreset, 'CUSTOM'>[] = ['TIGHT', 'BALANCED', 'WIDE'];
/** Structural copy of release-offset.ts's guarded range (this module stays import-free for the renderer). */
const OFFSET_MIN_MS = -2_000, OFFSET_MAX_MS = 0;
/** Multiples of the machine's minimum meaningful spacing for each preset. */
const SPACING_FACTOR: Record<Exclude<FanOutTimingPreset, 'CUSTOM'>, number> = { TIGHT: 1, BALANCED: 2, WIDE: 4 };
/** Without a profile nothing is assumed about the machine; the fallback spacing is deliberately conservative. */
export const UNMEASURED_MIN_SPACING_MS = 10;

export interface ChildTiming {
  fanOutIndex: number;
  configuredOffsetMs: number;
  /** Predicted local Chrome request start relative to release, [p50, p95] of the measured lag; null without a profile. */
  predictedChromeStartMs: [number, number] | null;
}
export interface FanOutTimingPlan {
  preset: FanOutTimingPreset; width: number; spacingMs: number; minSpacingMs: number;
  children: ChildTiming[];
  /** Where the spacing came from, for the operator. */
  basis: string;
  warnings: string[];
}

const nearest = (value: number, step: number) => Math.ceil(value / step) * step;
const width = (profile: FanOutProfile | null, count: number): WidthSummary | undefined =>
  profile?.widths.find(value => value.width === count);

/**
 * The smallest spacing this machine can meaningfully preserve between children at this width: the larger of the loaded
 * trigger→Chrome jitter (p95 − p50), the per-position step between consecutive child indices, and a quarter of the p95
 * first-to-last spread, never below 2 ms. Rounded up to whole milliseconds.
 */
export function minimumMeaningfulSpacingMs(profile: FanOutProfile | null, fanOutWidth: number): { spacingMs: number; basis: string } {
  const summary = width(profile, fanOutWidth);
  if (!summary) return { spacingMs: UNMEASURED_MIN_SPACING_MS, basis: `No measured profile at width ${fanOutWidth}: conservative ${UNMEASURED_MIN_SPACING_MS} ms spacing. Run the capacity benchmark.` };
  const lag = summary.triggerToChromeStart;
  const jitter = lag.p95 !== null && lag.p50 !== null ? lag.p95 - lag.p50 : 0;
  const steps = summary.perChildIndex.slice(1).map((value, index) => (value.triggerToChromeStart.p95 ?? 0) - (summary.perChildIndex[index]!.triggerToChromeStart.p95 ?? 0));
  const step = steps.length ? Math.max(0, ...steps) : 0;
  const spread = (summary.spread.p95 ?? 0) / 4;
  const spacing = Math.max(2, Math.ceil(Math.max(jitter, step, spread)));
  return { spacingMs: spacing, basis: `Measured ${summary.workers}×${summary.width}: loaded trigger→Chrome p50 ${lag.p50} ms, p95 ${lag.p95} ms, p99 ${lag.p99} ms; `
    + `spread p95 ${summary.spread.p95} ms (profile ${profile!.createdAt.slice(0, 10)}).` };
}

/** Predicted local Chrome start of one child: configured + measured lag of that child position (p50…p95). */
function predict(summary: WidthSummary | undefined, fanOutIndex: number, configured: number): [number, number] | null {
  const position: Stats | undefined = summary?.perChildIndex.find(value => value.fanOutIndex === fanOutIndex)?.triggerToChromeStart ?? summary?.triggerToChromeStart;
  if (!position || position.p50 === null || position.p95 === null) return null;
  return [Math.round((configured + position.p50) * 10) / 10, Math.round((configured + position.p95) * 10) / 10];
}

/**
 * Children of one target for a preset. The last child is triggered at the release instant (offset 0) and earlier
 * children step back by the preset spacing; a spacing never goes below the machine's minimum meaningful spacing.
 */
export function fanOutTimingPlan(preset: Exclude<FanOutTimingPreset, 'CUSTOM'>, fanOutWidth: number, profile: FanOutProfile | null): FanOutTimingPlan {
  if (!Number.isInteger(fanOutWidth) || fanOutWidth < 1 || fanOutWidth > 6) throw Error('FANOUT_WIDTH_INVALID');
  const minimum = minimumMeaningfulSpacingMs(profile, fanOutWidth);
  const spacing = Math.max(minimum.spacingMs, nearest(minimum.spacingMs * SPACING_FACTOR[preset], 5));
  const summary = width(profile, fanOutWidth);
  const children = Array.from({ length: fanOutWidth }, (_, index) => {
    // + 0 normalizes -0: the last child is at exactly 0 ms.
    const configured = Math.max(OFFSET_MIN_MS, -spacing * (fanOutWidth - 1 - index)) + 0;
    return { fanOutIndex: index, configuredOffsetMs: configured, predictedChromeStartMs: predict(summary, index, configured) };
  });
  return { preset, width: fanOutWidth, spacingMs: fanOutWidth > 1 ? spacing : 0, minSpacingMs: minimum.spacingMs, children, basis: minimum.basis,
    warnings: summary ? [] : [`Width ${fanOutWidth} has no measured capacity profile: spacing is a conservative default, not a measurement.`] };
}

/** An operator's own offsets, validated and annotated with the same local predictions and spacing warnings. */
export function customFanOutTiming(offsets: readonly number[], profile: FanOutProfile | null): FanOutTimingPlan {
  if (!offsets.length || offsets.length > 6) throw Error('FANOUT_WIDTH_INVALID');
  if (offsets.some(value => !Number.isSafeInteger(value) || value < OFFSET_MIN_MS || value > OFFSET_MAX_MS)) throw Error('FANOUT_OFFSET_INVALID');
  const minimum = minimumMeaningfulSpacingMs(profile, offsets.length), summary = width(profile, offsets.length);
  const sorted = [...offsets].sort((a, b) => a - b);
  const closest = sorted.slice(1).reduce((min, value, index) => Math.min(min, value - sorted[index]!), Infinity);
  const warnings = [...(summary ? [] : [`Width ${offsets.length} has no measured capacity profile: predictions are unavailable.`]),
    ...(offsets.length > 1 && closest < minimum.spacingMs ? [`Two children are ${closest} ms apart; this machine cannot reliably keep children closer than ${minimum.spacingMs} ms apart.`] : [])];
  return { preset: 'CUSTOM', width: offsets.length, spacingMs: Number.isFinite(closest) ? closest : 0, minSpacingMs: minimum.spacingMs,
    children: offsets.map((configured, index) => ({ fanOutIndex: index, configuredOffsetMs: configured, predictedChromeStartMs: predict(summary, index, configured) })),
    basis: minimum.basis, warnings };
}

/** "Configured −60 ms · expected Chrome start ≈ −49…−44 ms (local prediction, not network arrival)". */
export function describeChildTiming(child: ChildTiming): string {
  const ms = (value: number) => value < 0 ? `−${Math.abs(value)} ms` : value > 0 ? `+${value} ms` : '0 ms';
  const configured = `Configured ${ms(child.configuredOffsetMs)}`;
  if (!child.predictedChromeStartMs) return `${configured} · no local measurement`;
  const [low, high] = child.predictedChromeStartMs;
  return `${configured} · expected Chrome start ≈ ${ms(Math.round(low))}…${ms(Math.round(high))} (local prediction, not network arrival)`;
}
