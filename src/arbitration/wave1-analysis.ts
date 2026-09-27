import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { congestionEvidence, holdReopenings, parseNdjson, parseSlotWatch, providerEvidence, releaseAttempts, runTrace, staleReadEvidence,
  type Line, type ProviderEvidence, type ReadObservation, type ReleaseAttempt, type SlotWatchLog } from './archive-evidence.js';
import { buildReleaseTimeline, type ReleaseTimeline } from './release-timeline.js';
import { kendallTau, pairOrderCounts, spearman, summarize } from './stats.js';
import { ARBITRATION_ANALYSIS_SCHEMA, WAVE1_HYPOTHESES, WAVE1_HYPOTHESIS_SPEC_VERSION, type HypothesisId } from './hypothesis-spec.js';
import { EXPERIMENT_MANIFEST_FILE, experimentManifestProblem } from './experiment-manifest.js';
import { assertSanitizedOutput } from './sanitize.js';

export { ARBITRATION_ANALYSIS_SCHEMA, assertSanitizedOutput };
export type ContestClass = 'KNOWN_BLOCKED_PRE_RELEASE' | 'CONFIRMED_CONTESTABLE_FROM_FIRST_PUBLISHED_STATE' | 'NOT_CONTESTABLE' | 'UNKNOWN_AT_RELEASE';
export type AnalysisQuality = 'CLEAN' | 'MIXED' | 'POOR';
export type RejectionClass = 'EVENT_ALREADY_SCHEDULED' | 'OVERLAPS_EXISTING_BOOKING' | 'OTHER_REJECTION' | 'SUCCESS' | 'UNKNOWN';
export type EvidenceAssociationStatus = 'MATCH' | 'AMBIGUOUS' | 'NO_MATCH' | 'MISSING';
export type EvidenceAssociationConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

export interface EvidenceAssociationCandidate { path: string; basis: string; confidence: EvidenceAssociationConfidence; limitation?: string }
export interface EvidenceAssociation {
  status: EvidenceAssociationStatus; selected: EvidenceAssociationCandidate[]; rejected: EvidenceAssociationCandidate[];
  ambiguous: EvidenceAssociationCandidate[]; basis: string; confidence: EvidenceAssociationConfidence; limitations: string[]; code?: string;
}
export interface EvidenceAssociations {
  runProgress: EvidenceAssociation; slotWatch: EvidenceAssociation; providerTrace: EvidenceAssociation; criticalPath: EvidenceAssociation;
  clockEvidence: EvidenceAssociation; journals: EvidenceAssociation; releaseForensics: EvidenceAssociation; experimentManifest: EvidenceAssociation;
}

const num = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const str = (value: unknown): string | null => typeof value === 'string' ? value : null;
const round = (value: number | null, digits = 1) => value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits;
const safeJson = (path: string): Line | null => { try { const value = JSON.parse(readFileSync(path, 'utf8')) as unknown; return value && typeof value === 'object' && !Array.isArray(value) ? value as Line : null; } catch { return null; } };
const safeLines = (path: string | null): Line[] => path && existsSync(path) ? parseNdjson(readFileSync(path, 'utf8')) : [];
const normalize = (path: string) => path.replaceAll('\\', '/');

function walk(root: string): string[] {
  if (!existsSync(root)) return [];
  const ignored = new Set(['.git', 'node_modules', 'dist', 'api-first-chrome-profile', 'control-panel', 'private', 'runtime']);
  const result: string[] = [];
  const visit = (path: string) => {
    let entries;
    try { entries = readdirSync(path, { withFileTypes: true, encoding: 'utf8' }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory() && (ignored.has(entry.name) || entry.name.startsWith('api-first-chrome-profile'))) continue;
      const child = join(path, entry.name);
      if (entry.isDirectory()) visit(child); else if (entry.isFile()) result.push(child);
    }
  };
  if (statSync(root).isFile()) return [root];
  visit(root);
  return result;
}
export interface EvidencePaths {
  root: string; runId: string; runner: string; slotWatch: string | null; providerTrace: string | null; criticalPath: string | null;
  releaseForensics: string | null; experimentManifest: string | null; clockEvidence: string[]; journals: string[]; missing: string[];
  associations: EvidenceAssociations;
}

export interface DiscoveryOverrides { runner?: string; watch?: string; provider?: string; critical?: string; manifest?: string }

const associationCandidate = (path: string, basis: string, confidence: EvidenceAssociationConfidence,
  limitation?: string): EvidenceAssociationCandidate => ({ path, basis, confidence, ...(limitation ? { limitation } : {}) });
const association = (status: EvidenceAssociationStatus, selected: EvidenceAssociationCandidate[], rejected: EvidenceAssociationCandidate[],
  ambiguous: EvidenceAssociationCandidate[], basis: string, confidence: EvidenceAssociationConfidence, limitations: string[] = [], code?: string): EvidenceAssociation =>
  ({ status, selected, rejected, ambiguous, basis, confidence, limitations, ...(code ? { code } : {}) });

const timestamp = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const releaseInstant = (value: Line): number | null => num(value.releaseMs) ?? timestamp(value.releaseAt);
const checkpointOffset = (value: unknown): number | null => {
  if (typeof value !== 'string') return null;
  const match = /^T-(\d+(?:\.\d+)?)(MS|S|M)$/.exec(value.toUpperCase());
  if (!match) return null;
  const amount = Number(match[1]);
  return Number.isFinite(amount) ? amount * (match[2] === 'M' ? 60_000 : match[2] === 'S' ? 1_000 : 1) : null;
};

function associateSlotWatch(paths: string[], targetDate: string | null, releaseMs: number | null, runnerStartedMs: number,
  explicit: boolean): { path: string | null; evidence: EvidenceAssociation } {
  const rejected: EvidenceAssociationCandidate[] = [];
  const eligible: Array<EvidenceAssociationCandidate & { startedMs: number | null; watchId: string | null; lineCount: number; observations: number }> = [];
  for (const path of paths) {
    const lines = safeLines(path), header = lines.find(line => line.type === 'header');
    if (!header) { rejected.push(associationCandidate(path, 'missing readable Slot Watch header', 'NONE')); continue; }
    const watchReleaseMs = releaseInstant(header), watchDate = str(header.date);
    if (targetDate === null || watchDate !== targetDate) {
      rejected.push(associationCandidate(path, `target date ${watchDate ?? 'missing'} does not match ${targetDate ?? 'unknown'}`, 'NONE')); continue;
    }
    if (releaseMs === null || watchReleaseMs === null || watchReleaseMs !== releaseMs) {
      rejected.push(associationCandidate(path, `release instant ${watchReleaseMs ?? 'missing'} does not match ${releaseMs ?? 'unknown'}`, 'NONE')); continue;
    }
    const startedMs = timestamp(header.startedAt), observations = lines.filter(line => line.type === 'availability' || line.type === 'bookings').length;
    eligible.push({ ...associationCandidate(path, 'exact target date + release instant', 'HIGH',
      observations ? undefined : 'Partial watch contains no availability or booking observations.'), startedMs, watchId: str(header.id), lineCount: lines.length, observations });
  }
  if (explicit) {
    if (eligible.length !== 1) throw Error(`WATCH_EVIDENCE_INCOMPATIBLE:${rejected[0]?.basis ?? 'expected exactly one compatible file'}`);
    const selected = [eligible[0]!];
    return { path: selected[0]!.path, evidence: association('MATCH', selected, rejected, [],
      'explicit override validated by exact target date + release instant', 'HIGH', selected[0]!.limitation ? [selected[0]!.limitation] : []) };
  }
  if (!eligible.length) return { path: null, evidence: association('NO_MATCH', [], rejected, [],
    'no candidate satisfied exact target date + release instant', 'NONE', ['Older or incompatible watches are never substituted.']) };
  // The runner's own watch starts with it. Otherwise only a watch that actually observed the release qualifies,
  // e.g. an operator-started watch the controller kept; header-only leftovers from other launches never do.
  const near = eligible.filter(value => value.startedMs !== null && Number.isFinite(runnerStartedMs)
    && Math.abs(value.startedMs - runnerStartedMs) <= 10_000);
  const byStart = near.length > 0, pool = byStart ? near : eligible.filter(value => value.observations > 0);
  const notAssociated = byStart ? 'release-compatible but not started with the current runner'
    : 'release-compatible but not started with the current runner and holds no release observations';
  const ids = new Set(pool.map(value => value.watchId ?? value.path));
  if (ids.size === 1) {
    const chosen = [...pool].sort((a, b) => b.lineCount - a.lineCount
      || Number(normalize(b.path).includes('/local/slot-watch/')) - Number(normalize(a.path).includes('/local/slot-watch/')) || a.path.localeCompare(b.path))[0]!;
    const others = eligible.filter(value => value.path !== chosen.path).map(value => associationCandidate(value.path,
      chosen.watchId !== null && value.watchId === chosen.watchId ? `duplicate copy of Slot Watch ${chosen.watchId}` : notAssociated, 'NONE'));
    const deltaS = chosen.startedMs !== null && Number.isFinite(runnerStartedMs) ? round((chosen.startedMs - runnerStartedMs) / 1_000) : null;
    const when = deltaS === null ? 'at an unknown time relative to the runner' : `${Math.abs(deltaS)} s ${deltaS < 0 ? 'before' : 'after'} the runner`;
    const basis = byStart ? 'exact target date + release instant + started with this runner (within 10 s)'
      : 'exact target date + release instant + only compatible watch with release observations';
    const confidence: EvidenceAssociationConfidence = byStart ? 'HIGH' : 'MEDIUM';
    const limitations = [...(chosen.limitation ? [chosen.limitation] : []), ...(byStart ? []
      : [`Watch started ${when}; association rests on release identity and observation coverage (e.g. an operator-started watch kept for this release).`])];
    return { path: chosen.path, evidence: association('MATCH', [associationCandidate(chosen.path, basis, confidence, chosen.limitation)],
      [...rejected, ...others], [], basis, confidence, limitations) };
  }
  if (ids.size === 0) return { path: null, evidence: association('NO_MATCH', [],
    [...rejected, ...eligible.map(value => associationCandidate(value.path, notAssociated, 'NONE'))], [],
    'release-compatible watches exist, but none started with this runner or observed the release', 'NONE',
    ['Header-only leftovers from other launches are never substituted.']) };
  const ambiguousBasis = byStart ? 'started within 10 s of this runner' : 'observed the release but did not start with this runner';
  return { path: null, evidence: association('AMBIGUOUS', [],
    [...rejected, ...eligible.filter(value => !pool.includes(value)).map(value => associationCandidate(value.path, notAssociated, 'NONE'))],
    pool.map(value => associationCandidate(value.path, ambiguousBasis, 'NONE')),
    'multiple release-compatible Slot Watch files cannot be uniquely associated', 'NONE',
    ['No Slot Watch is selected when association is ambiguous.'], 'SLOT_WATCH_EVIDENCE_AMBIGUOUS') };
}

