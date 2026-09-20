import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { mkdir, open } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { chromium, type Browser, type Page } from 'playwright';
import { z } from 'zod';
import { ONDA_URL, VENUE, loadConfig, planFingerprint } from '../config.js';
import { browserIdentity, verifyDedicatedChrome } from '../browser.js';
import { emitUiEvent } from '../ui-events.js';
import { discoverApiAvailability } from './availability-engine.js';
import { OndaLiveAvailabilityProvider, THIRSTY_PICKLE_FACILITY_ID } from './live-availability-provider.js';
import { DurableSubmissionJournal } from './durable-submission-journal.js';
import { loadLocalCheckoutCustomer } from './local-customer.js';
import { submitCalendarFreeTwoHourCheckout } from './calendar-free-checkout.js';
import { officialCheckoutUrl } from './checkout-restoration.js';
import type { BookingPreferences } from './types.js';
import type { CheckoutHttpResponse } from './browser-session-transport.js';
import { firstUnjournaledCandidate } from './candidate-journal.js';
import { standardCheckoutChunks } from './extended-checkout.js';
import { standardPlanJournalKeys } from './two-hour-reservation.js';
import { ApiRunProgressLog } from './run-progress-log.js';

const preferencesSchema = z.object({ strategy: z.enum(['standard', 'extended']), date: z.iso.date(), start: z.string().regex(/^(0[89]|1\d|2[0-3]):00$/),
  duration: z.number().int().min(1).max(6), courtCount: z.union([z.literal(1), z.literal(2)]), maximum: z.number().finite().positive(),
  priority: z.array(z.number().int().min(1).max(7)).min(1),
  fallbackStarts: z.array(z.string().regex(/^(0[89]|1\d|2[0-3]):00$/)),
  exact: z.array(z.array(z.number().int().min(1).max(7))).optional() }).strict();
