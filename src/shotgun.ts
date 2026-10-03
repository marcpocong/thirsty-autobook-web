import { PRECISION_MAX_FAN_OUT, PRECISION_MAX_SENDS } from './workers.js';

export type ShotgunAllocationMode = 'EQUAL' | 'PRIORITY_WEIGHTED' | 'CUSTOM';
export type ShotgunTimingMode = 'AUTO' | 'TIGHT' | 'BALANCED' | 'WIDE' | 'CUSTOM';
export type ShotgunReadiness = 'PREPARING' | 'READY' | 'FAILED' | 'OMITTED';
export type ShotgunSuppressionReason = 'SHOTGUN_TARGET_ALREADY_ACHIEVED' | 'SHOTGUN_TARGET_OUTCOME_UNKNOWN' | 'SHOTGUN_PROVIDER_THROTTLE_STOP';
/** Installation evidence from the 2026-10-03 intercepted spaced run; live compatible profiles may only raise this floor. */
export const SHOTGUN_MEANINGFUL_SPACING_MS=105;
export const isShotgunOffsetMs=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=-2_000&&value<=2_000;
export function shotgunTriggerMs(releaseMs:number,offsetMs:number){if(!Number.isSafeInteger(releaseMs)||!isShotgunOffsetMs(offsetMs))throw Error('SHOTGUN_OFFSET_INVALID');return releaseMs+offsetMs;}

export interface ShotgunTarget {
  logicalTargetId: string;
  priority: number;
}

export interface ShotgunSettings {
  enabled: boolean;
  budget: number;
  allocationMode: ShotgunAllocationMode;
  selectedTargetIds: string[];
  customCounts?: Record<string, number>;
  windowStartMs: number;
  windowEndMs: number;
  timingMode: ShotgunTimingMode;
  /** Exact global release-relative positions used only when timingMode is CUSTOM. */
  customOffsetsMs?: number[];
  timingCapacityOverride?: boolean;
  allowStandbyConsumption?: boolean;
  /** Legacy read compatibility. Migrated conservatively by the editor. */
  capacityOverride?: boolean;
}

export interface ShotgunCapacityInput {
  /** Smallest spacing this machine has demonstrated it can preserve meaningfully. */
  meaningfulSpacingMs: number;
  /** Optional machine recommendation retained for review text; it never changes allocation. */
  recommendedBurstChildren?: number;
  /** Existing fresh learned/manual group anchor applied uniformly to the deterministic relative schedule. */
  groupAnchorMs?: number;
}

/** Legacy override acknowledged timing risk only; standby sacrifice is never inferred. */
export function migrateShotgunSettings<T extends ShotgunSettings>(settings:T):T{
  const migrated={...settings,timingCapacityOverride:settings.timingCapacityOverride??settings.capacityOverride??false,
    allowStandbyConsumption:settings.allowStandbyConsumption??false};delete migrated.capacityOverride;return migrated;
}

export interface ShotgunPlan {
  counts: Record<string, number>;
  shots: Array<{ logicalTargetId: string; shotIndex: number; shotCount: number; configuredOffsetMs: number }>;
  requestedSpacingMs: number | null;
  recommendedMaximum: number;
  capacityWarning: string | null;
  meaningfulSpacingMs: number;
  groupAnchorMs:number;
  problems: string[];
}

/** Stable under visual reordering. Editing the logical court/time target deliberately creates a new identity. */
export const logicalTargetId = (target: { court: number; start: string; durationHours: number }) =>
  `court-${target.court}:${target.start}:${target.durationHours}h`;

const largestRemainder = (budget: number, targets: readonly ShotgunTarget[], weights: readonly number[]) => {
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const raw = weights.map(value => budget * value / totalWeight);
  const counts = raw.map(Math.floor);
  let remaining = budget - counts.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({ index, remainder: value - counts[index]!, priority: targets[index]!.priority }))
    .sort((a, b) => b.remainder - a.remainder || a.priority - b.priority || a.index - b.index);
  for (let index = 0; index < remaining; index++) counts[order[index]!.index]!++;
  return counts;
};

/**
 * Deterministic allocation. Priority weighted gives rank 1..N weights N+1,N,...,2 and uses largest remainder;
 * therefore 20 shots across two targets becomes 12/8 without an opaque scoring model.
 */
