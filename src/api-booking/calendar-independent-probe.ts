import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { DateTime } from 'luxon';
import { ONDA_URL, VENUE } from '../config.js';
import { OndaLiveAvailabilityProvider, THIRSTY_PICKLE_FACILITY_ID } from './live-availability-provider.js';
import { parseAvailability } from './availability-parser.js';
import { watchCheckoutMilestones, readCheckoutMilestones } from './checkout-milestones.js';
import { OndaBrowserSessionTransport } from './browser-session-transport.js';
import { THIRSTY_PICKLE_CLIENT_ID } from './local-customer.js';
import type { BookingPlan } from './types.js';

// Archived diagnostic: use the guarded desktop runner; this legacy transport cannot submit.
function requireCurrentRunner():void{throw Error('LEGACY_ENTRYPOINT_RETIRED_USE_DESKTOP_RUNNER');}
requireCurrentRunner();

/** Read-only probe of the genuine bookingId route. Never selects a slot or submits a hold. */
const start = Date.now();
const elapsed = () => Date.now() - start;
const say = (stage: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ stage, elapsedMs: elapsed(), ...extra }));
const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-File',
  resolve('scripts/verify-onda-chrome.ps1'), '-Port', '19333', '-ExpectedProfile',
  resolve('.local/api-booking/native-hybrid-profile')], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
if (stdout.trim() !== 'CDP_VERIFIED') throw Error('HYBRID_DEV_CHROME_UNVERIFIED');
const browser = await chromium.connectOverCDP('http://127.0.0.1:19333');
const context = browser.contexts()[0];
if (!context) throw Error('HYBRID_DEV_CONTEXT_MISSING');
const page = await context.newPage();
const delayGridMs = process.argv.includes('--delay-grid=5000') ? 5000 : 0;
if (delayGridMs) await page.route('**/date-availability?**', async route => {
  await new Promise(resolve => setTimeout(resolve, delayGridMs));
  await route.continue();
});
await page.route('**/api/bookings/public-checkout', route => route.request().method() === 'POST' ? route.abort() : route.continue());
await page.route('**/api/public/bookings', route => route.request().method() === 'POST' ? route.abort() : route.continue());
const provider = new OndaLiveAvailabilityProvider();
let date = '';
let slot: ReturnType<typeof parseAvailability>['slots'][number] | undefined;
for (const offset of [0, 1]) {
  const candidateDate = DateTime.now().setZone('Asia/Manila').plus({ days: offset }).toISODate()!;
  const envelope = await provider.getAvailability({ startDate: candidateDate, endDate: candidateDate });
  const availability = parseAvailability(envelope.raw, { startDate: candidateDate, endDate: candidateDate,
    capturedAt: envelope.capturedAt, fixtureKind: 'live', label: envelope.label,
    now: new Date(), maximumAgeMs: 15_000 });
  slot = availability.slots.find(value => value.isAvailable && value.bookingDate === candidateDate && value.currency === 'PHP');
  if (slot) { date = candidateDate; break; }
}
if (!slot) throw Error('NO_LIVE_DRY_RUN_CANDIDATE');
const plan: BookingPlan = { mode: 'standard', targetDate: date, startTime: slot.startTime, endTime: slot.endTime,
  durationHours: 1, currency: 'PHP', totalPrice: slot.price,
  courts: [{ court: slot.court, spaceId: slot.spaceId, date, startTime: slot.startTime, endTime: slot.endTime,
    durationMinutes: 60, price: slot.price, currency: 'PHP', slots: [slot] }],
  chunks: [{ startTime: slot.startTime, endTime: slot.endTime, durationHours: 1, totalPrice: slot.price,
    courts: [{ court: slot.court, spaceId: slot.spaceId, date, startTime: slot.startTime, endTime: slot.endTime,
      durationMinutes: 60, price: slot.price, currency: 'PHP', slots: [slot] }] }] };
say('API_CANDIDATE_READY', { date, court: slot.court, hour: slot.startTime, price: slot.price });
const bookingReads: Array<{ status: number; elapsedMs: number }> = [];
page.on('response', response => {
  if (response.request().method() === 'GET' && /\/api\/public\/bookings\//.test(response.url()))
    bookingReads.push({ status: response.status(), elapsedMs: elapsed() });
});
// This deliberately nonexistent identifier tests route handling without accessing another customer's booking.
const url = new URL(ONDA_URL);
url.searchParams.set('d', date);
url.searchParams.set('bookingId', 'thirsty-probe-no-booking');
url.searchParams.set('bookingUi', 'court-v2');
const navigation = await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 45_000 });
if (navigation?.status() !== 200) throw Error('ONDA_PAGE_LOAD_FAILED');
await page.getByTestId('public-booking-hero-title').first().waitFor({ state: 'visible', timeout: 45_000 });
if ((await page.getByTestId('public-booking-hero-title').first().innerText()).trim() !== VENUE) throw Error('WRONG_VENUE');
say('VENUE_SHELL_READY', { route: page.url(), bookingReads });
await page.goto(ONDA_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
await page.getByTestId('public-booking-hero-title').first().waitFor({ state: 'visible', timeout: 45_000 });
await watchCheckoutMilestones(page, plan);
const transport = new OndaBrowserSessionTransport(page, async () => { throw Error('SUBMISSION_DISABLED'); });
const proof = await transport.checkSlot({ clientId: THIRSTY_PICKLE_CLIENT_ID,
  facilityId: THIRSTY_PICKLE_FACILITY_ID, spaceId: slot.spaceId, date,
  startTime: slot.startTime, endTime: slot.endTime }).catch(error => ({ error: error instanceof Error ? error.message : 'SLOT_PROOF_FAILED' }));
say('SLOT_PROOF_READ', { success: !!proof && typeof proof === 'object' && (proof as Record<string, unknown>).success === true,
  hasProof: !!proof && typeof proof === 'object' && typeof (proof as Record<string, unknown>).availabilityProof === 'string',
  error: proof && typeof proof === 'object' ? (proof as Record<string, unknown>).error ?? null : null,
  milestones: await readCheckoutMilestones(page, start) });
if (delayGridMs) {
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="court-schedule-slot-cell"]').length === 112,
    undefined, { timeout: 15_000 }).catch(() => undefined);
} else await page.waitForTimeout(3000);
const stages = await page.evaluate(() => ({
  review: [...document.querySelectorAll('h1,h2,h3')].some(element => element.textContent?.trim() === 'Review Booking'),
  payment: [...document.querySelectorAll('h1,h2,h3')].some(element => element.textContent?.trim() === 'Payment Summary'),
  url: location.href,
}));
say('ROUTE_PROBE_COMPLETE', { stages, bookingReads, milestones: await readCheckoutMilestones(page, start),
  delayGridMs, submitted: false });
await page.close();
await browser.close();
