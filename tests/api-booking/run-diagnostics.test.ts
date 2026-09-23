import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AvailabilitySnapshot } from '../../src/api-booking/types.js';
import { ApiRunProgressLog } from '../../src/api-booking/run-progress-log.js';
import { RunDiagnostics, availabilityObservation, sanitizeDiagnosticExtra } from '../../src/api-booking/run-diagnostics.js';
import { parseAvailability } from '../../src/api-booking/availability-parser.js';
import { availabilityFixture } from '../availability-fixture.js';

const date = '2026-09-25';
const baseSnapshot = (returned: boolean): AvailabilitySnapshot => ({ capturedAt: '2026-09-25T00:00:00.000Z',
  fixtureKind: 'live', label: 'offline', requestedDates: [date], returnedDates: { [date]: returned },
  incompleteDates: returned ? [] : [date], slots: [] });

describe('API run diagnostics', () => {
  it('records the exact 112-cell matrix, distinguishing unreleased, taken and unknown cells', () => {
    const unreleased = availabilityObservation(baseSnapshot(false), date);
    expect(unreleased).toMatchObject({ targetDatePresent: false, responseComplete: false, availableCount: 0, unreleasedCount: 112 });
    expect(unreleased.courtHourSummary).toBe([1, 2, 3, 4, 5, 6, 7].map(court => `${court}:${'U'.repeat(16)}`).join(','));
    const partial = baseSnapshot(true);
    partial.slots = Array.from({ length: 6 }, (_, index) => ({ court: 6, spaceId: 'space-6', date,
      bookingDate: date, startTime: `${17 + index}:00`, endTime: `${18 + index}:00`, isAvailable: index % 2 === 0,
      isNightRate: true, isNextDay: false, currency: 'PHP', price: 700 }));
    const observed = availabilityObservation(partial, date);
    expect(observed).toMatchObject({ targetDatePresent: true, responseComplete: true, availableCount: 3, takenCount: 3, unknownCount: 106 });
    // Court 6, 08:00→23:00: nine unpublished hours, then 17:00 open, 18:00 taken, … , then 23:00 unpublished.
    expect(observed.courtHourSummary).toContain(`6:${'?'.repeat(9)}OXOXOX?`);
  });

  it('keeps the whole-day matrix within the diagnostic string limit for a real snapshot', () => {
    const capturedAt = '2026-09-25T00:00:00.000Z';
    const snapshot = parseAvailability(availabilityFixture(date), { startDate: date, endDate: date, capturedAt,
      fixtureKind: 'synthetic', label: 'offline', now: new Date(capturedAt), maximumAgeMs: 1000 });
    const observed = availabilityObservation(snapshot, date);
    expect(sanitizeDiagnosticExtra(observed)).toEqual(observed);
    expect(String(observed.courtHourSummary).split(',')).toHaveLength(7);
  });

  it('correlates lane, worker, attempt type and monotonic duration and summarizes an aborted partial run', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'thirsty-run-diagnostics-'));
    try {
      let mono = 100;
      const wall = new Date('2026-09-25T23:50:00.000Z');
      const log = new ApiRunProgressLog('live', date, directory);
      const diagnostics = new RunDiagnostics(log, mono, () => wall, () => mono);
      const correlation = { workerId: 'A' as const, lane: 'core' as const,
        attemptType: 'official' as const, attemptId: diagnostics.nextAttemptId('core', 'A', 'official') };
      diagnostics.observe('DIAGNOSTIC_ATTEMPT_STARTED', correlation);
      const finish = diagnostics.begin('slotCheck', 'SLOT_CHECK_STARTED', correlation);
      mono += 37;
      finish('SLOT_CHECK_COMPLETED', { resultCategory: 'SUCCESS', success: true });
      diagnostics.observe('DIAGNOSTIC_VERIFIED_HOLD', correlation);
      diagnostics.finish('USER_ABORT', true);
      await log.close();
      const entries = (await readFile(log.path, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      expect(entries.find(entry => entry.stage === 'SLOT_CHECK_COMPLETED')).toMatchObject({ workerId: 'A', lane: 'core',
        attemptType: 'official', attemptId: correlation.attemptId, durationMs: 37, timingKind: 'MEASURED_DURATION' });
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