export function allocateShotgun(settings: ShotgunSettings, available: readonly ShotgunTarget[]): { counts: Record<string, number>; problems: string[] } {
  const problems: string[] = [];
  if (!settings.enabled) return { counts: {}, problems };
  if (!Number.isSafeInteger(settings.budget) || settings.budget < 1 || settings.budget > PRECISION_MAX_SENDS)
    problems.push(`Shotgun budget must be a whole number from 1 to ${PRECISION_MAX_SENDS}.`);
  const byId = new Map(available.map(value => [value.logicalTargetId, value] as const));
  const ids = [...new Set(settings.selectedTargetIds)];
  if (!ids.length) problems.push('Select at least one immediate logical target for Shotgun.');
  if (ids.some(id => !byId.has(id))) problems.push('A selected Shotgun target is no longer an immediate logical target.');
  const targets = ids.flatMap(id => byId.get(id) ?? []).sort((a, b) => a.priority - b.priority || a.logicalTargetId.localeCompare(b.logicalTargetId));
  if (problems.length) return { counts: {}, problems };
  if (settings.allocationMode === 'CUSTOM') {
    const counts: Record<string, number> = {};
    for (const target of targets) {
      const value = settings.customCounts?.[target.logicalTargetId];
      if (!Number.isSafeInteger(value) || (value as number) < 0) problems.push(`Custom Shotgun count for ${target.logicalTargetId} must be a non-negative whole number.`);
      else counts[target.logicalTargetId] = value as number;
    }
    const sum = Object.values(counts).reduce((total, value) => total + value, 0);
    if (sum > settings.budget) problems.push(`Custom Shotgun allocation uses ${sum}, above the budget of ${settings.budget}.`);
    return { counts, problems };
  }
  const weights = settings.allocationMode === 'EQUAL' ? targets.map(() => 1) : targets.map((_, index) => targets.length - index + 1);
  const values = largestRemainder(settings.budget, targets, weights);
  return { counts: Object.fromEntries(targets.map((target, index) => [target.logicalTargetId, values[index]!])), problems };
}

/** Inclusive, monotonic release-relative schedule; positive offsets are after release. */
export function shotgunOffsets(count: number, startMs: number, endMs: number): number[] {
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs > endMs)
    throw Error('SHOTGUN_WINDOW_INVALID');
  if (!count) return [];
  if (count === 1) return [startMs];
  return Array.from({ length: count }, (_, index) => Math.round(startMs + (endMs - startMs) * index / (count - 1)));
}

export function planShotgun(settings: ShotgunSettings, targets: readonly ShotgunTarget[], capacity: ShotgunCapacityInput): ShotgunPlan {
  const allocated = allocateShotgun(settings, targets), problems = [...allocated.problems];
  if (!Number.isSafeInteger(settings.windowStartMs) || !Number.isSafeInteger(settings.windowEndMs) || settings.windowStartMs < -2_000 || settings.windowEndMs > 2_000 || settings.windowStartMs > settings.windowEndMs)
    problems.push('Shotgun timing window must use whole milliseconds from -2000 through +2000, with start no later than end.');
  const spacing = Number.isFinite(capacity.meaningfulSpacingMs) && capacity.meaningfulSpacingMs > 0 ? Math.ceil(capacity.meaningfulSpacingMs) : SHOTGUN_MEANINGFUL_SPACING_MS;
  const span = Math.max(0, settings.windowEndMs - settings.windowStartMs);
  const recommendedMaximum = Math.max(1, Math.floor(span / spacing) + 1);
  const allocatedCount=Object.values(allocated.counts).reduce((sum,value)=>sum+value,0);
  const timingFactor=settings.timingMode==='TIGHT'?1:settings.timingMode==='BALANCED'?2:settings.timingMode==='WIDE'?4:null;
  const desiredSpan=timingFactor===null?span:spacing*timingFactor*Math.max(0,allocatedCount-1);
  const scheduleStart=timingFactor!==null&&desiredSpan<=span?settings.windowEndMs-desiredSpan:settings.windowStartMs;
  const configuredAnchorMs=Number.isSafeInteger(capacity.groupAnchorMs)?capacity.groupAnchorMs!:0;
  const custom=settings.timingMode==='CUSTOM';
  const groupAnchorMs=custom?0:configuredAnchorMs;
  if(custom&&settings.customOffsetsMs?.length!==allocatedCount)problems.push(`Custom Shotgun timing requires exactly ${allocatedCount} signed offsets.`);
  if(custom&&settings.customOffsetsMs?.some(value=>!isShotgunOffsetMs(value)))problems.push('Custom Shotgun offsets must be whole milliseconds from -2000 through +2000.');
  // Custom values are final operator-entered triggers: anchors must never silently rewrite them.
  const offsets=custom?[...(settings.customOffsetsMs??[])]:shotgunOffsets(allocatedCount,scheduleStart,settings.windowEndMs).map(value=>value+groupAnchorMs);
  if(offsets.some(value=>!isShotgunOffsetMs(value)))problems.push(`The ${groupAnchorMs>=0?'+':''}${groupAnchorMs} ms group anchor moves a Shotgun trigger outside -2000 through +2000 ms.`);
  const chronological=[...offsets].sort((a,b)=>a-b);
  const requestedSpacingMs = chronological.length>1?Math.min(...chronological.slice(1).map((value,index)=>value-chronological[index]!)):null;
  const capacityWarning = custom&&requestedSpacingMs!==null&&requestedSpacingMs<spacing
    ? `Requested Custom spacing reaches ${requestedSpacingMs} ms; measured meaningful spacing is ${spacing} ms.`
    : allocatedCount > recommendedMaximum
    ? `Requested ${allocatedCount}; recommended maximum for this window is about ${recommendedMaximum} at ${spacing} ms meaningful spacing.` : null;
  if (capacityWarning && !(settings.timingCapacityOverride??settings.capacityOverride??false)) problems.push(`${capacityWarning} Enable the timing capacity override or reduce the budget.`);
  // Lay out one global schedule, then distribute those positions fairly among targets. This preserves the
  // advertised aggregate spacing instead of placing every target at the same endpoints and creating hidden bursts.
  const placements=Object.entries(allocated.counts).flatMap(([logicalTargetId,shotCount])=>Array.from({length:shotCount},(_,shotIndex)=>
    ({logicalTargetId,shotIndex,shotCount,rank:(shotIndex+.5)/shotCount})))
    .sort((a,b)=>a.rank-b.rank||a.logicalTargetId.localeCompare(b.logicalTargetId)||a.shotIndex-b.shotIndex);
  const shots = placements.map((placement,index)=>({logicalTargetId:placement.logicalTargetId,shotIndex:placement.shotIndex,
    shotCount:placement.shotCount,configuredOffsetMs:offsets[index]!}));
  return { counts: allocated.counts, shots, requestedSpacingMs, recommendedMaximum, capacityWarning, meaningfulSpacingMs:spacing,groupAnchorMs, problems: [...new Set(problems)] };
}

