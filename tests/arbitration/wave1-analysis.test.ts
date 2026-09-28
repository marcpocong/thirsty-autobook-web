import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseVercelId } from '../../src/api-booking/response-evidence.js';
import { WAVE1_HYPOTHESES, WAVE1_HYPOTHESIS_SPEC_VERSION } from '../../src/arbitration/hypothesis-spec.js';
import { buildExperimentManifest, experimentManifestPath } from '../../src/arbitration/experiment-manifest.js';
import { averageRanks, pairOrderCounts, spearman } from '../../src/arbitration/stats.js';
import { analyzeOrder, assertSanitizedOutput, buildWave1Analysis, classifyContestSample, classifyStateTransitions, discoverEvidence,
  publicBookingWindow, rejectionClass, renderReport, slowReadFlushProximity, targetCells, targetDisappearanceWindow, type AvailabilityObservation,
  type BookingObservation, type Target } from '../../src/arbitration/wave1-analysis.js';

const temp: string[] = [];
afterEach(() => { for (const path of temp.splice(0)) rmSync(path, { recursive: true, force: true }); });
const root = () => { const path = mkdtempSync(join(tmpdir(), 'wave1-v2-')); temp.push(path); return path; };
const line = (path: string, values: unknown[]) => { mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(path, values.map(value => JSON.stringify(value)).join('\n') + '\n'); };
const openMatrix = () => Array.from({ length: 7 }, (_, court) => `${court + 1}:${'O'.repeat(16)}`).join(',');
const withCell = (matrix: string, court: number, hour: number, code: 'O' | 'X') => matrix.split(',').map(row => row.startsWith(`${court}:`)
  ? `${court}:${row.slice(2, 2 + hour - 8)}${code}${row.slice(3 + hour - 8)}` : row).join(',');
const availability = (seq: number, requestOffsetMs: number, responseOffsetMs: number, matrix: string): AvailabilityObservation =>
  ({ seq, requestOffsetMs, responseOffsetMs, durationMs: responseOffsetMs - requestOffsetMs, matrix, published: true, outcome: 'ok', cache: 'MISS' });
const booking = (seq: number, requestOffsetMs: number, responseOffsetMs: number, cells: string[]): BookingObservation =>
  ({ seq, requestOffsetMs, responseOffsetMs, cells, outcome: 'ok' });
const target: Target = { court: 2, startTime: '17:00', durationHours: 3, cells: targetCells(2, '17:00', 3) };
const configuredRun = (dir: string, runId: string, releaseMs: number, targetDate = '2027-01-03', startedAt = '2026-12-31T23:30:00.000Z',
  extra: Array<Record<string, unknown>> = []) => {
  const path = join(dir, 'run-progress', `${runId}.ndjson`);
  line(path, [{ runId, mode: 'live', targetDate, stage: 'RUN_CONFIGURATION', releaseMs, at: startedAt }, ...extra.map(value => ({ runId, ...value }))]);
  return path;
};
const clockStage = (checkpoint: string, at: string, offsetMs: number) => ({ stage: 'NETWORK_CLOCK_CONSENSUS', checkpoint, at, offsetMs });
const watchHeader = (dir: string, name: string, releaseMs: number, date = '2027-01-03', startedAt = '2026-12-31T23:30:00.500Z', partial = false) => {
  const path = join(dir, 'slot-watch', `${name}.ndjson`);
  line(path, [{ type: 'header', version: 2, date, releaseMs, releaseAt: new Date(releaseMs).toISOString(), startedAt },
    ...(partial ? [] : [{ type: 'availability', seq: 1, requestOffsetMs: 0, responseOffsetMs: 100, targetDatePresent: true, outcome: 'ok', matrix: openMatrix() }])]);
  return path;
};
const clockFile = (dir: string, name: string, value: Record<string, unknown>) => {
  const path = join(dir, 'network-clock-evidence', `${name}.json`);
  mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(path, JSON.stringify(value)); return path;
};

