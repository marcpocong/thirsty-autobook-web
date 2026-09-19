import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { mkdir, open } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';
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

const preferencesSchema = z.object({ date: z.iso.date(), start: z.string().regex(/^(0[89]|1\d|2[0-3]):00$/),
  duration: z.number().int().min(1).max(3), maximum: z.number().finite().positive(),
  priority: z.array(z.number().int().min(1).max(7)).min(1),
  fallbackStarts: z.array(z.string().regex(/^(0[89]|1\d|2[0-3]):00$/)) }).strict();
const command = z.object({ mode: z.enum(['prepare', 'dry', 'live', 'live-now']), date: z.iso.date(),
  releaseMs: z.number().int().positive().optional(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  preferences: preferencesSchema.optional() }).strict().parse(JSON.parse(process.argv[2] ?? '{}'));
const abort = new AbortController();
process.on('message', message => { if ((message as { type?: string })?.type === 'abort') abort.abort(); });
const started = performance.now();
const stamp = () => Math.round(performance.now() - started);
const stage = (name: string, extra: Record<string, string | number | boolean> = {}) =>
  emitUiEvent({ type: 'apiStage', stage: name, elapsedMs: stamp(), ...extra });
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
async function windowState(page: import('playwright').Page, state: 'minimized' | 'normal'): Promise<void> {
  const session = await page.context().newCDPSession(page);
  try {
    const { windowId } = await session.send('Browser.getWindowForTarget');
    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: state } });
    if (state === 'normal') await session.send('Browser.setWindowBounds',
      { windowId, bounds: { left: 40, top: 40, width: 1200, height: 900 } });
  } finally { await session.detach(); }
}

