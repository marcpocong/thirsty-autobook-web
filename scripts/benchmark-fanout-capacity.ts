/**
 * Fan-out Capacity Benchmark (offline; it NEVER contacts Onda — see scripts/bench-support.ts).
 *
 * Measures what this machine's real local dispatch path does when W workers each send F child attempts:
 * the actual Node runtime, real installed Chrome over Playwright/CDP, one Chrome process per worker with one tab
 * per child (the production topology), real request serialization and the production Precision code path
 * (freezePrecisionRace → armPrecisionRace → dispatchArmedPrecisionRace, durable journals in a scratch folder).
 * Every checkout is answered locally with a synthetic HTTP 409.
 *
 * Per child it records configured trigger, scheduler wake, worker invocation, transport entry, renderer evaluate
 * entry, fetch() call, Chrome request start (CDP wall stamp), Playwright request event and response; per run the
 * first-to-last spread, prewarm durations, last-ready margin, Node CPU and machine CPU busy share.
 *
 * Usage:
 *   npx tsx scripts/benchmark-fanout-capacity.ts --workers 7 --widths 1,2,3,4 --runs 40 --save-profile
 * Options:
 *   --pattern burst | offsets:-35,-30,-25,-10 | spaced:<ms>   child offsets (default burst: every child at the release instant)
 *   --dispatcher central | coordinator | renderer              (coordinator: experimental per-browser processes; renderer: experimental)
 *   --prewarm-lead <ms> (default 1500)  --prewarm-concurrency <n> (tiered policy, as production fan-out)  --synthetic-prewarm cpu:<ms>,wait:<ms>  --page-busy <ms per 10 ms>
 *   --headed (real windows; background tabs as in production)  --traces (passive CDP provider traces on every tab, as production)
 *   --chrome <path>  --label <text>  --out <dir>
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, platform, release as osRelease, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { busyPercent, cpuSnapshot, findChrome, launchOfflineChrome, startPageBusyWork, syntheticSecurityPreparation, type OfflineChrome } from './bench-support.js';

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index]!.replace(/^--/, ''), next = process.argv[index + 1];
  if (next !== undefined && !next.startsWith('--')) { args.set(key, next); index++; } else args.set(key, 'true');
}
const workerCount = Number(args.get('workers') ?? 7);
const widths = (args.get('widths') ?? '1,2,3,4').split(',').map(Number);
const runs = Number(args.get('runs') ?? 30), warmup = Number(args.get('warmup') ?? 2);
const pattern = args.get('pattern') ?? 'burst';
const dispatcher = (args.get('dispatcher') ?? 'central') as 'central' | 'coordinator' | 'renderer';
const prewarmLeadMs = Number(args.get('prewarm-lead') ?? 1500);
const prewarmConcurrency = args.has('prewarm-concurrency') ? Number(args.get('prewarm-concurrency')) : null;
const syntheticPrewarm = args.get('synthetic-prewarm') ?? 'cpu:0,wait:0';
const pageBusy = args.get('page-busy') ?? '0';
const headed = args.get('headed') === 'true';
const saveProfile = args.get('save-profile') === 'true';
const tracesOn = args.get('traces') === 'true';
const label = args.get('label') ?? `${dispatcher}-${pattern.replace(/[^a-z0-9-]/gi, '')}${headed ? '-headed' : ''}`;
if (!(workerCount >= 1 && workerCount <= 7) || widths.some(width => !(width >= 1 && width <= 4)) || !(runs >= 1) || !['central', 'coordinator', 'renderer'].includes(dispatcher) ||
  !(prewarmLeadMs >= 200 && prewarmLeadMs <= 30_000) || (dispatcher === 'renderer' && prewarmLeadMs < 1300)) throw Error('BENCH_ARGS_INVALID');
const [syntheticCpuMs = 0, syntheticWaitMs = 0] = [/cpu:(\d+)/.exec(syntheticPrewarm)?.[1], /wait:(\d+)/.exec(syntheticPrewarm)?.[1]].map(value => Number(value ?? 0));
const pageBusyMs = Number(pageBusy);

/** Configured Release Offset of child `index` of a `width`-child fan-out (whole ms in [-2000, 0]). */
function childOffset(index: number, width: number): number {
  if (pattern === 'burst') return 0;
  const offsets = /^offsets:(.+)$/.exec(pattern)?.[1]?.split(',').map(Number);
  if (offsets) return offsets[index] ?? offsets.at(-1) ?? 0;
  const spacing = Number(/^spaced:(\d+)$/.exec(pattern)?.[1]);
  if (Number.isFinite(spacing)) return -spacing * (width - 1 - index);
  throw Error('BENCH_PATTERN_INVALID');
}

