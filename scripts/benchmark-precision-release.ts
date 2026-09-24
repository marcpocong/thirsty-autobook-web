/**
 * Offline Precision release benchmark. It NEVER contacts Onda:
 * - each Chrome runs headless with DNS disabled and every request proxied to a closed local port;
 * - every https://app.onda.fit request is fulfilled locally by page.route (checkout -> synthetic HTTP 409);
 * - customer, security headers and journals are synthetic and live in a scratch directory.
 *
 * Modes:
 *   legacy  the pre-Phase-1 path: lock FINAL_ACTION_DISPATCHING + journal begin + one-shot claim after T=0
 *   armed   the Phase-1 path: durable arm before release, in-memory one-shot at T=0
 *
 * Phase 2 (armed mode only), --phase2 on:
 *   - the passive CDP provider trace (checkout-provider-trace.ts) is attached to every worker page before release
 *     and enabled from each worker's POST request event, exactly as the runner does, and persisted after the dispatch settles;
 *   - a real SlotWatch runs IN THIS PROCESS (worst case: production runs it in the desktop app's main process),
 *     launching reads at -1.2 s, -0.6 s, T+0, +0.25 s ... against a local HTTP server; reads launched in the
 *     release window hang for 6 s, like Onda's release-time reads.
 *
 * --response-delay <ms> holds each synthetic 409 (default 0) so a late-enabled trace can see it; use the same value for OFF and ON.
 *
 * Usage: npx tsx scripts/benchmark-precision-release.ts --mode legacy --workers 1,3,7 --runs 100 [--tail 20] [--priority high] [--phase2 on] [--response-delay 50]
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, writeSync } from 'node:fs';
import { mkdir, writeFile, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setPriority, constants as osConstants } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import type { Browser, Page } from 'playwright';

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index]!.replace(/^--/, ''), process.argv[index + 1] ?? '');
const mode = (args.get('mode') ?? 'legacy') as 'legacy' | 'armed';
const workerCounts = (args.get('workers') ?? '1,3,7').split(',').map(Number);
const runs = Number(args.get('runs') ?? 50);
const tailMs = args.has('tail') ? Number(args.get('tail')) : undefined;
const priority = args.get('priority') ?? 'normal';
const phase3 = args.get('phase3') === 'on';
const phase2 = phase3 || args.get('phase2') === 'on' || args.get('phase2') === 'trace';
/** --phase2 trace: the provider trace only, without the in-process slot watch. */
const phase2Watch = phase3 || args.get('phase2') === 'on';
const responseDelayMs = Number(args.get('response-delay') ?? 0);
const label = args.get('label') ?? `${mode}${tailMs !== undefined ? `-tail${tailMs}` : ''}${priority !== 'normal' ? `-${priority}` : ''}${phase3?'-phase3':phase2 ? (phase2Watch ? '-phase2on' : '-phase2trace') : ''}`;
const sourceRoot = resolve(import.meta.dirname, '..');
const scratch = resolve(args.get('scratch') ?? join(process.env.TEMP ?? sourceRoot, 'thirsty-precision-bench'));
const outDir = resolve(args.get('out') ?? join(sourceRoot, '.local/benchmarks'));
if (!['legacy', 'armed'].includes(mode) || workerCounts.some(count => ![1, 2, 3, 4, 5, 6, 7].includes(count)) || !(runs >= 1) || (phase2 && mode !== 'armed')) throw Error('BENCH_ARGS_INVALID');
process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
// A benchmark that stops must say why.
process.on('exit', code => { try { writeSync(2, `bench exit code ${code}
`); } catch { /* stderr gone */ } });
process.on('uncaughtException', error => { try { writeSync(2, `bench uncaught: ${error instanceof Error ? error.stack : String(error)}
`); } finally { process.exit(70); } });
process.on('unhandledRejection', reason => { try { writeSync(2, `bench unhandled rejection: ${reason instanceof Error ? reason.stack : String(reason)}
`); } finally { process.exit(71); } });
// 'high': whole process; 'window': the runner's production setting (HIGH from T-1 s until the POSTs have left).
if (priority === 'high') setPriority(0, osConstants.priority.PRIORITY_HIGH);

