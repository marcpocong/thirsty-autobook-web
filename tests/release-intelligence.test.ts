import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearReleaseIntelligence, computeMetrics, deriveReleaseIntelligence, observerQuality, readReleaseIntelligence, rebuildReleaseIntelligence, sharedRisk,
  statisticalRecords, type ReleaseRecord } from '../src/release-intelligence.js';
import { readObserverLog } from '../src/release-forensics.js';
import { makeRoot, ndjson, NOW_MS, SAT1, SAT2, twoSaturdays, v1Log, v2Log, write } from './phase4-fixtures.js';

const roots: string[] = [];
const root = () => { const value = makeRoot(); roots.push(value); return value; };
afterEach(() => { for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true }); });
const derive = (value: string) => deriveReleaseIntelligence(value, NOW_MS);
const files = (directory: string): Record<string, string> => Object.fromEntries(readdirSync(directory, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile()).map(entry => { const path = join(entry.parentPath, entry.name); return [path.slice(directory.length + 1).replaceAll('\\', '/'), readFileSync(path, 'utf8')]; }));

describe('Release Intelligence data layer', () => {
  it('rebuilds deterministically and only inside .local/release-intelligence', () => {
    const base = root(); twoSaturdays(base);
    const before = files(join(base, '.local', 'slot-watch'));
    rebuildReleaseIntelligence(base, { now: () => NOW_MS });
    const first = files(join(base, '.local', 'release-intelligence'));
    rebuildReleaseIntelligence(base, { now: () => NOW_MS });
    expect(files(join(base, '.local', 'release-intelligence'))).toEqual(first);
    expect(files(join(base, '.local', 'slot-watch'))).toEqual(before);
    expect(Object.keys(first).sort()).toEqual(['index.json', 'metrics.json', ...[SAT1, SAT2].map(value => `releases/${value.date}@${new Date(value.releaseMs).toISOString().replace(/[:.]/g, '-')}.json`), 'summary.txt']);
    expect(readReleaseIntelligence(base)!.records.map(record => record.origin)).toEqual(['REAL_RELEASE', 'REAL_RELEASE']);
  });

  it('deduplicates watches of the same release and keeps the one with the most reads', () => {
    const base = root(); twoSaturdays(base);
    write(base, `slot-watch/${SAT2.date}_z-partial.ndjson`, v2Log(SAT2.date, SAT2.releaseMs, [{ seq: 1, request: 0, response: 1100 }]));
    const record = derive(base).records.find(value => value.targetDate === SAT2.date)!;
    expect(record.sources.slotWatch).toEqual([`${SAT2.date}_b.ndjson`]);
    expect(record.sources.ignoredDuplicates).toEqual([`${SAT2.date}_z-partial.ndjson`]);
  });

  it('skips corrupt and empty artifacts without failing the rebuild', () => {
    const base = root(); twoSaturdays(base);
    write(base, 'slot-watch/garbage.ndjson', 'not json at all\n{"type":"poll"}\n');
    write(base, 'slot-watch/2026-10-17_empty.ndjson', v2Log('2026-10-17', Date.parse('2026-10-15T00:00:00Z'), []));
    write(base, 'release-forensics/bad-run/summary.json', '{');
    write(base, 'api-booking/run-progress/broken.ndjson', '{"runId":\n');
    const derived = derive(base);
    expect(derived.records).toHaveLength(2);
    expect(derived.index.skipped).toEqual(expect.arrayContaining([{ source: 'garbage.ndjson', code: 'UNREADABLE_OR_UNSUPPORTED' },
      { source: '2026-10-17_empty.ndjson', code: 'NO_READS' }, { source: 'bad-run/summary.json', code: 'UNREADABLE' }]));
  });

  it('keeps synthetic and benchmark evidence out of real-release statistics, even with a real timestamp', () => {
    const base = root(); twoSaturdays(base);
    write(base, `slot-watch/${SAT1.date}_synthetic-phase3.ndjson`, v2Log(SAT1.date, SAT1.releaseMs, [{ seq: 1, request: 0, response: 900 }, { seq: 2, request: 1000, response: 1500 },
      { seq: 3, request: 2000, response: 2400 }, { seq: 4, request: 3000, response: 3500 }, { seq: 5, request: 4000, response: 4500 }, { seq: 6, request: 5000, response: 5500 }]));
    write(base, 'api-booking/run-progress/00000000-0000-4000-8000-000000000009.ndjson', ndjson([{ runId: '00000000-0000-4000-8000-000000000009', mode: 'live', targetDate: SAT1.date },
      { stage: 'RUN_CONFIGURATION', releaseMs: SAT1.releaseMs, at: new Date(SAT1.releaseMs - 60_000).toISOString() },
      { stage: 'CHECKOUT_HTTP_POST_INITIATED', workerId: 'A', releaseLatenessMs: 3, at: new Date(SAT1.releaseMs + 3).toISOString() }]));
    write(base, 'benchmarks/2026-09-24T13-09-46-863Z-phase3-comparison-enabled-summary.json', JSON.stringify({ label: 'phase3-comparison-enabled' }));
    const derived = derive(base);
    const synthetic = derived.records.filter(record => record.origin === 'SYNTHETIC');
    expect(synthetic).toHaveLength(1);
    expect(synthetic[0]!.key.endsWith('-synthetic')).toBe(true);
    expect(synthetic[0]!.sources.runProgress).toEqual(['00000000-0000-4000-8000-000000000009.ndjson']);
    const real = derived.records.find(record => record.targetDate === SAT1.date && record.origin === 'REAL_RELEASE')!;
    expect(real.sources.slotWatch).toEqual([`${SAT1.date}_a.ndjson`]);
    expect(real.attempts).toEqual([]);
    expect(derived.index.benchmarks).toEqual([{ name: '2026-09-24T13-09-46-863Z-phase3-comparison-enabled-summary.json', origin: 'OFFLINE_BENCHMARK', label: 'phase3-comparison-enabled' }]);
    expect(computeMetrics(derived.records).realReleases).toBe(2);
    expect(statisticalRecords(derived.records).every(record => record.origin !== 'SYNTHETIC')).toBe(true);
  });

  it('tags old-observer and pre-architecture releases as historical and preserves the Sept 23/24 notes', () => {
    const base = root();
    const sept24 = Date.parse('2026-09-24T00:00:00.000Z');
    write(base, 'slot-watch/2026-09-26_old.ndjson', v1Log('2026-09-26', sept24, [{ seq: 1, request: -60_000, response: -59_700, released: false },
      { seq: 2, request: 11_293, response: 15_744, released: true, states: { '3/15:00': 'X' } }]));
    const record = derive(base).records[0]!;
    expect(record.origin).toBe('HISTORICAL_PRE_PHASE3');
    expect(record.quality.label).toBe('POOR');
    expect(record.quality.reasons.join(' ')).toContain('+15.7 s, later than +10 s: it is not release-instant evidence');
    expect(record.notes.join(' ')).toContain('The release-instant grid was not captured');
    expect(record.notes.join(' ')).not.toMatch(/venue block/i);
  });

  it('never copies private values from runner traces', () => {
    const base = root(); twoSaturdays(base);
    const secrets = ['secret.person@example.invalid', '09170000001', '11111111-2222-4333-8444-555555555555', 'Secret Person', 'session=abc', 'tok-secret',
      'fp-secret', 'BK-SECRET1', 'ct-secret', '000201010212', 'bid-secret'];
    write(base, 'api-booking/run-progress/7a1b2c3d-0000-4000-8000-00000000abcd.ndjson', ndjson([
      { runId: '7a1b2c3d-0000-4000-8000-00000000abcd', mode: 'live', targetDate: SAT2.date, stage: 'RUN_STARTED', at: new Date(SAT2.releaseMs - 600_000).toISOString() },
      { stage: 'RUN_CONFIGURATION', releaseMs: SAT2.releaseMs, at: new Date(SAT2.releaseMs - 599_000).toISOString() },
      { stage: 'CUSTOMER_IDENTITY', customerEmail: secrets[0], customerPhone: secrets[1], customerId: secrets[2], fullName: secrets[3], at: new Date(SAT2.releaseMs - 590_000).toISOString() },
      { stage: 'PRECISION_TARGET', workerId: 'A', court: 7, startTime: '19:00', endTime: '22:00', assumedPrice: 2100, at: new Date(SAT2.releaseMs - 580_000).toISOString() },
      { stage: 'CHECKOUT_HTTP_POST_INITIATED', workerId: 'A', releaseLatenessMs: 4.2, cookie: secrets[4], turnstileToken: secrets[5], fingerprint: secrets[6], at: new Date(SAT2.releaseMs + 4).toISOString() },
      { stage: 'CHECKOUT_RESPONSE_COMPLETED', workerId: 'A', statusCode: 200, networkDurationMs: 900, bookingNo: secrets[7], checkoutToken: secrets[8], qrPayload: secrets[9], at: new Date(SAT2.releaseMs + 905).toISOString() },
      { stage: 'PRECISION_ATTEMPT_STATE', workerId: 'A', attemptState: 'QR_READY', bookingId: secrets[10], at: new Date(SAT2.releaseMs + 2000).toISOString() },
      { stage: 'PRECISION_OUTCOME', outcome: 'OBJECTIVE_ACHIEVED', at: new Date(SAT2.releaseMs + 2100).toISOString() }]));
    rebuildReleaseIntelligence(base, { now: () => NOW_MS });
    const output = Object.values(files(join(base, '.local', 'release-intelligence'))).join('\n');
    for (const secret of secrets) expect(output).not.toContain(secret);
    expect(output).not.toContain(base);
    const record = readReleaseIntelligence(base)!.records.find(value => value.targetDate === SAT2.date)!;
    expect(record.attempts).toEqual([expect.objectContaining({ wave: 'IMMEDIATE', workerId: 'A', court: 7, postOffsetMs: 4.2, statusCode: 200, result: 'QR_READY', expectedAmount: 2100 })]);
    expect(record.outcome).toBe('OBJECTIVE_ACHIEVED');
  });

  it('clears only its own derived files', () => {
    const base = root(); twoSaturdays(base);
    for (const [path, content] of [['api-booking/api-first-journals/key/journal.json', '{}'], ['automation.lock', '{}'], ['release-forensics/run/summary.json', '{}']] as const) write(base, path, content);
    rebuildReleaseIntelligence(base, { now: () => NOW_MS });
    writeFileSync(join(base, '.local', 'release-intelligence', 'keep-me.bin'), 'x');
    expect(clearReleaseIntelligence(base)).toBeGreaterThan(3);
    expect(readdirSync(join(base, '.local', 'release-intelligence'))).toEqual(['keep-me.bin']);
    for (const path of ['slot-watch', 'api-booking/api-first-journals/key/journal.json', 'automation.lock', 'release-forensics/run/summary.json'])
      expect(existsSync(join(base, '.local', path))).toBe(true);
    expect(readReleaseIntelligence(base)).toBeNull();
  });
});