const confidenceRank: Record<EvidenceAssociationConfidence, number> = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
/** The runner logs a NETWORK_CLOCK_* stage with the same checkpoint right after writing each clock file. */
const isClockStage = (line: Line) => typeof line.stage === 'string' && line.stage.startsWith('NETWORK_CLOCK');

function associateClockEvidence(paths: string[], runId: string, targetDate: string | null, releaseMs: number | null, runnerLines: Line[]):
  { paths: string[]; evidence: EvidenceAssociation } {
  const selected: EvidenceAssociationCandidate[] = [], rejected: EvidenceAssociationCandidate[] = [], ambiguous: EvidenceAssociationCandidate[] = [];
  const groups = new Map<string, Array<{ path: string; linked: boolean }>>();
  const clockStages = runnerLines.filter(isClockStage);
  const runnerCheckpoints = new Set(clockStages.map(line => str(line.checkpoint)?.toUpperCase()));
  const linkedToRun = (checkpoint: string | null, at: number, offsetMs: number | null) => checkpoint !== null && clockStages.some(line =>
    str(line.checkpoint)?.toUpperCase() === checkpoint && Math.abs((timestamp(line.at) ?? Number.POSITIVE_INFINITY) - at) <= 5_000
    && (num(line.offsetMs) === null || offsetMs === null || Math.abs(num(line.offsetMs)! - offsetMs) <= 1));
  for (const path of paths) {
    const value = safeJson(path);
    if (!value) { rejected.push(associationCandidate(path, 'malformed JSON', 'NONE')); continue; }
    const at = timestamp(value.capturedAt ?? value.queriedAt ?? value.at);
    if (at === null) { rejected.push(associationCandidate(path, 'malformed or missing capturedAt/queriedAt/at timestamp', 'NONE')); continue; }
    const candidateRunId = str(value.runId ?? value.releaseRunId), candidateReleaseMs = releaseInstant(value), candidateDate = str(value.targetDate);
    if (candidateRunId && candidateRunId !== runId) { rejected.push(associationCandidate(path, `explicit run ${candidateRunId} does not match`, 'NONE')); continue; }
    if (candidateReleaseMs !== null && (releaseMs === null || candidateReleaseMs !== releaseMs)) {
      rejected.push(associationCandidate(path, `explicit release instant ${candidateReleaseMs} does not match`, 'NONE')); continue;
    }
    if (candidateDate && targetDate && candidateDate !== targetDate) {
      rejected.push(associationCandidate(path, `target date ${candidateDate} does not match ${targetDate}`, 'NONE')); continue;
    }
    if (candidateRunId === runId || releaseMs !== null && candidateReleaseMs === releaseMs) {
      selected.push(associationCandidate(path, candidateRunId === runId ? 'explicit run identifier' : 'explicit release instant', 'HIGH')); continue;
    }
    if (releaseMs === null) { rejected.push(associationCandidate(path, 'runner release instant is unavailable', 'NONE')); continue; }
    const key = str(value.checkpoint)?.toUpperCase() ?? null, offset = checkpointOffset(key);
    const linked = linkedToRun(key, at, num(value.offsetMs));
    if (offset !== null) {
      // A checkpoint is never recorded early, but is recorded late when the runner starts after it (e.g. T-10M at T-7 min).
      if (at < releaseMs - offset - 30_000 || at >= releaseMs) {
        rejected.push(associationCandidate(path, `${key} captured outside its current-release window (nominal checkpoint to release)`, 'NONE')); continue;
      }
    } else if (!linked && (at < releaseMs - 15 * 60_000 || at > releaseMs + 2 * 60_000)) {
      rejected.push(associationCandidate(path, 'timestamp outside the bounded current-release window (-15 min to +2 min)', 'NONE')); continue;
    }
    const group = key ?? 'UNLABELLED', list = groups.get(group) ?? [];
    list.push({ path, linked }); groups.set(group, list);
  }
  for (const [key, group] of groups) {
    const linked = group.filter(item => item.linked), labelled = checkpointOffset(key) !== null;
    if (linked.length === 1) {
      selected.push(associationCandidate(linked[0]!.path, `${key} + matching clock event in this run's progress log`, 'HIGH'));
      rejected.push(...group.filter(item => !item.linked).map(item => associationCandidate(item.path, `${key} file not recorded by this run`, 'NONE')));
    } else if (linked.length > 1) {
      ambiguous.push(...linked.map(item => associationCandidate(item.path, `${key} + matches a clock event in this run's progress log`, 'NONE')));
      rejected.push(...group.filter(item => !item.linked).map(item => associationCandidate(item.path, `${key} file not recorded by this run`, 'NONE')));
    } else if (runnerCheckpoints.has(key)) {
      rejected.push(...group.map(item => associationCandidate(item.path, `this run logged its own ${key} clock event, which this file does not match`, 'NONE')));
    } else if (group.length === 1) {
      selected.push(associationCandidate(group[0]!.path, labelled ? `${key} captured inside its current-release window` : 'timestamp inside bounded current-release window (-15 min to +2 min)',
        labelled ? 'MEDIUM' : 'LOW', `Not linked to this run: its progress log has no ${key} clock event.`));
    } else {
      ambiguous.push(...group.map(item => associationCandidate(item.path, labelled ? `${key} captured inside its current-release window` : 'timestamp inside bounded current-release window', 'NONE')));
    }
  }
  selected.sort((a, b) => a.path.localeCompare(b.path));
  const status: EvidenceAssociationStatus = ambiguous.length ? 'AMBIGUOUS' : selected.length ? 'MATCH' : 'MISSING';
  const confidence = selected.reduce<EvidenceAssociationConfidence>((low, value) =>
    confidenceRank[value.confidence] < confidenceRank[low] ? value.confidence : low, selected.length ? 'HIGH' : 'NONE');
  const basis = ambiguous.length ? 'one or more checkpoints have multiple plausible current-release files'
    : !selected.length ? 'no defensible current-release clock file'
      : confidence === 'HIGH' ? "each file matches a clock event in this run's progress log" : 'current-release checkpoint window; not every file is linked to this run';
  const limitations = [...selected.flatMap(value => value.limitation ? [value.limitation] : []),
    ...(ambiguous.length ? ['Ambiguous candidates are excluded from analysis.'] : selected.length ? [] : ['Historical or malformed samples are never substituted.'])];
  return { paths: selected.map(value => value.path), evidence: association(status, selected, rejected, ambiguous, basis,
    confidence, limitations, ambiguous.length ? 'CLOCK_EVIDENCE_AMBIGUOUS' : undefined) };
}

