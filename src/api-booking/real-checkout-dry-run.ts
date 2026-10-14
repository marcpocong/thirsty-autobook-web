import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig, ONDA_URL } from '../config.js';
import { OndaLiveAvailabilityProvider } from './live-availability-provider.js';
import { parseAvailability } from './availability-parser.js';
import { planBooking } from './booking-planner.js';
import { runRealCheckoutHybridDryRun } from './real-checkout-hybrid.js';
import { checkoutDiagnostic } from './checkout-diagnostics.js';
import { DateTime } from 'luxon';

// Archived diagnostic: use the guarded desktop runner; this legacy transport cannot submit.
function requireCurrentRunner():void{throw Error('LEGACY_ENTRYPOINT_RETIRED_USE_DESKTOP_RUNNER');}
requireCurrentRunner();

const [date, startTime, durationText, courtText] = process.argv.slice(2);
const durationHours = Number(durationText), court = Number(courtText);
const auto = date === 'auto';
if (!auto && (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !/^([01]\d|2[0-3]):00$/.test(startTime ?? '') ||
  !Number.isInteger(durationHours) || durationHours < 1 || durationHours > 3 ||
  !Number.isInteger(court) || court < 1 || court > 7)) {
  console.error('Usage: npx tsx src/api-booking/real-checkout-dry-run.ts auto|YYYY-MM-DD HH:00 HOURS COURT [--barrier=target|full-grid]');
  process.exit(2);
}
const barrier = process.argv.includes('--barrier=full-grid') ? 'full-grid' : 'target';
const config = loadConfig();
const startedAt = Date.now();
const cdpUrl = process.env.ONDA_HYBRID_CDP_URL;
if (cdpUrl !== 'http://127.0.0.1:19333') throw Error('HYBRID_DEV_CDP_URL_INVALID');
// Prepare the verified development page while the read-only API chooses a slot.
const browserReady = (async () => {
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-File',
    resolve('scripts/verify-onda-chrome.ps1'), '-Port', '19333', '-ExpectedProfile',
    resolve('.local/api-booking/native-hybrid-profile')],
  { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  if (stdout.trim() !== 'CDP_VERIFIED') throw Error('HYBRID_DEV_CHROME_UNVERIFIED');
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0];
  if (!context) throw Error('HYBRID_DEV_CONTEXT_MISSING');
  const page = context.pages().find(candidate => candidate.url() === ONDA_URL) ?? context.pages()[0] ?? await context.newPage();
  if (page.url() !== ONDA_URL) await page.goto(ONDA_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  return { browser, page };
})();
void browserReady.catch(() => undefined);
const provider = new OndaLiveAvailabilityProvider();
const offsets = process.argv.includes('--prefer-next-day') ? [1, 0, 2] : [0, 1, 2];
const days = auto ? offsets.map(offset => DateTime.now().setZone('Asia/Manila').plus({ days: offset }).toISODate()!) : [date!];
let plan: ReturnType<typeof planBooking> | undefined;
for (const targetDate of days) {
  let snapshot: ReturnType<typeof parseAvailability>;
  try {
    const envelope = await provider.getAvailability({ startDate: targetDate, endDate: targetDate });
    snapshot = parseAvailability(envelope.raw, { startDate: targetDate, endDate: targetDate,
      capturedAt: envelope.capturedAt, fixtureKind: 'live', label: envelope.label,
      now: new Date(), maximumAgeMs: 15_000 });
  } catch (error) {
    if (!auto) throw error;
    continue;
  }
  const durations = auto ? [3, 2, 1] : [durationHours];
  const courts = auto ? [5, 1, 7, 6, 4, 3, 2] : [court];
  for (const length of durations) {
    for (let hour = auto ? 8 : Number(startTime!.slice(0, 2)); hour <= (auto ? 23 - length : Number(startTime!.slice(0, 2))); hour++) {
      for (const candidateCourt of courts) {
        try {
          plan = planBooking(snapshot, { mode: 'standard', targetDate, durationHours: length,
            preferredStartTimes: [`${String(hour).padStart(2, '0')}:00`], fallbackStartTimes: [],
            courtPriority: [candidateCourt], fallbackCourts: [], exactCourts: [[candidateCourt]],
            courtCount: 1, maximumTotalPrice: config.MAX_PRICE, currency: 'PHP' });
          break;
        } catch { /* Try only the next real API candidate. */ }
      }
      if (plan) break;
    }
    if (plan) break;
  }
  if (plan) break;
}
if (!plan) throw Error('NO_LIVE_DRY_RUN_CANDIDATE');
const targetDate = plan.targetDate, targetStart = plan.startTime;
const apiReadyMs = Date.now() - startedAt;
console.log(JSON.stringify({ stage: 'API_PLAN_READY', elapsedMs: apiReadyMs, date: plan.targetDate,
  court: plan.courts[0]!.court, startTime: plan.startTime, endTime: plan.endTime, price: plan.totalPrice,
  checkoutPostAllowed: false }));