describe('pre-registered hypotheses and rank statistics', () => {
  it('defines H1-H5 before the run with support, contradiction and limitations', () => {
    expect(WAVE1_HYPOTHESIS_SPEC_VERSION).toMatch(/v2/);
    expect(WAVE1_HYPOTHESES.map(value => value.id)).toEqual(['H1', 'H2', 'H3', 'H4', 'H5']);
    expect(WAVE1_HYPOTHESES.every(value => value.supports.length && value.contradicts.length && value.limitations.length)).toBe(true);
  });

  it('handles ties, inversions and small N without overstating evidence', () => {
    expect(averageRanks([1, 1, 3])).toEqual([1.5, 1.5, 3]);
    expect(spearman([1, 2, 3], [1, 3, 2])).toBe(0.5);
    expect(pairOrderCounts([1, 1, 3], [1, 2, 0])).toEqual({ comparable: 2, concordant: 0, inversions: 2, ties: 1 });
    expect(analyzeOrder([{ workerId: 'A', inputMs: 1, responseMs: 2 }, { workerId: 'B', inputMs: 2, responseMs: 1 }]))
      .toMatchObject({ n: 2, sampleQuality: 'SMALL_N', inversions: 1, kendallTau: -1 });
  });
});

describe('contestability, bounded visibility and raw-vs-analytic state', () => {
  it('separates pre-release conflicts, confirmed contests and record-less unavailability', () => {
    const open = availability(1, 0, 1_000, openMatrix());
    expect(classifyContestSample(target, open, [], 'OVERLAPS_EXISTING_BOOKING').classification).toBe('CONFIRMED_CONTESTABLE_FROM_FIRST_PUBLISHED_STATE');
    expect(classifyContestSample(target, open, [booking(1, -2_000, -1_000, ['2/18:00'])], 'OVERLAPS_EXISTING_BOOKING').classification).toBe('KNOWN_BLOCKED_PRE_RELEASE');
    const blocked = availability(1, 0, 1_000, withCell(openMatrix(), 2, 18, 'X'));
    expect(classifyContestSample(target, blocked, [], 'OVERLAPS_EXISTING_BOOKING').classification).toBe('UNKNOWN_AT_RELEASE');
    expect(classifyContestSample(target, blocked, [], 'EVENT_ALREADY_SCHEDULED').classification).toBe('NOT_CONTESTABLE');
  });

  it('keeps disappearance and public-booking times as intervals', () => {
    const reads = [availability(1, 0, 1_000, openMatrix()), availability(2, 1_100, 2_000, withCell(openMatrix(), 2, 18, 'X'))];
    expect(targetDisappearanceWindow(target, reads).window).toMatchObject({ lowerMs: 1_000, upperMs: 2_000, provenance: 'INFERENCE' });
    const visible = publicBookingWindow(target, [booking(1, -2_000, -1_000, []), booking(2, 1_500, 2_500, ['2/18:00'])], 10, 5_000);
    expect(visible.window).toMatchObject({ lowerMs: -1_000, upperMs: 2_500 });
    expect(visible.requestUnresolvedDuringWindow).toBe(true);
  });

  it('distinguishes strong regression, legitimate reopening and overlapping UNKNOWN', () => {
    const unavailable = withCell(openMatrix(), 2, 18, 'X');
    const strong = classifyStateTransitions([availability(1, 0, 100, unavailable), availability(2, 200, 300, openMatrix())], []);
    expect(strong.find(value => value.cell === '2/18:00')?.classification).toBe('STATE_REGRESSION');
    const reopened = classifyStateTransitions([availability(1, 0, 100, unavailable), availability(2, 300, 400, openMatrix())],
      [booking(1, -100, 50, ['2/18:00']), booking(2, 150, 250, [])]);
    expect(reopened.find(value => value.cell === '2/18:00')?.classification).toBe('CONFIRMED_REOPENING');
    const overlap = classifyStateTransitions([availability(1, 0, 300, unavailable), availability(2, 100, 200, openMatrix())], []);
    expect(overlap.find(value => value.cell === '2/18:00')?.classification).toBe('UNKNOWN');
  });

  it('classifies sanitized rejection reasons without depending on response size', () => {
    expect(rejectionClass('This booking slot is temporarily unavailable because an event is already scheduled in this space.', 409)).toBe('EVENT_ALREADY_SCHEDULED');
    expect(rejectionClass('This booking slot is no longer available (overlaps an existing booking).', 409)).toBe('OVERLAPS_EXISTING_BOOKING');
    expect(rejectionClass(null, 200)).toBe('SUCCESS');
  });
});