/** Generic discovery. Explicit paths win only after compatibility validation; automatic discovery fails closed. */
export function discoverEvidence(rootInput: string, runId: string, overrides: DiscoveryOverrides = {}): EvidencePaths {
  const root = resolve(rootInput), files = walk(root);
  const ndjson = files.filter(path => path.endsWith('.ndjson'));
  const runnerCandidates = overrides.runner ? [resolve(overrides.runner)] : ndjson.filter(path => basename(path) === `${runId}.ndjson` || /[/\\]logs[/\\]run-progress\.ndjson$/i.test(path));
  const runner = runnerCandidates.find(path => safeLines(path).some(line => line.runId === runId && line.stage === 'RUN_CONFIGURATION'));
  if (!runner) throw Error(`RUN_NOT_FOUND:${runId}`);
  const runnerLines = safeLines(runner).filter(line => line.runId === runId), config = runnerLines.find(line => line.stage === 'RUN_CONFIGURATION') ?? {};
  const releaseMs = num(config.releaseMs), targetDate = str(config.targetDate) ?? str(runnerLines[0]?.targetDate);
  const startedMs = Date.parse(String(runnerLines[0]?.at ?? ''));
  const watchCandidates = overrides.watch ? [resolve(overrides.watch)] : ndjson.filter(path => /slot-watch/i.test(normalize(path)));
  const watch = associateSlotWatch(watchCandidates, targetDate, releaseMs, startedMs, Boolean(overrides.watch));
  const slotWatch = watch.path;
  const traceMatchesRun = (path: string) => safeLines(path).some(line => line.runId === runId || line.type === 'header' && line.runId === runId);
  const exactTrace = (kind: string) => ndjson.filter(path => normalize(path).includes(kind)).find(traceMatchesRun) ?? null;
  const explicitProvider = overrides.provider ? resolve(overrides.provider) : null, explicitCritical = overrides.critical ? resolve(overrides.critical) : null;
  if (explicitProvider && !traceMatchesRun(explicitProvider)) throw Error('PROVIDER_EVIDENCE_INCOMPATIBLE');
  if (explicitCritical && !traceMatchesRun(explicitCritical)) throw Error('CRITICAL_PATH_EVIDENCE_INCOMPATIBLE');
  const providerTrace = explicitProvider ?? exactTrace('provider-trace');
  const criticalPath = explicitCritical ?? exactTrace('critical-path');
  const releaseForensics = files.find(path => normalize(path).includes(`/release-forensics/${runId}/summary.json`) && safeJson(path)?.runId === runId) ?? null;
  const clockCandidates = files.filter(path => /network-clock-evidence/i.test(path) && path.endsWith('.json'));
  const clock = associateClockEvidence(clockCandidates, runId, targetDate, releaseMs, runnerLines);
  const clockEvidence = [...clock.paths].sort();
  const journalCandidates = files.filter(path => /api-first-journals/i.test(path) && path.endsWith('.json') && basename(dirname(path)) + '.json' === basename(path));
  const journals = journalCandidates.filter(path => {
    const value = safeJson(path), attempt = (value?.attempt ?? {}) as Line;
    return releaseMs !== null && num(attempt.releaseMs) === releaseMs;
  }).sort();
  const manifestCandidates = overrides.manifest ? [resolve(overrides.manifest)] : files.filter(path => basename(path) === EXPERIMENT_MANIFEST_FILE);
  // The same validator the desktop app applies when arming, plus: created no later than this runner's start.
  const manifestReason = (path: string): string | null => {
    const value = safeJson(path), problem = experimentManifestProblem(value, { targetDate, releaseMs, runId });
    if (problem) return problem.reason;
    const createdMs = timestamp(value?.createdAt);
    return createdMs !== null && Number.isFinite(startedMs) && createdMs <= startedMs ? null : 'it was not created before the runner started';
  };
  const manifestReasons = new Map(manifestCandidates.map(path => [path, manifestReason(path)]));
  const compatibleManifests = manifestCandidates.filter(path => manifestReasons.get(path) === null);
  if (overrides.manifest && compatibleManifests.length !== 1) throw Error('MANIFEST_EVIDENCE_INCOMPATIBLE');
  const experimentManifest = compatibleManifests.length === 1 ? compatibleManifests[0]! : null;
  const manifestAmbiguous = compatibleManifests.length > 1 ? compatibleManifests.map(path => associationCandidate(path, 'matching run + release + target date', 'HIGH')) : [];
  const manifestRejected = manifestCandidates.filter(path => !compatibleManifests.includes(path))
    .map(path => associationCandidate(path, `not preregistration for this run: ${manifestReasons.get(path)}`, 'NONE'));
  const manifestRunBound = experimentManifest ? safeJson(experimentManifest)?.runId === runId : false;
  const manifestAssociation = experimentManifest
    ? association('MATCH', [associationCandidate(experimentManifest, manifestRunBound
      ? 'matching schema + run + release + target date + created before runner start'
      : 'pre-run unbound manifest + matching release + target date + created before runner start', manifestRunBound ? 'HIGH' : 'MEDIUM')], manifestRejected, [],
      manifestRunBound ? 'matching schema + run + release + target date + created before runner start'
        : 'pre-run unbound manifest + matching release + target date + created before runner start', manifestRunBound ? 'HIGH' : 'MEDIUM',
      manifestRunBound ? [] : ['Manifest was created before the runner assigned its run ID; release instant and target date provide the association.'])
    : manifestAmbiguous.length ? association('AMBIGUOUS', [], manifestRejected, manifestAmbiguous,
      'multiple matching preregistration manifests', 'NONE', ['No manifest is selected when association is ambiguous.'], 'PREREGISTERED_MANIFEST_AMBIGUOUS')
      : association('MISSING', [], manifestRejected, [], 'no matching preregistered manifest', 'NONE',
        ['Post-run reconstruction is not preregistration.'], 'NO_PREREGISTERED_MANIFEST');
  const simple = (path: string | null, matched: string, missing: string): EvidenceAssociation => path
    ? association('MATCH', [associationCandidate(path, matched, 'HIGH')], [], [], matched, 'HIGH')
    : association('MISSING', [], [], [], missing, 'NONE');
  const journalSelected = journals.map(path => associationCandidate(path, 'journal attempt.releaseMs exactly matches runner release', 'HIGH'));
  const journalRejected = journalCandidates.filter(path => !journals.includes(path))
    .map(path => associationCandidate(path, 'journal is malformed or has a different releaseMs', 'NONE'));
  const associations: EvidenceAssociations = {
    runProgress: simple(runner, 'requested run ID + RUN_CONFIGURATION', 'run progress is required'), slotWatch: watch.evidence,
    providerTrace: simple(providerTrace, 'embedded run ID', 'no provider trace with the requested run ID'),
    criticalPath: simple(criticalPath, 'embedded run ID', 'no critical path with the requested run ID'), clockEvidence: clock.evidence,
    journals: association(journals.length ? 'MATCH' : 'MISSING', journalSelected, journalRejected, [],
      journals.length ? 'attempt.releaseMs exactly matches runner release' : 'no journal with the runner releaseMs', journals.length ? 'HIGH' : 'NONE'),
    releaseForensics: simple(releaseForensics, 'release-forensics directory named by run ID', 'no release-forensics summary for requested run'),
    experimentManifest: manifestAssociation,
  };
  const missing = [['slot-watch', slotWatch], ['provider-trace', providerTrace], ['critical-path', criticalPath],
    ['clock-evidence', clockEvidence.length ? clockEvidence[0] : null]].filter(([, path]) => !path).map(([name]) => name!);
  return { root, runId, runner, slotWatch, providerTrace, criticalPath, releaseForensics, experimentManifest,
    clockEvidence, journals, missing, associations };
}

