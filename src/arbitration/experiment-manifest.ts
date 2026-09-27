/**
 * Wave 1 arbitration preregistration manifest. The single implementation behind the desktop app (created
 * automatically when a release is armed, before the runner starts), the arbitration:manifest CLI and the
 * analyzer's association check. Investigation metadata only: it never changes the booking plan or traffic.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ARBITRATION_ANALYSIS_SCHEMA, WAVE1_HYPOTHESIS_SPEC_VERSION } from './hypothesis-spec.js';
import { assertSanitizedOutput } from './sanitize.js';

export const EXPERIMENT_MANIFEST_SCHEMA = 'wave1-experiment-manifest/v2';
export const UNBOUND_PRE_RUN = 'UNBOUND_PRE_RUN';
export const EXPERIMENT_MANIFEST_DIRECTORY = 'arbitration-manifests';
export const EXPERIMENT_MANIFEST_FILE = 'experiment-manifest.json';

export type ExperimentManifestErrorCode = 'ARBITRATION_RELEASE_CONTEXT_INVALID' | 'ARBITRATION_MANIFEST_TOO_LATE'
  | 'ARBITRATION_MANIFEST_MISMATCH' | 'ARBITRATION_MANIFEST_MALFORMED' | 'ARBITRATION_MANIFEST_STORAGE_FAILED';
export type ExperimentManifestOrigin = 'DESKTOP_ARM' | 'CLI';
/** The release a manifest preregisters: the same target date and release instant the runner is given. */
export interface ReleaseIdentity { targetDate: string; releaseMs: number }

export interface ExperimentManifest {
  schema: typeof EXPERIMENT_MANIFEST_SCHEMA; analysisSchema: string; createdAt: string; createdBy: ExperimentManifestOrigin;
  hypothesisSpecVersion: string; runId: string; releaseMs: number; targetDate: string; wave1Candidates: unknown[] | null;
  wave1CandidateSource: string; knownPreReleaseConflictSource: string; clockQuality: Record<string, unknown> | null;
  expectedEvidenceSources: string[]; safety: { readOnlyManifest: true; changesBookingPlan: false; addsCheckoutTraffic: false };
}
/** Optional safe fields the CLI can add from a Phase 3 freeze, Slot Watch or clock file. */
export type ExperimentManifestExtras = Partial<Pick<ExperimentManifest, 'runId' | 'wave1Candidates' | 'wave1CandidateSource'
  | 'knownPreReleaseConflictSource' | 'clockQuality'>>;

export type EnsureManifestResult =
  | { status: 'CREATED' | 'VERIFIED'; path: string; manifest: ExperimentManifest }
  | { status: 'BLOCKED'; code: ExperimentManifestErrorCode; reason: string; path: string | null };
export interface ManifestProblem { code: 'ARBITRATION_MANIFEST_MISMATCH' | 'ARBITRATION_MANIFEST_MALFORMED'; reason: string }

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const errorCode = (error: unknown) => isRecord(error) && typeof error.code === 'string' ? error.code : null;

/** The installed app's `.local` seen from a `Source/` checkout inside the install folder (the analyzer's first root). */
export const installedLocalRoot = (sourceRoot: string) => resolve(sourceRoot, '..', '.local');

/** `<.local>/arbitration-manifests/<target-date>_<release-ms>/experiment-manifest.json`, shared by app, CLI and analyzer. */
export function experimentManifestPath(localRoot: string, release: ReleaseIdentity): string {
  return join(localRoot, EXPERIMENT_MANIFEST_DIRECTORY, `${release.targetDate}_${release.releaseMs}`, EXPERIMENT_MANIFEST_FILE);
}

export function releaseIdentityProblem(release: { targetDate?: unknown; releaseMs?: unknown }): string | null {
  const date = release.targetDate;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)
    return 'the target date is not a valid calendar date';
  if (typeof release.releaseMs !== 'number' || !Number.isSafeInteger(release.releaseMs) || release.releaseMs <= 0) return 'the release instant is not valid';
  return null;
}

export function buildExperimentManifest(release: ReleaseIdentity, createdMs: number, createdBy: ExperimentManifestOrigin,
  extras: ExperimentManifestExtras = {}): ExperimentManifest {
  const manifest: ExperimentManifest = { schema: EXPERIMENT_MANIFEST_SCHEMA, analysisSchema: ARBITRATION_ANALYSIS_SCHEMA,
    createdAt: new Date(createdMs).toISOString(), createdBy, hypothesisSpecVersion: WAVE1_HYPOTHESIS_SPEC_VERSION, runId: extras.runId ?? UNBOUND_PRE_RUN,
    releaseMs: release.releaseMs, targetDate: release.targetDate, wave1Candidates: extras.wave1Candidates ?? null,
    // The runner writes its Phase 3 freeze at T-2 min, after it starts; a pre-arming manifest takes targets from that freeze.
    wave1CandidateSource: extras.wave1CandidateSource ?? 'RUNNER_PHASE3_FREEZE_WRITTEN_BEFORE_RELEASE',
    knownPreReleaseConflictSource: extras.knownPreReleaseConflictSource ?? 'UNKNOWN: no Slot Watch evidence supplied',
    clockQuality: extras.clockQuality ?? null,
    expectedEvidenceSources: ['run-progress', 'slot-watch', 'provider-trace', 'critical-path', 'journals', 'clock-evidence', 'release-forensics', 'response-evidence'],
    safety: { readOnlyManifest: true, changesBookingPlan: false, addsCheckoutTraffic: false } };
  assertSanitizedOutput(manifest);
  return manifest;
}