describe('observation quality', () => {
  const quality = (reads: Parameters<typeof v2Log>[2]) => {
    const base = root(); write(base, 'slot-watch/2026-10-03_q.ndjson', v2Log(SAT1.date, SAT1.releaseMs, reads));
    return observerQuality(readObserverLog(join(base, '.local', 'slot-watch', '2026-10-03_q.ndjson'))!);
  };
  it('labels fast, delayed, cached, incomplete and missing evidence deterministically with the metrics shown', () => {
    const fast = quality([{ seq: 1, request: 250, response: 1200 }]);
    expect(fast.label).toBe('GOOD'); expect(fast.metrics).toMatchObject({ firstPublishedRequestOffsetMs: 250, firstPublishedResponseOffsetMs: 1200, firstPublishedComplete: true, cacheCertain: true });
    const delayed = quality([{ seq: 1, request: 11_000, response: 15_700 }]);
    expect(delayed.label).toBe('POOR'); expect(delayed.reasons[0]).toContain('not release-instant evidence');
    const cached = quality([{ seq: 1, request: 250, response: 1200, cache: 'HIT' }]);
    expect(cached.label).toBe('FAIR'); expect(cached.reasons.join(' ')).toContain('Cache status HIT');
    expect(quality([{ seq: 1, request: 250, response: 1200, cache: 'MISS', ageS: 4 }]).label).toBe('FAIR');
    expect(quality([{ seq: 1, request: 250, response: 1200, cache: null }]).reasons.join(' ')).toContain('Cache provenance was not recorded');
    expect(quality([{ seq: 1, request: 250, response: 1200, states: { '4/10:00': '?' } }]).label).toBe('POOR');
    expect(quality([{ seq: 1, request: -1000, response: -800, published: false }]).label).toBe('NONE');
    expect(quality([{ seq: 1, request: 0, response: 4000 }]).label).toBe('FAIR');
  });
});