export interface Target { court: number; startTime: string; durationHours: number; cells: string[] }
export function targetCells(court: number, startTime: string, durationHours: number): string[] {
  const start = Number(startTime.slice(0, 2));
  return Array.from({ length: durationHours }, (_, index) => `${court}/${String(start + index).padStart(2, '0')}:00`);
}

function matrixState(matrix: string | null, cell: string): 'OPEN' | 'UNAVAILABLE' | 'UNKNOWN' {
  if (!matrix) return 'UNKNOWN';
  const [court, hour] = cell.split('/'), row = matrix.split(',').find(value => value.startsWith(`${court}:`));
  const index = Number(hour?.slice(0, 2)) - 8, code = row?.split(':')[1]?.[index];
  return code === 'O' ? 'OPEN' : code === 'X' ? 'UNAVAILABLE' : 'UNKNOWN';
}

export interface BookingObservation { seq: number; requestOffsetMs: number; responseOffsetMs: number; cells: string[]; outcome: string }
export interface AvailabilityObservation { seq: number; requestOffsetMs: number; responseOffsetMs: number; durationMs: number | null; matrix: string | null; published: boolean; outcome: string; cache: string | null }

export function normalizedWatch(lines: readonly Line[]): { log: SlotWatchLog | null; availability: AvailabilityObservation[]; bookings: BookingObservation[] } {
  const log = parseSlotWatch(lines as Line[]);
  const availability = lines.filter(line => line.type === 'availability').flatMap(line => {
    const request = num(line.requestOffsetMs), response = num(line.responseOffsetMs);
    if (request === null || response === null) return [];
    return [{ seq: num(line.seq) ?? -1, requestOffsetMs: request, responseOffsetMs: response, durationMs: num(line.durationMs), matrix: str(line.matrix),
      published: line.targetDatePresent === true, outcome: str(line.outcome) ?? 'failed', cache: str((line.cache as Line | undefined)?.status) }];
  });
  const bookings = lines.filter(line => line.type === 'bookings').flatMap(line => {
    const request = num(line.requestOffsetMs), response = num(line.responseOffsetMs);
    if (request === null || response === null) return [];
    return [{ seq: num(line.seq) ?? -1, requestOffsetMs: request, responseOffsetMs: response,
      cells: Array.isArray(line.cells) ? line.cells.filter((value): value is string => typeof value === 'string') : [], outcome: str(line.outcome) ?? 'failed' }];
  });
  return { log, availability, bookings };
}

export function rejectionClass(message: string | null, status: number | null): RejectionClass {
  if (status !== null && status >= 200 && status < 300) return 'SUCCESS';
  const value = message?.toLowerCase() ?? '';
  if (value.includes('event is already scheduled')) return 'EVENT_ALREADY_SCHEDULED';
  if (value.includes('overlaps an existing booking')) return 'OVERLAPS_EXISTING_BOOKING';
  return status === null ? 'UNKNOWN' : 'OTHER_REJECTION';
}

export interface ContestEvidence { classification: ContestClass; reasons: string[]; firstPublishedState: 'OPEN' | 'UNAVAILABLE' | 'MIXED' | 'UNKNOWN'; preReleaseBookingCells: string[] }
export function classifyContestSample(target: Target, firstPublished: AvailabilityObservation | null, preReleaseBookings: readonly BookingObservation[], reason: RejectionClass): ContestEvidence {
  const pre = target.cells.filter(cell => preReleaseBookings.some(read => read.outcome === 'ok' && read.responseOffsetMs <= 0 && read.cells.includes(cell)));
  const states = target.cells.map(cell => matrixState(firstPublished?.matrix ?? null, cell));
  const firstPublishedState = states.every(value => value === 'OPEN') ? 'OPEN' : states.every(value => value === 'UNAVAILABLE') ? 'UNAVAILABLE'
    : states.some(value => value === 'UNKNOWN') ? 'UNKNOWN' : 'MIXED';
  if (pre.length) return { classification: 'KNOWN_BLOCKED_PRE_RELEASE', reasons: ['Public booking record overlapped the target before release.'], firstPublishedState, preReleaseBookingCells: pre };
  if (firstPublishedState === 'OPEN') return { classification: 'CONFIRMED_CONTESTABLE_FROM_FIRST_PUBLISHED_STATE', reasons: ['Every target cell was OPEN in the first complete published grid.'], firstPublishedState, preReleaseBookingCells: [] };
  if (reason === 'EVENT_ALREADY_SCHEDULED') return { classification: 'NOT_CONTESTABLE', reasons: ['Onda rejected the target because an event was already scheduled.'], firstPublishedState, preReleaseBookingCells: [] };
  return { classification: 'UNKNOWN_AT_RELEASE', reasons: [firstPublished ? 'The first grid did not prove the full target OPEN; record-less unavailability remains UNKNOWN.' : 'No complete first published grid was recorded.'], firstPublishedState, preReleaseBookingCells: [] };
}

export interface OrderAnalysis {
  n: number; sampleQuality: 'ADEQUATE' | 'SMALL_N' | 'INSUFFICIENT'; orderByInput: string[]; responseOrder: string[];
  kendallTau: number | null; spearman: number | null; comparablePairs: number; inversions: number; concordant: number; ties: number;
}
export function analyzeOrder(rows: ReadonlyArray<{ workerId: string; inputMs: number | null; responseMs: number | null }>): OrderAnalysis {
  const complete = rows.filter((row): row is { workerId: string; inputMs: number; responseMs: number } => row.inputMs !== null && row.responseMs !== null)
    .sort((a, b) => a.inputMs - b.inputMs || a.workerId.localeCompare(b.workerId));
  const a = complete.map(row => row.inputMs), b = complete.map(row => row.responseMs), pairs = pairOrderCounts(a, b);
  return { n: complete.length, sampleQuality: complete.length >= 4 ? 'ADEQUATE' : complete.length >= 2 ? 'SMALL_N' : 'INSUFFICIENT',
    orderByInput: complete.map(row => row.workerId), responseOrder: [...complete].sort((x, y) => x.responseMs - y.responseMs || x.workerId.localeCompare(y.workerId)).map(row => row.workerId),
    kendallTau: kendallTau(a, b), spearman: spearman(a, b), comparablePairs: pairs.comparable, inversions: pairs.inversions, concordant: pairs.concordant, ties: pairs.ties };
}

export interface StateTransition { cell: string; fromSeq: number; toSeq: number; rawFrom: string; rawTo: string; classification: 'ORDINARY_STATE_ADVANCEMENT' | 'STATE_REGRESSION' | 'PLAUSIBLE_REOPENING' | 'CONFIRMED_REOPENING' | 'UNKNOWN'; reason: string }
export function classifyStateTransitions(availability: readonly AvailabilityObservation[], bookings: readonly BookingObservation[]): StateTransition[] {
  const reads = availability.filter(read => read.outcome === 'ok' && read.published && read.matrix).sort((a, b) => a.requestOffsetMs - b.requestOffsetMs || a.seq - b.seq);
  const result: StateTransition[] = [];
  for (let index = 1; index < reads.length; index++) {
    const before = reads[index - 1]!, after = reads[index]!;
    for (let court = 1; court <= 7; court++) for (let hour = 8; hour < 24; hour++) {
      const cell = `${court}/${String(hour).padStart(2, '0')}:00`, from = matrixState(before.matrix, cell), to = matrixState(after.matrix, cell);
      if (from === to || from === 'UNKNOWN' || to === 'UNKNOWN') continue;
      if (from === 'OPEN' && to === 'UNAVAILABLE') result.push({ cell, fromSeq: before.seq, toSeq: after.seq, rawFrom: from, rawTo: to,
        classification: 'ORDINARY_STATE_ADVANCEMENT', reason: 'Later requested observation shows open to unavailable.' });
      else {
        const strongRegression = before.responseOffsetMs < after.requestOffsetMs;
        const bookingBefore = bookings.filter(read => read.outcome === 'ok' && read.responseOffsetMs <= before.responseOffsetMs).at(-1);
        const bookingAfter = bookings.find(read => read.outcome === 'ok' && read.requestOffsetMs >= before.responseOffsetMs && read.cells.includes(cell) === false);
        const confirmed = bookingBefore?.cells.includes(cell) === true && bookingAfter !== undefined;
        const plausible = !confirmed && strongRegression && bookingBefore?.cells.includes(cell) === true;
        result.push({ cell, fromSeq: before.seq, toSeq: after.seq, rawFrom: from, rawTo: to,
          classification: confirmed ? 'CONFIRMED_REOPENING' : plausible ? 'PLAUSIBLE_REOPENING' : strongRegression ? 'STATE_REGRESSION' : 'UNKNOWN',
          reason: confirmed ? 'A public booking record disappeared before the cell returned open.' : plausible
            ? 'A prior booking record plus non-overlapping read intervals makes a genuine reopening plausible, but its cause is unknown.'
            : strongRegression ? 'Observation A completed unavailable before later observation B was sent and returned open; absent reopening evidence B is state-regressive.'
              : 'The read intervals overlap, so provider-state order is unknown.' });
      }
    }
  }
  return result;
}