describe('generic discovery and partial evidence', () => {
  it('discovers an arbitrary future run without September-specific paths', () => {
    const dir = root(), runId = '11111111-2222-4333-8444-555555555555', releaseMs = Date.parse('2027-01-01T00:00:00Z');
    line(join(dir, 'future', 'run-progress', `${runId}.ndjson`), [{ runId, mode: 'live', targetDate: '2027-01-03', stage: 'RUN_CONFIGURATION', releaseMs, at: '2026-12-31T23:00:00Z' }]);
    line(join(dir, 'future', 'slot-watch', 'anything.ndjson'), [{ type: 'header', version: 2, date: '2027-01-03', releaseMs, startedAt: '2026-12-31T23:00:00Z' }]);
    const found = discoverEvidence(dir, runId);
    expect(found.runner).toContain(runId);
    expect(found.slotWatch).toContain('anything.ndjson');
    expect(found.missing).toEqual(['provider-trace', 'critical-path', 'clock-evidence']);
  });

  it('builds a partial/no-success analysis and infers commit only when hold evidence exists', () => {
    const dir = root(), runId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', releaseMs = Date.parse('2027-01-01T00:00:00Z');
    const runner = join(dir, `${runId}.ndjson`);
    line(runner, [
      { runId, mode: 'live', targetDate: '2027-01-03', stage: 'RUN_CONFIGURATION', releaseMs, bookingMethod: 'proofless' },
      { runId, stage: 'DIAGNOSTIC_ATTEMPT_ARMED', workerId: 'A', court: 2, startTime: '17:00', durationHours: 3 },
      { runId, stage: 'CHECKOUT_PRE_POST', workerId: 'A', releaseLatenessMs: 1 },
      { runId, stage: 'CHECKOUT_HTTP_POST_INITIATED', workerId: 'A', releaseLatenessMs: 5 },
      { runId, stage: 'CHECKOUT_RESPONSE_COMPLETED', workerId: 'A', networkDurationMs: 1_000, statusCode: 200 },
    ]);
    const paths = discoverEvidence(dir, runId);
    expect(buildWave1Analysis(paths).holdCommit).toEqual([]);
    line(runner, [...readFileSync(runner, 'utf8').trim().split('\n').map(value => JSON.parse(value)),
      { runId, stage: 'PENDING_HOLD', workerId: 'A', holdExpiresAt: '2027-01-01T00:10:00.500Z' }]);
    expect(buildWave1Analysis(paths).holdCommit[0]).toMatchObject({ workerId: 'A', approximateProviderHoldCommit: { offsetFromReleaseMs: 500, provenance: 'INFERENCE' } });
  });

  it('links capturedAt clock files to the run through its progress log and rejects history', () => {
    const dir = root(), runId = '10000000-2222-4333-8444-555555555555', releaseMs = Date.parse('2027-01-01T00:00:00Z');
    configuredRun(dir, runId, releaseMs, undefined, undefined, [clockStage('T-10M', '2026-12-31T23:50:00.120Z', 12),
      clockStage('T-60S', '2026-12-31T23:59:00.220Z', 13.4), clockStage('T-30S', '2026-12-31T23:59:30.320Z', 13.1)]);
    clockFile(dir, 't10', { checkpoint: 'T-10M', capturedAt: '2026-12-31T23:50:00.100Z', offsetMs: 12.21 });
    clockFile(dir, 't60', { checkpoint: 'T-60S', capturedAt: '2026-12-31T23:59:00.200Z', offsetMs: 13.43 });
    clockFile(dir, 't30', { checkpoint: 'T-30S', capturedAt: '2026-12-31T23:59:30.300Z', offsetMs: 13.08 });
    clockFile(dir, 'historical', { checkpoint: 'T-30S', capturedAt: '2026-12-30T23:59:30.300Z', offsetMs: 13.08 });
    const found = discoverEvidence(dir, runId);
    expect(found.clockEvidence.map(path => path.split(/[\\/]/).at(-1))).toEqual(['t10.json', 't30.json', 't60.json']);
    expect(found.associations.clockEvidence).toMatchObject({ status: 'MATCH', confidence: 'HIGH', basis: "each file matches a clock event in this run's progress log" });
    expect(found.associations.clockEvidence.rejected.map(value => value.path)).toEqual(expect.arrayContaining([expect.stringContaining('historical.json')]));
  });

  it('keeps an unlinked current-release checkpoint only at MEDIUM confidence', () => {
    const dir = root(), runId = '11000000-2222-4333-8444-555555555555', releaseMs = Date.parse('2027-01-01T00:00:00Z');
    configuredRun(dir, runId, releaseMs);
    clockFile(dir, 't30', { checkpoint: 'T-30S', capturedAt: '2026-12-31T23:59:30.300Z' });
    const found = discoverEvidence(dir, runId);
    expect(found.clockEvidence).toHaveLength(1);
    expect(found.associations.clockEvidence).toMatchObject({ status: 'MATCH', confidence: 'MEDIUM' });
    expect(found.associations.clockEvidence.limitations).toContain('Not linked to this run: its progress log has no T-30S clock event.');
  });

  it('uses the run log to pick between relaunches and accepts a late T-10M checkpoint', () => {
    const dir = root(), runId = '12000000-2222-4333-8444-555555555555', releaseMs = Date.parse('2027-01-01T00:00:00Z');
    // An aborted launch wrote T-10M on time; this relaunch started at T-7 min and wrote its T-10M late.
    configuredRun(dir, runId, releaseMs, undefined, '2026-12-31T23:53:00.000Z', [clockStage('T-10M', '2026-12-31T23:53:01.050Z', 20)]);
    clockFile(dir, 'aborted-t10', { checkpoint: 'T-10M', capturedAt: '2026-12-31T23:50:00.100Z', offsetMs: 18.2 });
    clockFile(dir, 'relaunch-t10', { checkpoint: 'T-10M', capturedAt: '2026-12-31T23:53:01.000Z', offsetMs: 19.7 });
    const found = discoverEvidence(dir, runId);
    expect(found.clockEvidence.map(path => path.split(/[\\/]/).at(-1))).toEqual(['relaunch-t10.json']);
    expect(found.associations.clockEvidence).toMatchObject({ status: 'MATCH', confidence: 'HIGH' });
    expect(found.associations.clockEvidence.rejected).toEqual([expect.objectContaining({ path: expect.stringContaining('aborted-t10.json'),
      basis: 'T-10M file not recorded by this run' })]);
  });

  it("rejects a same-release file that contradicts the run's own clock event", () => {
    const dir = root(), runId = '13000000-2222-4333-8444-555555555555', releaseMs = Date.parse('2027-01-01T00:00:00Z');
    // This run's own late T-10M file was never written; an aborted launch's on-time T-10M must not stand in for it.
    configuredRun(dir, runId, releaseMs, undefined, '2026-12-31T23:53:00.000Z',
      [{ stage: 'NETWORK_CLOCK_REFRESHED', checkpoint: 'T-10M', at: '2026-12-31T23:53:01.050Z', offsetMs: 20 }]);
    clockFile(dir, 'aborted-launch', { checkpoint: 'T-10M', capturedAt: '2026-12-31T23:50:00.100Z', offsetMs: 18.2 });
    const found = discoverEvidence(dir, runId);
    expect(found.clockEvidence).toEqual([]);
    expect(found.associations.clockEvidence.status).toBe('MISSING');
    expect(found.associations.clockEvidence.rejected[0]?.basis).toBe('this run logged its own T-10M clock event, which this file does not match');
  });

  it('excludes duplicate current-release clock candidates as ambiguous', () => {
    const dir = root(), runId = '20000000-2222-4333-8444-555555555555', releaseMs = Date.parse('2027-01-01T00:00:00Z');
    configuredRun(dir, runId, releaseMs);
    clockFile(dir, 'a', { checkpoint: 'T-30S', capturedAt: '2026-12-31T23:59:30.100Z' });
    clockFile(dir, 'b', { checkpoint: 'T-30S', capturedAt: '2026-12-31T23:59:30.200Z' });
    const found = discoverEvidence(dir, runId);
    expect(found.clockEvidence).toEqual([]);
    expect(found.associations.clockEvidence).toMatchObject({ status: 'AMBIGUOUS', code: 'CLOCK_EVIDENCE_AMBIGUOUS' });
    expect(found.associations.clockEvidence.ambiguous).toHaveLength(2);
    expect(found.missing).toContain('clock-evidence');
  });

  it('reports clock evidence missing when timestamps are malformed or historical', () => {
    const dir = root(), runId = '30000000-2222-4333-8444-555555555555', releaseMs = Date.parse('2027-01-01T00:00:00Z');
    configuredRun(dir, runId, releaseMs);
    clockFile(dir, 'malformed', { checkpoint: 'T-30S', capturedAt: 'not-a-date' });
    clockFile(dir, 'old', { checkpoint: 'T-10M', capturedAt: '2026-12-20T23:50:00Z' });
    const found = discoverEvidence(dir, runId);
    expect(found.clockEvidence).toEqual([]);
    expect(found.associations.clockEvidence).toMatchObject({ status: 'MISSING', basis: 'no defensible current-release clock file' });
    expect(found.associations.clockEvidence.rejected).toHaveLength(2);
  });

  it('selects the exact current watch over an older release-compatible watch', () => {
    const dir = root(), runId = '40000000-2222-4333-8444-555555555555', releaseMs = Date.parse('2027-01-01T00:00:00Z');
    configuredRun(dir, runId, releaseMs);
    watchHeader(dir, 'older', releaseMs, '2027-01-03', '2026-12-31T22:00:00Z');
    const current = watchHeader(dir, 'current', releaseMs);
    const found = discoverEvidence(dir, runId);
    expect(found.slotWatch).toBe(current);
    expect(found.associations.slotWatch).toMatchObject({ status: 'MATCH', confidence: 'HIGH' });
    expect(found.associations.slotWatch.rejected.map(value => value.path)).toEqual(expect.arrayContaining([expect.stringContaining('older.ndjson')]));
  });

  it('does not substitute an older or wrong-date watch', () => {
    const dir = root(), runId = '50000000-2222-4333-8444-555555555555', releaseMs = Date.parse('2027-01-01T00:00:00Z');
    configuredRun(dir, runId, releaseMs);
    watchHeader(dir, 'older-release', releaseMs - 86_400_000);
    watchHeader(dir, 'wrong-date', releaseMs, '2027-01-04');
    const found = discoverEvidence(dir, runId);
    expect(found.slotWatch).toBeNull();
    expect(found.associations.slotWatch.status).toBe('NO_MATCH');
    expect(found.missing).toContain('slot-watch');
  });

  it('fails closed when two watches are equally plausible', () => {
    const dir = root(), runId = '60000000-2222-4333-8444-555555555555', releaseMs = Date.parse('2027-01-01T00:00:00Z');
    configuredRun(dir, runId, releaseMs);
    watchHeader(dir, 'one', releaseMs, '2027-01-03', '2026-12-31T23:29:59.900Z');
    watchHeader(dir, 'two', releaseMs, '2027-01-03', '2026-12-31T23:30:00.100Z');
    const found = discoverEvidence(dir, runId);
    expect(found.slotWatch).toBeNull();
    expect(found.associations.slotWatch).toMatchObject({ status: 'AMBIGUOUS', code: 'SLOT_WATCH_EVIDENCE_AMBIGUOUS' });
    expect(found.associations.slotWatch.ambiguous).toHaveLength(2);
  });

  it('accepts a partial current watch with an exact header', () => {
    const dir = root(), runId = '70000000-2222-4333-8444-555555555555', releaseMs = Date.parse('2027-01-01T00:00:00Z');
    configuredRun(dir, runId, releaseMs);
    const partial = watchHeader(dir, 'partial', releaseMs, '2027-01-03', '2026-12-31T23:30:00.500Z', true);
    const found = discoverEvidence(dir, runId);
    expect(found.slotWatch).toBe(partial);
    expect(found.associations.slotWatch.limitations).toContain('Partial watch contains no availability or booking observations.');
  });

  it('accepts a watch kept from before the runner only when it observed the release', () => {
    const dir = root(), runId = '71000000-2222-4333-8444-555555555555', releaseMs = Date.parse('2027-01-01T00:00:00Z');
    configuredRun(dir, runId, releaseMs);
    const operator = watchHeader(dir, 'operator', releaseMs, '2027-01-03', '2026-12-31T23:00:00.000Z');
    watchHeader(dir, 'aborted-launch', releaseMs, '2027-01-03', '2026-12-31T23:10:00.000Z', true);
    const found = discoverEvidence(dir, runId);
    expect(found.slotWatch).toBe(operator);
    expect(found.associations.slotWatch).toMatchObject({ status: 'MATCH', confidence: 'MEDIUM',
      basis: 'exact target date + release instant + only compatible watch with release observations' });
    expect(found.associations.slotWatch.limitations.join(' ')).toContain('Watch started 1800 s before the runner');
    expect(found.associations.slotWatch.rejected.map(value => value.path)).toEqual([expect.stringContaining('aborted-launch.ndjson')]);
  });

  it('does not substitute same-release header-only leftovers from other launches', () => {
    const dir = root(), runId = '72000000-2222-4333-8444-555555555555', releaseMs = Date.parse('2027-01-01T00:00:00Z');
    configuredRun(dir, runId, releaseMs);
    watchHeader(dir, 'leftover-a', releaseMs, '2027-01-03', '2026-12-31T21:00:00.000Z', true);
    watchHeader(dir, 'leftover-b', releaseMs, '2027-01-03', '2026-12-31T22:00:00.000Z', true);
    const found = discoverEvidence(dir, runId);
    expect(found.slotWatch).toBeNull();
    expect(found.associations.slotWatch.status).toBe('NO_MATCH');
    expect(found.associations.slotWatch.rejected).toHaveLength(2);
  });

  it('reads configuration only from the requested run in a combined progress log', () => {
    const dir = root(), runId = '73000000-2222-4333-8444-555555555555', releaseMs = Date.parse('2027-01-01T00:00:00Z');
    const runner = join(dir, 'logs', 'run-progress.ndjson');
    line(runner, [{ runId: 'earlier-run', mode: 'live', targetDate: '2027-01-02', stage: 'RUN_CONFIGURATION', releaseMs: releaseMs - 86_400_000, at: '2026-12-30T23:30:00.000Z' },
      { runId, mode: 'live', targetDate: '2027-01-03', stage: 'RUN_CONFIGURATION', releaseMs, at: '2026-12-31T23:30:00.000Z' }]);
    const current = watchHeader(dir, 'current', releaseMs);
    watchHeader(dir, 'earlier', releaseMs - 86_400_000, '2027-01-02', '2026-12-30T23:30:00.500Z');
    expect(discoverEvidence(dir, runId).slotWatch).toBe(current);
  });

  it('validates explicit watch overrides and rejects incompatible files', () => {
    const dir = root(), runId = '80000000-2222-4333-8444-555555555555', releaseMs = Date.parse('2027-01-01T00:00:00Z');
    configuredRun(dir, runId, releaseMs);
    const valid = watchHeader(dir, 'valid', releaseMs), invalid = watchHeader(dir, 'invalid', releaseMs, '2027-01-04');
    expect(discoverEvidence(dir, runId, { watch: valid }).slotWatch).toBe(valid);
    expect(() => discoverEvidence(dir, runId, { watch: invalid })).toThrow(/WATCH_EVIDENCE_INCOMPATIBLE/);
  });

  it('rejects explicit provider and critical-path files from another run', () => {
    const dir = root(), runId = '81000000-2222-4333-8444-555555555555', releaseMs = Date.parse('2027-01-01T00:00:00Z');
    configuredRun(dir, runId, releaseMs);
    const provider = join(dir, 'provider-trace.ndjson'), critical = join(dir, 'critical-path.ndjson');
    line(provider, [{ type: 'header', runId: 'wrong-run' }]); line(critical, [{ type: 'header', runId: 'wrong-run' }]);
    expect(() => discoverEvidence(dir, runId, { provider })).toThrow(/PROVIDER_EVIDENCE_INCOMPATIBLE/);
    expect(() => discoverEvidence(dir, runId, { critical })).toThrow(/CRITICAL_PATH_EVIDENCE_INCOMPATIBLE/);
  });

  it('reports evidence association and missing preregistration without aborting a partial analysis', () => {
    const dir = root(), runId = '90000000-2222-4333-8444-555555555555', releaseMs = Date.parse('2027-01-01T00:00:00Z');
    configuredRun(dir, runId, releaseMs);
    const analysis = buildWave1Analysis(discoverEvidence(dir, runId)), report = renderReport(analysis);
    expect(report).toContain('## Evidence Association');
    expect(report).toContain('Slot Watch: NO_MATCH');
    expect(report).toContain('Clock evidence: MISSING');
    expect(report).toContain('NO_PREREGISTERED_MANIFEST');
  });

  it('accepts only a manifest demonstrably created before the runner started', () => {
    const dir = root(), runId = '91000000-2222-4333-8444-555555555555', releaseMs = Date.parse('2027-01-01T00:00:00Z');
    configuredRun(dir, runId, releaseMs);
    const before = join(dir, 'before', 'experiment-manifest.json'), after = join(dir, 'after', 'experiment-manifest.json');
    for (const [path, createdAt] of [[before, '2026-12-31T23:00:00Z'], [after, '2026-12-31T23:31:00Z']] as const) {
      mkdirSync(resolve(path, '..'), { recursive: true });
      writeFileSync(path, JSON.stringify(buildExperimentManifest({ targetDate: '2027-01-03', releaseMs }, Date.parse(createdAt), 'CLI')));
    }
    expect(discoverEvidence(dir, runId, { manifest: before }).associations.experimentManifest).toMatchObject({ status: 'MATCH', confidence: 'MEDIUM' });
    expect(() => discoverEvidence(dir, runId, { manifest: after })).toThrow(/MANIFEST_EVIDENCE_INCOMPATIBLE/);
  });

  it('finds the default pre-arming manifest automatically but never a post-start one', () => {
    const dir = root(), runId = '92000000-2222-4333-8444-555555555555', releaseMs = Date.parse('2027-01-01T00:00:00Z');
    configuredRun(dir, runId, releaseMs);
    const manifest = experimentManifestPath(dir, { targetDate: '2027-01-03', releaseMs });
    const write = (createdAt: string) => { mkdirSync(resolve(manifest, '..'), { recursive: true });
      writeFileSync(manifest, JSON.stringify(buildExperimentManifest({ targetDate: '2027-01-03', releaseMs }, Date.parse(createdAt), 'CLI'))); };
    write('2026-12-31T23:31:00Z');
    expect(discoverEvidence(dir, runId).associations.experimentManifest).toMatchObject({ status: 'MISSING', code: 'NO_PREREGISTERED_MANIFEST' });
    write('2026-12-31T22:00:00Z');
    expect(discoverEvidence(dir, runId).experimentManifest).toBe(manifest);
  });

  it('keeps unknown Vercel formats undocumented/unknown and rejects sensitive output', () => {
    expect(parseVercelId('not-a-vercel-id')).toBeNull();
    expect(() => assertSanitizedOutput({ runId: 'safe', releaseMs: 1_800_000_000_000 })).not.toThrow();
    expect(() => assertSanitizedOutput({ customerId: 'secret' })).toThrow(/UNSANITIZED/);
    expect(() => assertSanitizedOutput({ email: 'person@example.com' })).toThrow(/UNSANITIZED/);
  });
});