/** How many children ended with each dispatcher result code ('-' when none). */
function countCodes(records: RunSample[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const child of records.flatMap(record => record.children)) counts[child.code ?? '-'] = (counts[child.code ?? '-'] ?? 0) + 1;
  return counts;
}

const sourceRoot = resolve(import.meta.dirname, '..');
const scratch = resolve(args.get('scratch') ?? join(process.env.TEMP ?? sourceRoot, 'thirsty-fanout-bench'));
const outDir = resolve(args.get('out') ?? join(sourceRoot, '.local/fanout-capacity'));
process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
const moduleUrl = (path: string) => pathToFileURL(join(sourceRoot, path)).href;
await mkdir(scratch, { recursive: true });
process.chdir(scratch);
const { chromium } = await import('playwright');
const { ApiAutomationLock } = await import(moduleUrl('src/api-booking/api-automation-lock.ts')) as typeof import('../src/api-booking/api-automation-lock.js');
const { OndaBrowserSessionTransport } = await import(moduleUrl('src/api-booking/browser-session-transport.ts')) as typeof import('../src/api-booking/browser-session-transport.js');
const race = await import(moduleUrl('src/api-booking/precision-race.ts')) as typeof import('../src/api-booking/precision-race.js');
const armedModule = await import(moduleUrl('src/api-booking/armed-dispatch.ts')) as typeof import('../src/api-booking/armed-dispatch.js');
const clockModule = await import(moduleUrl('src/release-clock.ts')) as typeof import('../src/release-clock.js');
const cp = await import(moduleUrl('src/api-booking/critical-path.ts')) as typeof import('../src/api-booking/critical-path.js');
const rc = await import(moduleUrl('src/api-booking/renderer-clock.ts')) as typeof import('../src/api-booking/renderer-clock.js');
const capacity = await import(moduleUrl('src/fanout-capacity.ts')) as typeof import('../src/fanout-capacity.js');
const coordinatorModule = dispatcher === 'coordinator'
  ? await import(moduleUrl('src/api-booking/dispatch-coordinator.ts')) as typeof import('../src/api-booking/dispatch-coordinator.js') : undefined;
const { ONDA_URL } = await import(moduleUrl('src/config.ts')) as typeof import('../src/config.js');
const traceModule = tracesOn ? await import(moduleUrl('src/api-booking/checkout-provider-trace.ts')) as typeof import('../src/api-booking/checkout-provider-trace.js') : undefined;
type ChildSample = import('../src/fanout-capacity.js').ChildSample;
type RunSample = import('../src/fanout-capacity.js').RunSample;

const customer = { clientId: '00000000-0000-4000-8000-00000000c11e', customerId: '00000000-0000-4000-8000-000000000b00',
  customerEmail: 'offline-bench@example.invalid', customerPhone: '09000000000', customerFirstName: 'Offline', customerLastName: 'Bench' };
const date = '2026-09-26';
const maxWidth = Math.max(...widths);
const sessions: OfflineChrome[] = [];
let coordinatorPool: import('../src/api-booking/dispatch-coordinator.js').CoordinatorPool | undefined;
const chromePath = findChrome(args.get('chrome'), chromium.executablePath());