try {
  if (process.env.THIRSTY_API_TEST_INSTALLATION !== '1') throw Error('API_TEST_INSTALLATION_REQUIRED');
  const config = loadConfig();
  if (!command.preferences && (config.BOOKING_METHOD !== 'api-first' || config.BOOKING_TYPE !== 'standard' || config.COURT_COUNT !== 1 ||
    config.DURATION_HOURS < 1 || config.DURATION_HOURS > 3)) throw Error('API_FIRST_STANDARD_ONE_COURT_REQUIRED');
  if (!command.preferences && command.fingerprint !== planFingerprint(config)) throw Error('API_PLAN_CHANGED');
  if ((command.mode === 'live' || command.mode === 'live-now') && process.env.ONDA_API_FIRST_LIVE !== 'ARMED')
    throw Error('API_LIVE_NOT_ARMED');
  if (command.mode === 'live' && !command.releaseMs) throw Error('API_RELEASE_TIME_REQUIRED');
  const identity = browserIdentity('A');
  stage('PREPARING_BROWSER');
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    resolve('scripts/start-onda-chrome.ps1'), '-Port', String(identity.port)],
  { cwd: process.cwd(), windowsHide: true, timeout: 30_000 });
  verifyDedicatedChrome(identity);
  const browser = await chromium.connectOverCDP(identity.cdpUrl);
  const context = browser.contexts()[0];
  if (!context) throw Error('API_BROWSER_CONTEXT_MISSING');
  const page = await context.newPage();
  await page.goto(ONDA_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.bringToFront();
  await page.getByTestId('public-booking-hero-title').first().waitFor({ state: 'visible', timeout: 45_000 });
  if ((await page.getByTestId('public-booking-hero-title').first().innerText()).trim() !== VENUE)
    throw Error('WRONG_VENUE');
  await windowState(page, 'minimized');
  stage('BROWSER_READY', { port: identity.port });
  if (command.mode === 'prepare') { await page.close(); process.exitCode = 0; }
  else {
    if (command.mode === 'live') {
      const releaseMs = command.releaseMs!;
      if (releaseMs <= Date.now()) throw Error('RELEASE_MISSED');
      stage('WAITING_FOR_RELEASE', { releaseMs });
      while (Date.now() < releaseMs) { ensureActive(); await pause(Math.min(500, releaseMs - Date.now())); }
      stage('RELEASE_TRIGGERED');
    }
    ensureActive();
    const requested = command.preferences;
    const preferences: BookingPreferences = { mode: 'standard', targetDate: command.date,
      durationHours: requested?.duration ?? config.DURATION_HOURS, preferredStartTimes: [requested?.start ?? config.START_TIME],
      fallbackStartTimes: requested?.fallbackStarts ?? config.FALLBACK_TIMES,
      courtPriority: requested?.priority ?? config.PREFERRED_COURTS,
      fallbackCourts: requested ? [] : config.FALLBACK_COURTS, courtCount: 1,
      maximumTotalPrice: requested?.maximum ?? config.MAX_PRICE, currency: 'PHP' };
    stage('FETCHING_AVAILABILITY');
    const discovery = await discoverApiAvailability(new OndaLiveAvailabilityProvider(), preferences);
    ensureActive();
    if (!discovery.candidates.length) throw Error('API_NO_AVAILABLE_CANDIDATE');
    stage('CANDIDATE_READY', { date: command.date, court: discovery.candidates[0]!.courts[0]!.court,
      startTime: discovery.candidates[0]!.startTime, durationHours: requested?.duration ?? config.DURATION_HOURS,
      price: discovery.candidates[0]!.totalPrice, availabilityMs: Math.round(discovery.timing.totalMs ?? 0) });
    if (command.mode === 'dry') {
      // The dry path has no customer lookup, checkout security context, or submission permit.
      stage('DRY_RUN_COMPLETE');
      await page.close();
    } else {
      const plan = discovery.candidates[0]!;
      const customer = loadLocalCheckoutCustomer();
      const court = plan.courts[0]!;
      const key = DurableSubmissionJournal.key(THIRSTY_PICKLE_FACILITY_ID, court.spaceId,
        command.date, plan.startTime, plan.endTime);
      const directory = resolve('.local/api-booking/api-first-journals', key);
      const journal = new DurableSubmissionJournal(directory);
      let token: string | undefined, bookingNo: string | undefined;
      const capture = async (response: CheckoutHttpResponse) => {
        await saveOnce(directory, 'checkout-response-private.json', { capturedAt: new Date().toISOString(), ...response });
        try {
          const value = JSON.parse(response.body) as { success?: boolean; bookings?: Array<{ id?: string; booking_no?: string; checkoutToken?: string }> };
          if (value.success === true && value.bookings?.length === plan.durationHours &&
            value.bookings[0]?.id && value.bookings[0]?.booking_no && value.bookings[0]?.checkoutToken) {
            token = value.bookings[0].checkoutToken; bookingNo = value.bookings[0].booking_no;
          }
        } catch { /* Raw response is in the private journal. */ }
      };
      ensureActive();
      stage('FRESH_VERIFICATION_AND_PROOFS');
      process.env.ONDA_CALENDAR_FREE_CHECKOUT = 'APPROVED_ONE_SHOT';
      process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
      let hold;
      try { hold = await submitCalendarFreeTwoHourCheckout({ page, plan, availability: discovery.snapshot,
        customer, approval: { court: court.court, date: command.date, startTime: plan.startTime,
          endTime: plan.endTime, maximumAmount: requested?.maximum ?? config.MAX_PRICE, customerId: customer.customerId,
          approvalReference: `desktop-api-first-${key}` }, journal, captureCheckoutResponse: capture });
      } catch (error) {
        const code = error instanceof Error ? error.message : '';
        if (/TURNSTILE|SECURITY_CONTEXT|CHALLENGE/.test(code)) {
          await windowState(page, 'normal'); await page.bringToFront();
          stage('HUMAN_VERIFICATION_REQUIRED', { code });
        }
        throw error;
      }
      stage('PENDING_HOLD', { bookingId: hold.bookingIds[0]!, bookingNo: bookingNo ?? '',
        holdExpiresAt: hold.holdExpiresAt, price: plan.totalPrice });
      if (!token || !bookingNo) throw Error('OFFICIAL_CHECKOUT_TOKEN_MISSING');
      const grant = await page.evaluate(async ({ bookingNo, token }) => {
        const url = new URL(`/api/public/bookings/booking-no/${encodeURIComponent(bookingNo)}`, location.origin);
        url.searchParams.set('checkoutToken', token); url.searchParams.set('grantCheckoutAccess', '1');
        const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
        return response.status;
      }, { bookingNo, token });
      if (grant !== 200) throw Error('OFFICIAL_CHECKOUT_ACCESS_FAILED');
      await page.goto(officialCheckoutUrl(hold.bookingIds[0]!), { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.getByText('QRPH', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 });
      const body = await page.locator('body').innerText();
      if (!body.includes('Pending') || !body.includes(plan.totalPrice.toFixed(2)))
        throw Error('OFFICIAL_CHECKOUT_STATE_MISMATCH');
      await windowState(page, 'normal'); await page.bringToFront();
      stage('OFFICIAL_QRPH_HANDOFF', { bookingId: hold.bookingIds[0]!, bookingNo,
        holdExpiresAt: hold.holdExpiresAt, price: plan.totalPrice });
    }
  }
} catch (error) {
  const code = error instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.message)
    ? error.message : 'API_FIRST_RUN_FAILED';
  stage('FAILED', { code });
  process.exitCode = 1;
} finally {
  // This process attaches to a browser owned by the desktop installation.
  // Exiting disconnects the CDP client while leaving that visible browser open.
  setImmediate(() => process.exit(process.exitCode ?? 0));
}
