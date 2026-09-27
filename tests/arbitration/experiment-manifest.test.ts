import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ARBITRATION_ANALYSIS_SCHEMA, WAVE1_HYPOTHESIS_SPEC_VERSION } from '../../src/arbitration/hypothesis-spec.js';
import { buildExperimentManifest, ensureExperimentManifest, experimentManifestPath, installedLocalRoot,
  type ReleaseIdentity } from '../../src/arbitration/experiment-manifest.js';
import { assertSanitizedOutput, discoverEvidence } from '../../src/arbitration/wave1-analysis.js';

const temp: string[] = [];
afterEach(() => { for (const path of temp.splice(0)) rmSync(path, { recursive: true, force: true }); });
const root = () => { const dir = mkdtempSync(join(tmpdir(), 'experiment-manifest-')); temp.push(dir); return dir; };
const release: ReleaseIdentity = { targetDate: '2027-01-03', releaseMs: Date.parse('2027-01-01T08:00:00+08:00') };
const before = release.releaseMs - 30 * 60_000;
const ensure = (localRoot: string, nowMs = before, extra: Partial<Parameters<typeof ensureExperimentManifest>[0]> = {}) =>
  ensureExperimentManifest({ localRoot, release, createdBy: 'DESKTOP_ARM', nowMs, ...extra });
const write = (path: string, text: string) => { mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(path, text); };

