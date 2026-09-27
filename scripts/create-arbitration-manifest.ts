/**
 * Development/diagnostic CLI for the Wave 1 preregistration manifest. Normal desktop use creates it automatically
 * when a release is armed; both go through the same ensureExperimentManifest (create or verify, never overwrite).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureExperimentManifest, installedLocalRoot, type ExperimentManifestExtras } from '../src/arbitration/experiment-manifest.js';
import { normalizedWatch, targetCells } from '../src/arbitration/wave1-analysis.js';
import { parseNdjson, type Line } from '../src/arbitration/archive-evidence.js';

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index++) if (process.argv[index]!.startsWith('--')) args.set(process.argv[index]!.slice(2), process.argv[++index] ?? '');
const repo = resolve(import.meta.dirname, '..'), freezePath = args.get('freeze');
const freeze = freezePath ? JSON.parse(readFileSync(resolve(freezePath), 'utf8')) as Line : null, authorization = (freeze?.authorization ?? {}) as Line;
const releaseAt = args.get('release-at');
if (releaseAt !== undefined && !/(Z|[+-]\d{2}:\d{2})$/.test(releaseAt)) throw Error('ARBITRATION_RELEASE_AT_NEEDS_OFFSET: e.g. 2026-09-29T08:00:00+08:00');
const releaseMs = typeof authorization.releaseMs === 'number' ? authorization.releaseMs : releaseAt !== undefined ? Date.parse(releaseAt) : Number.NaN;
const targetDate = typeof authorization.date === 'string' ? authorization.date : args.get('date') ?? '';
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
const extras: ExperimentManifestExtras = { ...(args.get('run') ? { runId: args.get('run')! } : {}),
  ...(freeze ? { wave1Candidates: wave1, wave1CandidateSource: 'SUPPLIED_PHASE3_FREEZE' } : {}),
  ...(watch ? { knownPreReleaseConflictSource: 'FACT: public booking observations completed before release' } : {}),
  ...(clock ? { clockQuality: { quality: clock.quality ?? null, offsetMs: clock.offsetMs ?? null, uncertaintyMs: clock.uncertaintyMs ?? null } } : {}) };
// Default: the installed .local, where the desktop app writes and arbitration:analyze searches first.
const result = ensureExperimentManifest({ localRoot: installedLocalRoot(repo), release: { targetDate, releaseMs }, createdBy: 'CLI', extras,
  ...(args.get('out') ? { path: resolve(args.get('out')!) } : {}) });
if (result.status === 'BLOCKED') throw Error(`${result.code}: ${result.reason}${result.path ? ` (${result.path})` : ''}`);
process.stdout.write(`${result.status} ${result.path}\n`);