async function runOnce(width: number, runIndex: number): Promise<RunSample> {
  const runDir = join(scratch, 'runs', `${label}-${width}x-${runIndex}-${Date.now()}`);
  await mkdir(runDir, { recursive: true });
  process.chdir(runDir);
  const targets = race.validatePrecisionTargets(Array.from({ length: workerCount }, (_, index) => ({ court: index + 1, start: '17:00', durationHours: 3 })), date);
  const lock = await ApiAutomationLock.acquire('standard', targets.map(target => target.workerId));
  const trusted = clockModule.TrustedReleaseClock.fromOffset(0, { method: 'bench-system-clock', sampleCount: 0 });
  const releaseMs = Date.now() + prewarmLeadMs + 700 + Math.floor(Math.random() * 50);
  const attempts = targets.flatMap(target => Array.from({ length: width }, (_, child) => {
    const offset = childOffset(child, width);
    const childTarget = { ...target, ...(offset ? { releaseOffsetMs: offset } : {}) };
    return { target: childTarget, plan: race.precisionTargetPlan(childTarget, date) };
  }));
  const frozen = race.freezePrecisionRace(date, releaseMs, attempts);
  const pageOf = (attempt: { target: { workerId: string }; fanOutIndex: number }) =>
    sessions[targets.findIndex(target => target.workerId === attempt.target.workerId)]!.pages[attempt.fanOutIndex]!;
  const recorder = new cp.CriticalPathRecorder(releaseMs, trusted.monotonicDeadline(releaseMs), trusted.offsetMs - trusted.wallDisagreementMs(),
    frozen.attempts.map(attempt => attempt.id));
  const prewarm = new Map<string, { started: number; ended?: number }>();
  // Production attaches a passive DevTools session to every tab before release and enables Network only after that tab's POST.
  const traces = traceModule ? new traceModule.ProviderTraceSet(`bench-${runIndex}`, 'release', releaseMs, () => trusted.nowMs() - releaseMs) : undefined;
  if (traces) { for (const attempt of frozen.attempts) { const page = pageOf(attempt);
    traces.start({ workerId: attempt.id, court: attempt.target.court, startTime: attempt.target.start, endTime: attempt.target.end },
      () => page.context().newCDPSession(page) as unknown as Promise<import('../src/api-booking/checkout-provider-trace.js').CdpSessionLike>); }
    await traces.ready(3_000); }
  const transports = new Map(frozen.attempts.map(attempt => {
    const page = pageOf(attempt);
    const transport = new OndaBrowserSessionTransport(page, syntheticSecurityPreparation(page, syntheticCpuMs, syntheticWaitMs), async () => undefined, {},
      observation => { recorder.observeTransport(attempt.id, observation); if (observation.event === 'CHECKOUT_HTTP_POST_INITIATED') traces?.postInitiated(attempt.id); });
    return [attempt.id, transport] as const;
  }));
  // Renderer mode: each page keeps a registry of keys it already fired (never re-armed). Runs reuse the same pages and keys, so clear it,
  // which is equivalent to fresh pages; production uses new keys for every release.
  if (dispatcher === 'renderer') await Promise.all(sessions.flatMap(session => session.pages).map(page => page.evaluate('delete globalThis.__thirstyRendererDispatch')));
  const armed = await armedModule.armPrecisionRace(frozen, { lock, customerFor: () => customer, journalRoot: resolve('.local/api-booking/api-first-journals'),
    releaseMs, now: () => trusted.nowMs() });
  const firstTrigger = armedModule.firstArmedTrigger(armed);
  let cpuBefore: ReturnType<typeof cpuSnapshot> | undefined, nodeCpuBefore: NodeJS.CpuUsage | undefined;
  const common = {
    clock: trusted, prewarmLeadMs, isAborted: () => false, transportFor: (_worker: string, attempt: { attempt: { id: string } }) => transports.get(attempt.attempt.id)!,
    prewarm: async (attempt: { attempt: { id: string } }) => {
      const entry = { started: performance.now() } as { started: number; ended?: number };
      prewarm.set(attempt.attempt.id, entry);
      cpuBefore ??= cpuSnapshot(); nodeCpuBefore ??= process.cpuUsage();
      await transports.get(attempt.attempt.id)!.prepareCheckoutContext();
      entry.ended = performance.now();
    },
    onWake: () => recorder.mark('*', 'schedulerFired'),
    onMark: (_worker: string, name: string, attempt: { attempt: { id: string } }) => {
      if (name === 'transportCall') recorder.mark(attempt.attempt.id, 'workerInvoked'); else if (name === 'rendererArm') recorder.mark(attempt.attempt.id, 'rendererArmSent');
    },
    afterFire: async () => { await lock.dispatching(); },
    // --prewarm-concurrency N: the production tiered policy (Tier 1 first, one preparation per browser, at most N at once).
    ...(prewarmConcurrency ? { prewarmPolicy: { concurrency: prewarmConcurrency, perGroupConcurrency: 1, tierBarrierTimeoutMs: Infinity } } : {}),
  };
  let results: Array<{ attempt: { id: string }; state: string; code?: string }>;
  if (dispatcher === 'coordinator') {
    results = (await coordinatorModule!.dispatchWithCoordinators(armed, { ...common, pool: coordinatorPool!, recorder,
      securityPreparation: { cpuMs: syntheticCpuMs, waitMs: syntheticWaitMs },
      onPrewarmTiming: timing => { cpuBefore ??= cpuSnapshot(); nodeCpuBefore ??= process.cpuUsage();
        const releaseMono = trusted.monotonicDeadline(releaseMs); prewarm.set(timing.attemptId, { started: releaseMono + timing.startedMs, ...(timing.readyMs !== null ? { ended: releaseMono + timing.readyMs } : {}) }); } })).results;
  } else {
    const outcome = await armedModule.dispatchArmedPrecisionRace(armed, { ...common,
      ...(dispatcher === 'renderer' ? { rendererDispatch: { pageUrl: ONDA_URL, transportFor: (_worker: import('../src/workers.js').WorkerId, attempt: { attempt: { id: string } }) => transports.get(attempt.attempt.id)!,
        calibrate: async (attempt: { attempt: { id: string; target: { workerId: string }; fanOutIndex: number } }) => rc.calibrateRendererClockAdaptive(pageOf(attempt.attempt), { targetUncertaintyMs: 1.5, maxSamples: 32 }) } } : {}) });
    results = outcome.results;
  }
  const busy = cpuBefore ? busyPercent(cpuBefore, cpuSnapshot()) : null;
  if (traces) { traces.enableAll(); await traces.persist(join(runDir, 'forensics')); }
  const nodeCpu = nodeCpuBefore ? process.cpuUsage(nodeCpuBefore) : undefined;
  // Independent post-run calibration of every page clock, after every POST settled.
  for (const attempt of frozen.attempts) {
    try { recorder.calibration(attempt.id, rc.calibrateRendererClock(await rc.sampleRendererClock(pageOf(attempt), 8))); } catch { /* the row keeps Node-side marks */ }
  }
  const rows = new Map(recorder.rows().map(row => [row.workerId, row] as const));
  const toRelease = (mono: number | undefined) => mono === undefined ? null : Math.round((mono - trusted.monotonicDeadline(releaseMs)) * 100) / 100;
  const children: ChildSample[] = frozen.attempts.map(attempt => {
    const row = rows.get(attempt.id), prep = prewarm.get(attempt.id), result = results.find(value => value.attempt.id === attempt.id), state = result?.state ?? 'MISSING';
    return { run: runIndex, workerIndex: targets.findIndex(target => target.workerId === attempt.target.workerId), workerId: attempt.target.workerId,
      fanOutIndex: attempt.fanOutIndex, fanOutCount: attempt.fanOutCount, configuredOffsetMs: attempt.target.releaseOffsetMs ?? 0,
      schedulerWakeMs: row?.schedulerFiredMs ?? null, workerInvokedMs: row?.workerInvokedMs ?? null, transportEnteredMs: row?.transportEnteredMs ?? null,
      prePostMs: row?.prePostMs ?? null, evaluateEnteredMs: row?.evaluateEnteredMs?.ms ?? null, fetchInvokedMs: row?.fetchInvokedMs?.ms ?? null,
      chromeStartMs: row?.browserRequestStartMs ?? null, requestEventMs: row?.requestObservedMs ?? null, responseMs: row?.responseObservedMs ?? null, state, ...(result?.code ? { code: result.code } : {}),
      prewarmDurationMs: prep?.ended !== undefined ? Math.round((prep.ended - prep.started) * 10) / 10 : null, prewarmReadyMs: toRelease(prep?.ended) };
  });
  const summary = race.reducePrecisionOutcome(results.map(result => result.state as import('../src/api-booking/precision-race.js').PrecisionAttemptState));
  if (summary.lockReleasable) await lock.release();
  process.chdir(scratch);
  return { run: runIndex, width, workers: workerCount, firstTriggerOffsetMs: firstTrigger - releaseMs, children,
    nodeCpuMs: nodeCpu ? Math.round((nodeCpu.user + nodeCpu.system) / 100) / 10 : null, systemBusyPct: busy };
}

