import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deriveReleaseIntelligence } from '../src/release-intelligence.js';
import { readObserverLog } from '../src/release-forensics.js';
import { replayAll, replayPlanFromFixed, replayRelease, type ReplayPlan } from '../src/strategy-replay.js';
import { PrecisionPhase3Schema } from '../src/config.js';

/**
 * Phase 4 replay fixtures (offline, deterministic): recorded-style Slot Watch logs replayed through the
 * production Phase 3 selector. No browser, network, journal, checkout or hold.
 *
 *   npm run phase4:replay                     fixtures only
 *   npm run phase4:replay -- --root ..        also replays the saved plan against real local releases (read only)
 */
const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index]!.replace(/^--/, ''), process.argv[index + 1] ?? '');
const date = '2026-10-03', releaseMs = Date.parse('2026-10-01T00:00:00.000Z');
const hours = Array.from({ length: 16 }, (_, index) => `${String(index + 8).padStart(2, '0')}:00`);
const grid = (seq: number, request: number, response: number, states: Record<string, string> = {}, cache: string | null = 'MISS') => ({ type: 'availability', seq, scheduledOffsetMs: request,
  requestOffsetMs: request, responseOffsetMs: response, outcome: 'ok', targetDatePresent: true,
  matrix: Array.from({ length: 7 }, (_, court) => `${court + 1}:${hours.map(hour => states[`${court + 1}/${hour}`] ?? 'O').join('')}`).join(','),
  prices: Array.from({ length: 7 }, () => hours.map(hour => Number(hour.slice(0, 2)) >= 16 ? 700 : 600)), ...(cache ? { cache: { status: cache } } : {}) });
const rate = { source: 'operator confirmed', capturedAt: '2026-09-30T00:00:00.000Z', status: 'OPERATOR_CONFIRMED' as const, date, perHour: [700, 700, 700], actionable: true };
const plan = (concurrentWave2: boolean): ReplayPlan => ({ candidates: [
  { court: 7, start: '19:00', durationHours: 3, priority: 1, permissions: { wave1: true, wave2: false, rescue: true }, rateEvidence: rate },
  { court: 6, start: '19:00', durationHours: 3, priority: 2, permissions: { wave1: false, wave2: true, rescue: true }, rateEvidence: rate }],
  wave1: [{ workerId: 'A', candidateIndex: 0 }], standby: ['B'], budgets: { wave2: 1, rescue: 1, total: 3 }, concurrentWave2, rescueEnabled: true });
const scratch = mkdtempSync(join(tmpdir(), 'phase4-replay-'));
const run = (name: string, reads: unknown[], replayPlan: ReplayPlan, options: Parameters<typeof replayRelease>[3], check: (result: ReturnType<typeof replayRelease>) => void) => {
  const folder = join(scratch, name, '.local', 'slot-watch'); mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, `${date}_${name}.ndjson`), [{ type: 'header', version: 2, date, releaseMs, schedule: { availability: [0], maxInFlight: 6 } }, ...reads].map(line => JSON.stringify(line)).join('\n') + '\n');
  const record = deriveReleaseIntelligence(join(scratch, name), Date.parse('2026-12-01T00:00:00Z')).records[0]!;
  const result = replayRelease(replayPlan, readObserverLog(join(folder, `${date}_${name}.ndjson`))!, record, options);
  check(result);
  assert.doesNotMatch(JSON.stringify(result), /would have won|\bwon\b|\bwin\b/i);
  process.stdout.write(`PASS ${name}: ${result.statement}\n`);
};
try {
  run('backup-fresh-open', [grid(1, 0, 1200, { '7/19:00': 'X' })], plan(true), {}, result => assert.equal(result.backup?.selections[0]?.court, 6));
  run('backup-waits-for-answers', [grid(1, 0, 1200)], plan(false), { immediateSettledAtMs: 3000 }, result => assert.equal(result.backup?.atResponseOffsetMs, 3000));
  run('reopened-slot', [grid(1, 0, 1000, { '7/19:00': 'X', '6/19:00': 'X' }), grid(2, 4000, 4500)], plan(false), { immediateSettledAtMs: 2000 },
    result => assert.equal(result.rescue[0]?.court, 7));
  run('unknown-hard-stop', [grid(1, 0, 1000, { '7/19:00': 'X', '6/19:00': 'X' }), grid(2, 4000, 4500)], plan(false), { immediateSettledAtMs: 2000, immediateResult: 'UNKNOWN' },
    result => { assert.equal(result.backup, null); assert.deepEqual(result.rescue, []); });
  run('cached-not-actionable', [grid(1, 0, 1200, { '7/19:00': 'X' }, 'HIT')], plan(true), {}, result => { assert.equal(result.backup, null); assert.equal(result.forensicOpenings.length, 1); });
  run('censored-late-first-grid', [grid(1, 11_000, 15_700)], plan(true), {}, result => assert.match(result.censored[0]!, /not observed/));
  run('fixed-plan', [grid(1, 0, 1200)], replayPlanFromFixed([{ court: 7, start: '19:00', durationHours: 3 }]), {}, result => assert.equal(result.immediate[0]?.firstPublished, 'FULLY_OPEN'));
} finally { rmSync(scratch, { recursive: true, force: true }); }

if (args.has('root')) {
  const root = resolve(args.get('root')!);
  const config = JSON.parse(readFileSync(join(root, 'config.local.json'), 'utf8')) as { RELEASE_STRATEGY?: string; PRECISION_TARGETS?: Array<{ court: number; start: string; durationHours: number }>; PRECISION_PHASE3?: unknown };
  const saved: ReplayPlan = config.PRECISION_PHASE3 ? PrecisionPhase3Schema.parse(config.PRECISION_PHASE3) as ReplayPlan : replayPlanFromFixed(config.PRECISION_TARGETS ?? []);
  const { results, skipped } = replayAll(root, saved, deriveReleaseIntelligence(root).records);
  process.stdout.write(`\nSaved plan (${config.PRECISION_PHASE3 ? 'Smart backups' : 'Fixed attempts'}) against local releases:\n`);
  for (const result of results) process.stdout.write(`${result.targetDate} (${result.origin}, quality ${result.quality}): ${result.statement}\n${[...result.immediate.map(value =>
    `  immediate Court ${value.court} ${value.startTime}-${value.endTime}: ${value.firstPublished}${value.firstPublishedRead ? ` (answered +${(value.firstPublishedRead.responseOffsetMs / 1000).toFixed(1)} s)` : ''}`), ...result.censored.map(value => `  ${value}`)].join('\n')}\n`);
  for (const value of skipped) process.stdout.write(`${value.releaseKey.split('@')[0]}: not replayed (${value.reason})\n`);
}
