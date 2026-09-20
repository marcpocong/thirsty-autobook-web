import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { join } from 'node:path';
import { mkdir, open } from 'node:fs/promises';
import { chromium } from 'playwright';
import { DateTime } from 'luxon';
import { loadConfig, ONDA_URL } from '../config.js';
import { OndaLiveAvailabilityProvider } from './live-availability-provider.js';
import { parseAvailability } from './availability-parser.js';
import { planBooking } from './booking-planner.js';
import { loadLocalCheckoutCustomer } from './local-customer.js';
import { DurableSubmissionJournal } from './durable-submission-journal.js';
import { submitCalendarFreeTwoHourCheckout } from './calendar-free-checkout.js';
import { officialCheckoutUrl } from './checkout-restoration.js';
import type { CheckoutHttpResponse } from './browser-session-transport.js';

const [date, startTime, courtText, durationText] = process.argv.slice(2);
const journalDirectory = '.local/api-booking/submission-journal-session-20260919-second';
const court = Number(courtText);
const durationHours = Number(durationText);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !/^([01]\d|2[0-3]):00$/.test(startTime ?? '') ||
  !Number.isInteger(court) || court < 1 || court > 7 || ![1, 2].includes(durationHours) || process.argv.length !== 6)
  throw Error('USAGE: calendar-free-live-attempt DATE HH:00 COURT DURATION_HOURS');
if (DateTime.fromISO(`${date}T${startTime}`, { zone: 'Asia/Manila' }).toMillis() <= Date.now())
  throw Error('FUTURE_SLOT_REQUIRED');
const config = loadConfig();
const customer = loadLocalCheckoutCustomer();
async function savePrivateOnce(name: string, value: unknown): Promise<void> {
  await mkdir(journalDirectory, { recursive: true, mode: 0o700 });
  const handle = await open(join(journalDirectory, name), 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
  finally { await handle.close(); }
}
const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-File',
  resolve('scripts/verify-onda-chrome.ps1'), '-Port', '19333', '-ExpectedProfile',
  resolve('.local/api-booking/native-hybrid-profile')], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
if (stdout.trim() !== 'CDP_VERIFIED') throw Error('HYBRID_DEV_CHROME_UNVERIFIED');
const browser = await chromium.connectOverCDP('http://127.0.0.1:19333');
try {
  const page = browser.contexts()[0]?.pages().find(page => page.url() === ONDA_URL);
  if (!page) throw Error('ONDA_VENUE_PAGE_MISSING');
  let checkoutToken: string | undefined;
  let bookingNumber: string | undefined;
  const networkCaptures: Promise<void>[] = [];
  page.on('response', response => {
    if (response.request().method() !== 'POST' ||
      new URL(response.url()).pathname !== '/api/bookings/public-checkout') return;
    networkCaptures.push((async () => {
      const body = await response.text();
      await savePrivateOnce('checkout-network-response.json', {
        capturedAt: new Date().toISOString(), status: response.status(),
        contentType: response.headers()['content-type'] ?? '', body });
    })().catch(() => { console.log(JSON.stringify({ stage: 'NETWORK_CAPTURE_FAILED' })); }));
  });
  const captureCheckoutResponse = async (response: CheckoutHttpResponse) => {
    await savePrivateOnce('checkout-transport-response.json', {
      capturedAt: new Date().toISOString(), ...response });
    try {
      const parsed = JSON.parse(response.body) as Record<string, unknown>;
      const bookings = Array.isArray(parsed.bookings) ? parsed.bookings as Array<Record<string, unknown>> : [];
      const first = bookings[0];
      if (parsed.success === true && typeof first?.booking_no === 'string') bookingNumber = first.booking_no;
      const token = bookings.find(booking => typeof booking.checkoutToken === 'string')?.checkoutToken;
      if (parsed.success === true && typeof token === 'string') checkoutToken = token;
    } catch { /* Raw response remains in the private evidence file. */ }
  };
  const provider = new OndaLiveAvailabilityProvider();
  const envelope = await provider.getAvailability({ startDate: date!, endDate: date! });
  const availability = parseAvailability(envelope.raw, { startDate: date!, endDate: date!,
    capturedAt: envelope.capturedAt, fixtureKind: 'live', label: envelope.label,
    now: new Date(), maximumAgeMs: 15_000 });
  const plan = planBooking(availability, { mode: 'standard', targetDate: date!, durationHours,
    preferredStartTimes: [startTime!], fallbackStartTimes: [], courtPriority: [court], fallbackCourts: [],
    courtCount: 1, maximumTotalPrice: config.MAX_PRICE, currency: 'PHP' });
  const journal = new DurableSubmissionJournal(journalDirectory);
  console.log(JSON.stringify({ stage: 'EXACT_ATTEMPT', court, date, startTime, durationHours,
    endTime: plan.endTime, price: plan.totalPrice,
    possiblePendingHold: true, journalDirectory, submitted: false }));
  let hold;
  try { hold = await submitCalendarFreeTwoHourCheckout({ page, plan, availability, customer,
    approval: { courts: [court], date: date!, startTime: startTime!, endTime: plan.endTime,
      maximumAmount: plan.totalPrice, customerId: customer.customerId,
      approvalReference: 'user-session-2026-09-19-second-live-reservation' }, journal,
    captureCheckoutResponse }); }
  finally { await Promise.allSettled(networkCaptures); }
  console.log(JSON.stringify({ stage: 'ACCEPTED_PENDING_HOLD', ...hold, court, date, startTime,
    endTime: plan.endTime, price: plan.totalPrice }));
  if (checkoutToken && bookingNumber) {
    const path = `/api/public/bookings/booking-no/${encodeURIComponent(bookingNumber)}`;
    const grant = await page.evaluate(async ({ path, token }) => {
      const url = new URL(path, location.origin);
      url.searchParams.set('checkoutToken', token);
      url.searchParams.set('grantCheckoutAccess', '1');
      const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
      return { status: response.status, success: response.ok };
    }, { path, token: checkoutToken });
    console.log(JSON.stringify({ stage: 'OFFICIAL_CHECKOUT_ACCESS', ...grant }));
  }
  await page.goto(officialCheckoutUrl(hold.bookingIds[0]!), { waitUntil: 'domcontentloaded', timeout: 45_000 });
  console.log(JSON.stringify({ stage: 'OFFICIAL_CHECKOUT_ROUTE', url: page.url(), title: await page.title() }));
} finally { await browser.close(); }