const moduleUrl = (path: string) => pathToFileURL(join(sourceRoot, path)).href;
await mkdir(scratch, { recursive: true });
process.chdir(scratch);
const { chromium } = await import('playwright');
const { ONDA_URL } = await import(moduleUrl('src/config.ts')) as typeof import('../src/config.js');
const { ApiAutomationLock } = await import(moduleUrl('src/api-booking/api-automation-lock.ts')) as typeof import('../src/api-booking/api-automation-lock.js');
const { DurableSubmissionJournal } = await import(moduleUrl('src/api-booking/durable-submission-journal.ts')) as typeof import('../src/api-booking/durable-submission-journal.js');
const { OndaBrowserSessionTransport } = await import(moduleUrl('src/api-booking/browser-session-transport.ts')) as typeof import('../src/api-booking/browser-session-transport.js');
const { submitDirectCheckout } = await import(moduleUrl('src/api-booking/proofless-checkout.ts')) as typeof import('../src/api-booking/proofless-checkout.js');
const race = await import(moduleUrl('src/api-booking/precision-race.ts')) as typeof import('../src/api-booking/precision-race.js');
const p3 = phase3 ? await import(moduleUrl('src/api-booking/precision-phase3.ts')) as typeof import('../src/api-booking/precision-phase3.js') : undefined;
const { standardPlanJournalKeys } = await import(moduleUrl('src/api-booking/two-hour-reservation.ts')) as typeof import('../src/api-booking/two-hour-reservation.js');
const { ApiRunProgressLog } = await import(moduleUrl('src/api-booking/run-progress-log.ts')) as typeof import('../src/api-booking/run-progress-log.js');
const { RunDiagnostics } = await import(moduleUrl('src/api-booking/run-diagnostics.ts')) as typeof import('../src/api-booking/run-diagnostics.js');
const { THIRSTY_PICKLE_FACILITY_ID } = await import(moduleUrl('src/api-booking/live-availability-provider.ts')) as typeof import('../src/api-booking/live-availability-provider.js');
const armedModule = mode === 'armed' ? await import(moduleUrl('src/api-booking/armed-dispatch.ts')) as typeof import('../src/api-booking/armed-dispatch.js') : undefined;
const clockModule = mode === 'armed' ? await import(moduleUrl('src/release-clock.ts')) as typeof import('../src/release-clock.js') : undefined;
const p2 = phase2 ? {
  ...await import(moduleUrl('src/slot-watch.ts')) as typeof import('../src/slot-watch.js'),
  ...await import(moduleUrl('src/api-booking/checkout-provider-trace.ts')) as typeof import('../src/api-booking/checkout-provider-trace.js'),
  ...await import(moduleUrl('src/api-booking/availability-parser.ts')) as typeof import('../src/api-booking/availability-parser.js'),
} : undefined;

// Local stand-in for Onda's availability endpoint (Phase 2 ON only). ?delay=ms holds the answer.
const BENCH_DATE = '2026-09-26';
const availabilityBody = JSON.stringify({ success: true, data: { dates: { [BENCH_DATE]: true }, slotsBySpace: Object.fromEntries(
  ['c8c8fb0a-518e-4838-b006-8f200e477788', 'df1a98c3-deb2-4721-949a-d5a1e54fdce0', '0e853a91-33b6-4de2-9237-778007a9313b', '2166184c-db40-4a04-9a80-656878f7327b',
    '1cdcd209-71ce-4a72-a2f6-9252c4d06a01', '7aa7d361-9e60-433f-85ed-9e8eeaef8f96', '648d72bb-0789-40c6-9557-66709da121ba'].map((space, court) => [space,
    Array.from({ length: 16 }, (_, index) => { const hour = index + 8; return { date: BENCH_DATE, bookingDate: BENCH_DATE, startTime: `${String(hour).padStart(2, '0')}:00`,
      endTime: `${String(hour + 1).padStart(2, '0')}:00`, isAvailable: (court + index) % 3 !== 0, pricing: { currency: 'PHP', amount: hour >= 16 ? 700 : 600 } }; })])) } });
