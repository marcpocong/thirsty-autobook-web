import type { Wing } from './court-registry.js';
import { SHOTGUN_MAX_TRIGGER_LATENESS_MS, SHOTGUN_MEANINGFUL_SPACING_MS, denseCoreOffsets, isShotgunOffsetMs } from './shotgun.js';
import { PRECISION_MAX_FAN_OUT } from './workers.js';
import { defaultShotgun, type ObjectiveShotgun } from './booking-objective.js';

/**
 * Shotgun suggestions, presets and schedule metrics. Dependency-free. A suggestion is a starting point with a stated
 * rationale and confidence; it never predicts provider success and never overwrites an operator's custom preset.
 */
export const SHOTGUN_WINDOW = Object.freeze({ minMs: -2000, maxMs: 0 });
/** Benchmarked locally READY lower-density envelope (8 globally spaced attempts over 2 s, 2026-10-14). */
export const BENCHMARKED_READY_ATTEMPTS = 8;
/** Historical Dense Core 20 was AT_RISK locally; suggestions stay below it. */
export const SUGGESTION_CEILING = 16;
export interface ShotgunEvidence {
  immediateTargets: number; targetWings: Wing[]; idealCourts: number; readyWorkers: number;
  /** Machine meaningful spacing from the fan-out capacity profile, if one applies to this build. */ meaningfulSpacingMs?: number | null;
  /** Latest applicable local timing readiness for the exact topology, if any. */ timing?: { status: 'READY' | 'AT_RISK' | 'FAILED' | 'NOT_TESTED'; shotCount: number; p95: number | null } | null;
  /** Live configured-trigger → Chrome request lag p95 from real releases, if calibrated. */ liveInvokeToChromeP95Ms?: number | null;
  /** Number of recorded real releases with critical-path timing. */ releasesWithTiming?: number;
  prewarmConcurrency?: number;
}
export interface ShotgunSuggestion { settings: ObjectiveShotgun; confidence: 'HEURISTIC' | 'LOCALLY_BENCHMARKED'; rationale: string[]; evidence: string[]; warnings: string[] }

export function suggestShotgun(e: ShotgunEvidence): ShotgunSuggestion {
  const rationale: string[] = [], evidence: string[] = [], warnings: string[] = [];
  const spacing = Math.max(SHOTGUN_MEANINGFUL_SPACING_MS, Math.ceil(e.meaningfulSpacingMs ?? SHOTGUN_MEANINGFUL_SPACING_MS));
  const span = SHOTGUN_WINDOW.maxMs - SHOTGUN_WINDOW.minMs, bySpacing = Math.floor(span / spacing) + 1;
  const targets = Math.max(1, e.immediateTargets), workers = Math.max(0, e.readyWorkers);
  // Every target needs at least one worker; each worker owns up to six child tabs for its own target.
  const byWorkers = targets <= workers ? workers * PRECISION_MAX_FAN_OUT : 0;
  if (!byWorkers) warnings.push(`${targets} immediate targets need at least ${targets} ready workers; ${workers} are ready.`);
  const wanted = Math.max(BENCHMARKED_READY_ATTEMPTS, 2 * targets);
  const budget = Math.max(targets, Math.min(wanted, bySpacing, SUGGESTION_CEILING, byWorkers || targets));
  rationale.push(`${targets} immediate target${targets === 1 ? '' : 's'} across ${e.targetWings.map(w => w === 'MANGO' ? 'Mango' : 'Buko').join(' and ') || 'no wing'}; ideal ${e.idealCourts} distinct court${e.idealCourts === 1 ? '' : 's'}.`);
  rationale.push(`Budget ${budget}: about two attempts per target, at least the ${BENCHMARKED_READY_ATTEMPTS}-attempt envelope that was locally READY, below the Dense 20 schedule that was locally AT RISK.`);
  rationale.push(`Spread evenly over −2000…0 ms; ${spacing} ms meaningful-spacing reference allows about ${bySpacing} distinct positions.`);
  if (budget < wanted) rationale.push(`Reduced from ${wanted} by ${budget === bySpacing ? 'timing spacing' : budget === SUGGESTION_CEILING ? 'the suggestion ceiling' : 'free worker capacity'}.`);
  const allocationMode = e.idealCourts > 1 || e.targetWings.length > 1 ? 'EQUAL' : 'PRIORITY_WEIGHTED';
  rationale.push(allocationMode === 'EQUAL' ? 'Equal allocation keeps every distinct court in play, because the goal needs more than one court or wing.'
    : 'Priority-weighted allocation favors your first choices while keeping alternatives.');
  evidence.push(e.meaningfulSpacingMs ? `Machine fan-out profile: ${e.meaningfulSpacingMs} ms meaningful spacing.` : `No applicable machine profile; ${SHOTGUN_MEANINGFUL_SPACING_MS} ms historical reference used.`);
  if (e.liveInvokeToChromeP95Ms !== undefined && e.liveInvokeToChromeP95Ms !== null) evidence.push(`Live invoke→Chrome p95 ${e.liveInvokeToChromeP95Ms} ms from ${e.releasesWithTiming ?? 0} recorded release(s).`);
  else evidence.push('No live invoke→Chrome calibration recorded for this build.');
  if (e.prewarmConcurrency) evidence.push(`Browser preparation concurrency ${e.prewarmConcurrency}.`);
  const benchmarked = e.timing?.status === 'READY' && e.timing.shotCount === budget;
  if (benchmarked) evidence.push(`Local timing READY for ${budget} attempts (p95 ${e.timing!.p95 ?? '—'} ms).`);
  else warnings.push('Heuristic: no local timing benchmark exists for this exact schedule. Run Booking Test Lab (offline) to measure it.');
  if (e.liveInvokeToChromeP95Ms && e.liveInvokeToChromeP95Ms > SHOTGUN_MAX_TRIGGER_LATENESS_MS) warnings.push(`Live trigger→Chrome lag (${e.liveInvokeToChromeP95Ms} ms) exceeds the strict ${SHOTGUN_MAX_TRIGGER_LATENESS_MS} ms lateness bound; expect omitted attempts.`);
  return { settings: { ...defaultShotgun(), budget, allocationMode, timingMode: 'AUTO', presetId: 'SUGGESTED', source: 'SUGGESTED' },
    confidence: benchmarked ? 'LOCALLY_BENCHMARKED' : 'HEURISTIC', rationale, evidence, warnings };
}