/**
 * Why a parsed manifest cannot preregister this release, or null. `targetDate: null` skips the date comparison
 * (runs whose configuration lacks one); `runId` also accepts a manifest bound to that run.
 */
export function experimentManifestProblem(value: unknown, expected: { targetDate: string | null; releaseMs: number | null; runId?: string }): ManifestProblem | null {
  const malformed = (reason: string): ManifestProblem => ({ code: 'ARBITRATION_MANIFEST_MALFORMED', reason });
  const mismatch = (reason: string): ManifestProblem => ({ code: 'ARBITRATION_MANIFEST_MISMATCH', reason });
  if (!isRecord(value)) return malformed('it is not a JSON object');
  const createdMs = typeof value.createdAt === 'string' ? Date.parse(value.createdAt) : Number.NaN;
  if (typeof value.schema !== 'string' || typeof value.releaseMs !== 'number' || typeof value.targetDate !== 'string' || !Number.isFinite(createdMs))
    return malformed('its schema, release, target date or creation time is missing');
  if (value.schema !== EXPERIMENT_MANIFEST_SCHEMA) return mismatch(`it uses manifest schema ${value.schema}`);
  if (value.hypothesisSpecVersion !== WAVE1_HYPOTHESIS_SPEC_VERSION) return mismatch('it preregistered a different hypothesis specification');
  if (value.runId !== UNBOUND_PRE_RUN && (expected.runId === undefined || value.runId !== expected.runId)) return mismatch('it is bound to a different run');
  if (expected.releaseMs === null || value.releaseMs !== expected.releaseMs) return mismatch('its release time differs');
  if (expected.targetDate !== null && value.targetDate !== expected.targetDate) return mismatch('its target date differs');
  if (createdMs >= value.releaseMs) return mismatch('it was created after the release');
  return null;
}

function writeOnce(path: string, manifest: ExperimentManifest): void {
  const descriptor = openSync(path, 'wx');
  try { writeSync(descriptor, `${JSON.stringify(manifest, null, 2)}\n`); fsyncSync(descriptor); }
  catch (error) {
    closeSync(descriptor);
    try { unlinkSync(path); } catch { /* only this call's own partial file */ }
    throw error;
  }
  closeSync(descriptor);
}

/**
 * Idempotent: verifies and reuses a matching manifest, otherwise creates it write-once. Never overwrites or
 * replaces an existing file; a malformed or mismatching one blocks instead.
 */
export function ensureExperimentManifest(input: { localRoot: string; release: ReleaseIdentity; createdBy: ExperimentManifestOrigin;
  nowMs?: number; clockOffsetMs?: number; extras?: ExperimentManifestExtras; path?: string }): EnsureManifestResult {
  const blocked = (code: ExperimentManifestErrorCode, reason: string, path: string | null): EnsureManifestResult => ({ status: 'BLOCKED', code, reason, path });
  const problem = releaseIdentityProblem(input.release);
  if (problem) return blocked('ARBITRATION_RELEASE_CONTEXT_INVALID', problem, null);
  const nowMs = input.nowMs ?? Date.now();
  if (nowMs + (input.clockOffsetMs ?? 0) >= input.release.releaseMs) return blocked('ARBITRATION_MANIFEST_TOO_LATE', 'the release instant has passed', null);
  const path = resolve(input.path ?? experimentManifestPath(input.localRoot, input.release));
  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string | null = null;
    try { text = readFileSync(path, 'utf8'); }
    catch (error) { if (errorCode(error) !== 'ENOENT') return blocked('ARBITRATION_MANIFEST_STORAGE_FAILED', `the manifest could not be read (${errorCode(error) ?? 'error'})`, path); }
    if (text !== null) {
      let value: unknown;
      try { value = JSON.parse(text); } catch { return blocked('ARBITRATION_MANIFEST_MALFORMED', 'it is not valid JSON', path); }
      const found = experimentManifestProblem(value, { ...input.release, ...(input.extras?.runId ? { runId: input.extras.runId } : {}) });
      if (found) return blocked(found.code, found.reason, path);
      // The analyzer accepts it only if created no later than the runner start, which is after now.
      if (Date.parse(String((value as Record<string, unknown>).createdAt)) > nowMs) return blocked('ARBITRATION_MANIFEST_MISMATCH', 'its creation time is in the future', path);
      return { status: 'VERIFIED', path, manifest: value as ExperimentManifest };
    }
    const manifest = buildExperimentManifest(input.release, nowMs, input.createdBy, input.extras);
    try { mkdirSync(dirname(path), { recursive: true }); }
    catch (error) { return blocked('ARBITRATION_MANIFEST_STORAGE_FAILED', `the local data folder could not be created (${errorCode(error) ?? 'error'})`, path); }
    try { writeOnce(path, manifest); return { status: 'CREATED', path, manifest }; }
    catch (error) {
      if (errorCode(error) === 'EEXIST') continue;
      return blocked('ARBITRATION_MANIFEST_STORAGE_FAILED', `the local data folder could not be written (${errorCode(error) ?? 'error'})`, path);
    }
  }
  return blocked('ARBITRATION_MANIFEST_STORAGE_FAILED', 'the manifest kept changing while it was being created', path);
}
