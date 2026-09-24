import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { rebuildReleaseIntelligence, readReleaseIntelligence } from '../src/release-intelligence.js';
import { replayAll } from '../src/strategy-replay.js';
import { adviseFromHistory } from '../src/release-advisor.js';

/**
 * Benchmark helper only: a continuous Phase 4 workload (intelligence rebuild, replay and advisor over eight
 * full-size synthetic releases) in its own process, like the desktop main process. Used by
 * `bench:release --phase4 on` as a pessimistic load; production pauses Phase 4 around a release.
 * Prints the completed iteration count when stopped.
 */
const root = resolve(process.argv[2] ?? '.');
const hours = Array.from({ length: 16 }, (_, index) => `${String(index + 8).padStart(2, '0')}:00`);
const folder = join(root, '.local', 'slot-watch'); mkdirSync(folder, { recursive: true });
for (let release = 0; release < 8; release++) {
  const releaseMs = Date.parse('2026-10-01T00:00:00Z') + release * 7 * 86_400_000, date = new Date(releaseMs + 2 * 86_400_000).toISOString().slice(0, 10);
  const reads = Array.from({ length: 150 }, (_, seq) => { const request = seq < 6 ? [0, 250, 500, 1000, 2000, 5000][seq]! : 5000 + (seq - 5) * 1000;
    const rows = Array.from({ length: 7 }, (_, court) => `${court + 1}:${hours.map((_, hour) => (court * 16 + hour + seq + release) % 5 === 0 ? 'X' : 'O').join('')}`).join(',');
    return { type: 'availability', seq: seq + 1, scheduledOffsetMs: request, requestOffsetMs: request, responseOffsetMs: request + 900, outcome: 'ok', targetDatePresent: true, matrix: rows,
      prices: Array.from({ length: 7 }, () => hours.map(hour => Number(hour.slice(0, 2)) >= 16 ? 700 : 600)), cache: { status: 'MISS' } }; });
  writeFileSync(join(folder, `${date}_load.ndjson`), [{ type: 'header', version: 2, date, releaseMs, schedule: { availability: [0], maxInFlight: 6 } }, ...reads].map(line => JSON.stringify(line)).join('\n') + '\n');
}
const rate = { source: 'operator confirmed', capturedAt: '2026-09-30T00:00:00.000Z', status: 'OPERATOR_CONFIRMED' as const, date: '2026-10-03', perHour: [700, 700, 700], actionable: true };
const plan = { candidates: [7, 6, 5, 4, 3, 2, 1].map((court, index) => ({ court, start: '19:00', durationHours: 3, priority: index + 1,
  permissions: { wave1: index < 4, wave2: index >= 4, rescue: true }, rateEvidence: rate })),
  wave1: (['A', 'B', 'C', 'D'] as const).map((workerId, candidateIndex) => ({ workerId, candidateIndex })), standby: ['E', 'F', 'G'] as Array<'E' | 'F' | 'G'>,
  budgets: { wave2: 3, rescue: 1, total: 8 }, concurrentWave2: true, rescueEnabled: true };
let iterations = 0, stopping = false;
process.on('SIGTERM', () => { stopping = true; }); process.on('SIGINT', () => { stopping = true; });
process.stdin.on('data', () => { stopping = true; });
while (!stopping) {
  rebuildReleaseIntelligence(root, { now: () => Date.parse('2027-01-01T00:00:00Z') });
  const records = readReleaseIntelligence(root)!.records;
  replayAll(root, plan, records);
  adviseFromHistory({ targetDate: '2026-10-03', courts: [1, 2, 3, 4, 5, 6, 7], earliestStart: '17:00', latestStart: '20:00', durationHours: 3, immediate: 4, backups: 3 }, records);
  iterations++;
  await new Promise(done => setImmediate(done));
}
process.stdout.write(`${JSON.stringify({ iterations })}\n`);
