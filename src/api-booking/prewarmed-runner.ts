import { performance } from 'node:perf_hooks';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DateTime } from 'luxon';
import { chromium, type Browser } from 'playwright';
import { browserIdentity, verifyDedicatedChrome } from '../browser.js';
import { loadConfig, releaseCalendar, releaseCalendarOn, ONDA_URL, VENUE } from '../config.js';
import { discoverApiAvailability } from './availability-engine.js';
import { OndaLiveAvailabilityProvider, THIRSTY_PICKLE_FACILITY_ID } from './live-availability-provider.js';
import { loadLocalCheckoutCustomer, THIRSTY_PICKLE_CLIENT_ID } from './local-customer.js';
import { buildStandardPublicCheckoutRequest } from './public-checkout.js';
import { acquireFreshSlotProofs } from './slot-proofs.js';
import type { BookingPreferences, BookingPlan } from './types.js';

// Observation and preparation only. This module intentionally has no checkout transport or POST permit import.
type Stage = { startedAt: string; durationMs: number };
const stamp = () => new Date().toISOString();
const elapsed = (start: number) => Math.round((performance.now() - start) * 10) / 10;
const priorJournalPath = resolve('.local/api-booking/submission-journal/ca3d4b28720677734aeec133f295ab191c4101560c14e54a5e6502383b9560ab.json');

function priorIntentStatus(): string {
  try {
    if (!existsSync(priorJournalPath)) return 'MISSING_REVIEW_REQUIRED';
    const record = JSON.parse(readFileSync(priorJournalPath, 'utf8')) as { state?: unknown };
    return record.state === 'unknown' ? 'UNKNOWN_RECONCILIATION_REQUIRED' : 'REVIEW_REQUIRED';
  } catch { return 'UNREADABLE_REVIEW_REQUIRED'; }
}

function preferencesFor(config: ReturnType<typeof loadConfig>, targetDate: string): BookingPreferences {
  return { mode: config.BOOKING_TYPE, targetDate, durationHours: config.DURATION_HOURS,
    preferredStartTimes: [config.START_TIME], fallbackStartTimes: config.FALLBACK_TIMES,
    courtPriority: config.PREFERRED_COURTS, fallbackCourts: config.FALLBACK_COURTS,
    courtCount: config.COURT_COUNT, maximumTotalPrice: config.MAX_PRICE, currency: 'PHP' };
}

async function attachPreparedBrowser(): Promise<{ browser: Browser; stage: Stage }> {
  const startedAt = stamp(), start = performance.now();
  const identity = browserIdentity('A');
  verifyDedicatedChrome(identity);
  const browser = await chromium.connectOverCDP(identity.cdpUrl, { timeout: 10_000 });
  try {
    if (browser.contexts().length !== 1) throw Error('BROWSER_CONTEXT_AMBIGUOUS');
    const pages = browser.contexts()[0]!.pages().filter(page => page.url() === ONDA_URL);
    if (pages.length !== 1) throw Error('ONDA_TAB_AMBIGUOUS_OR_MISSING');
    if ((await pages[0]!.getByTestId('public-booking-hero-title').innerText()).trim() !== VENUE)
      throw Error('ONDA_VENUE_INVALID');
    return { browser, stage: { startedAt, durationMs: elapsed(start) } };
  } catch (error) { await browser.close(); throw error; }
}

async function waitUntil(releaseMs: number): Promise<void> {
  while (true) {
    const remaining = releaseMs - Date.now();
    if (remaining <= 0) return;
    await new Promise<void>(resolveWait => setTimeout(resolveWait, Math.min(remaining, 1_000)));
  }
}