const command = z.object({ mode: z.enum(['prepare', 'dry', 'live', 'live-now']), date: z.iso.date(),
  releaseMs: z.number().int().positive().optional(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  preferences: preferencesSchema.optional() }).strict().parse(JSON.parse(process.argv[2] ?? '{}'));
const abort = new AbortController();
process.on('message', message => { if ((message as { type?: string })?.type === 'abort') abort.abort(); });
const started = performance.now();
const stamp = () => Math.round(performance.now() - started);
const progressLog = new ApiRunProgressLog(command.mode, command.date);
const stage = (name: string, extra: Record<string, string | number | boolean> = {}) => {
  const entry = progressLog.record(name, new Date().toISOString(), stamp(), extra);
  emitUiEvent({ type: 'apiStage', stage: name, at: entry.at, elapsedMs: entry.elapsedMs,
    sincePreviousMs: entry.sincePreviousMs, ...(name === 'RUN_STARTED' ? { runId: progressLog.runId } : {}), ...extra });
};
stage('RUN_STARTED');
const ensureActive = () => { if (abort.signal.aborted) throw Error('USER_ABORT'); };
const pause = (ms: number) => new Promise<void>((done, fail) => {
  const timer = setTimeout(done, ms);
  abort.signal.addEventListener('abort', () => { clearTimeout(timer); fail(Error('USER_ABORT')); }, { once: true });
});
const saveOnce = async (directory: string, filename: string, content: unknown) => {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = await open(join(directory, filename), 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(content)); await file.sync(); }
  finally { await file.close(); }
};
const connectedBrowsers: Browser[] = [];
async function showWindow(page: import('playwright').Page): Promise<void> {
  const session = await page.context().newCDPSession(page);
  try {
    const { windowId, bounds } = await session.send('Browser.getWindowForTarget');
    if (bounds.windowState === 'minimized')
      await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  } finally { await session.detach(); }
  await page.bringToFront();
}
interface WorkerSession { workerId: 'A' | 'B'; browser: Browser; page: Page; port: number }
async function prepareWorker(workerId: 'A' | 'B'): Promise<WorkerSession> {
  const identity = browserIdentity(workerId);
  stage('PREPARING_BROWSER', { workerId });
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    resolve('scripts/start-onda-chrome.ps1'), '-Worker', workerId, '-Port', String(identity.port)],
  { cwd: process.cwd(), windowsHide: true, timeout: 30_000 });
  verifyDedicatedChrome(identity);
  const browser = await chromium.connectOverCDP(identity.cdpUrl);
  connectedBrowsers.push(browser);
  const context = browser.contexts()[0];
  if (!context) throw Error('API_BROWSER_CONTEXT_MISSING');
  const matchingPages = context.pages().filter(candidate => candidate.url() === ONDA_URL);
  const page = matchingPages[0] ?? await context.newPage();
  await Promise.all(matchingPages.slice(1).map(duplicate => duplicate.close().catch(() => undefined)));
  if (page.url() !== ONDA_URL) await page.goto(ONDA_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.getByTestId('public-booking-hero-title').first().waitFor({ state: 'visible', timeout: 45_000 });
  if ((await page.getByTestId('public-booking-hero-title').first().innerText()).trim() !== VENUE) throw Error('WRONG_VENUE');
  await showWindow(page);
  stage('BROWSER_READY', { workerId, port: identity.port });
  return { workerId, browser, page, port: identity.port };
}
try {
  if (process.env.THIRSTY_API_TEST_INSTALLATION !== '1') throw Error('API_TEST_INSTALLATION_REQUIRED');
  const config = loadConfig();
  const requested = command.preferences;
  const strategy = requested?.strategy ?? config.BOOKING_TYPE;
  const duration = requested?.duration ?? config.DURATION_HOURS;
  const courtCount = requested?.courtCount ?? config.COURT_COUNT;
  if (!command.preferences && config.BOOKING_METHOD !== 'api-first') throw Error('API_FIRST_METHOD_REQUIRED');
  if (strategy === 'standard' && (courtCount !== 1 || duration < 1 || duration > 3) ||
    strategy === 'extended' && (duration < 4 || duration > 6 || ![1, 2].includes(courtCount)))
    throw Error('API_FIRST_COURT_COUNT_UNSUPPORTED');
  if (!command.preferences && command.fingerprint !== planFingerprint(config)) throw Error('API_PLAN_CHANGED');
  if ((command.mode === 'live' || command.mode === 'live-now') && process.env.ONDA_API_FIRST_LIVE !== 'ARMED')
    throw Error('API_LIVE_NOT_ARMED');
  if (command.mode === 'live' && !command.releaseMs) throw Error('API_RELEASE_TIME_REQUIRED');
  const customers = command.mode === 'dry' ? undefined : { A: loadLocalCheckoutCustomer('A'),
    ...(strategy === 'extended' ? { B: loadLocalCheckoutCustomer('B') } : {}) };
  const sessions = [await prepareWorker('A')];
  if (strategy === 'extended') sessions.push(await prepareWorker('B'));
  if (command.mode === 'prepare') { process.exitCode = 0; }
  else {
    if (command.mode === 'live') {
      const releaseMs = command.releaseMs!;
      if (releaseMs <= Date.now()) throw Error('RELEASE_MISSED');
      stage('WAITING_FOR_RELEASE', { releaseMs });
      while (Date.now() < releaseMs) { ensureActive(); await pause(Math.min(500, releaseMs - Date.now())); }
      stage('RELEASE_TRIGGERED');
    }
    ensureActive();
    const preferences: BookingPreferences = { mode: strategy, targetDate: command.date,
      durationHours: duration, preferredStartTimes: [requested?.start ?? config.START_TIME],
      fallbackStartTimes: requested?.fallbackStarts ?? config.FALLBACK_TIMES,
      courtPriority: requested?.priority ?? config.PREFERRED_COURTS,
      fallbackCourts: requested ? [] : config.FALLBACK_COURTS, courtCount, exactCourts: requested?.exact,
      maximumTotalPrice: requested?.maximum ?? config.MAX_PRICE, currency: 'PHP' };
    stage('FETCHING_AVAILABILITY');
    const discovery = await discoverApiAvailability(new OndaLiveAvailabilityProvider(), preferences);
    ensureActive();
    if (!discovery.candidates.length) throw Error('API_NO_AVAILABLE_CANDIDATE');
    const selected = command.mode === 'dry' ? { plan: discovery.candidates[0]! } :
      await firstUnjournaledCandidate(discovery.candidates, THIRSTY_PICKLE_FACILITY_ID, async key => {
        const directory = resolve('.local/api-booking/api-first-journals', key);
        const disposition = await new DurableSubmissionJournal(directory).recycleExpiredVerified(key);
        if (disposition === 'reused') stage('EXPIRED_HOLD_REUSABLE');
        return disposition === 'blocked';
      });
    if (!selected) throw Error('API_NO_UNUSED_CANDIDATE');
    const plan = selected.plan;
    stage('CANDIDATE_READY', { date: command.date, court: plan.courts[0]!.court,
      ...(plan.courts[1] ? { courtB: plan.courts[1].court } : {}),
      startTime: plan.startTime, durationHours: duration,
      price: plan.totalPrice, availabilityMs: Math.round(discovery.timing.totalMs ?? 0) });
    if (command.mode === 'dry') {
      // The dry path has no customer lookup, checkout security context, or submission permit.
      stage('DRY_RUN_COMPLETE');
    } else {
      ensureActive();
      process.env.ONDA_CALENDAR_FREE_CHECKOUT = 'APPROVED_ONE_SHOT';
      process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
      const checkoutPlans = standardCheckoutChunks(plan);
      for (const [index, chunkPlan] of checkoutPlans.entries()) {
        ensureActive();
        const workerId = index === 0 ? 'A' : 'B';
        const session = sessions[index]; const customer = customers?.[workerId];
        if (!session || !customer) throw Error('API_EXTENDED_WORKER_MISSING');
        const keys = standardPlanJournalKeys(chunkPlan, THIRSTY_PICKLE_FACILITY_ID);
        const directories = keys.map(key => resolve('.local/api-booking/api-first-journals', key));
        const journals = directories.map(directory => new DurableSubmissionJournal(directory));
        const key = keys[0]!, directory = directories[0]!, journal = journals[0]!;
        let token: string | undefined, bookingNo: string | undefined;
        const capture = async (response: CheckoutHttpResponse) => {
          await saveOnce(directory, 'checkout-response-private.json', { capturedAt: new Date().toISOString(), ...response });
          try {
            const value = JSON.parse(response.body) as { success?: boolean; bookings?: Array<{ id?: string; booking_no?: string; checkoutToken?: string }> };
            if (value.success === true && value.bookings?.length === chunkPlan.durationHours * chunkPlan.courts.length &&
              value.bookings[0]?.id && value.bookings[0]?.booking_no && value.bookings[0]?.checkoutToken) {
              token = value.bookings[0].checkoutToken; bookingNo = value.bookings[0].booking_no;
            }
          } catch { /* Raw response is in the private journal. */ }
        };
        stage('FRESH_VERIFICATION_AND_PROOFS', { workerId });
        let hold;
        try { hold = await submitCalendarFreeTwoHourCheckout({ page: session.page, plan: chunkPlan, availability: discovery.snapshot,
          customer, approval: { courts: chunkPlan.courts.map(court => court.court), date: command.date,
            startTime: chunkPlan.startTime, endTime: chunkPlan.endTime,
            maximumAmount: chunkPlan.totalPrice, customerId: customer.customerId,
            approvalReference: `desktop-api-first-${workerId}-${key}` }, journal,
          additionalJournals: journals.slice(1), captureCheckoutResponse: capture,
          onHumanVerificationRequired: async () => {
            await session.page.evaluate(id => { document.title = `THIRSTY BOT ${id} - VERIFY HERE`; }, workerId);
            await showWindow(session.page); stage('HUMAN_VERIFICATION_REQUIRED', { workerId });
          },
          onHumanVerificationCompleted: async () => { stage('HUMAN_VERIFICATION_COMPLETE', { workerId }); } });
        } catch (error) {
          const code = error instanceof Error ? error.message : '';
          if (/TURNSTILE|SECURITY_CONTEXT|CHALLENGE/.test(code)) {
            await showWindow(session.page); stage('HUMAN_VERIFICATION_REQUIRED', { workerId, code });
          }
          throw error;
        }
        stage('PENDING_HOLD', { workerId, bookingId: hold.bookingIds[0]!, bookingNo: bookingNo ?? '',
          holdExpiresAt: hold.holdExpiresAt, price: chunkPlan.totalPrice });
        if (!token || !bookingNo) throw Error('OFFICIAL_CHECKOUT_TOKEN_MISSING');
        const grant = await session.page.evaluate(async ({ bookingNo, token }) => {
          const url = new URL(`/api/public/bookings/booking-no/${encodeURIComponent(bookingNo)}`, location.origin);
          url.searchParams.set('checkoutToken', token); url.searchParams.set('grantCheckoutAccess', '1');
          const response = await fetch(url, { credentials: 'include', cache: 'no-store' }); return response.status;
        }, { bookingNo, token });
        if (grant !== 200) throw Error('OFFICIAL_CHECKOUT_ACCESS_FAILED');
        await session.page.goto(officialCheckoutUrl(hold.bookingIds[0]!), { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await session.page.getByText('QRPH', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 });
        const body = await session.page.locator('body').innerText();
        if (!body.includes('Pending') || !body.replaceAll(',', '').includes(chunkPlan.totalPrice.toFixed(2)))
          throw Error('OFFICIAL_CHECKOUT_STATE_MISMATCH');
        await showWindow(session.page);
        stage('OFFICIAL_QRPH_HANDOFF', { workerId, bookingId: hold.bookingIds[0]!, bookingNo,
          holdExpiresAt: hold.holdExpiresAt, price: chunkPlan.totalPrice });
      }
    }
  }
} catch (error) {
  const code = error instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.message)
    ? error.message : 'API_FIRST_RUN_FAILED';
  stage('FAILED', { code });
  process.exitCode = 1;
} finally {
  // This process attaches to a browser owned by the desktop installation.
  // Closing a CDP attachment closes its transport; the independently launched Chrome windows stay open.
  await Promise.allSettled(connectedBrowsers.map(browser => browser.close()));
  progressLog.record('PROCESS_EXIT', new Date().toISOString(), stamp(), { exitCode: process.exitCode ?? 0 });
  progressLog.close();
  if (process.connected) process.disconnect();
}