let benchPort = 0;
const benchServer = phase2 ? createServer((request, response) => {
  const delay = Number(new URL(request.url ?? '/', 'http://127.0.0.1').searchParams.get('delay') ?? 0);
  const timer = setTimeout(() => { response.writeHead(200, { 'content-type': 'application/json', 'x-vercel-cache': 'MISS' }); response.end(request.url?.startsWith('/b') ? '{"data":[]}' : availabilityBody); }, delay);
  request.on('close', () => clearTimeout(timer));
}) : undefined;
if (benchServer) await new Promise<void>(done => benchServer.listen(0, '127.0.0.1', () => { benchPort = (benchServer.address() as { port: number }).port; done(); }));
/** Reads launched in the release window hang 6 s (Onda took 3-6 s on 2026-09-23/24); others answer in 80 ms. */
const benchAvailability = async (releaseMs: number, signal: AbortSignal) => {
  const offset = Date.now() - releaseMs, delay = offset >= -50 && offset < 2_000 ? 6_000 : 80;
  const raw = await (await fetch(`http://127.0.0.1:${benchPort}/a?delay=${delay}`, { signal })).json() as unknown;
  return { snapshot: p2!.parseAvailability(raw, { startDate: BENCH_DATE, endDate: BENCH_DATE, capturedAt: new Date().toISOString(), fixtureKind: 'live',
    label: 'bench', now: new Date(), maximumAgeMs: 15_000, requireCompleteRange: false }) };
};
const benchBookings = async (signal: AbortSignal) => {
  await Promise.all(Array.from({ length: 7 }, () => fetch(`http://127.0.0.1:${benchPort}/b?delay=80`, { signal }).then(value => value.text())));
  return { blocks: [], failedCourts: [] };
};

const chromePath = [join(process.env.ProgramFiles ?? '', 'Google/Chrome/Application/chrome.exe'),
  join(process.env['ProgramFiles(x86)'] ?? '', 'Google/Chrome/Application/chrome.exe'),
  join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe')].find(existsSync);
if (!chromePath) throw Error('CHROME_NOT_FOUND');

interface BenchSession { index: number; browser: Browser; page: Page; process: ChildProcess; routeSeen: number[] }
const SYNTHETIC_409 = JSON.stringify({ success: false, error: 'Synthetic benchmark conflict (offline).' });

async function launch(index: number): Promise<BenchSession> {
  const port = 29444 + index, profile = join(scratch, 'profiles', `w${index}`);
  await mkdir(profile, { recursive: true });
  // A previous run's Chrome may still own the port while it exits; never attach to it.
  for (const stop = Date.now() + 20_000; ;) {
    try { await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) }); } catch { break; }
    if (Date.now() > stop) throw Error('BENCH_PORT_BUSY');
    await new Promise(done => setTimeout(done, 250));
  }
  const child = spawn(chromePath!, ['--headless=new', `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--proxy-server=http://127.0.0.1:9', 'about:blank'],
  { stdio: 'ignore', windowsHide: true });
  const deadline = Date.now() + 20_000;
  while (true) {
    try { const response = await fetch(`http://127.0.0.1:${port}/json/version`); if (response.ok) break; } catch { /* starting */ }
    if (Date.now() > deadline) throw Error('BENCH_CHROME_START_TIMEOUT');
    await new Promise(done => setTimeout(done, 100));
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0]!;
  const page = context.pages()[0] ?? await context.newPage();
  const session: BenchSession = { index, browser, page, process: child, routeSeen: [] };
  await page.route('https://app.onda.fit/**', async route => {
    const request = route.request();
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/bookings/public-checkout') {
      session.routeSeen.push(performance.now());
      if (responseDelayMs > 0) await new Promise(done => setTimeout(done, responseDelayMs));
      await route.fulfill({ status: 409, contentType: 'application/json', body: SYNTHETIC_409 });
      return;
    }
    if (request.method() === 'GET' && request.url() === ONDA_URL) {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>offline bench</title><p>offline bench</p>' });
      return;
    }
    await route.fulfill({ status: 404, body: '' });
  });
  await page.goto(ONDA_URL, { waitUntil: 'domcontentloaded' });
  // Self-check: real network must be unreachable from this browser.
  const escaped = await page.evaluate(async () => { try { await fetch('https://example.com/', { mode: 'no-cors' }); return true; } catch { return false; } });
  if (escaped) throw Error('BENCH_NETWORK_NOT_ISOLATED');
  return session;
}

