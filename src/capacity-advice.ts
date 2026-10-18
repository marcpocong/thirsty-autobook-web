import { compileObjective, type BookingObjective, type CompileContext } from './booking-objective.js';
import { forecastPreparation } from './quick-shotgun.js';
import type { PrewarmFeasibilityResult } from './api-booking/prewarm-feasibility.js';

/**
 * Transparent capacity advice for a Shotgun draft whose preparation forecast predicts omissions. Dependency-free
 * (renderer-safe). It never edits anything: it returns a proposed objective plus an exact before/after comparison,
 * and the operator must accept it into the draft and then save the release plan explicitly.
 *
 * Reduction rule (deterministic): literal custom timing keeps the attempts closest to the release instant (the dense
 * core) with their exact offsets and targets; generated timing reduces the attempt budget (custom counts scaled by
 * largest remainder). The proposal is the LARGEST attempt count the same forecast predicts with zero omissions.
 */
export interface CapacitySide { attempts: number; ready: number; atRisk: number; omitted: number; workers: string; offsets: number[] }
export interface CapacityAdvice { before: CapacitySide; after: CapacitySide; objective: BookingObjective; removedOffsets: number[]; basis: string }
type Prior = Pick<PrewarmFeasibilityResult, 'p95Source' | 'preparationP95Ms' | 'sampleCount'> | null | undefined;

function side(o: BookingObjective, ctx: CompileContext, prior: Prior): { side: CapacitySide; forecast: PrewarmFeasibilityResult } | null {
  const compiled = compileObjective(o, ctx), cohort = compiled.cohorts[0], phase3 = cohort?.smart?.phase3, shots = cohort?.smart?.shotgun?.shots;
  if (compiled.problems.length || !phase3 || !shots) return null;
  const forecast = forecastPreparation(phase3, ctx.unavailableWorkers ?? new Set(), prior ?? null);
  return { forecast, side: { attempts: shots.length, ready: forecast.projectedReady, atRisk: forecast.projectedAtRisk, omitted: forecast.projectedOmitted,
    workers: phase3.wave1.map(a => `${a.workerId}:${a.fanOutOffsetsMs?.length ?? 1}`).join(' '), offsets: shots.map(s => s.configuredOffsetMs).sort((a, b) => a - b) } };
}
function largestRemainder(counts: Record<string, number>, total: number): Record<string, number> {
  const entries = Object.entries(counts), sum = entries.reduce((n, [, v]) => n + v, 0) || 1;
  const raw = entries.map(([id, v]) => ({ id, exact: v * total / sum })), out: Record<string, number> = {};
  for (const r of raw) out[r.id] = Math.floor(r.exact);
  let left = total - Object.values(out).reduce((n, v) => n + v, 0);
  for (const r of [...raw].sort((a, b) => (b.exact % 1) - (a.exact % 1) || a.id.localeCompare(b.id))) { if (left <= 0) break; out[r.id]! += 1; left--; }
  return out;
}
export function reduceShotgunAttempts(o: BookingObjective, attempts: number): BookingObjective {
  const next: BookingObjective = JSON.parse(JSON.stringify(o)), s = next.shotgun;
  if (s.timingMode === 'CUSTOM' && s.customAssignments && s.customOffsetsMs) {
    const keep = s.customOffsetsMs.map((offset, index) => ({ offset, index })).sort((a, b) => b.offset - a.offset || a.index - b.index).slice(0, attempts).map(v => v.index).sort((a, b) => a - b);
    s.customAssignments = keep.map(i => s.customAssignments![i]!); s.customOffsetsMs = keep.map(i => s.customOffsetsMs![i]!);
  } else if (s.allocationMode === 'CUSTOM' && s.customCounts) s.customCounts = largestRemainder(s.customCounts, attempts);
  s.budget = attempts; s.presetId = 'CAPACITY_REDUCED'; s.source = 'CUSTOM';
  return next;
}
export function capacityAdvice(o: BookingObjective, ctx: CompileContext, prior: Prior): CapacityAdvice | null {
  if (o.strategy !== 'SHOTGUN') return null;
  const current = side(o, ctx, prior);
  if (!current || !current.side.omitted) return null;
  for (let n = Math.min(current.side.ready, current.side.attempts - 1); n >= 1; n--) {
    const candidate = reduceShotgunAttempts(o, n), result = side(candidate, ctx, prior);
    if (!result || result.side.omitted) continue;
    const kept = [...result.side.offsets], removed = current.side.offsets.filter(offset => { const i = kept.indexOf(offset); if (i >= 0) { kept.splice(i, 1); return false; } return true; });
    return { before: current.side, after: result.side, objective: candidate, removedOffsets: removed,
      basis: current.forecast.p95Source === 'FALLBACK' ? 'fallback preparation estimate (no compatible measured history)' : `measured preparation p95 ${(current.forecast.preparationP95Ms / 1000).toFixed(1)} s from ${current.forecast.sampleCount} samples` };
  }
  return null;
}