describe('slow-read and archive regression fixtures', () => {
  it('detects a slow-read flush and distances to checkout decisions', () => {
    const log = { version: 2, releaseMs: 0, observerOffsetMs: 0, reads: [
      { kind: 'availability', seq: 1, requestOffsetMs: 0, responseOffsetMs: 5_000, durationMs: 5_000, outcome: 'ok', published: true, open: 1, taken: 1, records: null, cache: null, matrix: null, cells: null },
      { kind: 'availability', seq: 2, requestOffsetMs: 1_500, responseOffsetMs: 5_050, durationMs: 3_550, outcome: 'ok', published: true, open: 1, taken: 1, records: null, cache: null, matrix: null, cells: null },
      { kind: 'availability', seq: 3, requestOffsetMs: 3_100, responseOffsetMs: 5_100, durationMs: 2_000, outcome: 'ok', published: true, open: 1, taken: 1, records: null, cache: null, matrix: null, cells: null },
    ] } as const;
    const result = slowReadFlushProximity(log as any, [{ workerId: 'A', responseMs: 5_500 }]);
    expect(result.flushes).toHaveLength(1);
    expect(result.perDecision[0]).toMatchObject({ nearestBeforeMs: 400 });
  });

  const repo = resolve(import.meta.dirname, '../..');
  it.runIf(Boolean(process.env.CI) || true)('replays September 25 and 26 with the expected analytical distinction', () => {
    const p25 = discoverEvidence(join(repo, 'diagnostics-archive/2026-09-25'), 'fc62669a-bfe5-4726-998a-fa0616bd1e19');
    const p26 = discoverEvidence(join(repo, 'diagnostics-archive/2026-09-26'), 'e69098a8-b8b2-444e-b0ea-2b1170f1420f');
    const a25 = buildWave1Analysis(p25), a26 = buildWave1Analysis(p26);
    expect(a25.experimentQuality).toMatchObject({ label: 'CLEAN', usefulContestSamples: 7 });
    expect((a25.slowReadFlush.flushes as unknown[]).length).toBeGreaterThan(0);
    expect((a25.readPath.existingStaleSummary as any).provablyStale).toBeGreaterThan(0);
    expect(a26.experimentQuality).toMatchObject({ label: 'POOR', usefulContestSamples: 2 });
    expect(a26.responseReasons.map(value => value.reason)).toEqual(expect.arrayContaining(['EVENT_ALREADY_SCHEDULED', 'OVERLAPS_EXISTING_BOOKING']));
    expect((a26.ordering.contestableWave1 as any).vercelEmbeddedTimestampCandidate.sampleQuality).toBe('SMALL_N');
  });

  it('keeps investigation modules off the release critical path', () => {
    const live = ['src/api-booking/desktop-runner.ts', 'src/api-booking/public-checkout.ts', 'src/api-booking/critical-path.ts']
      .map(path => readFileSync(join(repo, path), 'utf8')).join('\n');
    expect(live).not.toMatch(/wave1-analysis|hypothesis-spec|analyze-release-arbitration/);
  });
});