const percentile = (values: number[], p: number) => {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
};
const stats = (values: number[]) => ({ n: values.length, p50: round(percentile(values, 50)), p95: round(percentile(values, 95)),
  p99: round(percentile(values, 99)), max: round(Math.max(...values)), mean: round(values.reduce((sum, value) => sum + value, 0) / (values.length || 1)) });
const round = (value: number) => Math.round(value * 1000) / 1000;

const customer = { clientId: '00000000-0000-4000-8000-00000000c11e', customerId: '00000000-0000-4000-8000-000000000b00',
  customerEmail: 'offline-bench@example.invalid', customerPhone: '09000000000', customerFirstName: 'Offline', customerLastName: 'Bench' };
const syntheticHeaders = async () => { await new Promise(done => setTimeout(done, 5)); return { turnstileToken: 'offline-bench-token', publicFingerprint: 'offline-bench-print' }; };

// The runner's scheduler, reproduced exactly for legacy mode (desktop-runner.ts pause/waitUntil).
const SPIN_TAIL_MS = 20;
const legacyPause = (ms: number) => new Promise<void>(done => {
  if (ms <= SPIN_TAIL_MS) { const deadline = performance.now() + ms; const tick = () => { if (performance.now() >= deadline) { done(); return; } setImmediate(tick); }; tick(); return; }
  setTimeout(done, ms);
});
const legacyWaitUntil = async (at: number) => { while (Date.now() < at) await legacyPause(Math.min(500, Math.max(1, at - Date.now()))); };

type Marks = Record<string, number>;
interface RunRecord { run: number; workers: number; releaseMono: number; wake: number; shared: Marks; perWorker: Record<string, Marks>; states: string[]; cpuMsArmToWake: number }

