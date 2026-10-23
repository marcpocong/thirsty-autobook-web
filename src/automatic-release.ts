import { defaultObjective, enabledWings, objectiveProblems, parseStoredObjective, rebaseReleasedDates, type BookingObjective } from './booking-objective.js';
import { canonicalJson, sha256Hex } from './sha256-pure.js';
import { nextReleaseFor } from './wing-release-data.js';

/** Recurring preferences and proposals only. This module cannot save an authorization or dispatch. */
export type DailyPreset = 'BALANCED' | 'EXPANDED' | 'HIGH_DENSITY' | 'CUSTOM';
export type Distribution = 'AUTOMATIC' | 'FOCUSED' | 'DIVERSIFIED' | 'CUSTOM';
export interface ReleaseProfile {
  version: 1; id: string; enabled: boolean; updatedAt: string; origin: 'NEW' | 'OWNER_REVIEWED';
  objective: BookingObjective; preferredBudget: number; preset: DailyPreset; distribution: Distribution;
  workers: string[]; reminders: number[]; notifications: boolean;
}
export interface GeneratedReleaseDraft {
  version: 1; id: string; profileId: string; profileFingerprint: string; generatedAt: string;
  targetDates: Record<string, string>; releaseAt: string; objective: BookingObjective;
  status: 'DRAFT'; notes: string[];
}
export const DAILY_PRESETS = [
  { id: 'BALANCED', label: 'Balanced Shotgun', budget: 8 },
  { id: 'EXPANDED', label: 'Expanded Shotgun', budget: 12 },
  { id: 'HIGH_DENSITY', label: 'High-density Shotgun · experimental', budget: 16 },
  { id: 'CUSTOM', label: 'Custom Shotgun', budget: null },
] as const;
export function newReleaseProfile(now: number): ReleaseProfile {
  const objective = defaultObjective(now); objective.strategy = 'SHOTGUN'; objective.checkoutMethod = 'PROOFLESS';
  objective.shotgun = { ...objective.shotgun, budget: 8, timingMode: 'BALANCED', allocationMode: 'EQUAL', presetId: 'BALANCED', source: 'PRESET', limitToIdeal: true };
  return { version: 1, id: 'daily', enabled: true, updatedAt: new Date(now).toISOString(), origin: 'NEW', objective,
    preferredBudget: 8, preset: 'BALANCED', distribution: 'AUTOMATIC', workers: ['A','B','C','D','E','F','G'], reminders: [60,30,10], notifications: true };
}
export function parseReleaseProfile(value: unknown): ReleaseProfile {
  const p = value as ReleaseProfile, objective = parseStoredObjective(p?.objective);
  if (!p || p.version !== 1 || p.id !== 'daily' || !objective || objective.mode !== 'NEXT_RELEASE' || objectiveProblems(objective).length ||
    typeof p.enabled !== 'boolean' || typeof p.notifications !== 'boolean' || !['NEW','OWNER_REVIEWED'].includes(p.origin) ||
    !Number.isFinite(Date.parse(p.updatedAt)) || !Number.isSafeInteger(p.preferredBudget) || p.preferredBudget < 1 || p.preferredBudget > 42 ||
    !DAILY_PRESETS.some(s => s.id === p.preset) || !['AUTOMATIC','FOCUSED','DIVERSIFIED','CUSTOM'].includes(p.distribution) ||
    !Array.isArray(p.workers) || !p.workers.length || new Set(p.workers).size !== p.workers.length || p.workers.some(w => !/^[A-G]$/.test(w)) ||
    !Array.isArray(p.reminders) || p.reminders.length > 8 || p.reminders.some(m => !Number.isSafeInteger(m) || m < 1 || m > 1440) || new Set(p.reminders).size !== p.reminders.length)
    throw Error('RELEASE_PROFILE_INVALID');
  if (p.distribution === 'CUSTOM' && p.preferredBudget !== (objective.shotgun.customOffsetsMs?.length ?? objective.shotgun.budget)) throw Error('CUSTOM_BUDGET_REQUIRES_REVIEWED_SCHEDULE');
  return structuredClone({ ...p, objective });
}
export const profileFingerprint = (p: ReleaseProfile) => sha256Hex(canonicalJson({ ...p, updatedAt: undefined, enabled: undefined, notifications: undefined, reminders: undefined }));
export function generateReleaseDraft(profile: ReleaseProfile, now: number): GeneratedReleaseDraft {
  const p = parseReleaseProfile(profile);
  // Reuse the reviewed-ID remapper: dates move; literal offsets and target relationships do not.
  let objective = structuredClone(p.objective);
  const rebased = rebaseReleasedDates(objective, now, true); objective = rebased.objective;
  if (objective.strategy === 'SHOTGUN' && p.distribution !== 'CUSTOM') {
    objective.shotgun.budget = p.preferredBudget;
    objective.shotgun.allocationMode = p.distribution === 'FOCUSED' ? 'PRIORITY_WEIGHTED' : 'EQUAL';
    objective.shotgun.timingMode = 'BALANCED'; objective.shotgun.presetId = p.preset; objective.shotgun.source = 'PRESET';
    objective.shotgun.limitToIdeal = true;
    delete objective.shotgun.customAssignments; delete objective.shotgun.customOffsetsMs; delete objective.shotgun.customCounts;
  }
  const targetDates = Object.fromEntries(enabledWings(objective).map(w => [w, objective.wings[w].bookingDate]));
  const releases = enabledWings(objective).map(w => nextReleaseFor(now, w));
  const fingerprint = profileFingerprint(p);
  return { version: 1, id: sha256Hex(canonicalJson({ fingerprint, targetDates })), profileId: p.id, profileFingerprint: fingerprint,
    generatedAt: new Date(now).toISOString(), targetDates, releaseAt: new Date(Math.min(...releases.map(r => r.releaseMs))).toISOString(), objective, status: 'DRAFT',
    notes: [...rebased.notes, ...releases.filter(r => r.status !== 'VERIFIED').map(r => `Release policy ${r.status}: planning only; live verification is still required.`)] };
}
export function preferenceDifferences(before: unknown, after: unknown): Array<{ field: string; before: string; after: string }> {
  const changes: Array<{ field: string; before: string; after: string }> = [];
  const visit = (a: unknown, b: unknown, field: string) => {
    if (canonicalJson(a ?? null) === canonicalJson(b ?? null)) return;
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) visit((a as Record<string,unknown>)[key], (b as Record<string,unknown>)[key], field ? `${field}.${key}` : key);
    } else changes.push({ field, before: JSON.stringify(a) ?? 'unset', after: JSON.stringify(b) ?? 'unset' });
  }; visit(before, after, ''); return changes;
}
