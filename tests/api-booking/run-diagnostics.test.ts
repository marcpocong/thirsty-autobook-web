import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AvailabilitySnapshot } from '../../src/api-booking/types.js';
import { ApiRunProgressLog } from '../../src/api-booking/run-progress-log.js';
import { RunDiagnostics, sanitizeDiagnosticExtra, specialAvailabilityObservation } from '../../src/api-booking/run-diagnostics.js';
import { parseAvailability } from '../../src/api-booking/availability-parser.js';
import { availabilityFixture } from '../availability-fixture.js';

const date = '2026-09-25';
const baseSnapshot = (returned: boolean): AvailabilitySnapshot => ({ capturedAt: '2026-09-25T00:00:00.000Z',
  fixtureKind: 'live', label: 'offline', requestedDates: [date], returnedDates: { [date]: returned },
  incompleteDates: returned ? [] : [date], slots: [] });

describe('Special Friday run diagnostics', () => {
  it('distinguishes a missing target date from a returned date whose required hours are unavailable', () => {
    const missing = specialAvailabilityObservation(baseSnapshot(false), date);
    const unavailableSnapshot = baseSnapshot(true);
    unavailableSnapshot.slots = Array.from({ length: 6 }, (_, index) => ({ court: 6, spaceId: 'space-6', date,
      bookingDate: date, startTime: `${17 + index}:00`, endTime: `${18 + index}:00`, isAvailable: false,
      isNightRate: true, isNextDay: false, currency: 'PHP', price: 700 }));
    const unavailable = specialAvailabilityObservation(unavailableSnapshot, date);
    expect(missing).toMatchObject({ targetDatePresent: false, responseComplete: false, coreFeasible: false });
    expect(unavailable).toMatchObject({ targetDatePresent: true, responseComplete: true, coreFeasible: false });
    expect(missing.courtHourSummary).toContain('6:------');
    expect(unavailable.courtHourSummary).toContain('6:000000');
  });

  it('reports exact A-D, E/F, and G/H plan feasibility from one complete snapshot', () => {
    const capturedAt = '2026-09-25T00:00:00.000Z';
    const snapshot = parseAvailability(availabilityFixture(date), { startDate: date, endDate: date, capturedAt,
      fixtureKind: 'synthetic', label: 'offline', now: new Date(capturedAt), maximumAgeMs: 1000 });
    expect(specialAvailabilityObservation(snapshot, date,
      { directCourt: 5, coreAssignment: { earlyCourt: 6, lateCourt: 7 }, bonusCourt: 4 }))
      .toMatchObject({ coreFeasible: true, corePlanExact: true, adaptiveFeasible: true, adaptivePlanExact: true,
        bonusFeasible: true, bonusPlanExact: true });
  });

  it('correlates lane, worker, attempt type and monotonic duration and summarizes an aborted partial run', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'thirsty-run-diagnostics-'));
    try {
      let mono = 100;
      const wall = new Date('2026-09-25T23:50:00.000Z');
      const log = new ApiRunProgressLog('live', date, directory);
      const diagnostics = new RunDiagnostics(log, mono, () => wall, () => mono);
      const correlation = { workerId: 'A' as const, lane: 'core' as const,
        attemptType: 'early' as const, attemptId: diagnostics.nextAttemptId('core', 'A', 'early') };
      diagnostics.observe('DIAGNOSTIC_ATTEMPT_STARTED', correlation);
      const finish = diagnostics.begin('slotCheck', 'SLOT_CHECK_STARTED', correlation);
      mono += 37;
      finish('SLOT_CHECK_COMPLETED', { resultCategory: 'SUCCESS', success: true });
      diagnostics.observe('DIAGNOSTIC_VERIFIED_HOLD', correlation);
      diagnostics.finish('USER_ABORT', true);
      await log.close();
      const entries = (await readFile(log.path, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      expect(entries.find(entry => entry.stage === 'SLOT_CHECK_COMPLETED')).toMatchObject({ workerId: 'A', lane: 'core',
        attemptType: 'early', attemptId: correlation.attemptId, durationMs: 37, timingKind: 'MEASURED_DURATION' });
      expect(entries.find(entry => entry.stage === 'RUN_DIAGNOSTIC_SUMMARY')).toMatchObject({ finalCode: 'USER_ABORT',
        aborted: true, verifiedHoldCount: 1, qrHandoffCount: 0, partialHolds: true });
    } finally {
      if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw Error('TEST_CLEANUP_PATH_INVALID');
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('drops secrets, raw URLs, unknown fields, and non-finite values', () => {
    expect(sanitizeDiagnosticExtra({ status: 'SUCCESS', durationMs: 12, token: 'secret',
      failureCategory: 'https://app.onda.fit/private?token=secret', rawResponse: '{secret}', price: Number.NaN }))
      .toEqual({ status: 'SUCCESS', durationMs: 12 });
  });
});
