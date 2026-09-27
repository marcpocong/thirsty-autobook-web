import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseVercelId } from '../../src/api-booking/response-evidence.js';
import { WAVE1_HYPOTHESES, WAVE1_HYPOTHESIS_SPEC_VERSION } from '../../src/arbitration/hypothesis-spec.js';
import { averageRanks, pairOrderCounts, spearman } from '../../src/arbitration/stats.js';
import { analyzeOrder, assertSanitizedOutput, buildWave1Analysis, classifyContestSample, classifyStateTransitions, discoverEvidence,
  publicBookingWindow, rejectionClass, slowReadFlushProximity, targetCells, targetDisappearanceWindow, type AvailabilityObservation,
  type BookingObservation, type EvidencePaths, type Target } from '../../src/arbitration/wave1-analysis.js';

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
    expect(found.missing).toEqual(['provider-trace', 'critical-path']);
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
    const paths: EvidencePaths = { root: dir, runId, runner, slotWatch: null, providerTrace: null, criticalPath: null, releaseForensics: null, clockEvidence: [], journals: [], missing: ['slot-watch', 'provider-trace', 'critical-path'] };
    expect(buildWave1Analysis(paths).holdCommit).toEqual([]);
    line(runner, [...readFileSync(runner, 'utf8').trim().split('\n').map(value => JSON.parse(value)),
      { runId, stage: 'PENDING_HOLD', workerId: 'A', holdExpiresAt: '2027-01-01T00:10:00.500Z' }]);
    expect(buildWave1Analysis(paths).holdCommit[0]).toMatchObject({ workerId: 'A', approximateProviderHoldCommit: { offsetFromReleaseMs: 500, provenance: 'INFERENCE' } });
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
