import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableSubmissionJournal } from '../../src/api-booking/durable-submission-journal.js';

describe('durable submission journal', () => {
  it('blocks concurrent callers and restart replay without storing sensitive material', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'onda-submission-'));
    try {
      const first = new DurableSubmissionJournal(directory);
      const second = new DurableSubmissionJournal(directory);
      const key = DurableSubmissionJournal.key('facility', 'court', '2026-09-18', '08:00', '10:00');
      const outcomes = await Promise.allSettled([first.begin(key), second.begin(key)]);
      expect(outcomes.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
      await expect(new DurableSubmissionJournal(directory).begin(key)).rejects.toThrow('DUPLICATE_LOGICAL_BOOKING_BLOCKED');
      await first.mark(key, 'unknown');
      await expect(second.begin(key)).rejects.toThrow('DUPLICATE_LOGICAL_BOOKING_BLOCKED');
      const record = await readFile(join(directory, `${key}.json`), 'utf8');
      expect(record).not.toMatch(/proof|token|customer|email|cookie/i);
      expect(JSON.parse(record)).toMatchObject({ key, state: 'unknown' });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
