/** Create a sanitized, read-only pre-run experiment manifest from an existing Phase 3 freeze. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { WAVE1_HYPOTHESIS_SPEC_VERSION } from '../src/arbitration/hypothesis-spec.js';
import { ARBITRATION_ANALYSIS_SCHEMA, assertSanitizedOutput, normalizedWatch, targetCells } from '../src/arbitration/wave1-analysis.js';
import { parseNdjson, type Line } from '../src/arbitration/archive-evidence.js';

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index++) if (process.argv[index]!.startsWith('--')) args.set(process.argv[index]!.slice(2), process.argv[++index] ?? '');
const freezePath = args.get('freeze');
if (!freezePath) throw Error('ARBITRATION_FREEZE_REQUIRED: use --freeze <phase3-freeze.json>');
const freeze = JSON.parse(readFileSync(resolve(freezePath), 'utf8')) as Line, authorization = (freeze.authorization ?? {}) as Line;
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
  hypothesisSpecVersion: WAVE1_HYPOTHESIS_SPEC_VERSION, runId: args.get('run') ?? freeze.runId ?? 'UNKNOWN',
  releaseMs: authorization.releaseMs ?? null, targetDate: authorization.date ?? null, wave1Candidates: wave1,
  knownPreReleaseConflictSource: watch ? 'FACT: public booking observations completed before release' : 'UNKNOWN: no Slot Watch evidence supplied',
  clockQuality: clock ? { quality: clock.quality ?? null, offsetMs: clock.offsetMs ?? null, uncertaintyMs: clock.uncertaintyMs ?? null } : null,
  expectedEvidenceSources: ['run-progress', 'slot-watch', 'provider-trace', 'critical-path', 'journals', 'clock-evidence', 'release-forensics', 'response-evidence'],
  safety: { readOnlyManifest: true, changesBookingPlan: false, addsCheckoutTraffic: false } };
assertSanitizedOutput(manifest);
const out = resolve(args.get('out') ?? `arbitration-forensics/${String(manifest.runId)}/experiment-manifest.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${out}\n`);