export type ShotgunPresetId = 'SUGGESTED' | 'DENSE_CORE' | 'BALANCED' | 'WIDE' | 'FULLY_CUSTOM';
export const BUILT_IN_PRESETS: ReadonlyArray<{ id: ShotgunPresetId; label: string; detail: string }> = Object.freeze([
  { id: 'SUGGESTED', label: 'Suggested', detail: 'Evidence-based starting point (see rationale).' },
  { id: 'DENSE_CORE', label: 'Dense Core', detail: '20-position experimental schedule concentrated in the final second. Locally AT RISK at 20.' },
  { id: 'BALANCED', label: 'Balanced', detail: 'Two times the meaningful spacing, ending at release.' },
  { id: 'WIDE', label: 'Wide', detail: 'Four times the meaningful spacing, ending at release.' },
  { id: 'FULLY_CUSTOM', label: 'Fully Custom', detail: 'Every attempt\'s target and offset are literal and editable.' }]);
/** Applies a built-in preset to the current settings. Budget and allocation are kept unless the preset defines them. */
export function applyPreset(id: ShotgunPresetId, current: ObjectiveShotgun, context: { suggestion: ShotgunSuggestion; literal: ReadonlyArray<{ targetId: string; offsetMs: number }> }): ObjectiveShotgun {
  const base = { ...current, presetId: id, source: id === 'SUGGESTED' ? 'SUGGESTED' as const : id === 'FULLY_CUSTOM' ? 'CUSTOM' as const : 'PRESET' as const };
  delete (base as Partial<ObjectiveShotgun>).customAssignments; delete (base as Partial<ObjectiveShotgun>).customOffsetsMs;
  if (id === 'SUGGESTED') return { ...context.suggestion.settings };
  if (id === 'DENSE_CORE') return { ...base, timingMode: 'DENSE_CORE', windowStartMs: -1000, windowEndMs: 0, budget: Math.max(current.budget, 1), timingCapacityOverride: false };
  if (id === 'BALANCED' || id === 'WIDE') return { ...base, timingMode: id, windowStartMs: -2000, windowEndMs: 0 };
  // Fully Custom starts from the currently compiled literal schedule; nothing is respaced.
  return { ...base, timingMode: 'CUSTOM', allocationMode: 'CUSTOM', budget: Math.max(1, context.literal.length),
    customOffsetsMs: context.literal.map(p => p.offsetMs), customAssignments: context.literal.map(p => p.targetId) };
}