describe('historical metrics and shared risk', () => {
  const records = (): ReleaseRecord[] => { const base = root(); twoSaturdays(base); return derive(base).records; };
  it('counts per-cell first publication, survival windows, reopen, public records and prices', () => {
    const metrics = computeMetrics(records());
    const cell = (court: number, hour: string) => metrics.cells.find(value => value.dayOfWeek === 'Saturday' && value.court === court && value.hour === hour)!;
    expect(cell(7, '19:00')).toMatchObject({ releases: 2, adequate: 2, firstOpen: 2, firstUnavailable: 0, censored: 0 });
    expect(cell(7, '19:00').survival['500']).toEqual({ observed: 1, open: 0 });
    expect(cell(7, '19:00').survival['1000']).toEqual({ observed: 2, open: 1 });
    expect(cell(3, '19:00')).toMatchObject({ firstOpen: 1, firstUnavailable: 1, reopened: 1, reopenedCacheUncertain: 0, publicRecordChecked: 1, publicRecordPresent: 1 });
    expect(cell(3, '19:00').reopenOffsetsMs).toEqual([2000]);
    expect(cell(5, '08:00')).toMatchObject({ firstUnavailable: 1, unavailableWithoutRecord: 1 });
    expect(cell(7, '19:00').prices).toMatchObject({ n: 2, min: 700, median: 700, max: 700 });
    expect(JSON.stringify(metrics)).not.toMatch(/probab|win/i);
  });
  it('counts 1-3 hour ranges as fully open, partial, unavailable or censored with survival and price', () => {
    const metrics = computeMetrics(records());
    const range = (court: number, start: string, hours: number) => metrics.ranges.find(value => value.court === court && value.start === start && value.durationHours === hours)!;
    expect(range(7, '19:00', 3)).toMatchObject({ adequate: 2, fullyOpen: 2, partiallyUnavailable: 0, censored: 0 });
    expect(range(7, '19:00', 3).survival['1000']).toEqual({ observed: 2, open: 1 });
    expect(range(3, '18:00', 2)).toMatchObject({ fullyOpen: 1, partiallyUnavailable: 1, reopened: 1 });
    expect(range(7, '19:00', 3).prices.values).toEqual([2100]);
    expect(metrics.ranges.some(value => Number(value.start.slice(0, 2)) + value.durationHours > 24)).toBe(false);
  });
  it('explains shared-risk numbers without inferring cause', () => {
    const data = records();
    const across = sharedRisk({ court: 7, start: '19:00', durationHours: 3 }, { court: 6, start: '19:00', durationHours: 3 }, data);
    expect(across).toMatchObject({ sameCourt: false, sharedCells: 0, jaccard: 0, overlappingHours: 3, bothObserved: 2, coUnavailable: 0, sameEarlyLoss: 0 });
    const same = sharedRisk({ court: 7, start: '19:00', durationHours: 3 }, { court: 7, start: '20:00', durationHours: 2 }, data);
    expect(same).toMatchObject({ sameCourt: true, sharedCells: 2, jaccard: 0.667, overlappingHours: 2 });
    const lost = sharedRisk({ court: 7, start: '19:00', durationHours: 1 }, { court: 7, start: '19:00', durationHours: 2 }, data);
    expect(lost.sameEarlyLoss).toBe(1);
    expect(across.explanation).toContain('3 overlapping clock hours');
    expect(across.explanation).not.toMatch(/because|caused/i);
  });
});
