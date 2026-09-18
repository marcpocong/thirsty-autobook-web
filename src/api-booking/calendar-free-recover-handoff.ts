import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { ONDA_URL } from '../config.js';
import { officialCheckoutUrl } from './checkout-restoration.js';

/** Read-only recovery from the saved response to the official checkout UI. Never creates another hold. */
const path = '.local/api-booking/submission-journal-session-20260919-second/checkout-transport-response.json';
const captured = JSON.parse(await readFile(path, 'utf8')) as { status: number; body: string };
if (captured.status !== 200) throw Error('SAVED_RESPONSE_NOT_ACCEPTED');
const body = JSON.parse(captured.body) as { success: boolean; bookings?: Array<{
  id?: string; booking_no?: string; checkoutToken?: string; hold_expires_at?: string }> };
const booking = body.bookings?.[0];
if (body.success !== true || body.bookings?.length !== 1 || !booking?.id || !booking.booking_no ||
  !booking.checkoutToken || !booking.hold_expires_at) throw Error('SAVED_BOOKING_INCOMPLETE');
if (Date.parse(booking.hold_expires_at) <= Date.now()) throw Error('SAVED_HOLD_EXPIRED');
const browser = await chromium.connectOverCDP('http://127.0.0.1:19333');
try {
  const page = browser.contexts()[0]?.pages().find(page => page.url() === ONDA_URL ||
    page.url().startsWith('https://app.onda.fit/book/thirsty-pickle?bookingId='));
  if (!page) throw Error('ONDA_VENUE_PAGE_MISSING');
  const grant = await page.evaluate(async ({ bookingNo, token }) => {
    const url = new URL(`/api/public/bookings/booking-no/${encodeURIComponent(bookingNo)}`, location.origin);
    url.searchParams.set('checkoutToken', token);
    url.searchParams.set('grantCheckoutAccess', '1');
    const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
    return { status: response.status, success: response.ok };
  }, { bookingNo: booking.booking_no, token: booking.checkoutToken });
  console.log(JSON.stringify({ stage: 'OFFICIAL_CHECKOUT_ACCESS', ...grant }));
  await page.goto(officialCheckoutUrl(booking.id), { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: '.local/api-booking/submission-journal-session-20260919-second/official-handoff.png', fullPage: true });
  const visible = await page.locator('body').innerText();
  console.log(JSON.stringify({ stage: 'OFFICIAL_CHECKOUT_ROUTE', url: page.url(), title: await page.title(),
    bookingId: booking.id, bookingNo: booking.booking_no, holdExpiresAt: booking.hold_expires_at,
    visibleIndicators: ['Payment Summary', 'QRPH', 'Pending', 'Court 2', '12:00', '700'].filter(value => visible.includes(value)) }));
} finally { await browser.close(); }