async function runOnce(sessions: BenchSession[], count: number, runIndex: number): Promise<RunRecord> {
  const runDir = join(scratch, 'runs', `${label}-${count}w-${runIndex}-${Date.now()}`);
  await mkdir(runDir, { recursive: true });
  process.chdir(runDir);
  const date = '2026-09-26';
  const targets = race.validatePrecisionTargets([1, 2, 3, 4, 5, 6, 7].slice(0, count).map(court => ({ court, start: '17:00', durationHours: 3 })), date);
  const lock = await ApiAutomationLock.acquire('standard', targets.map(target => target.workerId));
  const started = performance.now();
  const progressLog = new ApiRunProgressLog('bench', date);
  const diagnostics = new RunDiagnostics(progressLog, started);
  const stage = (name: string, extra: Record<string, string | number | boolean> = {}) => progressLog.record(name, new Date().toISOString(), Math.round(performance.now() - started), extra);
  const releaseMs = Date.now() + 1500 + Math.floor(Math.random() * 50);
  const shared: Marks = {}, perWorker: Record<string, Marks> = {};
  const mark = (worker: string, name: string) => { (perWorker[worker] ??= {})[name] ??= performance.now(); };
  const frozen = race.freezePrecisionRace(date, releaseMs, targets.map(target => ({ target, plan: race.precisionTargetPlan(target, date) })));
  let traces: InstanceType<NonNullable<typeof p2>['ProviderTraceSet']> | undefined;
  const transports = new Map(targets.map((target, index) => {
    const session = sessions[index]!;
    const transport = new OndaBrowserSessionTransport(session.page, syntheticHeaders, async () => undefined, {}, observation => {
      if (observation.event === 'CHECKOUT_FUNCTION_ENTERED') mark(target.workerId, 'transportEntered');
      if (observation.event === 'CHECKOUT_PRE_POST') mark(target.workerId, 'prePost');
      if (observation.event === 'CHECKOUT_HTTP_POST_INITIATED') { mark(target.workerId, 'requestEvent'); traces?.postInitiated(target.workerId); }
      const extra = { ...observation, ...(observation.event === 'CHECKOUT_PRE_POST' || observation.event === 'CHECKOUT_HTTP_POST_INITIATED' ? { releaseLatenessMs: Date.now() - releaseMs } : {}) };
      if (mode === 'armed' && (observation.event === 'CHECKOUT_FUNCTION_ENTERED' || observation.event === 'CHECKOUT_PRE_POST'))
        diagnostics.observeDeferred(observation.event, { workerId: target.workerId, lane: 'core' }, extra);
      else diagnostics.observe(observation.event, { workerId: target.workerId, lane: 'core' }, extra);
    });
    return [target.workerId, transport] as const;
  }));
  const routeBaseline = sessions.map(session => session.routeSeen.length);
  let releaseMono = 0, cpuMs = NaN;
  let results: Array<{ state: string }> = [];

  if (mode === 'legacy') {
    const journalFor = (key: string, worker: string) => {
      const journal = new DurableSubmissionJournal(resolve('.local/api-booking/api-first-journals', key));
      const begin = journal.begin.bind(journal), claim = journal.claimSupervisedOneShot.bind(journal);
      journal.begin = async (...values) => { mark(worker, 'journalBeginStart'); try { return await begin(...values); } finally { mark(worker, 'journalBeginEnd'); } };
      journal.claimSupervisedOneShot = async (...values) => { mark(worker, 'claimStart'); try { return await claim(...values); } finally { mark(worker, 'claimEnd'); } };
      return journal;
    };
    const attempts = new Map(frozen.attempts.map(attempt => {
      const keys = standardPlanJournalKeys(attempt.plan, THIRSTY_PICKLE_FACILITY_ID);
      return [attempt.target.workerId, { plan: attempt.plan, keys, journals: keys.map(key => journalFor(key, attempt.target.workerId)) }] as const;
    }));
    let dispatching: Promise<void> | undefined;
    const enterDispatch = () => dispatching ??= (async () => { shared.lockStart = performance.now(); await lock.dispatching(); shared.lockEnd = performance.now();
      stage('PRECISION_DISPATCHING', { frozenCount: frozen.attempts.length }); })();
    releaseMono = performance.now() + (releaseMs - Date.now());
    const settled = await race.dispatchPrecisionRace(frozen, { now: Date.now, prewarmLeadMs: 1000,
      waitUntil: async at => { await legacyWaitUntil(at); if (at === releaseMs) shared.wake ??= performance.now(); },
      prewarm: async attempt => transports.get(attempt.target.workerId)!.prepareCheckoutContext(),
      dispatch: async attempt => {
        const worker = attempt.target.workerId;
        mark(worker, 'dispatchEnter');
        await enterDispatch();
        mark(worker, 'attemptBegin');
        const value = attempts.get(worker)!;
        diagnostics.observe('DIAGNOSTIC_ATTEMPT_STARTED', { workerId: worker, lane: 'core' }, { court: attempt.target.court });
        const transport = transports.get(worker)!;
        const call = transport.publicCheckoutProofless.bind(transport);
        const wrapped = { publicCheckoutProofless: (...values: Parameters<typeof call>) => { mark(worker, 'transportCall'); return call(...values); } };
        try { await submitDirectCheckout(value.plan, customer, wrapped, value.journals[0]!, releaseMs, value.journals.slice(1), Date.now, { requirePreparedContext: true }); return { state: 'QR_READY' }; }
        catch (error) { return race.classifyPrecisionDispatchError(error, async () => (await value.journals[0]!.read(value.keys[0]!)).state); }
      } });
    results = settled;
  } else {
    const armed = armedModule!, clock = clockModule!;
    const trusted = clock.TrustedReleaseClock.fromOffset(0, { method: 'bench-system-clock', sampleCount: 0 });
    // Pre-release: durable arm (lock + journals + one-shot) happens here, well before T-0.
    shared.armStart = performance.now();
    const armedSet = await armed.armPrecisionRace(frozen, {
      lock, customerFor: () => customer, journalRoot: resolve('.local/api-booking/api-first-journals'), releaseMs, now: () => trusted.nowMs(),
    });
    shared.armEnd = performance.now();
    const phase3Session=p3?new p3.PrecisionSession(p3.authorizePrecision({date,releaseMs,
      candidates:targets.map((target,index)=>({court:target.court,start:target.start,durationHours:target.durationHours,priority:index+1,
        permissions:{wave1:true,wave2:false,rescue:false},rateEvidence:{source:'synthetic bench',capturedAt:new Date(releaseMs-60_000).toISOString(),
          status:'OPERATOR_CONFIRMED',date,perHour:Array(target.durationHours).fill(700),actionable:true}})),
      wave1:targets.map(target=>({workerId:target.workerId,candidateId:p3.precisionCandidateId(date,target)})),standby:[],
      budgets:{wave2:0,rescue:0,total:count},concurrentWave2:false,rescueEnabled:false,
      authorizedAt:new Date(releaseMs-60_000).toISOString()})):undefined;
    // Phase 2 ON: passive provider traces attached before release (production attaches at T-2 min without waiting;
    // here the run is 1.5 s long, so wait for the attach to finish before the timed window) and an in-process slot watch.
    let watch: InstanceType<NonNullable<typeof p2>['SlotWatch']> | undefined;
    if (p2) {
      traces = new p2.ProviderTraceSet(`bench-${runIndex}`, 'release', releaseMs, () => trusted.nowMs() - releaseMs);
      targets.forEach((target, index) => traces!.start({ workerId: target.workerId, court: target.court, startTime: target.start, endTime: target.end },
        () => sessions[index]!.page.context().newCDPSession(sessions[index]!.page) as unknown as Promise<import('../src/api-booking/checkout-provider-trace.js').CdpSessionLike>));
      await traces.ready(3_000);
      if (phase2Watch) watch = new p2.SlotWatch({ date, releaseMs, directory: join(runDir, 'slot-watch'), now: () => trusted.nowMs(), clockOffsetMs: 0, clockSynced: true,
        schedule: { availability: [-1_200, -600, 0, 250, 500, 1_000], bookings: [-1_200, 200] },
        readAvailability: (_date, signal) => benchAvailability(releaseMs, signal), readBookings: (_date, signal) => benchBookings(signal) });
      shared.traceAttached = performance.now();
    }
    const cpuStart = process.cpuUsage();
    const deadlineMono = trusted.monotonicDeadline(releaseMs);
    releaseMono = deadlineMono;
    const outcome = await armed.dispatchArmedPrecisionRace(armedSet, {
      clock: trusted, prewarmLeadMs: 1000, ...(tailMs !== undefined ? { spinTailMs: tailMs } : {}),
      prewarm: async attempt => transports.get(attempt.target.workerId)!.prepareCheckoutContext(),
      transportFor: worker => transports.get(worker)!,
      isAborted: () => false,
      onWake: () => { shared.wake ??= performance.now(); const cpu = process.cpuUsage(cpuStart); cpuMs = (cpu.user + cpu.system) / 1000; },
      onMark: (worker, name) => mark(worker, name),
      ...(phase3Session?{onEvent:(event:{kind:string;workerId:string;state?:string})=>{
        const candidate=phase3Session.authorization.candidates.find(value=>value.court===targets.find(target=>target.workerId===event.workerId)?.court);
        if(!candidate)return;
        if(event.kind==='dispatch-start')phase3Session.record({id:`bench-${event.workerId}`,candidateId:candidate.id,
          workerId:event.workerId as import('../src/workers.js').WorkerId,wave:'WAVE_1',state:'IN_FLIGHT'});
        if(event.kind==='settled'){const attempt=phase3Session.attempts.find(value=>value.workerId===event.workerId);
          if(attempt)attempt.state=event.state==='REJECTED'?'REJECTED':'UNKNOWN';}
      }}:{}),
      afterFire: async () => { await lock.dispatching(); stage('PRECISION_DISPATCHING', { frozenCount: frozen.attempts.length }); },
      ...(priority === 'window' ? { onFinalApproach: () => setPriority(0, osConstants.priority.PRIORITY_HIGH),
        onReleaseWindowEnd: () => setPriority(0, osConstants.priority.PRIORITY_NORMAL) } : {}),
    });
    results = outcome.results;
    if (traces) { const path = await traces.persist(join(runDir, 'forensics')); if (!path) throw Error('BENCH_TRACE_NOT_WRITTEN'); traceCounts.push(traces.records().filter(value => value.complete).length); }
    if (watch) { const summary = await watch.stop('bench run complete'); watchLaunches.push(summary.availability.launched); }
  }
  sessions.forEach((session, index) => { const seen = session.routeSeen[routeBaseline[index]!]; const worker = targets[index]?.workerId; if (worker && seen !== undefined) (perWorker[worker] ??= {}).routeSeen = seen; });
  const summary = race.reducePrecisionOutcome(results.map(result => result.state as import('../src/api-booking/precision-race.js').PrecisionAttemptState));
  if (summary.lockReleasable) await lock.release();
  diagnostics.finish('BENCH_COMPLETE', false);
  await progressLog.close();
  process.chdir(scratch);
  const relative = (value: number) => value - releaseMono;
  return { run: runIndex, workers: count, releaseMono, wake: relative(shared.wake ?? NaN),
    shared: Object.fromEntries(Object.entries(shared).map(([key, value]) => [key, relative(value)])),
    perWorker: Object.fromEntries(Object.entries(perWorker).map(([worker, marks]) => [worker, Object.fromEntries(Object.entries(marks).map(([key, value]) => [key, relative(value)]))])),
    states: results.map(result => result.state), cpuMsArmToWake: cpuMs };
}

