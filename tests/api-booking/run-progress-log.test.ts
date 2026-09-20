import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep, join } from 'node:path';
import { expect, it } from 'vitest';
import { ApiRunProgressLog } from '../../src/api-booking/run-progress-log.js';

it('records ordered wall times and stage durations for a dry API run', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'thirsty-run-progress-'));
  try {
    const log = new ApiRunProgressLog('dry', '2026-09-21', directory);
    log.record('RUN_STARTED', '2026-09-21T01:00:00.000Z', 3);
    log.record('FETCHING_AVAILABILITY', '2026-09-21T01:00:00.230Z', 233);
    log.record('DRY_RUN_COMPLETE', '2026-09-21T01:00:00.500Z', 503, { court: 7 });
    log.close();
    const entries = (await readFile(log.path, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(entries.map(entry => [entry.stage, entry.elapsedMs, entry.sincePreviousMs])).toEqual([
      ['RUN_STARTED', 3, 3], ['FETCHING_AVAILABILITY', 233, 230], ['DRY_RUN_COMPLETE', 503, 270],
    ]);
    expect(entries[2]).toMatchObject({ mode: 'dry', targetDate: '2026-09-21', court: 7, runId: log.runId });
  } finally {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw Error('TEST_CLEANUP_PATH_INVALID');
    await rm(directory, { recursive: true, force: true });
  }
});
