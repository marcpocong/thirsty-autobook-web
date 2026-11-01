/** Explicit one-attempt live rehearsal using the canonical installed Shotgun modules. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { z } from 'zod';
import { ShotgunRehearsalSchema, runShotgunLiveRehearsal, type productionRehearsalEngine } from '../src/shotgun-live-rehearsal.js';
import { OndaBrowserAvailabilityProvider } from '../src/api-booking/browser-availability-provider.js';
import { queryGoogleClockConsensus } from '../src/network-clock.js';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const authSchema = z.object({ request: ShotgunRehearsalSchema, approvedBy: z.literal('OWNER_CONVERSATION'),
  expiresAt: z.iso.datetime(), engineHashes: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)) }).strict();
async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== '--execute') throw Error('REHEARSAL_EXPLICIT_EXECUTION_REQUIRED');
  const root = resolve('.'), directory = resolve(process.argv[3]!), parent = resolve('.local/shotgun-rehearsal');
  const child = relative(parent, directory);
  if (!child || child.startsWith('..') || isAbsolute(child) || !existsSync('Thirsty Pickle Bot.exe')) throw Error('REHEARSAL_DIRECTORY_REFUSED');
  const auth = authSchema.parse(JSON.parse(await readFile(join(directory, 'authorization.json'), 'utf8')));
  if (!(Date.parse(auth.expiresAt) > Date.now()) || Date.parse(auth.expiresAt) - Date.now() > 15 * 60_000) throw Error('REHEARSAL_AUTHORIZATION_EXPIRED');
  const required = ['api-booking/armed-dispatch.js','api-booking/precision-race.js','api-booking/browser-session-transport.js',
    'api-booking/public-checkout.js','api-booking/calendar-free-security-context-browser.js','api-booking/qr-order-summary.js'];
  for (const name of required) if (sha(await readFile(resolve('dist/src', name))) !== auth.engineHashes[name]) throw Error('REHEARSAL_ENGINE_CHANGED');
  if (existsSync('.local/automation.lock')) throw Error('AUTOMATION_LOCK_EXISTS');
  process.env.THIRSTY_API_INSTALLATION = '1';
  const installed = async (name: string) => import(pathToFileURL(resolve('dist/src', name)).href);
  const browserModule = await installed('browser.js'), recoveryModule = await installed('api-booking/checkout-recovery.js');
  const precision = await installed('api-booking/precision-race.js'), armedModule = await installed('api-booking/armed-dispatch.js');
  const transportModule = await installed('api-booking/browser-session-transport.js');
  const securityModule = await installed('api-booking/calendar-free-security-context.js');
  const journalModule = await installed('api-booking/durable-submission-journal.js');
  const plannerModule = await installed('api-booking/booking-planner.js'), parserModule = await installed('api-booking/availability-parser.js');
  const customerModule = await installed('api-booking/local-customer.js'), lockModule = await installed('api-booking/api-automation-lock.js');
  const clockModule = await installed('release-clock.js'), reviewModule = await installed('lock-browser.js');
  const identity = browserModule.browserIdentity(auth.request.worker);
  await browserModule.verifyDedicatedChromeAsync(identity);
  const browser = await chromium.connectOverCDP(identity.cdpUrl, { timeout: 10_000 });
  let lock: any, outcome: any, held = false, dispatched = false;
  const events: unknown[] = [], observations: unknown[] = [];
  let firstHandoff = false, recoveredInFreshTab = false;
  const abort = new AbortController();
  process.once('SIGINT', () => abort.abort()); process.once('SIGTERM', () => abort.abort());
  try {
    const pages = browser.contexts().flatMap(c => c.pages()).filter(p => p.url().startsWith('https://app.onda.fit/'));
    for (const p of pages) {
      const review = await reviewModule.inspectLockPage(p, { scheduleHydrationTimeoutMs: 3000 });
      if (!review.clean && review.hold !== 'Expired') throw Error('REHEARSAL_BROWSER_NOT_CLEAN');
    }
    const schedules = pages.filter(p => p.url() === 'https://app.onda.fit/book/thirsty-pickle');
    if (schedules.length !== 1) throw Error('ONDA_TAB_AMBIGUOUS_OR_MISSING');
    const page = schedules[0]!, r = auth.request, query = { startDate: r.date, endDate: r.date };
    const customer = customerModule.loadLocalCheckoutCustomer(r.worker);
    const envelope = await new OndaBrowserAvailabilityProvider(page, { wing: 'MANGO' }).getAvailability(query);
    const snapshot = parserModule.parseAvailability(envelope.raw, { ...query, wing: 'MANGO', capturedAt: envelope.capturedAt,
      fixtureKind: 'live', label: envelope.label, now: new Date(), maximumAgeMs: 15_000 });
    const plan = plannerModule.planBooking(snapshot, { wing: 'MANGO', mode: 'standard', targetDate: r.date, durationHours: r.duration,
      preferredStartTimes: [r.start], fallbackStartTimes: [], courtPriority: [r.court], fallbackCourts: [],
      courtCount: 1, exactCourts: [[r.court]], maximumTotalPrice: r.maximum, currency: 'PHP' });
    const key = journalModule.DurableSubmissionJournal.key('5f8786bd-dc61-4509-b893-74cda8f783f7', plan.courts[0].spaceId, r.date, r.start, plan.endTime);
    const journalRoot = resolve('.local/api-booking/api-first-journals'), journalDirectory = join(journalRoot, key);
    if (existsSync(join(journalDirectory, key + '.json'))) throw Error('DUPLICATE_LOGICAL_BOOKING_BLOCKED');
    const consensus = await queryGoogleClockConsensus();
    if (consensus.quality !== 'GOOD' || consensus.uncertaintyMs > 50) throw Error('REHEARSAL_CLOCK_NOT_VERIFIED');
    const clock = clockModule.TrustedReleaseClock.fromOffset(consensus.offsetMs, { method: consensus.method,
      sampleCount: consensus.sampleCount, uncertaintyMs: consensus.uncertaintyMs, quality: consensus.quality });
    await writeFile(join(directory, 'execution-claimed.json'), JSON.stringify({ at: new Date().toISOString(), request: r,
      engineHashes: auth.engineHashes, purpose: 'REHEARSAL_NOT_OFFICIAL_08AM_RELEASE', checkoutBudget: 1 }), { flag: 'wx' });
    lock = await lockModule.ApiAutomationLock.acquire('standard', [r.worker]);
    const transport = new transportModule.OndaBrowserSessionTransport(page, securityModule.calendarFreeSecurityContext(page),
      async (response: any) => recoveryModule.saveCheckoutRecovery(journalDirectory, response, plan, r.worker, new Date(clock.nowMs())), {},
      (event: any) => {
        if (event.event === 'CHECKOUT_HTTP_POST_INITIATED') dispatched = true;
        observations.push({ event: event.event, at: clock.nowMs(), ...(typeof event.status === 'number' ? { status: event.status } : {}) });
      });
    process.env.ONDA_CALENDAR_FREE_CHECKOUT = 'APPROVED_ONE_SHOT';
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    const triggerMs = Math.ceil(clock.nowMs() + 30_000);
    await writeFile(join(directory, 'prepared-plan.json'), JSON.stringify({ request: r, amount: plan.totalPrice,
      triggerMs, triggerKind: 'REHEARSAL_ANCHOR', key, clockEvidence: clock.evidence }, null, 2));
    outcome = await runShotgunLiveRehearsal(r, plan, {
      engine: { freezePrecisionRace: precision.freezePrecisionRace, armPrecisionRace: armedModule.armPrecisionRace,
        dispatchArmedPrecisionRace: armedModule.dispatchArmedPrecisionRace, disarmUnfired: armedModule.disarmUnfired } as typeof productionRehearsalEngine,
      arm: { lock, releaseMs: triggerMs, journalRoot, now: () => clock.nowMs(), customerFor: () => customer },
      dispatch: { clock, prewarmLeadMs: 25_000, isAborted: () => abort.signal.aborted,
        transportFor: () => transport, prewarm: async () => transport.prepareCheckoutContext(),
        afterFire: async () => lock.dispatching(), onEvent: e => events.push(e),
        onVerifiedHold: async (_attempt, verified) => {
          held = true; await lock.held(verified.holdExpiresAt);
          await recoveryModule.openCheckoutRecovery(page, journalDirectory); firstHandoff = true;
          const fresh = await page.context().newPage();
          await fresh.goto('https://app.onda.fit/book/thirsty-pickle', { waitUntil: 'domcontentloaded', timeout: 30_000 });
          await recoveryModule.openCheckoutRecovery(fresh, journalDirectory); recoveredInFreshTab = true;
          return { state: 'QR_READY' };
        },
      },
    });
    const safe = { at: new Date().toISOString(), kind: r.kind, request: r, amount: plan.totalPrice, triggerMs,
      results: outcome.results.map((x: any) => ({ state: x.state, code: x.code ?? null, worker: x.attempt.target.workerId,
        strict: x.attempt.dispatchTimingPolicy === 'SHOTGUN_STRICT' })), firstHandoff, recoveredInFreshTab,
      events, observations, paymentAutomated: false, engineHashes: auth.engineHashes };
    await writeFile(join(directory, 'result.json'), JSON.stringify(safe, null, 2));
    console.log(JSON.stringify({ results: safe.results, firstHandoff, recoveredInFreshTab, paymentAutomated: false }));
    if (!recoveredInFreshTab) process.exitCode = 1;
  } finally {
    if (lock && !held && outcome && outcome.results.every((x: any) => ['NOT_DISPATCHED','REJECTED','WINDOW_MISSED'].includes(x.state))) await lock.release();
    await writeFile(join(directory, 'exit-evidence.json'), JSON.stringify({ at: new Date().toISOString(), held, dispatched,
      firstHandoff, recoveredInFreshTab, paymentAutomated: false, events, observations }, null, 2));
    await browser.close();
  }
}
main().catch(async error => {
  const code = error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'SHOTGUN_REHEARSAL_FAILED';
  console.error(code); process.exitCode = 1;
});