export interface BoundedWindow { lowerMs: number | null; upperMs: number | null; provenance: 'FACT' | 'INFERENCE' | 'UNKNOWN'; note: string }
export function targetDisappearanceWindow(target: Target, availability: readonly AvailabilityObservation[]): { lastFullyOpen: AvailabilityObservation | null; firstUnavailable: AvailabilityObservation | null; window: BoundedWindow } {
  const reads = availability.filter(read => read.outcome === 'ok' && read.published && read.matrix).sort((a, b) => a.requestOffsetMs - b.requestOffsetMs || a.seq - b.seq);
  const fullyOpen = (read: AvailabilityObservation) => target.cells.every(cell => matrixState(read.matrix, cell) === 'OPEN');
  const unavailable = (read: AvailabilityObservation) => target.cells.some(cell => matrixState(read.matrix, cell) === 'UNAVAILABLE');
  const firstUnavailable = reads.find(unavailable) ?? null;
  const lastFullyOpen = firstUnavailable ? reads.filter(read => read.seq < firstUnavailable.seq && fullyOpen(read)).at(-1) ?? null : reads.filter(fullyOpen).at(-1) ?? null;
  return { lastFullyOpen, firstUnavailable, window: { lowerMs: lastFullyOpen?.responseOffsetMs ?? null, upperMs: firstUnavailable?.responseOffsetMs ?? null,
    provenance: firstUnavailable ? 'INFERENCE' : 'UNKNOWN', note: firstUnavailable ? 'The provider transition occurred at an unknown time after the last fully-open observation and no later than the first unavailable response.' : 'No unavailable observation bounded the transition.' } };
}

export function publicBookingWindow(target: Target, bookings: readonly BookingObservation[], sendMs: number | null, responseMs: number | null) {
  const reads = bookings.filter(read => read.outcome === 'ok').sort((a, b) => a.requestOffsetMs - b.requestOffsetMs || a.seq - b.seq);
  const firstIndex = reads.findIndex(read => read.cells.some(cell => target.cells.includes(cell)));
  if (firstIndex < 0) return { existedBeforeRelease: false, firstObserved: null, window: { lowerMs: null, upperMs: null, provenance: 'UNKNOWN', note: 'No explaining public booking was observed.' } as BoundedWindow, requestUnresolvedDuringWindow: null };
  const first = reads[firstIndex]!, previous = reads.slice(0, firstIndex).filter(read => !read.cells.some(cell => target.cells.includes(cell))).at(-1);
  const lower = previous?.responseOffsetMs ?? null, upper = first.responseOffsetMs;
  return { existedBeforeRelease: first.responseOffsetMs <= 0, firstObserved: { seq: first.seq, requestOffsetMs: first.requestOffsetMs, responseOffsetMs: first.responseOffsetMs },
    window: { lowerMs: lower, upperMs: upper, provenance: 'INFERENCE', note: 'First-seen bounds public visibility only; it is not internal commit time.' } as BoundedWindow,
    requestUnresolvedDuringWindow: sendMs === null || responseMs === null ? null : sendMs <= upper && responseMs >= (lower ?? first.requestOffsetMs) };
}

export function slowReadFlushProximity(log: SlotWatchLog | null, responseOffsets: ReadonlyArray<{ workerId: string; responseMs: number | null }>) {
  if (!log) return { flushes: [], perDecision: [] };
  const congestion = congestionEvidence(log, 'slot-watch');
  const flushes = congestion.flushes.map((flush, index) => ({ id: `flush-${index + 1}`, startMs: flush.startMs, endMs: flush.endMs, reads: flush.reads, requestSpanMs: flush.requestSpanMs }));
  return { flushes, perDecision: responseOffsets.map(row => {
    const response = row.responseMs;
    if (response === null) return { workerId: row.workerId, nearestBeforeMs: null, nearestAfterMs: null };
    const before = flushes.filter(flush => flush.endMs <= response).at(-1), after = flushes.find(flush => flush.startMs >= response);
    return { workerId: row.workerId, nearestBeforeMs: before ? round(response - before.endMs) : null, nearestAfterMs: after ? round(after.startMs - response) : null };
  }) };
}

function responseMessages(providerLines: readonly Line[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of providerLines.filter(value => value.type === 'response-fallback')) {
    const fields = (((line.evidence ?? {}) as Line).body as Line | undefined)?.fields as Line | undefined;
    const message = str(fields?.error);
    if (message) result.set(String(line.workerId), message);
  }
  return result;
}

function quality(contestable: number, total: number): AnalysisQuality {
  if (contestable >= 4 && contestable / Math.max(total, 1) >= 0.5) return 'CLEAN';
  if (contestable >= 3) return 'MIXED';
  return 'POOR';
}

const relativeAssociation = (root: string, value: EvidenceAssociation): Line => {
  const candidate = (item: EvidenceAssociationCandidate) => ({ ...item, path: normalize(relative(root, item.path)) });
  return { ...value, selected: value.selected.map(candidate), rejected: value.rejected.map(candidate), ambiguous: value.ambiguous.map(candidate) };
};

function hypothesisAssessment(input: { contestOrder: OrderAnalysis; stateRegressions: number; flushes: number; contestable: number; sameCourtPairs: number }) {
  const result: Record<HypothesisId, { verdict: 'SUPPORTING' | 'CONTRADICTING' | 'NEUTRAL' | 'INSUFFICIENT'; observations: string[] }> = {} as never;
  for (const spec of WAVE1_HYPOTHESES) result[spec.id] = { verdict: 'INSUFFICIENT', observations: [`Evaluated against ${WAVE1_HYPOTHESIS_SPEC_VERSION}.`] };
  if (input.contestOrder.sampleQuality === 'ADEQUATE' && (input.contestOrder.kendallTau ?? 0) >= 0.6)
    result.H1 = { verdict: 'SUPPORTING', observations: [`Contestable Kendall tau=${input.contestOrder.kendallTau}; recurrence across clean releases is still required.`] };
  else if (input.contestOrder.sampleQuality === 'ADEQUATE' && (input.contestOrder.kendallTau ?? 1) <= 0)
    result.H1 = { verdict: 'CONTRADICTING', observations: [`Contestable ordering contained ${input.contestOrder.inversions} inversions; recurrence is required.`] };
  else result.H1.observations.push('Contestable sample is too small or mixed for a strong FIFO conclusion.');
  result.H2 = input.flushes > 0 ? { verdict: 'SUPPORTING', observations: [`${input.flushes} slow-read flush cluster(s) were observed; proximity alone is not causation.`] }
    : { verdict: 'NEUTRAL', observations: ['No qualifying slow-read flush was observed, or read evidence was missing.'] };
  result.H3 = input.contestOrder.inversions > 0 || input.stateRegressions > 0 ? { verdict: 'SUPPORTING', observations: [`${input.contestOrder.inversions} contest-order inversion(s); ${input.stateRegressions} state-regression case(s).`] }
    : { verdict: 'NEUTRAL', observations: ['No discriminating split-path signature in this run.'] };
  result.H4 = input.sameCourtPairs > 0 ? { verdict: 'NEUTRAL', observations: [`${input.sameCourtPairs} same-court pair(s) exist, but the run does not independently identify a court queue.`] }
    : { verdict: 'INSUFFICIENT', observations: ['No same-court contestable pair; per-court serialization is not testable.'] };
  result.H5 = input.stateRegressions > 0 ? { verdict: 'SUPPORTING', observations: [`${input.stateRegressions} raw state-regression case(s) were preserved separately from analytic state.`] }
    : { verdict: 'NEUTRAL', observations: ['No strong state-regression case was found in the available read evidence.'] };
  return result;
}

