/**
 * Create a sanitized, read-only experiment manifest BEFORE the live release is armed.
 * The runner writes its Phase 3 freeze only at T-2 min, so a pre-arming manifest is bound by
 * target date + release instant; Wave 1 targets then come from that runner freeze (also pre-release).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { WAVE1_HYPOTHESIS_SPEC_VERSION } from '../src/arbitration/hypothesis-spec.js';
import { ARBITRATION_ANALYSIS_SCHEMA, assertSanitizedOutput, normalizedWatch, targetCells } from '../src/arbitration/wave1-analysis.js';
import { parseNdjson, type Line } from '../src/arbitration/archive-evidence.js';

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index++) if (process.argv[index]!.startsWith('--')) args.set(process.argv[index]!.slice(2), process.argv[++index] ?? '');
const repo = resolve(import.meta.dirname, '..'), freezePath = args.get('freeze');
const freeze = freezePath ? JSON.parse(readFileSync(resolve(freezePath), 'utf8')) as Line : null, authorization = (freeze?.authorization ?? {}) as Line;
const releaseAt = args.get('release-at');
if (releaseAt !== undefined && !/(Z|[+-]\d{2}:\d{2})$/.test(releaseAt)) throw Error('ARBITRATION_RELEASE_AT_NEEDS_OFFSET: e.g. 2026-09-29T08:00:00+08:00');
const releaseMs = typeof authorization.releaseMs === 'number' ? authorization.releaseMs : releaseAt !== undefined ? Date.parse(releaseAt) : NaN;
const targetDate = typeof authorization.date === 'string' ? authorization.date : args.get('date') ?? '';
if (!Number.isFinite(releaseMs) || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate))
  throw Error('ARBITRATION_RELEASE_REQUIRED: use --date <target-date> --release-at <ISO instant with offset> (or --freeze <phase3-freeze.json>)');
const createdMs = Date.now();
if (createdMs >= releaseMs) throw Error('ARBITRATION_MANIFEST_TOO_LATE: preregistration must be created before arming; post-release reconstruction is not preregistration');
const candidates = Array.isArray(authorization.candidates) ? authorization.candidates as Line[] : [];
const assignments = Array.isArray(authorization.wave1) ? authorization.wave1 as Line[] : [];
const watch = args.get('watch') ? normalizedWatch(parseNdjson(readFileSync(resolve(args.get('watch')!), 'utf8'))) : null;
const preReleaseCells = new Set(watch?.bookings.filter(read => read.outcome === 'ok' && read.responseOffsetMs <= 0).flatMap(read => read.cells) ?? []);
const wave1 = assignments.flatMap(assignment => {
  const candidate = candidates.find(value => value.id === assignment.candidateId);
  const court = typeof candidate?.court === 'number' ? candidate.court : null, startTime = typeof candidate?.start === 'string' ? candidate.start : null;
  const durationHours = typeof candidate?.durationHours === 'number' ? candidate.durationHours : null;
  if (court === null || !startTime || durationHours === null) return [];
  const cells = targetCells(court, startTime, durationHours);
  return [{ workerId: assignment.workerId, court, startTime, durationHours, knownPreReleaseBookingConflicts: cells.filter(cell => preReleaseCells.has(cell)) }];
});
const clock = args.get('clock') ? JSON.parse(readFileSync(resolve(args.get('clock')!), 'utf8')) as Line : null;
const manifest = { schema: 'wave1-experiment-manifest/v2', analysisSchema: ARBITRATION_ANALYSIS_SCHEMA,
  createdAt: new Date(createdMs).toISOString(),
  hypothesisSpecVersion: WAVE1_HYPOTHESIS_SPEC_VERSION, runId: args.get('run') ?? 'UNBOUND_PRE_RUN',
  releaseMs, targetDate, wave1Candidates: freeze ? wave1 : null,
  wave1CandidateSource: freeze ? 'SUPPLIED_PHASE3_FREEZE' : 'RUNNER_PHASE3_FREEZE_WRITTEN_BEFORE_RELEASE',
  knownPreReleaseConflictSource: watch ? 'FACT: public booking observations completed before release' : 'UNKNOWN: no Slot Watch evidence supplied',
  clockQuality: clock ? { quality: clock.quality ?? null, offsetMs: clock.offsetMs ?? null, uncertaintyMs: clock.uncertaintyMs ?? null } : null,
  expectedEvidenceSources: ['run-progress', 'slot-watch', 'provider-trace', 'critical-path', 'journals', 'clock-evidence', 'release-forensics', 'response-evidence'],
  safety: { readOnlyManifest: true, changesBookingPlan: false, addsCheckoutTraffic: false } };
assertSanitizedOutput(manifest);
// Default: the installed .local, which arbitration:analyze searches first.
const out = resolve(args.get('out') ?? resolve(repo, '..', '.local', 'arbitration-manifests', `${targetDate}_${releaseMs}`, 'experiment-manifest.json'));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(`${out}\n`);