const raw: RunSample[] = [];
const summaries: import('../src/fanout-capacity.js').WidthSummary[] = [];
try {
  for (let index = 0; index < workerCount; index++) {
    const session = await launchOfflineChrome({ chromium, chromePath, scratch, index, tabs: maxWidth, headed });
    sessions.push(session);
    for (const page of session.pages) await startPageBusyWork(page, pageBusyMs);
  }
  // Coordinators are started once and reused (like one release's coordinators, warmed before the trigger).
  if (coordinatorModule) coordinatorPool = await coordinatorModule.startCoordinatorPool(sessions.map((session, index) => ({ workerId: String.fromCharCode(65 + index),
    cdpUrl: `http://127.0.0.1:${session.port}`, pageUrl: ONDA_URL, pageCount: maxWidth })), { security: { kind: 'synthetic', cpuMs: syntheticCpuMs, waitMs: syntheticWaitMs }, captureResponses: false });
  for (const width of widths) {
    const records: RunSample[] = [];
    for (let run = -warmup; run < runs; run++) {
      const record = await runOnce(width, run);
      if (run >= 0) records.push(record);
      if (run >= 0 && (run + 1) % 10 === 0) process.stdout.write(`${label} ${workerCount}x${width} run ${run + 1}/${runs}\n`);
    }
    raw.push(...records);
    const summary = capacity.summarizeWidth(width, records);
    summaries.push(summary);
    const t = summary.triggerToChromeStart;
    process.stdout.write(`${workerCount}x${width} (${summary.attempts} attempts): trigger→Chrome p50 ${t.p50} p95 ${t.p95} p99 ${t.p99} max ${t.max} · spread p95 ${summary.spread.p95} · `
      + `codes ${JSON.stringify(countCodes(records))} · per child ${summary.perChildIndex.map(value => `#${value.fanOutIndex} p95 ${value.triggerToChromeStart.p95}`).join(', ')} · states ${JSON.stringify(summary.states)}\n`);
  }
  const recommendation = capacity.recommendFanOutWidth(summaries);
  const gitInfo = (await import(moduleUrl('scripts/build-support.mjs')) as { gitInfo: () => { gitSha: string; dirty: boolean | null } }).gitInfo();
  const createdAt = new Date().toISOString();
  const profile = { schema: capacity.FANOUT_PROFILE_SCHEMA, createdAt,
    build: { gitSha: gitInfo.gitSha, buildId: `${gitInfo.gitSha.slice(0, 7)}${gitInfo.dirty ? '+dirty' : ''}`, dirty: gitInfo.dirty },
    machine: { cpuModel: cpus()[0]?.model ?? 'unknown', logicalCores: cpus().length, totalMemGb: Math.round(totalmem() / 2 ** 30), platform: platform(), osRelease: osRelease(),
      chromeVersion: sessions[0]?.version ?? null },
    config: { workers: workerCount, widths, runsPerWidth: runs, pattern, dispatcher, prewarmLeadMs, prewarmConcurrency, headed, syntheticPrewarm, pageBusy },
    widths: summaries, recommendation };
  capacity.FanOutProfileSchema.parse(profile);
  await mkdir(outDir, { recursive: true });
  const stamp = createdAt.replace(/[:.]/g, '-');
  await writeFile(join(outDir, `${stamp}-${label}-raw.json`), JSON.stringify(raw));
  await writeFile(join(outDir, `${stamp}-${label}-summary.json`), JSON.stringify(profile, null, 2));
  if (saveProfile) await writeFile(join(outDir, `profile-${stamp}.json`), JSON.stringify(profile, null, 2));
  process.stdout.write(`\nMachine recommendation (local dispatch only): ${recommendation.width} attempt(s) per target\n${recommendation.reasons.map(reason => `  - ${reason}`).join('\n')}\n`);
  process.stdout.write(`${JSON.stringify({ summary: join(outDir, `${stamp}-${label}-summary.json`), ...(saveProfile ? { profile: join(outDir, `profile-${stamp}.json`) } : {}) })}\n`);
} finally {
  await coordinatorPool?.close();
  await Promise.allSettled(sessions.map(session => session.browser.close()));
  for (const session of sessions) session.process.kill();
}