function planHours(plan: BookingPlan) {
  return plan.courts.flatMap(court => court.slots.map(slot => ({
    spaceId: slot.spaceId, date: slot.date, startTime: slot.startTime, endTime: slot.endTime,
  })));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const attach = args.includes('--attach-browser');
  const benchmark = args.indexOf('--benchmark-date');
  const release = args.indexOf('--release-date');
  const twoHour = args.indexOf('--benchmark-two-hour');
  if (args.some((arg, index) => !['--attach-browser', '--benchmark-date', '--release-date', '--benchmark-two-hour'].includes(arg) &&
      (benchmark === -1 || index !== benchmark + 1) && (release === -1 || index !== release + 1) &&
      (twoHour === -1 || (index !== twoHour + 1 && index !== twoHour + 2))) ||
      (benchmark !== -1 && release !== -1) ||
      (twoHour !== -1 && benchmark === -1) ||
      (benchmark !== -1 && !args[benchmark + 1]) || (release !== -1 && !args[release + 1]))
    throw Error('RUNNER_ARGUMENTS_INVALID');
  const overrideStart = twoHour === -1 ? null : args[twoHour + 1];
  const overrideCourt = twoHour === -1 ? null : Number(args[twoHour + 2]);
  if (twoHour !== -1 && (!/^([01]\d|2[0-2]):00$/.test(overrideStart ?? '') ||
    !Number.isInteger(overrideCourt) || overrideCourt! < 1 || overrideCourt! > 7))
    throw Error('BENCHMARK_TWO_HOUR_INVALID');

  const startupMs = Math.round(performance.now() * 10) / 10;
  const prepareStart = performance.now(), prepareAt = stamp();
  const config = loadConfig();
  // Validate the private contact binding before release; do not print identity fields.
  const customer = loadLocalCheckoutCustomer();
  const selected = benchmark !== -1 ? { targetDate: args[benchmark + 1]!, releaseMs: null, releaseISO: null } :
    release !== -1 ? releaseCalendarOn(config, args[release + 1]!) : releaseCalendar(config);
  const date = DateTime.fromISO(selected.targetDate, { zone: config.TIMEZONE });
  if (!date.isValid || date.toISODate() !== selected.targetDate) throw Error('RUNNER_TARGET_DATE_INVALID');
  if (benchmark !== -1 && date.startOf('day').toMillis() > DateTime.now().setZone(config.TIMEZONE).startOf('day').toMillis())
    throw Error('BENCHMARK_DATE_NOT_RELEASED');
  if (benchmark === -1 && (selected.releaseMs === null || selected.releaseMs <= Date.now()))
    throw Error('RELEASE_TIME_NOT_FUTURE');
  const preferences = twoHour === -1 ? preferencesFor(config, selected.targetDate) : {
    ...preferencesFor(config, selected.targetDate), mode: 'standard' as const, durationHours: 2,
    courtCount: 1 as const, preferredStartTimes: [overrideStart!], fallbackStartTimes: [],
    courtPriority: [overrideCourt!], fallbackCourts: [], exactCourts: [[overrideCourt!]],
  };
  let availabilityHeaders: Stage | null = null;
  const provider = new OndaLiveAvailabilityProvider({ fetcher: async (input, init) => {
    const startedAt = stamp(), start = performance.now();
    const response = await fetch(input, init);
    availabilityHeaders = { startedAt, durationMs: elapsed(start) };
    return response;
  } });
  const journal = priorIntentStatus();
  let browser: Browser | undefined;
  let browserStage: Stage | null = null;
  try {
    if (attach) {
      const connected = await attachPreparedBrowser();
      browser = connected.browser;
      browserStage = connected.stage;
    }
    const preparation: Stage = { startedAt: prepareAt, durationMs: elapsed(prepareStart) };
    const blockers = [
      'CHECKOUT_VERIFICATION_BINDING_UNSUPPORTED', 'EXACT_BOOKING_APPROVAL_REQUIRED',
      ...(journal === 'UNKNOWN_RECONCILIATION_REQUIRED' ? ['PRIOR_INTENT_UNRECONCILED'] : []),
      ...(config.BOOKING_METHOD !== 'api-first' ? ['SAVED_METHOD_NOT_API_FIRST'] : []),
      ...(config.BOOKING_TYPE !== 'standard' || config.DURATION_HOURS !== 2 || config.COURT_COUNT !== 1
        ? ['SAVED_PLAN_NOT_TWO_HOUR_ADAPTER'] : []),
    ];
    console.log(JSON.stringify({ kind: 'API_PREWARM_READY', at: stamp(), targetDate: selected.targetDate,
      releaseAt: selected.releaseISO, mode: benchmark !== -1 ? 'READ_ONLY_BENCHMARK' : 'WAIT_FOR_RELEASE',
      configured: { bookingMethod: config.BOOKING_METHOD, bookingType: config.BOOKING_TYPE,
        durationHours: config.DURATION_HOURS, courtCount: config.COURT_COUNT,
        preferredStartTime: config.START_TIME, fallbackTimeCount: config.FALLBACK_TIMES.length,
        courtPriority: config.PREFERRED_COURTS, maximumPrice: config.MAX_PRICE },
      benchmarkOverride: twoHour === -1 ? null : { durationHours: 2, startTime: overrideStart, court: overrideCourt },
      browser: attach ? 'VERIFIED_PREATTACHED' : 'NOT_REQUESTED', journal, blockers,
      timing: { processStartupMs: startupMs, preparation, browserAttachment: browserStage } }));

    const releaseAt = selected.releaseMs;
    if (releaseAt !== null) await waitUntil(releaseAt);
    const triggeredAt = stamp(), releaseStart = performance.now();
    const triggerLagMs = releaseAt === null ? null : Date.now() - releaseAt;
    const discovered = await discoverApiAvailability(provider, preferences);
    const candidate = discovered.candidates[0];
    if (!candidate) {
      console.log(JSON.stringify({ kind: 'API_PREPARATION_RESULT', at: stamp(), targetDate: selected.targetDate,
        result: 'NO_AVAILABLE_CANDIDATE', checkoutSubmitted: false,
        timing: { releaseTrigger: { intendedAt: selected.releaseISO, actualAt: triggeredAt, lagMs: triggerLagMs },
          availability: discovered.timing, availabilityHeaders, releaseToResultMs: elapsed(releaseStart) } }));
      return;
    }
    const proofAt = stamp(), proofStart = performance.now();
    const proofHeaderMs: number[] = [];
    const proofs = await acquireFreshSlotProofs(planHours(candidate), {
      clientId: THIRSTY_PICKLE_CLIENT_ID, facilityId: THIRSTY_PICKLE_FACILITY_ID,
      concurrency: 2, transport: { async checkSlot(request) {
        const networkStart = performance.now();
        const response = await fetch('https://app.onda.fit/api/public/is-slot-available', {
          method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(request), signal: AbortSignal.timeout(10_000),
        });
        proofHeaderMs.push(Math.round((performance.now() - networkStart) * 10) / 10);
        if (response.status !== 200 || !response.headers.get('content-type')?.toLowerCase().includes('application/json'))
          throw Error('PROOF_HTTP_FAILED');
        return response.json() as Promise<unknown>;
      } },
    });
    const proofMs = elapsed(proofStart);
    const buildAt = stamp(), buildStart = performance.now();
    const request = candidate.mode === 'standard' && candidate.courts.length === 1
      ? buildStandardPublicCheckoutRequest(candidate, customer, THIRSTY_PICKLE_FACILITY_ID, proofs) : null;
    const buildMs = elapsed(buildStart);
    // Proof strings are discarded here; a later authorized checkout must obtain fresh ones again.
    console.log(JSON.stringify({ kind: 'API_PREPARATION_RESULT', at: stamp(), targetDate: selected.targetDate,
      result: 'CANDIDATE_VERIFIED_READ_ONLY', candidate: { courtIds: candidate.courts.map(court => court.court),
        startTime: candidate.startTime, endTime: candidate.endTime, durationHours: candidate.durationHours,
        totalPrice: candidate.totalPrice, currency: candidate.currency, proofCount: proofs.length,
        requestPreparedInMemory: request !== null, requestItemCount: request?.items.length ?? null },
      checkoutSubmitted: false, blockers,
      timing: { releaseTrigger: { intendedAt: selected.releaseISO, actualAt: triggeredAt, lagMs: triggerLagMs },
        availability: discovered.timing, availabilityHeaders,
        candidateSelectionMs: discovered.timing.candidateSelectionMs !== null && discovered.timing.parsedMs !== null
          ? Math.round((discovered.timing.candidateSelectionMs - discovered.timing.parsedMs) * 10) / 10 : null,
        slotVerification: { startedAt: proofAt, durationMs: proofMs, headerDurationsMs: proofHeaderMs },
        requestConstruction: { startedAt: buildAt, durationMs: buildMs },
        officialVerification: null, checkoutSubmission: null, reservationValidation: null, paymentHandoff: null,
        releaseToPreparationMs: elapsed(releaseStart) } }));
  } finally { await browser?.close(); }
}

main().catch(error => {
  const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message)
    ? error.message : 'API_PREWARM_FAILED';
  console.error(JSON.stringify({ kind: 'API_PREWARM_ERROR', at: stamp(), code, checkoutSubmitted: false }));
  process.exitCode = 1;
});
