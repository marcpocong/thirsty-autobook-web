import { chromium } from 'playwright';
import { DateTime } from 'luxon';
import { ONDA_URL } from '../src/config.js';
import { releaseAvailabilityRequest } from '../src/availability-discovery.js';
import { apiCandidates } from '../src/onda-availability.js';
import { Safety } from '../src/safety.js';
import { Telemetry } from '../src/telemetry.js';

// Separate, temporary browser context. Read-only: no booking clicks or checkout.
const date = process.argv[2];
if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('DATE_REQUIRED');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const nav = await page.goto(ONDA_URL, { waitUntil: 'commit', timeout: 30_000 });
  if (process.argv.includes('--observe-date')) {
    const picker = page.getByRole('button', { name: 'Select booking date', exact: true });
    await picker.waitFor({ state: 'visible', timeout: 30_000 });
    await picker.click();
    const selector = `button[data-day="${DateTime.fromISO(date).toFormat('M/d/yyyy')}"]`;
    const day = page.locator(selector);
    await day.waitFor({ state: 'visible', timeout: 10_000 });
    let appAvailabilityResponses = 0;
    page.on('response', response => {
      if (response.url().includes('/date-availability?') && response.status() === 200) appAvailabilityResponses++;
    });
    const initiallyEnabled = await day.isEnabled();
    await page.waitForTimeout(22_000);
    console.log(JSON.stringify({ probe: 'NO_RELOAD_DATE_STATE', initiallyEnabled,
      enabledAfter22s: await day.isEnabled(), appAvailabilityResponses, reloads: 0 }));
    process.exitCode = 0;
  } else {
  const t = new Telemetry();
  const started = performance.now();
  const request = releaseAvailabilityRequest(page, date, new Safety(), t, 10_000)();
  const reload = process.argv.includes('--reload') ? await page.reload({ waitUntil: 'commit', timeout: 30_000 }) : null;
  const result = await request;
  const start = process.argv.find(value => /^--start=(0[89]|1\d|2[01]):00$/.test(value))?.slice(8) ?? '15:00';
  const hour = Number(start.slice(0, 2));
  const preferences = [7, 6, 5, 4, 3, 2, 1].map(court => ({ court,
    hours: [0, 1, 2].map(offset => `${String(hour + offset).padStart(2, '0')}:00`) }));
  console.log(JSON.stringify({ navigationStatus: nav?.status() ?? null,
    reloadStatus: reload?.status() ?? null,
    elapsedMs: Math.round(performance.now() - started), parsed: !!result,
    released: result?.released ?? null, knownCourts: result?.knownCourts ?? null,
    queriedStart: start, preferredCandidates: result ? apiCandidates(result, preferences, 10_000).map(candidate => candidate.court) : null,
    firstOpenHour: result?.slots.find(slot => slot.available && slot.price !== undefined && slot.currency === 'PHP')
      ? { court: result.slots.find(slot => slot.available && slot.price !== undefined && slot.currency === 'PHP')!.court,
        startTime: result.slots.find(slot => slot.available && slot.price !== undefined && slot.currency === 'PHP')!.startTime } : null,
    events: t.events.map(event => ({ event: event.event, ...(event.event === 'availabilityHttpStatus' ? { value: event.value } : {}) })) }));
  }
} finally { await browser.close(); }