export interface Wave1Analysis { schema: string; run: Line; sources: Line; experimentQuality: Line; attempts: Line[]; ordering: Line; responseReasons: Line[];
  readPath: Line; slowReadFlush: Line; holdCommit: Line[]; hypotheses: Line; simulatorInput: Line; timeline: ReleaseTimeline; limitations: string[] }

export function buildWave1Analysis(paths: EvidencePaths): Wave1Analysis {
  const runnerLines = safeLines(paths.runner).filter(line => line.runId === paths.runId), providerLines = safeLines(paths.providerTrace), criticalLines = safeLines(paths.criticalPath), watchLines = safeLines(paths.slotWatch);
  const trace = runTrace(runnerLines), config = runnerLines.find(line => line.stage === 'RUN_CONFIGURATION') ?? {}, releaseMs = num(config.releaseMs);
  if (releaseMs === null) throw Error('ANALYSIS_RELEASE_UNKNOWN');
  const watch = normalizedWatch(watchLines), firstPublished = watch.availability.filter(read => read.outcome === 'ok' && read.published && read.matrix && !read.matrix.includes('?')).sort((a, b) => a.responseOffsetMs - b.responseOffsetMs)[0] ?? null;
  const attempts = releaseAttempts(trace), posts = new Map(runnerLines.filter(line => line.stage === 'CHECKOUT_HTTP_POST_INITIATED').map(line => [String(line.workerId), num(line.releaseLatenessMs) ?? 0]));
  const providers = providerEvidence(providerLines, releaseMs, posts), providerByWorker = new Map(providers.map(value => [value.workerId, value]));
  const criticalByWorker = new Map(criticalLines.filter(line => line.workerId).map(line => [String(line.workerId), line]));
  const messages = responseMessages(providerLines);
  const targets = new Map<string, Target>();
  for (const line of runnerLines.filter(line => line.stage === 'DIAGNOSTIC_ATTEMPT_ARMED' || line.stage === 'DIAGNOSTIC_ATTEMPT_STARTED')) {
    const court = num(line.court), startTime = str(line.startTime), durationHours = num(line.durationHours);
    if (line.workerId && court !== null && startTime && durationHours !== null) targets.set(String(line.workerId), { court, startTime, durationHours, cells: targetCells(court, startTime, durationHours) });
  }
  const rows: Array<any> = attempts.flatMap(attempt => {
    const target = targets.get(attempt.workerId); if (!target) return [];
    const provider = providerByWorker.get(attempt.workerId), reason = rejectionClass(messages.get(attempt.workerId) ?? null, attempt.statusCode);
    const contest = classifyContestSample(target, firstPublished, watch.bookings, reason), disappearance = targetDisappearanceWindow(target, watch.availability);
    const booking = publicBookingWindow(target, watch.bookings, provider?.browserRequestStartUpperBoundMs ?? attempt.sendOffsetMs, attempt.responseOffsetMs);
    const critical = criticalByWorker.get(attempt.workerId) ?? {};
    const fallback = providerLines.find(line => line.type === 'response-fallback' && line.workerId === attempt.workerId), evidence = (fallback?.evidence ?? {}) as Line;
    const headers = (evidence.headers ?? {}) as Line;
    return [{ workerId: attempt.workerId, target, contest, rejection: { class: reason, status: attempt.statusCode, sanitizedReason: messages.get(attempt.workerId) ?? null },
      localPath: { releaseMs, schedulerFireMs: num(critical.schedulerFiredMs), workerCalledMs: num(critical.workerInvokedMs), prePostMs: num(critical.prePostMs),
        evaluateEnteredMs: num((critical.evaluateEnteredMs as Line | undefined)?.ms), fetchCalledMs: num((critical.fetchInvokedMs as Line | undefined)?.ms),
        chromeNetworkStartMs: num(critical.browserRequestStartMs) ?? provider?.browserRequestStartUpperBoundMs ?? null, playwrightRequestEventMs: attempt.sendOffsetMs },
      providerPath: { protocol: provider?.protocol ?? null, connectionReuse: provider?.reused ?? null, dnsMs: num(((providerLines.find(line => line.type === 'provider-trace' && line.workerId === attempt.workerId)?.browser ?? {}) as Line).dnsMs),
        tcpMs: num(((providerLines.find(line => line.type === 'provider-trace' && line.workerId === attempt.workerId)?.browser ?? {}) as Line).connectMs),
        tlsMs: num(((providerLines.find(line => line.type === 'provider-trace' && line.workerId === attempt.workerId)?.browser ?? {}) as Line).tlsMs), sendDurationMs: provider?.sendMs ?? null,
        providerWaitMs: provider?.waitMs ?? null, responseHeadersStartMs: provider?.headersNodeMs ?? null, responseCompleteMs: attempt.responseOffsetMs, status: attempt.statusCode,
        responseDate: str(headers.date), vercelCache: str(headers['x-vercel-cache']), matchedPath: str(headers['x-matched-path']), requestId: str(headers['x-request-id']),
        serverTiming: str(headers['server-timing']), vercelId: provider?.vercelId ?? null,
        vercelEmbeddedTimestampCandidate: provider?.embeddedOffsetMs === null || provider?.embeddedOffsetMs === undefined ? null : { offsetMs: provider.embeddedOffsetMs, provenance: 'INFERENCE', meaning: 'UNDOCUMENTED' } },
      inventory: { lastTrustedOpen: disappearance.lastFullyOpen, firstUnavailable: disappearance.firstUnavailable, disappearanceWindow: disappearance.window,
        firstPublishedState: contest.firstPublishedState, publicBookingVisibility: booking },
      success: { holdExpiresAt: null, approximateProviderHoldCommit: null } }];
  });
  const journals = paths.journals.map(safeJson).filter((value): value is Line => value !== null);
  const holds: Line[] = [];
  for (const row of rows) {
    const pending = runnerLines.find(line => line.stage === 'PENDING_HOLD' && line.workerId === row.workerId && typeof line.holdExpiresAt === 'string');
    const journal = journals.find(value => ((value.attempt ?? {}) as Line).workerId === row.workerId && typeof value.holdExpiresAt === 'string');
    const expires = str(pending?.holdExpiresAt) ?? str(journal?.holdExpiresAt);
    if (!expires) continue;
    const commit = Date.parse(expires) - 600_000;
    row.success = { holdExpiresAt: expires, approximateProviderHoldCommit: { epochMs: commit, offsetFromReleaseMs: round(commit - releaseMs), provenance: 'INFERENCE', assumption: 'documented/observed hold duration is 10 minutes' } };
    holds.push({ workerId: row.workerId, ...row.success });
  }
  const contestable = rows.filter(row => row.contest.classification === 'CONFIRMED_CONTESTABLE_FROM_FIRST_PUBLISHED_STATE');
  const orderFor = (subset: typeof rows, key: 'playwright' | 'chrome' | 'vercel') => analyzeOrder(subset.map(row => ({ workerId: row.workerId,
    inputMs: key === 'playwright' ? row.localPath.playwrightRequestEventMs : key === 'chrome' ? row.localPath.chromeNetworkStartMs : (row.providerPath.vercelEmbeddedTimestampCandidate as Line | null)?.offsetMs as number | null ?? null,
    responseMs: row.providerPath.responseCompleteMs })));
  const ordering = { allWave1: { playwright: orderFor(rows, 'playwright'), chromeNetworkStart: orderFor(rows, 'chrome'), vercelEmbeddedTimestampCandidate: orderFor(rows, 'vercel') },
    contestableWave1: { playwright: orderFor(contestable, 'playwright'), chromeNetworkStart: orderFor(contestable, 'chrome'), vercelEmbeddedTimestampCandidate: orderFor(contestable, 'vercel') },
    caveat: 'n <= 3 is SMALL_N. The Vercel candidate is INFERENCE with UNDOCUMENTED meaning.' };
  const transitions = classifyStateTransitions(watch.availability, watch.bookings), regressions = transitions.filter(value => value.classification === 'STATE_REGRESSION');
  const inferredRegressions = watch.log ? holdReopenings(watch.log.reads.filter(read => read.kind === 'availability' && read.outcome === 'ok')).flatMap(reopening => {
    const cell = `${reopening.court}/${reopening.hour}`, commitUpper = reopening.commitWindowIfExactExpiryMs[1];
    const firstTaken = watch.availability.find(read => read.requestOffsetMs >= commitUpper && matrixState(read.matrix, cell) === 'UNAVAILABLE');
    const regressive = watch.availability.find(read => read.requestOffsetMs > commitUpper && (!firstTaken || read.requestOffsetMs < firstTaken.requestOffsetMs) && matrixState(read.matrix, cell) === 'OPEN');
    return regressive ? [{ cell, readSeq: regressive.seq, inferredCommitWindowMs: reopening.commitWindowIfExactExpiryMs,
      provenance: 'INFERENCE', assumption: 'The later ~10-minute reopening was this pending hold reaching hold_expires_at; cancellation can mimic it.' }] : [];
  }) : [];
  const flush = slowReadFlushProximity(watch.log, rows.map(row => ({ workerId: row.workerId, responseMs: row.providerPath.responseCompleteMs })));
  const reasonGroups = [...new Set(rows.map(row => row.rejection.class))].sort().map(reason => {
    const own = rows.filter(row => row.rejection.class === reason);
    return { reason, count: own.length, providerWaitMs: summarize(own.map(row => row.providerPath.providerWaitMs).filter((value): value is number => value !== null), 1),
      responseOrder: [...own].sort((a, b) => (a.providerPath.responseCompleteMs ?? Infinity) - (b.providerPath.responseCompleteMs ?? Infinity)).map(row => row.workerId),
      contestClasses: own.reduce<Record<string, number>>((sum, row) => { sum[row.contest.classification] = (sum[row.contest.classification] ?? 0) + 1; return sum; }, {}) };
  });
  const sameCourtPairs = contestable.reduce((sum, row, index) => sum + contestable.slice(index + 1).filter(other => other.target.court === row.target.court).length, 0);
  const hypotheses = { specVersion: WAVE1_HYPOTHESIS_SPEC_VERSION, specifications: WAVE1_HYPOTHESES,
    assessments: hypothesisAssessment({ contestOrder: ordering.contestableWave1.vercelEmbeddedTimestampCandidate,
      stateRegressions: regressions.length + inferredRegressions.length, flushes: flush.flushes.length, contestable: contestable.length, sameCourtPairs }) };
  const timeline = buildReleaseTimeline({ runnerLines, runnerFile: normalize(relative(paths.root, paths.runner)), slotWatchLines: watchLines,
    ...(paths.slotWatch ? { slotWatchFile: normalize(relative(paths.root, paths.slotWatch)) } : {}), providerLines,
    ...(paths.providerTrace ? { providerFile: normalize(relative(paths.root, paths.providerTrace)) } : {}), journals: paths.journals.map(file => ({ file: normalize(relative(paths.root, file)), record: safeJson(file)! })) });
  const chrome = rows.map(row => row.localPath.chromeNetworkStartMs).filter((value): value is number => value !== null);
  return { schema: ARBITRATION_ANALYSIS_SCHEMA, run: { runId: paths.runId, releaseMs, releaseUtc: new Date(releaseMs).toISOString(), targetDate: trace.targetDate,
      mode: trace.mode, wave1Attempts: rows.length },
    sources: { runner: normalize(relative(paths.root, paths.runner)), slotWatch: paths.slotWatch ? normalize(relative(paths.root, paths.slotWatch)) : null,
      providerTrace: paths.providerTrace ? normalize(relative(paths.root, paths.providerTrace)) : null, criticalPath: paths.criticalPath ? normalize(relative(paths.root, paths.criticalPath)) : null,
      releaseForensics: paths.releaseForensics ? normalize(relative(paths.root, paths.releaseForensics)) : null,
      experimentManifest: paths.experimentManifest ? normalize(relative(paths.root, paths.experimentManifest)) : null,
      journalCount: paths.journals.length, clockEvidenceCount: paths.clockEvidence.length, missing: paths.missing,
      association: Object.fromEntries(Object.entries(paths.associations).map(([key, value]) => [key, relativeAssociation(paths.root, value)])) },
    experimentQuality: { label: quality(contestable.length, rows.length), usefulContestSamples: contestable.length, totalWave1Attempts: rows.length,
      distribution: rows.reduce<Record<string, number>>((sum, row) => { sum[row.contest.classification] = (sum[row.contest.classification] ?? 0) + 1; return sum; }, {}) },
    attempts: rows, ordering, responseReasons: reasonGroups, readPath: { rawProviderState: watch.availability.map(read => ({ seq: read.seq, requestOffsetMs: read.requestOffsetMs, responseOffsetMs: read.responseOffsetMs, matrix: read.matrix })),
      analyticTransitions: transitions, stateRegressionCount: regressions.length, inferredStateRegressions: inferredRegressions,
      inferredStateRegressionCount: inferredRegressions.length, existingStaleSummary: watch.log ? staleReadEvidence(watch.log) : null }, slowReadFlush: flush, holdCommit: holds,
    hypotheses, simulatorInput: { label: new Date(releaseMs).toISOString().slice(0, 10), quality: quality(contestable.length, rows.length),
      checkouts: rows.map(row => ({ id: row.workerId, court: row.target.court, startTime: row.target.startTime, hours: row.target.durationHours,
        sendMs: row.localPath.chromeNetworkStartMs ?? row.localPath.playwrightRequestEventMs, edgeMs: (row.providerPath.vercelEmbeddedTimestampCandidate as Line | null)?.offsetMs ?? row.localPath.chromeNetworkStartMs,
        responseMs: row.providerPath.responseCompleteMs, status: row.providerPath.status, contestClass: row.contest.classification, rejectionClass: row.rejection.class })),
      reads: watch.availability.filter(read => read.requestOffsetMs >= -2_000 && read.requestOffsetMs <= 45_000).map(read => ({ id: `watch-${read.seq}`, sendMs: read.requestOffsetMs, responseMs: read.responseOffsetMs })),
      signatures: { allResponseWindowMs: rows.length ? [Math.min(...rows.map(row => row.providerPath.responseCompleteMs ?? Infinity)), Math.max(...rows.map(row => row.providerPath.responseCompleteMs ?? -Infinity))] : null,
        contestableOrder: ordering.contestableWave1, rejectionClasses: reasonGroups.map(group => ({ reason: group.reason, count: group.count })), disappearanceWindows: rows.map(row => ({ workerId: row.workerId, ...row.inventory.disappearanceWindow })),
        stateRegressionCount: regressions.length, inferredStateRegressionCount: inferredRegressions.length, slowReadFlushCount: flush.flushes.length } }, timeline,
    limitations: ['Provider queue entry, database lock acquisition, instance identity and internal commit time are not externally observable.',
      'Public booking first-seen time is a visibility bound, not internal commit time.', 'The Vercel embedded timestamp candidate remains UNDOCUMENTED.',
      ...(chrome.length ? [] : ['Chrome network start is missing; Playwright request time is the available fallback.']),
      ...(paths.associations.experimentManifest.status === 'MATCH' ? [] : ['NO_PREREGISTERED_MANIFEST: post-run reconstruction must not be described as preregistration.']),
      ...(paths.associations.clockEvidence.status === 'AMBIGUOUS' ? ['CLOCK_EVIDENCE_AMBIGUOUS: ambiguous clock files were excluded.'] : []),
      ...(paths.associations.slotWatch.status === 'AMBIGUOUS' ? ['SLOT_WATCH_EVIDENCE_AMBIGUOUS: no watch was selected.'] : []),
      ...paths.missing.map(value => `Missing evidence source: ${value}.`)] };
}

