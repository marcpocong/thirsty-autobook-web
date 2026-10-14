import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableSubmissionJournal } from '../src/api-booking/durable-submission-journal.js';
import { archiveHistoricalUnknown, journalOverview, readArchiveIndex, restoreArchived, scanJournals, verifyArchive } from '../src/journal-archive.js';
// @ts-expect-error plain ESM installation helper
import { inspectUpdateSafety } from '../scripts/app-installation.mjs';

const NOW = Date.parse('2026-10-14T13:00:00Z'), OLD = new Date('2026-09-30T00:00:00Z');
const key = (n: number) => n.toString(16).padStart(64, 'a');
async function journal(root: string, k: string, state: 'unknown' | 'verified' | 'armed', at: Date, extra: { holdExpiresAt?: string } = {}) {
  const directory = join(root, '.local/api-booking/api-first-journals', k), j = new DurableSubmissionJournal(directory);
  const attempt = { attemptId: k, planFingerprint: k, targetDate: '2026-10-01', courtIds: [7], hourlyBoundaries: [], expectedBookingCount: 1, maximumAmount: 700 };
  if (state === 'armed') await j.arm(k, at, { ...attempt, stage: 'armed', releaseMs: at.getTime() + 60_000, dispatchDeadlineMs: at.getTime() + 61_000 });
  else { await j.begin(k, at, { ...attempt, stage: 'dispatching' });
    if (state === 'unknown') await j.mark(k, 'unknown', at, undefined, undefined, 'SUBMISSION_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED');
    else await j.mark(k, 'verified', at, undefined, { success: true, bookingIds: ['b'], bookingNumbers: ['n'], bookingSessionIds: ['s'], holdExpiresAt: [extra.holdExpiresAt!], validationCode: 'OK' }); }
  await utimes(join(directory, `${k}.json`), at, at);
  return join(directory, `${k}.json`);
}

describe('historical UNKNOWN archival', () => {
  it('archives only eligible historical records, keeps the original bytes and the duplicate guard, and can verify and restore', async () => {
    const root = await mkdtemp(join(tmpdir(), 'journal-archive-'));
    const oldUnknown = await journal(root, key(1), 'unknown', OLD);
    const recentUnknown = await journal(root, key(2), 'unknown', new Date(NOW - 60_000));
    await journal(root, key(3), 'verified', OLD, { holdExpiresAt: new Date(NOW + 300_000).toISOString() });
    const before = await readFile(oldUnknown);
    const scan = await scanJournals(root, NOW);
    expect(scan.find(r => r.key === key(1))).toMatchObject({ state: 'unknown', eligible: true });
    expect(scan.find(r => r.key === key(2))).toMatchObject({ eligible: false, reason: 'UNKNOWN_RECORD_RECENT' });
    // Same historical rule as the installer.
    const safety = await inspectUpdateSafety(root, { processes: [], now: NOW });
    expect(safety.historicalUnknown.map((r: { key: string }) => r.key)).toEqual([key(1)]);

    const result = await archiveHistoricalUnknown(root, [key(1), key(2), key(3), key(9)], 'owner-approved archival', NOW);
    expect(result.archived.map(e => e.key)).toEqual([key(1)]);
    expect(result.refused).toEqual([{ key: key(2), reason: 'UNKNOWN_RECORD_RECENT' }, { key: key(3), reason: 'STATE_VERIFIED' }, { key: key(9), reason: 'NOT_FOUND' }]);
    expect(await readFile(oldUnknown)).toEqual(before);
    const guard = new DurableSubmissionJournal(join(root, '.local/api-booking/api-first-journals', key(1)));
    await expect(guard.begin(key(1))).rejects.toThrow('DUPLICATE_LOGICAL_BOOKING_BLOCKED');
    expect(await guard.peekDisposition(key(1))).toBe('blocked');
    expect((await guard.read(key(1))).state).toBe('unknown');

    const overview = await journalOverview(root, NOW);
    expect(overview.activeUnknown.map(r => r.key)).toEqual([key(2)]);
    expect(overview.archived.map(e => e.key)).toEqual([key(1)]);
    expect(await verifyArchive(root)).toEqual([{ key: key(1), path: expect.stringContaining(key(1)), status: 'MATCH' }]);
    // The installer still sees the same evidence; the archive lives outside the lifecycle stores.
    const after = await inspectUpdateSafety(root, { processes: [], now: NOW });
    expect(after.historicalUnknown).toEqual(safety.historicalUnknown);

    await writeFile(oldUnknown, before.toString().replace('"unknown"', '"unknown" '));
    expect((await verifyArchive(root))[0]!.status).toBe('CHANGED');
    await writeFile(oldUnknown, before);
    expect((await restoreArchived(root, [key(1)], 'review again')).restored).toEqual([key(1)]);
    expect((await readArchiveIndex(root)).entries).toEqual([]);
    const auditLog = (await readFile(join(root, '.local/journal-archive/audit.ndjson'), 'utf8')).trim().split('\n').map(line => JSON.parse(line).action);
    expect(auditLog).toEqual(['ARCHIVE', 'VERIFY', 'VERIFY', 'RESTORE']);
  });
  it('never archives armed records or records with an unexpired hold', async () => {
    const root = await mkdtemp(join(tmpdir(), 'journal-archive-'));
    await journal(root, key(4), 'armed', OLD);
    const result = await archiveHistoricalUnknown(root, [key(4)], 'x', NOW);
    expect(result.archived).toEqual([]); expect(result.refused[0]!.reason).toBe('STATE_ARMED');
  });
});
