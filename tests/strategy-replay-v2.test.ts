import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readObserverLog } from '../src/release-forensics.js';
import { COUNTERFACTUAL_LABEL, replayStrategyV2, scheduleFromObserverLog, strategyReplayText } from '../src/strategy-replay-v2.js';

/**
 * Strategy V2 against recorded releases (sanitized archives in the repository). The replay is counterfactual:
 * it shows what the proposed plan would have been ALLOWED to try on the recorded evidence, never that it would have won.
 */
const ARCHIVES = {
  'Sep 25 (target 09-27)': 'diagnostics-archive/2026-09-25/local/slot-watch/2026-09-27_60d68777-0022-471a-99aa-3a47543858f4.ndjson',
  'Sep 26 (target 09-28)': 'diagnostics-archive/2026-09-26/logs/slot-watch.ndjson',
  'Sep 28 (target 09-30)': 'diagnostics-archive/2026-09-28/local/slot-watch/2026-09-30_ffe896ed-9c1f-43c7-9ce9-7767b6d12d49.ndjson',
};
const record = (key: string) => ({ key, origin: 'HISTORICAL_PRE_PHASE3' as const, quality: { label: 'FAIR' } as never, attempts: [] });

describe('Strategy V2 replay over recorded releases', () => {
  for (const [name, path] of Object.entries(ARCHIVES)) it(`${name}: authorizes within limits, fans out, never contradicts UNKNOWN, and is labelled counterfactual`, () => {
    const log = readObserverLog(path)!;
    expect(log).toBeDefined();
    const result = replayStrategyV2(log, record(name), { preset: 'BALANCED', fanOutWidth: 2 });
    expect(result.counterfactual).toBe(true);
    expect(result.label).toBe(COUNTERFACTUAL_LABEL);
    expect(result.authorizedCandidates).toBeLessThanOrEqual(21);
    expect(result.immediateTargets).toBe(4);
    expect(result.immediateSends).toBe(8);
    // Immediate targets were chosen from pre-release evidence without a known public booking.
    const known = scheduleFromObserverLog(log).schedule!;
    for (const window of result.suggestion.immediate) {
      const [court, range] = window.slice(1).split(' '), [start, end] = range!.split('-');
      for (let hour = Number(start!.slice(0, 2)); hour < (end === '24:00' ? 24 : Number(end!.slice(0, 2))); hour++)
        expect(known.hours.get(`${court}/${String(hour).padStart(2, '0')}:00`), `${name} ${window}`).not.toBe('KNOWN_PUBLIC_BOOKING_CONFLICT');
    }
    // UNKNOWN on the immediate attempts blocks every later send.
    expect(result.unknownBlocksLaterSends).toBe(true);
    // Rescue selections only follow a fresh reopening: each one is at an actionable read.
    for (const rescue of result.rescue) expect(rescue.atResponseOffsetMs).toBeGreaterThan(0);
    expect(strategyReplayText(result).replace(COUNTERFACTUAL_LABEL, '')).not.toMatch(/would have (won|succeeded|booked)/i);
  });

  it('Sep 28: Rescue would have been allowed to act on the +10 min reopening, in bounded-cache evidence', () => {
    const result = replayStrategyV2(readObserverLog(ARCHIVES['Sep 28 (target 09-30)'])!, record('09-28'), { preset: 'BALANCED', fanOutWidth: 2 });
    expect(result.rescue.some(value => value.atResponseOffsetMs > 590_000 && value.atResponseOffsetMs < 620_000)).toBe(true);
    expect(result.rejectedScenario.fitness.ACTIONABLE_BOUNDED_CACHE).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const log = readObserverLog(ARCHIVES['Sep 26 (target 09-28)'])!;
    expect(replayStrategyV2(log, record('a'), { fanOutWidth: 2 })).toEqual(replayStrategyV2(log, record('a'), { fanOutWidth: 2 }));
  });
});

describe('observer log versions', () => {
  const directories: string[] = [];
  afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
  it('reads version-3 Slot Watch logs (written since 2026-09-29), not only version 2', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'observer-')); directories.push(directory);
    const path = join(directory, 'watch.ndjson');
    await writeFile(path, [JSON.stringify({ type: 'header', version: 3, id: 'x', date: '2026-10-01', releaseMs: 1790640000000, schedule: { availability: [0, 250], maxInFlight: 6 } }),
      JSON.stringify({ type: 'availability', seq: 1, scheduledOffsetMs: 0, requestOffsetMs: 1, responseOffsetMs: 900, outcome: 'ok', targetDatePresent: true, matrix: '7:OOOOOOOOOOOOOOOO' }),
      JSON.stringify({ type: 'bookings', seq: 1, scheduledOffsetMs: -60000, requestOffsetMs: -59990, responseOffsetMs: -59800, outcome: 'ok', failedCourts: [], cells: ['7/23:00'] })].join('\n'));
    const log = readObserverLog(path)!;
    expect(log).toMatchObject({ version: 3, releaseMs: 1790640000000, date: '2026-10-01', bookingsItemized: true });
    expect(log.availability).toHaveLength(1);
    expect(scheduleFromObserverLog(log).schedule!.hours.get('7/23:00')).toBe('KNOWN_PUBLIC_BOOKING_CONFLICT');
  });
});