function summarize(records: RunRecord[]) {
  const flat = records.flatMap(record => Object.values(record.perWorker));
  const pick = (name: string) => flat.map(marks => marks[name]).filter((value): value is number => Number.isFinite(value));
  const diff = (a: string, b: string) => flat.flatMap(marks => Number.isFinite(marks[a]) && Number.isFinite(marks[b]) ? [marks[b]! - marks[a]!] : []);
  const first = records.map(record => Math.min(...Object.values(record.perWorker).map(marks => marks.requestEvent ?? Infinity)));
  const last = records.map(record => Math.max(...Object.values(record.perWorker).map(marks => marks.requestEvent ?? -Infinity)));
  return {
    runs: records.length,
    states: Object.fromEntries([...new Set(records.flatMap(record => record.states))].map(state => [state, records.flatMap(record => record.states).filter(value => value === state).length])),
    schedulerWakeLateness: stats(records.map(record => record.wake).filter(Number.isFinite)),
    releaseToRequestEvent_allWorkers: stats(pick('requestEvent')),
    releaseToFirstRequest: stats(first.filter(Number.isFinite)),
    releaseToLastRequest: stats(last.filter(Number.isFinite)),
    firstToLastSpread: stats(records.map((record, index) => last[index]! - first[index]!).filter(Number.isFinite)),
    releaseToRouteSeen: stats(pick('routeSeen')),
    globalLockAfterRelease: stats(records.flatMap(record => Number.isFinite(record.shared.lockStart) && Number.isFinite(record.shared.lockEnd) ? [record.shared.lockEnd! - record.shared.lockStart!] : [])),
    wakeToDispatchEnter: stats(records.flatMap(record => Object.values(record.perWorker).flatMap(marks => Number.isFinite(marks.dispatchEnter) ? [marks.dispatchEnter! - record.wake] : []))),
    dispatchEnterToAttemptBegin: stats(diff('dispatchEnter', 'attemptBegin')),
    requestPreparation: stats(diff('attemptBegin', 'journalBeginStart')),
    journalBegin: stats(diff('journalBeginStart', 'journalBeginEnd')),
    permitClaim: stats(diff('claimStart', 'claimEnd')),
    claimEndToTransportCall: stats(diff('claimEnd', 'transportCall')),
    wakeToTransportCall: stats(records.flatMap(record => Object.values(record.perWorker).flatMap(marks => Number.isFinite(marks.transportCall) ? [marks.transportCall! - record.wake] : []))),
    transportCallToPrePost: stats(diff('transportCall', 'prePost')),
    prePostToRequestEvent: stats(diff('prePost', 'requestEvent')),
    transportCallToRequestEvent: stats(diff('transportCall', 'requestEvent')),
    cpuMsArmToWake: stats(records.map(record => record.cpuMsArmToWake).filter(Number.isFinite)),
    armDurationBeforeRelease: stats(records.flatMap(record => Number.isFinite(record.shared.armStart) && Number.isFinite(record.shared.armEnd) ? [record.shared.armEnd! - record.shared.armStart!] : [])),
  };
}

