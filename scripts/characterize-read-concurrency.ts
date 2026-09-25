/**
 * Read-only concurrency characterization (src/arbitration/read-concurrency.ts): 1/2/4/7 simultaneous public
 * availability reads, rounds ≥ 5 s apart, balanced random order, sanitized headers only.
 *
 * DEFAULT = OFFLINE SELF-TEST against two local servers (one parallel, one serializing per client), proving the
 * analysis tells them apart. Nothing leaves this machine.
 *
 * LIVE (operator only, never automated): the booking page's own public read, no credentials, no cookies, refused
 * between 07:45 and 08:45 Manila, stops at the first 403/429/5xx/mitigation/non-JSON/slow read, ≤ 120 requests.
 * Run it from the machine you normally book from; to compare locations (e.g. Cebu vs Singapore) run the same
 * command on each host at the same off-peak hour and compare the JSON files — see SERVER_ARBITRATION_INVESTIGATION.md.
 * If the provider's normal security flow rejects a host, the harness stops; do not work around it.
 *
 *   npx tsx scripts/characterize-read-concurrency.ts                         # offline self-test
 *   npx tsx scripts/characterize-read-concurrency.ts --live READ_ONLY_PUBLIC_AVAILABILITY --dates 2026-10-01,2026-10-02 [--rounds 4] [--label cebu]
 */
import { createServer, type Server } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { THIRSTY_PICKLE_FACILITY_ID } from '../src/api-booking/live-availability-provider.js';
import { analyzeRounds, assertOutsideBlackout, DEFAULT_HARNESS_LIMITS, HarnessStop, LIVE_ACKNOWLEDGEMENT, roundPlan, runRound, SAFE_LEVELS,
  type ReadSample } from '../src/arbitration/read-concurrency.js';

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index]!.replace(/^--/, ''), process.argv[index + 1] ?? '');
const rounds = Number(args.get('rounds') ?? 4);
const levels = (args.get('levels') ?? SAFE_LEVELS.join(',')).split(',').map(Number);
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

async function session(urlFor: (date: string) => string, dates: string[], gapMs: number, live: boolean) {
  const samples: ReadSample[] = [];
  const plan = roundPlan(levels, rounds, Date.now() & 0xffff);
  let stopped: string | null = null;
  for (const [round, level] of plan.entries()) {
    if (live) assertOutsideBlackout(Date.now());
    try { samples.push(...await runRound(level, round, { urlFor, dates, fetcher: fetch })); }
    catch (error) { stopped = error instanceof HarnessStop ? error.code : 'HARNESS_STOP_UNEXPECTED'; break; }
    if (round < plan.length - 1) await sleep(gapMs);
  }
  return { plan, samples, stopped, analysis: analyzeRounds(samples) };
}

/** Local stand-in: answers JSON after `serviceMs`, either in parallel or strictly one request at a time. */
function localServer(mode: 'parallel' | 'serial', serviceMs: number): Promise<{ server: Server; port: number }> {
  let busyUntil = 0;
  const server = createServer((_request, response) => {
    const now = performance.now(), start = mode === 'serial' ? Math.max(now, busyUntil) : now;
    if (mode === 'serial') busyUntil = start + serviceMs;
    setTimeout(() => { response.writeHead(200, { 'content-type': 'application/json', 'x-vercel-cache': 'MISS' }); response.end('{"success":true,"data":{}}'); },
      start + serviceMs - now);
  });
  return new Promise(done => server.listen(0, '127.0.0.1', () => done({ server, port: (server.address() as { port: number }).port })));
}

if (args.get('live') !== undefined) {
  if (args.get('live') !== LIVE_ACKNOWLEDGEMENT) throw Error('HARNESS_LIVE_ACKNOWLEDGEMENT_REQUIRED');
  const dates = (args.get('dates') ?? '').split(',').filter(Boolean);
  if (!dates.length || dates.some(date => !/^\d{4}-\d{2}-\d{2}$/.test(date))) throw Error('HARNESS_DATES_REQUIRED');
  assertOutsideBlackout(Date.now());
  const urlFor = (date: string) => `https://app.onda.fit/api/public/facilities/${THIRSTY_PICKLE_FACILITY_ID}/date-availability?${new URLSearchParams(
    { startDate: date, endDate: date, duration: '60', includeSchedule: 'true' })}`;
  const result = await session(urlFor, dates, DEFAULT_HARNESS_LIMITS.minRoundGapMs, true);
  const directory = resolve('.local/arbitration');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, `read-concurrency-${args.get('label') ?? 'host'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  // Timing, status, cache, region and allowlisted headers only: no bodies, no cookies, no identities.
  await writeFile(file, `${JSON.stringify({ schema: 'read-concurrency/v1', label: args.get('label') ?? 'host', startedAt: new Date().toISOString(), levels, rounds,
    stopped: result.stopped, analysis: result.analysis, samples: result.samples }, null, 1)}\n`, { mode: 0o600, flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ stopped: result.stopped, analysis: result.analysis.map(value => ({ level: value.level, latencyP50: value.latencyMs.p50,
    spanP50: value.completionSpanMs.p50, serializationIndex: value.serializationIndex, cache: value.cache, regions: value.regions })) }, null, 1)}\n${file}\n`);
} else {
  const results: Record<string, unknown> = {};
  for (const mode of ['parallel', 'serial'] as const) {
    const { server, port } = await localServer(mode, 80);
    try {
      const result = await session(() => `http://127.0.0.1:${port}/date-availability`, ['2026-10-01'], 50, false);
      results[mode] = result.analysis.map(value => ({ level: value.level, spanP50: value.completionSpanMs.p50, serializationIndex: value.serializationIndex, stopped: result.stopped }));
    } finally { server.close(); }
  }
  process.stdout.write(`${JSON.stringify({ selfTest: 'offline (two local servers, 80 ms service)', results }, null, 1)}\n`);
}