const { page } = await browserReady;
let availabilitySequence = 0;
const availabilityRequests = new WeakMap<import('playwright').Request, number>();
page.on('request', request => {
  if (request.method() !== 'GET' || !request.url().includes('/date-availability?')) return;
  const id = ++availabilitySequence;
  availabilityRequests.set(request, id);
  console.log(JSON.stringify({ stage: 'ONDA_UI_AVAILABILITY', id, phase: 'DISPATCHED', elapsedMs: Date.now() - startedAt }));
});
page.on('requestfinished', request => {
  const id = availabilityRequests.get(request);
  if (id) console.log(JSON.stringify({ stage: 'ONDA_UI_AVAILABILITY', id, phase: 'COMPLETED', elapsedMs: Date.now() - startedAt }));
});
page.on('requestfailed', request => {
  const id = availabilityRequests.get(request);
  if (id) console.log(JSON.stringify({ stage: 'ONDA_UI_AVAILABILITY', id, phase: 'FAILED', elapsedMs: Date.now() - startedAt }));
});
const endpointKind = (url: string) => {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== 'https://app.onda.fit') return null;
    const path = parsed.pathname;
    return path.includes('member-only-court-slots') ? 'MEMBER_SLOT_CHECK' :
      path.includes('/api/public/customers') || path.includes('/api/public/clients') ? 'CUSTOMER' :
        path.includes('/api/bookings/public-checkout') ? 'CHECKOUT' :
          path.includes('/api/public/is-slot-available') ? 'SLOT_PROOF' : 'OTHER_ONDA_POST';
  } catch { return null; }
};
page.on('response', response => {
  const availabilityId = availabilityRequests.get(response.request());
  if (availabilityId) console.log(JSON.stringify({ stage: 'ONDA_UI_AVAILABILITY', id: availabilityId,
    phase: 'HEADERS', elapsedMs: Date.now() - startedAt, status: response.status() }));
  if (response.request().method() !== 'POST') return;
  const endpoint = endpointKind(response.url());
  if (!endpoint) return;
  void (async () => {
    const body = await response.text().catch(() => '');
    const headers = response.headers();
    const diagnostic = checkoutDiagnostic({ status: response.status(), contentType: headers['content-type'] ?? '',
      server: headers.server, cloudflareRay: headers['cf-ray'], cfMitigated: headers['cf-mitigated'], body });
    console.log(JSON.stringify({ stage: 'ONDA_POST_RESPONSE', endpoint, status: diagnostic.status,
      source: diagnostic.responseSource, contentKind: diagnostic.contentKind,
      errorHint: diagnostic.errorHint, ...(diagnostic.applicationCode ? { applicationCode: diagnostic.applicationCode } : {}),
      challenged: headers['cf-mitigated'] === 'challenge' }));
  })();
});
page.on('requestfailed', request => {
  if (request.method() !== 'POST') return;
  const endpoint = endpointKind(request.url());
  if (endpoint) console.log(JSON.stringify({ stage: 'ONDA_POST_NETWORK_FAILURE', endpoint }));
});
try {
  const outcome = await runRealCheckoutHybridDryRun(page, plan,
    { fullName: config.PLAYER_FULL_NAME, phone: config.PLAYER_PHONE, email: config.PLAYER_EMAIL },
    apiReadyMs, startedAt, config.MAX_PRICE, barrier);
  console.log(JSON.stringify({ stage: 'PAYMENT_SUMMARY_DRY_RUN', ...outcome.elapsedMs,
    barrier: outcome.barrier,
    fullGridReadyAtTarget: outcome.fullGridReadyAtTarget, court: outcome.selection.court,
    date: outcome.selection.date, hours: outcome.selection.hours, amount: outcome.selection.amount,
    checkoutSubmitted: false }));
} catch (error) {
  const code = error instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.message) ? error.message : 'HYBRID_DRY_RUN_FAILED';
  const probeArgs = JSON.stringify({ date: targetDate, court: plan.courts[0]!.court, hour: targetStart });
  const state = await page.evaluate(`(() => { const { date, court, hour } = ${probeArgs};
    const rows = [...document.querySelectorAll('[data-schedule-grid-row-date][data-schedule-grid-row-time]')];
    const row = rows.find(value => value.getAttribute('data-schedule-grid-row-date') === date &&
      value.getAttribute('data-schedule-grid-row-time') === hour);
    const cell = [...(row?.querySelectorAll('[data-testid="court-schedule-slot-cell"]') ?? [])]
      .find(value => value.getAttribute('aria-label')?.startsWith('Court ' + court + ':'));
    return { headingPresent: !!document.querySelector('[data-testid="booking-selected-date-label"]'),
      rowCount: rows.length, cellCount: document.querySelectorAll('[data-testid="court-schedule-slot-cell"]').length,
      wrongDateRows: rows.filter(value => value.getAttribute('data-schedule-grid-row-date') !== date).length,
      busy: !!document.querySelector('[aria-busy="true"]'), targetPresent: !!cell,
      targetState: cell?.querySelector('[data-slot-state]')?.getAttribute('data-slot-state') ?? null,
      targetDisabled: !!cell?.disabled };
  })()`).catch(() => null);
  const reviewStage = await page.evaluate(`(() => ({
    review: [...document.querySelectorAll('h1,h2,h3')].some(value => value.textContent?.trim() === 'Review Booking'),
    player: [...document.querySelectorAll('h1,h2,h3')].some(value => value.textContent?.trim() === 'Player Information'),
    payment: [...document.querySelectorAll('h1,h2,h3')].some(value => value.textContent?.trim() === 'Payment Summary'),
    challenge: !!document.querySelector('iframe[src*="challenges.cloudflare.com"]'),
    preparationError: document.body?.innerText?.includes('We could not prepare your payment summary.') === true
  }))()`).catch(() => null);
  console.log(JSON.stringify({ stage: 'DRY_RUN_STOPPED', code, elapsedMs: Date.now() - startedAt,
    checkoutSubmitted: false, state, reviewStage }));
}
console.log(JSON.stringify({ stage: 'BROWSER_LEFT_VISIBLE', action: 'Close the development browser window when finished inspecting.' }));
await page.waitForEvent('close', { timeout: 0 }).catch(() => undefined);
