/**
 * Regression gates for the offline release benchmark (scripts/benchmark-precision-release.ts summaries).
 *
 * SAFETY gates are machine-independent and absolute:
 *   - no transmission before release (fetch provably early, Chrome request start, route handler);
 *   - every offline attempt settles REJECTED (the synthetic 409): none UNKNOWN, NOT_DISPATCHED or verified;
 *   - in renderer mode, every attempt actually used the renderer path (a silent fallback is a failure).
 * LATENCY gates are machine-dependent: p50/p95/p99 may not exceed factor × baseline + slack, where the
 * baseline is a summary from the SAME machine and configuration. There are no absolute latency targets here:
 * a number from this container says nothing about the Windows desktop.
 */
export interface LatencyGate { metric: string; stats: Array<'p50' | 'p95' | 'p99'>; factor: number; slackMs: number }
export const DEFAULT_LATENCY_GATES: readonly LatencyGate[] = Object.freeze([
  { metric: 'releaseToRequestEvent_allWorkers', stats: ['p50', 'p95', 'p99'], factor: 1.25, slackMs: 1 },
  { metric: 'firstToLastSpread', stats: ['p50', 'p95', 'p99'], factor: 1.5, slackMs: 1 },
  { metric: 'criticalPath.releaseToFetchInvoked', stats: ['p50', 'p95', 'p99'], factor: 1.25, slackMs: 1 },
  { metric: 'criticalPath.releaseToBrowserRequestStart', stats: ['p50', 'p95', 'p99'], factor: 1.25, slackMs: 1 },
  { metric: 'criticalPath.browserRequestStartSpread', stats: ['p50', 'p95', 'p99'], factor: 1.5, slackMs: 1 },
] as LatencyGate[]);

export interface GateResult { configuration: string; kind: 'safety' | 'latency'; gate: string; value: number | null; limit: number | null; pass: boolean }
type Json = Record<string, unknown>;
const at = (object: unknown, path: string): unknown => path.split('.').reduce<unknown>((value, key) => (value && typeof value === 'object' ? (value as Json)[key] : undefined), object);
const numberAt = (object: unknown, path: string) => { const value = at(object, path); return typeof value === 'number' && Number.isFinite(value) ? value : null; };

export function evaluateSafety(summary: Json, options: { requireRenderer?: boolean } = {}): GateResult[] {
  const results: GateResult[] = [];
  const configurations = (summary.configurations ?? {}) as Record<string, Json>;
  for (const [name, configuration] of Object.entries(configurations)) {
    const states = (configuration.states ?? {}) as Record<string, number>;
    const other = Object.entries(states).filter(([state]) => state !== 'REJECTED').reduce((sum, [, count]) => sum + count, 0);
    results.push({ configuration: name, kind: 'safety', gate: 'every attempt settled REJECTED (offline 409)', value: other, limit: 0, pass: other === 0 && (states.REJECTED ?? 0) > 0 });
    const early = at(configuration, 'criticalPath.earlyTransmission') as Record<string, number> | undefined;
    if (early) for (const key of ['fetchProvablyEarly', 'browserRequestStartBeforeRelease', 'routeSeenBeforeRelease']) {
      const value = typeof early[key] === 'number' ? early[key]! : null;
      results.push({ configuration: name, kind: 'safety', gate: `no early transmission: ${key}`, value, limit: 0, pass: value === 0 });
    } else results.push({ configuration: name, kind: 'safety', gate: 'critical path recorded', value: null, limit: null, pass: false });
    if (options.requireRenderer) {
      const plans = (at(configuration, 'criticalPath.planEvents') ?? {}) as Record<string, number>;
      const fallbacks = Object.entries(plans).filter(([key]) => key !== 'renderer').reduce((sum, [, count]) => sum + count, 0);
      results.push({ configuration: name, kind: 'safety', gate: 'renderer path used for every attempt (no silent fallback)', value: fallbacks, limit: 0,
        pass: fallbacks === 0 && (plans.renderer ?? 0) > 0 });
    }
  }
  return results;
}

export function evaluateLatency(summary: Json, baseline: Json, gates: readonly LatencyGate[] = DEFAULT_LATENCY_GATES): GateResult[] {
  const results: GateResult[] = [];
  const configurations = (summary.configurations ?? {}) as Record<string, Json>;
  const baselines = (baseline.configurations ?? {}) as Record<string, Json>;
  for (const [name, configuration] of Object.entries(configurations)) {
    const reference = baselines[name];
    if (!reference) continue;
    for (const gate of gates) for (const stat of gate.stats) {
      const value = numberAt(configuration, `${gate.metric}.${stat}`), base = numberAt(reference, `${gate.metric}.${stat}`);
      if (value === null && base === null) continue;
      const limit = base === null ? null : Math.round((base * gate.factor + gate.slackMs) * 1000) / 1000;
      results.push({ configuration: name, kind: 'latency', gate: `${gate.metric}.${stat} ≤ ${gate.factor}× baseline + ${gate.slackMs} ms`, value, limit,
        pass: value !== null && limit !== null && value <= limit });
    }
  }
  return results;
}