export interface SavedShotgunPreset { id: string; name: string; createdAt: string; updatedAt: string; settings: ObjectiveShotgun }
const presetId = (name: string, now: string) => `user-${now.replace(/[^0-9]/g, '').slice(0, 17)}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`;
export function savePreset(list: readonly SavedShotgunPreset[], name: string, settings: ObjectiveShotgun, now = new Date().toISOString()): SavedShotgunPreset[] {
  const clean = name.trim().slice(0, 60);
  if (!clean) throw Error('PRESET_NAME_REQUIRED');
  if (list.some(p => p.name.toLowerCase() === clean.toLowerCase())) throw Error('PRESET_NAME_EXISTS');
  return [...list, { id: presetId(clean, now), name: clean, createdAt: now, updatedAt: now, settings: JSON.parse(JSON.stringify(settings)) }];
}
export function renamePreset(list: readonly SavedShotgunPreset[], id: string, name: string, now = new Date().toISOString()) {
  const clean = name.trim().slice(0, 60);
  if (!clean) throw Error('PRESET_NAME_REQUIRED');
  if (list.some(p => p.id !== id && p.name.toLowerCase() === clean.toLowerCase())) throw Error('PRESET_NAME_EXISTS');
  if (!list.some(p => p.id === id)) throw Error('PRESET_NOT_FOUND');
  return list.map(p => p.id === id ? { ...p, name: clean, updatedAt: now } : p);
}
export function duplicatePreset(list: readonly SavedShotgunPreset[], id: string, now = new Date().toISOString()) {
  const source = list.find(p => p.id === id); if (!source) throw Error('PRESET_NOT_FOUND');
  let name = `${source.name} copy`, n = 2; while (list.some(p => p.name.toLowerCase() === name.toLowerCase())) name = `${source.name} copy ${n++}`;
  return savePreset(list, name, source.settings, now);
}
export const removePreset = (list: readonly SavedShotgunPreset[], id: string) => list.filter(p => p.id !== id);
/** Restoring a saved preset returns its exact settings; nothing is recalculated. */
export function restorePreset(list: readonly SavedShotgunPreset[], id: string): ObjectiveShotgun {
  const preset = list.find(p => p.id === id); if (!preset) throw Error('PRESET_NOT_FOUND');
  return { ...JSON.parse(JSON.stringify(preset.settings)), presetId: preset.id };
}
export function comparePresets(a: ObjectiveShotgun, b: ObjectiveShotgun) {
  const fields: Array<[string, (s: ObjectiveShotgun) => string]> = [
    ['Attempts', s => String(s.timingMode === 'CUSTOM' && s.customOffsetsMs ? s.customOffsetsMs.length : s.budget)], ['Allocation', s => s.allocationMode],
    ['Timing', s => s.timingMode], ['Window', s => `${s.windowStartMs}…${s.windowEndMs} ms`],
    ['Offsets', s => s.customOffsetsMs ? s.customOffsetsMs.join(', ') : '(generated)'], ['Capacity override', s => s.timingCapacityOverride ? 'on' : 'off']];
  return fields.map(([label, read]) => ({ label, a: read(a), b: read(b), differs: read(a) !== read(b) }));
}

export interface ScheduleShot { targetId: string; offsetMs: number; workerId?: string | null }
export interface ScheduleMetrics {
  count: number; earliestMs: number | null; latestMs: number | null; minimumGapMs: number | null;
  gaps: number[]; coincident: Array<{ offsetMs: number; count: number }>; closeGaps: number; invalid: number[];
  density: Array<{ fromMs: number; toMs: number; count: number }>; perWorker: Record<string, number>;
}
/** Timeline facts from the literal schedule. Invalid offsets are reported, never clamped. */
export function scheduleMetrics(shots: readonly ScheduleShot[], meaningfulSpacingMs = SHOTGUN_MEANINGFUL_SPACING_MS, bucketMs = 250): ScheduleMetrics {
  const invalid = shots.map(s => s.offsetMs).filter(o => !isShotgunOffsetMs(o));
  const ordered = shots.map(s => s.offsetMs).filter(isShotgunOffsetMs).sort((a, b) => a - b);
  const gaps = ordered.slice(1).map((value, index) => value - ordered[index]!);
  const counts = new Map<number, number>(); for (const o of ordered) counts.set(o, (counts.get(o) ?? 0) + 1);
  const density: ScheduleMetrics['density'] = [];
  for (let from = SHOTGUN_WINDOW.minMs; from < SHOTGUN_WINDOW.maxMs; from += bucketMs) density.push({ fromMs: from, toMs: from + bucketMs, count: ordered.filter(o => o >= from && (o < from + bucketMs || (from + bucketMs === 0 && o === 0))).length });
  const perWorker: Record<string, number> = {}; for (const s of shots) if (s.workerId) perWorker[s.workerId] = (perWorker[s.workerId] ?? 0) + 1;
  return { count: shots.length, earliestMs: ordered[0] ?? null, latestMs: ordered.at(-1) ?? null, minimumGapMs: gaps.length ? Math.min(...gaps) : null, gaps,
    coincident: [...counts.entries()].filter(([, n]) => n > 1).map(([offsetMs, count]) => ({ offsetMs, count })), closeGaps: gaps.filter(g => g < meaningfulSpacingMs).length, invalid, density, perWorker };
}
export const denseCorePreview = (count: number) => denseCoreOffsets(Math.min(count, 42));