/** Split one logical target across browser workers while preserving the authoritative per-worker child ceiling. */
export const shotgunWorkerGroups = (offsets: readonly number[]) => Array.from({ length: Math.ceil(offsets.length / PRECISION_MAX_FAN_OUT) }, (_, index) =>
  offsets.slice(index * PRECISION_MAX_FAN_OUT, (index + 1) * PRECISION_MAX_FAN_OUT));

export type ShotgunTimingBucket = '< -500 ms' | '-500 to -100 ms' | '-100 to 0 ms' | '0 to +100 ms' | '+100 to +250 ms' | '> +250 ms';
export function shotgunTimingBucket(offsetMs: number): ShotgunTimingBucket {
  if (offsetMs < -500) return '< -500 ms';
  if (offsetMs < -100) return '-500 to -100 ms';
  if (offsetMs < 0) return '-100 to 0 ms';
  if (offsetMs <= 100) return '0 to +100 ms';
  if (offsetMs <= 250) return '+100 to +250 ms';
  return '> +250 ms';
}

/** Telemetry topology comes only from the saved exact schedule, never from fan-out shape. */
export function deriveShotgunTopology(attempts:readonly {id:string;logicalTargetId:string;configuredOffsetMs:number}[],schedule:readonly {logicalTargetId:string;shotIndex:number;configuredOffsetMs:number}[]){
  const result=new Map<string,{shotIndex:number;shotCount:number;timingBucket:ShotgunTimingBucket}>();
  for(const logicalTargetId of new Set(schedule.map(value=>value.logicalTargetId))){
    const planned=schedule.filter(value=>value.logicalTargetId===logicalTargetId).sort((a,b)=>a.shotIndex-b.shotIndex);
    const actual=attempts.filter(value=>value.logicalTargetId===logicalTargetId);
    const used=new Set<number>();actual.forEach(attempt=>{const index=planned.findIndex((shot,shotIndex)=>!used.has(shotIndex)&&shot.configuredOffsetMs===attempt.configuredOffsetMs),shot=planned[index];
      if(shot){used.add(index);result.set(attempt.id,{shotIndex:shot.shotIndex,shotCount:planned.length,timingBucket:shotgunTimingBucket(shot.configuredOffsetMs)});}});
  }
  return result;
}

/** Outcome-driven same-target stop rule. Confirmed rejection deliberately permits later shots. */
export function shotgunStopReason(input: { state: string; httpStatus?: number; throttle?: boolean }): ShotgunSuppressionReason | null {
  if (input.throttle || input.httpStatus === 429) return 'SHOTGUN_PROVIDER_THROTTLE_STOP';
  if (input.state === 'QR_READY' || input.state === 'HOLD_VERIFIED_QR_ATTENTION' || input.state === 'HOLD_VERIFIED') return 'SHOTGUN_TARGET_ALREADY_ACHIEVED';
  if (input.state === 'UNKNOWN') return 'SHOTGUN_TARGET_OUTCOME_UNKNOWN';
  return null;
}
