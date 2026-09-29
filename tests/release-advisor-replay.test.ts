import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { adviseFromHistory, ADVISOR_RULE, strategyHistoricalEvidence } from '../src/release-advisor.js';
import { deriveReleaseIntelligence, type ReleaseRecord } from '../src/release-intelligence.js';
import { readObserverLog } from '../src/release-forensics.js';
import { replayRelease, replayPlanFromFixed, type ReplayPlan, type ReplayResult } from '../src/strategy-replay.js';
import { makeRoot, NOW_MS, SAT1, twoSaturdays, v2Log, write, type ReadSpec } from './phase4-fixtures.js';

const roots: string[] = [];
const root = () => { const value = makeRoot(); roots.push(value); return value; };
afterEach(() => { for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true }); });
const saturdays = (): ReleaseRecord[] => { const base = root(); twoSaturdays(base); return deriveReleaseIntelligence(base, NOW_MS).records; };
const deepFreeze = <T>(value: T): T => { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };

describe('Historical Advisor', () => {
  it('builds a sanitized same-weekday DTO and excludes synthetic/offline evidence from strength', () => {
    const records=saturdays(),synthetic={...structuredClone(records[0]!),key:'synthetic',origin:'SYNTHETIC' as const};
    const result=strategyHistoricalEvidence('2026-10-17',[{court:6,start:'19:00',durationHours:3},{court:7,start:'19:00',durationHours:3}],[...records,synthetic]);
    expect(result).toMatchObject({dayOfWeek:'Saturday',releasesConsidered:2,wellObservedReleases:2,strength:'LIMITED',realReleases:2,historicalPrePhase3:0});
    expect(result.ranges).toHaveLength(2);expect(result.sharedRisk).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/sources|path|customer|token|cookie/i);
  });
  it('does not let POOR history affect Auto strength', () => {
    const poor=saturdays().map(record=>({...structuredClone(record),quality:{...record.quality,label:'POOR' as const}}));
    const result=strategyHistoricalEvidence('2026-10-17',[{court:6,start:'19:00',durationHours:3}],poor);
    expect(result).toMatchObject({wellObservedReleases:0,strength:'NONE'});
    expect(result.ranges[0]).toMatchObject({wellObserved:0,fullyOpenFirst:0,reopened:0});
  });
  it('stays inside the operator constraints and never invents a court or time', () => {
    const result = adviseFromHistory({ targetDate: '2026-10-17', courts: [6, 7], earliestStart: '18:00', latestStart: '19:00', durationHours: 3,
      immediate: 2, backups: 2, exclude: [{ court: 6, start: '18:00' }] }, saturdays());
    expect(result.candidatesConsidered).toBe(3);
    for (const suggestion of result.suggestions) {
      expect([6, 7]).toContain(suggestion.court); expect(['18:00', '19:00']).toContain(suggestion.start); expect(suggestion.durationHours).toBe(3);
      expect(`${suggestion.court}@${suggestion.start}`).not.toBe('6@18:00');
    }
    expect(result.suggestions.filter(value => value.role === 'IMMEDIATE').every((value, index, list) => list.every((other, j) => j === index || other.court !== value.court))).toBe(true);
  });

  it('ranks by visible evidence and shows sample size, survival and rationale', () => {
    const result = adviseFromHistory({ targetDate: '2026-10-17', courts: [7, 6], earliestStart: '19:00', latestStart: '19:00', durationHours: 3, immediate: 2, backups: 0 }, saturdays());
    expect(result.rule).toBe(ADVISOR_RULE);
    expect(result.dayOfWeek).toBe('Saturday'); expect(result.wellObservedReleases).toBe(2); expect(result.insufficient).toBe(false);
    // Court 6 stayed open at +1 s in both Saturdays; court 7 was lost in one, so court 6 ranks first despite the court order.
    expect(result.suggestions.map(value => value.title)).toEqual(['Court 6 · 7:00 PM–10:00 PM', 'Court 7 · 7:00 PM–10:00 PM']);
    expect(result.suggestions[0]!.lines).toEqual(expect.arrayContaining(['Fully open in first usable snapshot: 2 of 2 well-observed Saturdays',
      'Still observed open at +1 s: 2 of 2', 'Evidence quality: 2 good']));
    expect(result.suggestions[1]!.lines).toContain('Still observed open at +1 s: 1 of 2');
    expect(JSON.stringify(result)).not.toMatch(/probab|chance|\bwin\b|would have won/i);
  });

  it('says plainly when there is no well-observed history', () => {
    const result = adviseFromHistory({ targetDate: '2026-10-18', courts: [1], earliestStart: '17:00', latestStart: '17:00', durationHours: 3, immediate: 1, backups: 0 }, saturdays());
    expect(result.insufficient).toBe(true); expect(result.dayOfWeek).toBe('Sunday');
    expect(result.suggestions[0]!.lines[0]).toBe('No well-observed Sunday release yet (sample size 0).');
    expect(result.notes[0]).toContain('not evidence-based yet');
  });

  it('is draft-only: pure input to output, with no save, arm, dispatch or network path', () => {
    const records = deepFreeze(saturdays());
    expect(() => adviseFromHistory({ targetDate: '2026-10-17', courts: [1, 2, 3, 4, 5, 6, 7], earliestStart: '17:00', latestStart: '20:00', durationHours: 3, immediate: 4, backups: 3 }, records)).not.toThrow();
    const source = readFileSync('src/release-advisor.ts', 'utf8');
    expect(source).not.toMatch(/saveBooking|armFullBooking|dispatch\(|fetch\(|writeFile|precision-race|desktop-runner|armed-dispatch/);
    expect(source.match(/^import .*$/gm)!.join('\n')).not.toMatch(/node:fs|config\.js|controller/);
  });
});

const date = SAT1.date, releaseMs = SAT1.releaseMs;
const rate = { source: 'operator confirmed', capturedAt: '2026-09-30T00:00:00.000Z', status: 'OPERATOR_CONFIRMED' as const, date, perHour: [700, 700, 700], actionable: true };
const candidate = (court: number, start: string, priority: number, permissions = { wave1: false, wave2: true, rescue: false }, hours = 3) =>
  ({ court, start, durationHours: hours, priority, permissions, rateEvidence: { ...rate, perHour: rate.perHour.slice(0, hours) } });
function plan(extra: Partial<ReplayPlan> = {}): ReplayPlan {
  return { candidates: [candidate(7, '19:00', 1, { wave1: true, wave2: false, rescue: true }), candidate(6, '19:00', 2, { wave1: false, wave2: true, rescue: true })],
    wave1: [{ workerId: 'A', candidateIndex: 0 }], standby: ['B'], budgets: { wave2: 1, rescue: 1, total: 3 }, concurrentWave2: true, rescueEnabled: true, ...extra };
}
function replay(reads: ReadSpec[], replayPlan = plan(), options: Parameters<typeof replayRelease>[3] = {}): ReplayResult {
  const base = root(); write(base, `slot-watch/${date}_r.ndjson`, v2Log(date, releaseMs, reads));
  const log = readObserverLog(join(base, '.local', 'slot-watch', `${date}_r.ndjson`))!;
  const record = deriveReleaseIntelligence(base, NOW_MS).records[0]!;
  return replayRelease(replayPlan, log, record, options);
}
const text = (result: ReplayResult) => JSON.stringify(result);

describe('Offline Strategy Replay', () => {
  it('uses the production Phase 3 logic and no network, browser, journal or checkout code', () => {
    const source = readFileSync('src/strategy-replay.ts', 'utf8'), imports = source.match(/^import[\s\S]*?from '[^']+';/gm)!.join('\n');
    expect(imports).toMatch(/authorizePrecision[\s\S]*PrecisionSession[\s\S]*from '\.\/api-booking\/precision-phase3\.js'/);
    for (const name of ['adaptiveMaxAgeMs', 'classifyActionableObservation', 'candidatePriceFromObservation']) expect(imports).toContain(name);
    expect(imports).not.toMatch(/browser-session-transport|proofless-checkout|durable-submission-journal|armed-dispatch|playwright|desktop-runner/);
    expect(source).not.toMatch(/fetch\(|executeProofless|prepareCheckoutContext/);
    expect(readFileSync('src/api-booking/desktop-runner.ts', 'utf8')).toContain('adaptiveMaxAgeMs(latency,securityRefreshMs)');
  });

  it('finds the first actionable backup opportunity at the fresh grid, with that grid\'s prices', () => {
    const result = replay([{ seq: 1, request: 0, response: 1200, states: { '7/19:00': 'X' } }]);
    expect(result.backup).toEqual({ atResponseOffsetMs: 1200, seq: 1, selections: [{ court: 6, startTime: '19:00', endTime: '22:00', workerId: 'B', prices: [700, 700, 700], amount: 2100 }] });
    expect(result.immediate[0]).toMatchObject({ workerId: 'A', court: 7, firstPublished: 'PARTIALLY_UNAVAILABLE' });
    expect(result.statement).toBe('This release contained an observed authorized opportunity.');
  });

  it('waits for immediate answers when backups are not used immediately', () => {
    const result = replay([{ seq: 1, request: 0, response: 1200 }], plan({ concurrentWave2: false }), { immediateSettledAtMs: 3000 });
    expect(result.backup?.atResponseOffsetMs).toBe(3000);
    expect(replay([{ seq: 1, request: 0, response: 1200 }], plan({ concurrentWave2: false }), { immediateSettledAtMs: 9000 }).backup).toBeNull(); // evidence too old by then
  });

  it('finds a reopened-slot opportunity only after everything was rejected, and UNKNOWN stops everything', () => {
    const reads: ReadSpec[] = [{ seq: 1, request: 0, response: 1000, states: { '7/19:00': 'X', '6/19:00': 'X' } }, { seq: 2, request: 4000, response: 4500 }];
    const result = replay(reads, plan({ concurrentWave2: false }), { immediateSettledAtMs: 2000 });
    expect(result.rescue).toEqual([expect.objectContaining({ court: 7, startTime: '19:00', atResponseOffsetMs: 4500, seq: 2 })]);
    const unknown = replay(reads, plan({ concurrentWave2: false }), { immediateSettledAtMs: 2000, immediateResult: 'UNKNOWN' });
    expect(unknown.backup).toBeNull(); expect(unknown.rescue).toEqual([]);
    expect(unknown.assumptions[1]).toContain('treated as UNKNOWN');
    expect(unknown.statement).toBe('An authorized opening was observed, but nothing may be sent after an UNKNOWN result.');
  });

  it('treats cached evidence as observed but not actionable', () => {
    const result = replay([{ seq: 1, request: 0, response: 1200, cache: 'HIT', states: { '7/19:00': 'X' } }]);
    expect(result.backup).toBeNull();
    expect(result.fitness).toEqual({ FORENSIC_ONLY_CACHE_AGE_UNKNOWN: 1 });
    expect(result.forensicOpenings).toEqual([expect.objectContaining({ court: 6, fitness: 'FORENSIC_ONLY_CACHE_AGE_UNKNOWN' })]);
    expect(result.statement).toBe('This release contained an observed authorized opening, but not in evidence the current rules may act on.');
  });

  it('reports censored evidence and overlap conflicts', () => {
    const late = replay([{ seq: 1, request: 11_000, response: 15_700 }]);
    expect(late.censored[0]).toContain('+15.7 s: the first seconds after release were not observed');
    const conflicted = replay([{ seq: 1, request: 0, response: 1200 }], plan({ candidates: [candidate(7, '19:00', 1, { wave1: true, wave2: false, rescue: false }),
      candidate(7, '20:00', 2, undefined, 2), candidate(6, '19:00', 3)], budgets: { wave2: 1, rescue: 0, total: 2 }, rescueEnabled: false }));
    expect(conflicted.conflicts).toEqual([expect.objectContaining({ court: 7, startTime: '20:00', blockedBy: { court: 7, startTime: '19:00', endTime: '22:00' } })]);
    expect(conflicted.backup?.selections.map(value => value.court)).toEqual([6]);
  });

  it('replays a Fixed plan as immediate attempts only and never claims a win', () => {
    const result = replay([{ seq: 1, request: 0, response: 1200 }, { seq: 2, request: 1000, response: 1900, states: { '7/19:00': 'X' } }],
      replayPlanFromFixed([{ court: 7, start: '19:00', durationHours: 3 }]));
    expect(result.backup).toBeNull(); expect(result.immediate[0]!.firstPublished).toBe('FULLY_OPEN');
    expect(result.statement).toBe('No backup or reopened-slot opportunity was observed in this release.');
    for (const value of [result, late()]) expect(text(value)).not.toMatch(/would have won|\bwon\b|\bwin\b|guarantee/i);
    function late() { return replay([{ seq: 1, request: 0, response: 1200 }]); }
  });
});