describe('shared Wave 1 preregistration manifest', () => {
  it('creates a new sanitized preregistration at the canonical path', () => {
    const local = root(), result = ensure(local);
    expect(result).toMatchObject({ status: 'CREATED', path: experimentManifestPath(local, release) });
    const saved = JSON.parse(readFileSync(experimentManifestPath(local, release), 'utf8'));
    expect(saved).toMatchObject({ schema: 'wave1-experiment-manifest/v2', analysisSchema: ARBITRATION_ANALYSIS_SCHEMA, createdBy: 'DESKTOP_ARM',
      hypothesisSpecVersion: WAVE1_HYPOTHESIS_SPEC_VERSION, runId: 'UNBOUND_PRE_RUN', targetDate: '2027-01-03', releaseMs: release.releaseMs,
      createdAt: new Date(before).toISOString(), wave1CandidateSource: 'RUNNER_PHASE3_FREEZE_WRITTEN_BEFORE_RELEASE' });
    expect(() => assertSanitizedOutput(saved)).not.toThrow();
  });

  it('verifies and reuses a matching manifest without rewriting it', () => {
    const local = root(), path = experimentManifestPath(local, release);
    ensure(local);
    const bytes = readFileSync(path, 'utf8'), modified = statSync(path).mtimeMs;
    const again = ensure(local, before + 60_000);
    expect(again).toMatchObject({ status: 'VERIFIED', path, manifest: { createdAt: new Date(before).toISOString() } });
    expect(readFileSync(path, 'utf8')).toBe(bytes);
    expect(statSync(path).mtimeMs).toBe(modified);
    expect(readdirSync(resolve(path, '..'))).toEqual(['experiment-manifest.json']);
  });

  it('blocks on an incompatible manifest and leaves it untouched', () => {
    const local = root(), path = experimentManifestPath(local, release);
    const other = JSON.stringify({ ...buildExperimentManifest(release, before, 'CLI'), hypothesisSpecVersion: 'wave1-arbitration-hypotheses/v1.0.0' });
    write(path, other);
    expect(ensure(local)).toMatchObject({ status: 'BLOCKED', code: 'ARBITRATION_MANIFEST_MISMATCH', reason: 'it preregistered a different hypothesis specification', path });
    write(path, JSON.stringify({ ...buildExperimentManifest(release, before, 'CLI'), releaseMs: release.releaseMs + 86_400_000 }));
    expect(ensure(local)).toMatchObject({ code: 'ARBITRATION_MANIFEST_MISMATCH', reason: 'its release time differs' });
    write(path, other);
    ensure(local);
    expect(readFileSync(path, 'utf8')).toBe(other);
  });

  it('blocks on a malformed manifest instead of replacing it', () => {
    const local = root(), path = experimentManifestPath(local, release);
    write(path, '{"schema":"wave1-experiment-manifest/v2",');
    expect(ensure(local)).toMatchObject({ status: 'BLOCKED', code: 'ARBITRATION_MANIFEST_MALFORMED', reason: 'it is not valid JSON' });
    write(path, JSON.stringify({ schema: 'wave1-experiment-manifest/v2' }));
    expect(ensure(local)).toMatchObject({ code: 'ARBITRATION_MANIFEST_MALFORMED' });
    expect(readFileSync(path, 'utf8')).toBe(JSON.stringify({ schema: 'wave1-experiment-manifest/v2' }));
  });

  it('refuses to create or accept a preregistration at or after the release', () => {
    const local = root();
    expect(ensure(local, release.releaseMs)).toMatchObject({ status: 'BLOCKED', code: 'ARBITRATION_MANIFEST_TOO_LATE' });
    expect(ensure(local, release.releaseMs - 500, { clockOffsetMs: 600 })).toMatchObject({ code: 'ARBITRATION_MANIFEST_TOO_LATE' });
    expect(() => readdirSync(join(local, 'arbitration-manifests'))).toThrow();
    write(experimentManifestPath(local, release), JSON.stringify(buildExperimentManifest(release, release.releaseMs + 1, 'CLI')));
    expect(ensure(local)).toMatchObject({ code: 'ARBITRATION_MANIFEST_MISMATCH', reason: 'it was created after the release' });
    write(experimentManifestPath(local, release), JSON.stringify(buildExperimentManifest(release, before + 60_000, 'CLI')));
    expect(ensure(local)).toMatchObject({ code: 'ARBITRATION_MANIFEST_MISMATCH', reason: 'its creation time is in the future' });
  });

  it('identifies the release by its absolute instant, whatever time zone produced it', () => {
    const local = root(), manila = Date.parse('2027-01-01T08:00:00+08:00'), utc = Date.parse('2027-01-01T00:00:00Z');
    expect(manila).toBe(utc);
    ensureExperimentManifest({ localRoot: local, release: { targetDate: '2027-01-03', releaseMs: manila }, createdBy: 'CLI', nowMs: before });
    expect(ensureExperimentManifest({ localRoot: local, release: { targetDate: '2027-01-03', releaseMs: utc }, createdBy: 'DESKTOP_ARM', nowMs: before }))
      .toMatchObject({ status: 'VERIFIED' });
    expect(experimentManifestPath(local, release)).toContain(`2027-01-03_${utc}`);
  });

  it('rejects an invalid release context and reports storage failures without writing', () => {
    const local = root();
    expect(ensureExperimentManifest({ localRoot: local, release: { targetDate: '2027-02-30', releaseMs: release.releaseMs }, createdBy: 'DESKTOP_ARM', nowMs: before }))
      .toMatchObject({ status: 'BLOCKED', code: 'ARBITRATION_RELEASE_CONTEXT_INVALID' });
    expect(ensureExperimentManifest({ localRoot: local, release: { targetDate: '2027-01-03', releaseMs: Number.NaN }, createdBy: 'DESKTOP_ARM', nowMs: before }))
      .toMatchObject({ code: 'ARBITRATION_RELEASE_CONTEXT_INVALID' });
    const blocker = join(local, 'not-a-folder');
    writeFileSync(blocker, 'file');
    expect(ensure(blocker)).toMatchObject({ status: 'BLOCKED', code: 'ARBITRATION_MANIFEST_STORAGE_FAILED' });
    expect(readFileSync(blocker, 'utf8')).toBe('file');
  });

  it('uses one canonical location the analyzer finds without copying', () => {
    const install = root(), source = join(install, 'Source'), local = join(install, '.local');
    expect(installedLocalRoot(source)).toBe(local);
    expect(experimentManifestPath(local, release)).toBe(join(local, 'arbitration-manifests', `2027-01-03_${release.releaseMs}`, 'experiment-manifest.json'));
    // The desktop app writes into its own .local before the runner starts; the analyzer walks that same .local.
    const created = ensure(local);
    const runId = '93000000-2222-4333-8444-555555555555', started = new Date(before + 5_000).toISOString();
    write(join(local, 'api-booking', 'run-progress', `${runId}.ndjson`),
      `${JSON.stringify({ runId, mode: 'live', targetDate: '2027-01-03', stage: 'RUN_CONFIGURATION', releaseMs: release.releaseMs, at: started })}\n`);
    const found = discoverEvidence(local, runId);
    expect(found.experimentManifest).toBe(created.path);
    expect(found.associations.experimentManifest).toMatchObject({ status: 'MATCH', basis: 'pre-run unbound manifest + matching release + target date + created before runner start' });
  });
});