export function renderTimelineMarkdown(analysis: Wave1Analysis): string {
  const rows = analysis.attempts as Array<any>;
  const out = [`# Wave 1 canonical timeline — ${analysis.run.runId}`, '', `Release: ${analysis.run.releaseUtc}  `, `Target: ${analysis.run.targetDate}`, '',
    '| Worker | Target | Contest class | Chrome start | Arrival candidate | Provider response | Reason | Disappearance bound | First booking visibility |',
    '|---|---|---|---:|---:|---:|---|---|---|'];
  for (const row of rows) {
    const d = row.inventory.disappearanceWindow, b = row.inventory.publicBookingVisibility.window;
    out.push(`| ${row.workerId} | C${row.target.court} ${row.target.startTime} +${row.target.durationHours}h | ${row.contest.classification} | ${row.localPath.chromeNetworkStartMs ?? 'UNKNOWN'} ms | ${row.providerPath.vercelEmbeddedTimestampCandidate?.offsetMs ?? 'UNKNOWN'} ms (UNDOCUMENTED) | ${row.providerPath.responseCompleteMs ?? 'UNKNOWN'} ms | ${row.rejection.class} | ${d.lowerMs ?? '?'}…${d.upperMs ?? '?'} ms | ${b.lowerMs ?? '?'}…${b.upperMs ?? '?'} ms |`);
  }
  out.push('', 'Every interval is a bound. No first-seen value is treated as provider commit time.', '');
  return out.join('\n');
}