const sessions: BenchSession[] = [];
const traceCounts: number[] = [], watchLaunches: number[] = [];
const report: Record<string, unknown> = { label, mode, runsPerConfiguration: runs, tailMs: tailMs ?? null, priority, startedAt: new Date().toISOString(),
  host: { platform: process.platform, node: process.version }, notes: 'Offline: headless Chrome over CDP, DNS disabled, app.onda.fit fulfilled locally. Times are ms relative to the monotonic release deadline.' };
try {
  for (let index = 0; index < Math.max(...workerCounts); index++) sessions.push(await launch(index));
  const raw: RunRecord[] = [];
  const configurations: Record<string, unknown> = {};
  for (const count of workerCounts) {
    const records: RunRecord[] = [];
    // Two warm-up runs per configuration are discarded (JIT, first file-system touches).
    for (let run = -2; run < runs; run++) { const record = await runOnce(sessions.slice(0, count), count, run); if (run >= 0) records.push(record); if (run % 25 === 24) process.stdout.write(`${label} ${count}w run ${run + 1}
`); }
    configurations[`${count}w`] = summarize(records);
    raw.push(...records);
    process.stdout.write(`${label} ${count}w done\n`);
  }
  report.configurations = configurations;
  if (phase2) report.phase2 = { providerTraceCompleteRecordsPerRun: stats(traceCounts), slotWatchLaunchesPerRun: stats(watchLaunches) };
  report.finishedAt = new Date().toISOString();
  await mkdir(outDir, { recursive: true });
  const base = join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${label}`);
  const handle = await open(`${base}-raw.json`, 'wx'); try { await handle.writeFile(JSON.stringify(raw)); } finally { await handle.close(); }
  await writeFile(`${base}-summary.json`, JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify({ summary: `${base}-summary.json`, raw: `${base}-raw.json` })}\n`);
} finally {
  await Promise.allSettled(sessions.map(session => session.browser.close()));
  for (const session of sessions) session.process.kill();
  benchServer?.close();
}
