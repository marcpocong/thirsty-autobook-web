import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeRounds, assertOutsideBlackout, HarnessStop, manilaMinuteOfDay, roundPlan, runRound, type Fetcher, type ReadSample } from '../../src/arbitration/read-concurrency.js';

const manila = (hhmm: string) => Date.parse(`2026-09-26T${hhmm}:00.000+08:00`);
const json = (headers: Record<string, string> = {}, status = 200, body = '{"success":true}') =>
  new Response(body, { status, headers: { 'content-type': 'application/json', ...headers } });

describe('read concurrency harness safety', () => {
  it('refuses the release window (07:45–08:45 Manila) and allows the rest of the day', () => {
    expect(manilaMinuteOfDay(manila('08:00'))).toBe(480);
    for (const time of ['07:45', '08:00', '08:44']) expect(() => assertOutsideBlackout(manila(time))).toThrow('HARNESS_RELEASE_WINDOW_BLACKOUT');
    for (const time of ['07:44', '08:45', '14:00', '00:00']) expect(() => assertOutsideBlackout(manila(time))).not.toThrow();
  });

  it('plans balanced, shuffled rounds under the request cap and only safe levels', () => {
    const plan = roundPlan([1, 2, 4, 7], 4, 42);
    expect(plan).toEqual(roundPlan([1, 2, 4, 7], 4, 42));
    expect([1, 2, 4, 7].map(level => plan.filter(value => value === level).length)).toEqual([4, 4, 4, 4]);
    expect(plan.reduce((sum, level) => sum + level, 0)).toBe(56);
    expect(() => roundPlan([7], 20, 1)).toThrow('HARNESS_REQUEST_CAP');
    expect(() => roundPlan([3], 1, 1)).toThrow('HARNESS_PLAN_INVALID');
    expect(() => roundPlan([8], 1, 1)).toThrow('HARNESS_PLAN_INVALID');
  });

  it('stops at the first protective signal and keeps only allowlisted headers', async () => {
    const options = (fetcher: Fetcher) => ({ urlFor: (date: string) => `http://offline.invalid/${date}`, dates: ['2026-10-01'], fetcher });
    await expect(runRound(2, 0, options(async () => json({}, 429)))).rejects.toMatchObject({ code: 'HARNESS_STOP_HTTP_429', samples: [
      { status: 429, startEpochMs: expect.any(Number) }, { status: 429, startEpochMs: expect.any(Number) }] });
    await expect(runRound(1, 0, options(async () => json({}, 403)))).rejects.toMatchObject({ code: 'HARNESS_STOP_HTTP_403' });
    await expect(runRound(1, 0, options(async () => json({}, 503)))).rejects.toMatchObject({ code: 'HARNESS_STOP_HTTP_503' });
    await expect(runRound(1, 0, options(async () => new Response('<html>challenge</html>', { headers: { 'content-type': 'text/html' } }))))
      .rejects.toMatchObject({ code: 'HARNESS_STOP_NOT_JSON' });
    await expect(runRound(1, 0, options(async () => json({ 'cf-mitigated': 'challenge' })))).rejects.toMatchObject({ code: 'HARNESS_STOP_MITIGATED' });
    await expect(runRound(1, 0, options(async () => { throw new TypeError('fetch failed'); }))).rejects.toBeInstanceOf(HarnessStop);
    let clock = 0;
    const slow = { ...options(async () => { clock += 11_000; return json(); }), perf: () => clock };
    await expect(runRound(1, 0, slow)).rejects.toMatchObject({ code: 'HARNESS_STOP_SLOW_READ' });
    const [sample] = await runRound(1, 0, options(async () => json({ 'set-cookie': 'session=secret', 'x-vercel-cache': 'MISS',
      'x-vercel-id': 'sin1::sin1::abcde-1790294400030-a73f748bcd1f' })));
    expect(sample!.headers).toEqual({ 'content-type': 'application/json', 'x-vercel-cache': 'MISS', 'x-vercel-id': 'sin1::sin1::abcde-1790294400030-a73f748bcd1f' });
    expect(sample!).toMatchObject({ cache: 'MISS', edgeRegion: 'sin1', functionRegion: 'sin1', embeddedMs: 1_790_294_400_030 });
    expect(Math.abs(sample!.startEpochMs - Date.now())).toBeLessThan(1_000);
  });
});

describe('read concurrency analysis (local servers, offline)', () => {
  let server: Server | undefined;
  afterEach(() => { server?.close(); server = undefined; });
  const serve = (mode: 'parallel' | 'serial', serviceMs: number) => new Promise<number>(done => {
    let busyUntil = 0;
    server = createServer((_request, response) => {
      const now = performance.now(), start = mode === 'serial' ? Math.max(now, busyUntil) : now;
      if (mode === 'serial') busyUntil = start + serviceMs;
      setTimeout(() => { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{}'); }, start + serviceMs - now);
    });
    server.listen(0, '127.0.0.1', () => done((server!.address() as { port: number }).port));
  });
  const measure = async (mode: 'parallel' | 'serial') => {
    const port = await serve(mode, 60), samples: ReadSample[] = [];
    for (const [round, level] of [1, 4, 1, 4, 1, 4].entries())
      samples.push(...await runRound(level, round, { urlFor: () => `http://127.0.0.1:${port}/`, dates: ['2026-10-01'], fetcher: fetch }));
    return analyzeRounds(samples).find(value => value.level === 4)!;
  };

  it('tells a serializing provider from a parallel one', async () => {
    const parallel = await measure('parallel');
    server?.close();
    const serial = await measure('serial');
    expect(parallel.serializationIndex!).toBeLessThan(0.35);
    expect(serial.serializationIndex!).toBeGreaterThan(0.6);
    expect(serial.completionSpanMs.p50!).toBeGreaterThan(150);
  });
});