export function renderReport(analysis: Wave1Analysis, crossRelease: readonly Line[] = [], replay: Line | null = null): string {
  const quality = analysis.experimentQuality, contest = (analysis.ordering.contestableWave1 as Line).vercelEmbeddedTimestampCandidate as Line;
  const associations = (analysis.sources.association ?? {}) as Record<string, Line>;
  const associationLine = (label: string, key: string) => {
    const item = associations[key] ?? {}, selected = (item.selected ?? []) as Line[], rejected = (item.rejected ?? []) as Line[], ambiguous = (item.ambiguous ?? []) as Line[];
    const sources = selected.map(value => String(value.path)).join(', ') || 'none';
    const limitations = Array.isArray(item.limitations) && item.limitations.length ? `; limitations: ${item.limitations.join(' ')}` : '';
    const rejectedDetail = key === 'clockEvidence' ? rejected.map(value => `${value.path} (${value.basis})`).join(', ')
      : rejected.length ? `${rejected.length} candidate(s); see analysis.json` : '';
    const candidateDetail = `${rejected.length ? `; rejected: ${rejectedDetail}` : ''}`
      + `${ambiguous.length ? `; ambiguous: ${ambiguous.map(value => `${value.path} (${value.basis})`).join(', ')}` : ''}`;
    return `- ${label}: ${item.status ?? 'MISSING'} — ${item.basis ?? 'association unavailable'}; selected: ${sources}; confidence: ${item.confidence ?? 'NONE'}${limitations}${candidateDetail}`;
  };
  const lines = [`# Wave 1 arbitration report — ${analysis.run.runId}`, '', '# Executive result', '',
    `${quality.label}: ${quality.usefulContestSamples}/${quality.totalWave1Attempts} Wave 1 attempts are meaningful contest samples. `
      + `The report separates known/impossible attempts from contestable attempts and does not identify a single provider mechanism as proven.`, '',
    '# Experiment quality', '', `- Label: ${quality.label}`, `- Useful contest samples: ${quality.usefulContestSamples}`, `- Missing sources: ${((analysis.sources.missing as string[]) ?? []).join(', ') || 'none'}`, '',
    '## Evidence Association', '', associationLine('Run progress', 'runProgress'), associationLine('Slot Watch', 'slotWatch'),
    associationLine('Provider trace', 'providerTrace'), associationLine('Critical path', 'criticalPath'), associationLine('Clock evidence', 'clockEvidence'),
    associationLine('Journals', 'journals'), associationLine('Release forensics', 'releaseForensics'), associationLine('Experiment manifest', 'experimentManifest'),
    ...((associations.experimentManifest?.status === 'MATCH') ? [] : ['', 'NO_PREREGISTERED_MANIFEST — no compatible pre-run manifest was associated; post-run reconstruction is not preregistration.']), '',
    '# Wave 1 timing', '', `Chrome/network start summary: ${JSON.stringify(summarize((analysis.attempts as Array<any>).map(row => row.localPath.chromeNetworkStartMs).filter(Number.isFinite), 2))}.`, '',
    '# Target-by-target timeline', '', renderTimelineMarkdown(analysis), '# Contestable-only ordering', '',
    `n=${contest.n}; quality=${contest.sampleQuality}; Kendall tau=${contest.kendallTau ?? 'UNKNOWN'}; Spearman=${contest.spearman ?? 'UNKNOWN'}; inversions=${contest.inversions}; ties=${contest.ties}.`,
    'For n=2 or n=3 this is descriptive only. The Vercel timestamp candidate is INFERENCE / UNDOCUMENTED.', '', '# Response reason analysis', ''];
  for (const group of analysis.responseReasons) lines.push(`- ${group.reason}: ${group.count}; provider wait ${JSON.stringify(group.providerWaitMs)}; contest classes ${JSON.stringify(group.contestClasses)}.`);
  const eventGroup = analysis.responseReasons.find(group => group.reason === 'EVENT_ALREADY_SCHEDULED');
  if (eventGroup && (eventGroup.providerWaitMs as any).min !== null) lines.push(`- FACT: event-conflict responses still waited at least ${(eventGroup.providerWaitMs as any).min} ms. This is compatible with delay before final slot-conflict classification, but external evidence does not prove where that classification occurs.`);
  lines.push('', '# Inventory disappearance windows', '', 'See `timeline.md` and `analysis.json`; bounds remain intervals.', '', '# Public booking visibility', '',
    'First-seen booking records are compared with send and response bounds. They are not treated as customer identity or internal commit time.', '', '# Read path analysis', '',
    `Raw provider matrices are retained separately from analytic transitions. Strong state-regression cases: ${analysis.readPath.stateRegressionCount}; additional expiry-derived INFERENCE cases: ${analysis.readPath.inferredStateRegressionCount ?? 0}.`, '', '# Slow-read flush relationships', '',
    `Qualifying flushes: ${(analysis.slowReadFlush.flushes as unknown[]).length}. Temporal proximity is reported without a causal claim.`, '', '# Hold commit timing if successful', '',
    analysis.holdCommit.length ? `${analysis.holdCommit.length} hold(s) include an INFERENCE based on hold expiry minus the documented/observed duration.` : 'No successful hold was recorded; commit position is UNKNOWN.', '',
    '# Existing model replay results', '', replay ? 'Simulator replay was supplied; compatibility is not probability.' : 'No replay result was supplied. Run `npm run arbitration:replay -- --analysis <analysis.json>`; the v2 simulator input is embedded in `analysis.json`.');
  const replayFamilies = (((replay?.days as Line[] | undefined)?.[0]?.families ?? []) as Line[]);
  for (const family of replayFamilies) lines.push(`- ${family.family}: ${family.verdict}; compatible cells ${family.cellsWithAnyFullMatch}/${family.cells}; limitations: explored grid and seeds only.`);
  lines.push('',
    '# Cross-release recurrence', '', '| Release | Attempts | Contestable | Quality | Provider wait | Stale/regressive | Slow flushes |', '|---|---:|---:|---|---|---:|---:|');
  for (const row of crossRelease) lines.push(`| ${row.release ?? row.label} | ${row.attempts ?? '?'} | ${row.contestable ?? '?'} | ${row.quality ?? 'UNKNOWN'} | ${JSON.stringify(row.providerWaitMs ?? null)} | ${row.stateRegressions ?? '?'} direct + ${row.inferredStateRegressions ?? '?'} inferred | ${row.slowReadFlushes ?? '?'} |`);
  lines.push('', '# Hypothesis assessments', '');
  const assessments = analysis.hypotheses.assessments as Record<string, { verdict: string; observations: string[] }>;
  for (const spec of WAVE1_HYPOTHESES) lines.push(`- ${spec.id} ${spec.label}: ${assessments[spec.id]?.verdict}. ${(assessments[spec.id]?.observations ?? []).join(' ')}`);
  lines.push('', '# What this run established', '', '- Recorded facts, bounded inferences and hypotheses remain distinct.', '- Contestability is separated before order analysis.', '',
    '# What this run weakened', '', '- Only hypotheses with a CONTRADICTING assessment are weakened, and only within the stated evidence quality.', '', '# What remains unresolved', '',
    ...analysis.limitations.map(value => `- ${value}`), '', '# What evidence would be needed next', '', '- Another clean release with at least four genuinely contestable Wave 1 attempts.',
    '- Recurrent ordering, read-flush and state-regression signatures under the same pre-registered rules.', '- A successful legitimate hold would add an approximate commit-position bound without extra traffic.', '');
  return lines.join('\n');
}
