import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { mkdir, open } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';
import { z } from 'zod';
import { ONDA_URL, VENUE, loadConfig, planFingerprint } from '../config.js';
import { browserIdentity, verifyDedicatedChromeAsync } from '../browser.js';
import { emitUiEvent } from '../ui-events.js';
import { discoverApiAvailability } from './availability-engine.js';
import { OndaLiveAvailabilityProvider, THIRSTY_PICKLE_FACILITY_ID } from './live-availability-provider.js';
import { parseAvailability } from './availability-parser.js';
import { DurableSubmissionJournal } from './durable-submission-journal.js';
import { loadLocalCheckoutCustomer } from './local-customer.js';
import { submitCalendarFreeTwoHourCheckout } from './calendar-free-checkout.js';
import { officialCheckoutUrl } from './checkout-restoration.js';
import { OndaBrowserSessionTransport } from './browser-session-transport.js';
import { calendarFreeSecurityContext } from './calendar-free-security-context.js';
import { firstUnjournaledAvailableCandidate } from './candidate-journal.js';
import { standardCheckoutChunks } from './extended-checkout.js';
import { observedResponse, standardPlanJournalKeys } from './two-hour-reservation.js';
import { checkoutDiagnostic } from './checkout-diagnostics.js';
import { ApiRunProgressLog } from './run-progress-log.js';
import { ApiAutomationLock } from './api-automation-lock.js';
import { assertApiReleaseFresh } from './api-release.js';
import { canReleaseApiLockAfterParallelFailure } from './api-lock-outcome.js';
import { requiredWorkerIds } from '../workers.js';
import { showWorkerPage } from '../browser-window.js';
import { prooflessCourtHourStatuses, prooflessReleasePlan, resolveProoflessReleasePlan, submitDirectCheckout } from './proofless-checkout.js';
import { readPublicBookingRecords } from './public-bookings.js';
import { API_SECURITY_PREWARM_LEAD_MS, safeApiFailureCode } from './run-observability.js';
import { availabilityObservation, diagnosticLaneForWorker, RunDiagnostics, safeDiagnosticCode } from './run-diagnostics.js';
const preferencesSchema = z.object({ strategy: z.enum(['standard', 'extended']), date: z.iso.date(), start: z.string().regex(/^(0[89]|1\d|2[0-3]):00$/),
    duration: z.number().int().min(1).max(6), courtCount: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7)]), maximum: z.number().optional(),
    priority: z.array(z.number().int().min(1).max(7)).min(1),
    fallbackStarts: z.array(z.string().regex(/^(0[89]|1\d|2[0-3]):00$/)),
    exact: z.array(z.array(z.number().int().min(1).max(7))).optional() }).strict();
const command = z.object({ mode: z.enum(['prepare', 'dry', 'audit', 'live', 'live-now']), date: z.iso.date(),
    checkoutMethod: z.enum(['proof-based', 'proofless']).optional(), clockOffsetMs: z.number().finite().optional(), releaseMs: z.number().int().positive().optional(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    preferences: preferencesSchema.optional() }).strict().parse(JSON.parse(process.argv[2] ?? '{}'));
const abort = new AbortController();
process.on('message', message => { if (message?.type === 'abort')
    abort.abort(); });
const started = performance.now();
const nowMs = () => Date.now() + (command.clockOffsetMs ?? 0);
const stamp = () => Math.round(performance.now() - started);
const progressLog = new ApiRunProgressLog(command.mode, command.date);
const diagnostics = new RunDiagnostics(progressLog, started);
const stage = (name, extra = {}) => {
    const entry = progressLog.record(name, new Date(nowMs()).toISOString(), stamp(), extra);
    emitUiEvent({ type: 'apiStage', stage: name, at: entry.at, elapsedMs: entry.elapsedMs,
        sincePreviousMs: entry.sincePreviousMs, ...(name === 'RUN_STARTED' ? { runId: progressLog.runId } : {}), ...extra });
};
// High-frequency forensic evidence stays in the append-only local trace and
// does not flood the operator UI or Previous Runs activity list.
const trace = (name, extra = {}) => progressLog.recordDiagnostic(name, new Date(nowMs()).toISOString(), stamp(), extra);
stage('RUN_STARTED');
const ensureActive = () => { if (abort.signal.aborted)
    throw Error('USER_ABORT'); };
// Windows' default timer resolution (~15.6ms) makes setTimeout overshoot short
// waits by up to that much, which matters right at the release trigger instant.
// Below this threshold, spin on setImmediate (sub-ms scheduling) instead.
const SPIN_TAIL_MS = 20;
const pause = (ms) => new Promise((done, fail) => {
    if (abort.signal.aborted) {
        fail(Error('USER_ABORT'));
        return;
    }
    if (ms <= SPIN_TAIL_MS) {
        const deadline = performance.now() + ms;
        const onAbort = () => { abort.signal.removeEventListener('abort', onAbort); fail(Error('USER_ABORT')); };
        abort.signal.addEventListener('abort', onAbort, { once: true });
        const tick = () => {
            if (abort.signal.aborted)
                return;
            if (performance.now() >= deadline) {
                abort.signal.removeEventListener('abort', onAbort);
                done();
                return;
            }
            setImmediate(tick);
        };
        tick();
        return;
    }
    const onAbort = () => { clearTimeout(timer); fail(Error('USER_ABORT')); };
    const timer = setTimeout(() => { abort.signal.removeEventListener('abort', onAbort); done(); }, ms);
    abort.signal.addEventListener('abort', onAbort, { once: true });
});
const saveOnce = async (directory, filename, content) => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = await open(join(directory, filename), 'wx', 0o600);
    try {
        await file.writeFile(JSON.stringify(content));
        await file.sync();
    }
    finally {
        await file.close();
    }
};
const sanitizedCheckoutCapture = (response) => {
    let parsed;
    try {
        parsed = JSON.parse(response.body);
    }
    catch { }
    return { capturedAt: new Date(nowMs()).toISOString(), status: response.status, contentType: response.contentType,
        diagnostic: checkoutDiagnostic(response), observed: observedResponse(parsed, 'RESPONSE_CAPTURED') };
};
const connectedBrowsers = [];
let liveLock, retainLiveLock = false, verifiedHold = false;
let latestVerifiedHoldExpiry;
let persistedVerifiedHoldExpiry;
let finalDiagnosticCode = 'COMPLETED';
const persistLatestVerifiedHold = async () => {
    if (!liveLock || !latestVerifiedHoldExpiry || latestVerifiedHoldExpiry === persistedVerifiedHoldExpiry)
        return;
    await liveLock.held(latestVerifiedHoldExpiry);
    persistedVerifiedHoldExpiry = latestVerifiedHoldExpiry;
};
async function prepareWorker(workerId) {
    const identity = browserIdentity(workerId);
    stage('PREPARING_BROWSER', { workerId });
    try {
        await verifyDedicatedChromeAsync(identity);
    }
    catch (error) {
        if (!(error instanceof Error) || error.message !== 'CDP_NOT_LISTENING')
            throw error;
        await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
            resolve('scripts/start-onda-chrome.ps1'), '-Worker', workerId, '-Port', String(identity.port)], { cwd: process.cwd(), windowsHide: true, timeout: 30_000 });
        // The starter exits successfully only after verifying the new listener,
        // Chrome process, port, and exact dedicated profile.
    }
    const browser = await chromium.connectOverCDP(identity.cdpUrl);
    connectedBrowsers.push(browser);
    const context = browser.contexts()[0];
    if (!context)
        throw Error('API_BROWSER_CONTEXT_MISSING');
    const matchingPages = context.pages().filter(candidate => candidate.url() === ONDA_URL);
    const page = matchingPages[0] ?? await context.newPage();
    await Promise.all(matchingPages.slice(1).map(duplicate => duplicate.close().catch(() => undefined)));
    if (page.url() !== ONDA_URL)
        await page.goto(ONDA_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.getByTestId('public-booking-hero-title').first().waitFor({ state: 'visible', timeout: 45_000 });
    if ((await page.getByTestId('public-booking-hero-title').first().innerText()).trim() !== VENUE)
        throw Error('WRONG_VENUE');
    await showWorkerPage(page, workerId);
    stage('BROWSER_READY', { workerId, port: identity.port });
    return { workerId, browser, page, port: identity.port };
}
/** One read-only availability GET; every read lands in the trace with its exact 112-cell matrix. */
async function readAvailabilitySnapshot(date) {
    ensureActive();
    const requestedAt = performance.now();
    const finish = diagnostics.begin('availability', 'AVAILABILITY_REQUEST_STARTED', {}, {});
    try {
        const provider = new OndaLiveAvailabilityProvider({ allowIncompleteRange: true });
        const envelope = await provider.getAvailability({ startDate: date, endDate: date });
        const snapshot = parseAvailability(envelope.raw, { startDate: date, endDate: date, capturedAt: envelope.capturedAt,
            fixtureKind: envelope.fixtureKind, label: envelope.label, now: new Date(), maximumAgeMs: 15_000, requireCompleteRange: false });
        finish('AVAILABILITY_REQUEST_COMPLETED', { ...availabilityObservation(snapshot, date), status: 'SUCCESS' });
        return snapshot;
    }
    catch (error) {
        const code = error instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.message)
            ? error.message : 'AVAILABILITY_READ_FAILED';
        trace('AVAILABILITY_SAMPLE_FAILED', { durationMs: Math.round(performance.now() - requestedAt), code });
        finish('AVAILABILITY_REQUEST_COMPLETED', { status: 'FAILED', failureCategory: code, targetDatePresent: false,
            responseComplete: false, slotCount: 0, availableCount: 0 });
        return;
    }
}
const readKnownCourtHourBlocks = (date) => readPublicBookingRecords(date, { onCourt: (court, outcome) => trace('PUBLIC_BOOKING_BLOCK_SAMPLE', { court, ...outcome }) });
try {
    if (process.env.THIRSTY_API_INSTALLATION !== '1' && process.env.THIRSTY_API_TEST_INSTALLATION !== '1')
        throw Error('API_INSTALLATION_REQUIRED');
    const config = loadConfig();
    const requested = command.preferences;
    stage('RUN_CONFIGURATION', { bookingMethod: config.BOOKING_METHOD,
        workerCount: requiredWorkerIds(config.BOOKING_TYPE, config.COURT_COUNT).length,
        prewarmLeadMs: API_SECURITY_PREWARM_LEAD_MS,
        ...(command.releaseMs ? { releaseMs: command.releaseMs } : {}) });
    const strategy = requested?.strategy ?? config.BOOKING_TYPE;
    const duration = requested?.duration ?? config.DURATION_HOURS;
    const courtCount = requested?.courtCount ?? config.COURT_COUNT;
    if (command.mode === 'audit') {
        const [snapshot, publicRecords] = await Promise.all([readAvailabilitySnapshot(command.date), readKnownCourtHourBlocks(command.date)]);
        const cells = prooflessCourtHourStatuses(snapshot, command.date, publicRecords.blocks, publicRecords.failedCourts);
        for (const value of cells)
            trace('COURT_HOUR_STATUS', { court: value.court, hour: value.hour, status: value.status, source: value.source, ...(value.price !== undefined ? { price: value.price } : {}) });
        emitUiEvent({ type: 'blockAudit', date: command.date, cells });
        stage('BLOCK_AUDIT_COMPLETE');
        throw Error('BLOCK_AUDIT_COMPLETE');
    }
    if (!command.preferences && !['api-first', 'proofless'].includes(config.BOOKING_METHOD))
        throw Error('API_FIRST_METHOD_REQUIRED');
    if (strategy === 'standard' && (duration < 1 || duration > 3) ||
        strategy === 'extended' && (duration < 4 || duration > 6) || ![1, 2, 3, 4, 5, 6, 7].includes(courtCount))
        throw Error('API_FIRST_COURT_COUNT_UNSUPPORTED');
    if (!command.preferences && command.fingerprint !== planFingerprint(config))
        throw Error('API_PLAN_CHANGED');
    if ((command.mode === 'live' || command.mode === 'live-now') && process.env.ONDA_API_FIRST_LIVE !== 'ARMED')
        throw Error('API_LIVE_NOT_ARMED');
    if (command.mode === 'live' && !command.releaseMs)
        throw Error('API_RELEASE_TIME_REQUIRED');
    const workerIds = requiredWorkerIds(strategy, courtCount);
    if (command.mode === 'live' || command.mode === 'live-now')
        liveLock = await ApiAutomationLock.acquire(strategy, workerIds);
    const customers = command.mode === 'dry' ? undefined :
        Object.fromEntries(workerIds.map(worker => [worker, loadLocalCheckoutCustomer(worker)]));
    // The dedicated profiles are independent. Wait for both checks to settle so
    // a failure in one browser cannot leave an unobserved preparation running.
    const prepared = await Promise.allSettled(workerIds.map(prepareWorker));
    prepared.forEach((result, index) => stage('BROWSER_PREPARATION_OUTCOME', { workerId: workerIds[index], status: result.status,
        code: result.status === 'fulfilled' ? 'COMPLETED' : safeApiFailureCode(result.reason, 'API_BROWSER_PREPARATION_FAILED') }));
    const failure = prepared.find((result) => result.status === 'rejected');
    if (failure)
        throw Error(safeApiFailureCode(failure.reason, 'API_BROWSER_PREPARATION_FAILED'));
    const sessions = prepared.map(result => { if (result.status !== 'fulfilled')
        throw Error('API_BROWSER_PREPARATION_FAILED'); return result.value; });
    if (command.mode === 'prepare') {
        process.exitCode = 0;
    }
    else {
        if (command.mode === 'live' || command.mode === 'live-now') {
            process.env.ONDA_CALENDAR_FREE_CHECKOUT = 'APPROVED_ONE_SHOT';
            process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
        }
        const responseCaptures = new Map();
        const releaseTransports = new Map();
        const activeAttemptContexts = new Map();
        const activeTransportOperations = new Map();
        const transportContext = (workerId) => activeAttemptContexts.get(workerId) ??
            { workerId, lane: diagnosticLaneForWorker(workerId) };
        const beginTransport = (key, operation, stage, context, extra) => {
            const end = diagnostics.begin(operation, stage, context, extra), queue = activeTransportOperations.get(key) ?? [];
            queue.push(end);
            activeTransportOperations.set(key, queue);
        };
        const endTransport = (key, stage, context, extra) => {
            const queue = activeTransportOperations.get(key), end = queue?.shift();
            if (queue && !queue.length)
                activeTransportOperations.delete(key);
            if (end)
                end(stage, extra);
            else
                diagnostics.observe(stage, context, extra);
        };
        const observeTransport = (workerId, observation) => {
            const context = transportContext(workerId);
            if (observation.event === 'SECURITY_PREPARATION_STARTED') {
                beginTransport(`${workerId}:security:${observation.securitySource}`, 'security', observation.event, context, observation);
                return;
            }
            if (observation.event === 'SECURITY_PREPARATION_COMPLETED') {
                endTransport(`${workerId}:security:${observation.securitySource}`, observation.event, context, observation);
                return;
            }
            if (observation.event === 'SLOT_CHECK_STARTED') {
                beginTransport(`${workerId}:slot`, 'slotCheck', observation.event, context, observation);
                return;
            }
            if (observation.event === 'SLOT_CHECK_COMPLETED') {
                endTransport(`${workerId}:slot`, observation.event, context, observation);
                return;
            }
            if (observation.event === 'CHECKOUT_HTTP_POST_INITIATED') {
                beginTransport(`${workerId}:checkout`, 'checkout', observation.event, context, observation);
                return;
            }
            if (observation.event === 'CHECKOUT_RESPONSE_COMPLETED') {
                endTransport(`${workerId}:checkout`, observation.event, context, observation);
                return;
            }
            diagnostics.observe(observation.event, context, observation);
        };
        if (command.mode === 'live' || command.mode === 'live-now' && command.checkoutMethod === 'proofless')
            for (const session of sessions) {
                const workerId = session.workerId;
                releaseTransports.set(workerId, new OndaBrowserSessionTransport(session.page, () => calendarFreeSecurityContext(session.page)(), response => responseCaptures.get(workerId)?.(response) ?? Promise.reject(Error('CHECKOUT_RESPONSE_CAPTURE_MISSING')), { onHumanVerificationRequired: async () => {
                        await session.page.evaluate(id => { document.title = `THIRSTY BOT ${id} - VERIFY HERE`; }, workerId);
                        await showWorkerPage(session.page, workerId);
                        stage('HUMAN_VERIFICATION_REQUIRED', { workerId });
                    }, onHumanVerificationCompleted: async () => { stage('HUMAN_VERIFICATION_COMPLETE', { workerId }); } }, observation => observeTransport(workerId, observation)));
            }
        // Hoisted so the E/F adaptive lane can dispatch a proof-based attempt as
        // soon as its court is ready, through the exact same verified path as the
        // main A-D/G-H batch dispatched later.
        const makeAttempts = (plans, ids, availability, requestedAttemptType) => plans.map((chunkPlan, index) => {
            const workerId = ids[index];
            if (!workerId)
                throw Error('API_CHECKOUT_WORKER_MISSING');
            const session = sessions.find(value => value.workerId === workerId), customer = customers?.[workerId];
            if (!session || !customer)
                throw Error('API_CHECKOUT_WORKER_MISSING');
            const keys = standardPlanJournalKeys(chunkPlan, THIRSTY_PICKLE_FACILITY_ID);
            const directories = keys.map(key => resolve('.local/api-booking/api-first-journals', key));
            const lane = diagnosticLaneForWorker(workerId);
            const attemptType = requestedAttemptType ?? 'official';
            return { chunkPlan, workerId, session, customer, keys, directories, availability, lane, attemptType,
                attemptId: diagnostics.nextAttemptId(lane, workerId, attemptType),
                journals: directories.map(directory => new DurableSubmissionJournal(directory)) };
        });
        const executeAttemptInner = async (attempt) => {
            const { chunkPlan, workerId, session, customer, keys, directories, journals, availability } = attempt;
            ensureActive();
            const workerStarted = performance.now();
            const workerTiming = () => ({ workerId, workerElapsedMs: Math.round(performance.now() - workerStarted) });
            const key = keys[0], directory = directories[0], journal = journals[0];
            let token, bookingNo;
            const capture = async (response) => {
                await saveOnce(directory, 'checkout-response-private.json', sanitizedCheckoutCapture(response));
                try {
                    const value = JSON.parse(response.body);
                    if (value.success === true && value.bookings?.length === chunkPlan.durationHours * chunkPlan.courts.length &&
                        value.bookings[0]?.id && value.bookings[0]?.booking_no && value.bookings[0]?.checkoutToken) {
                        token = value.bookings[0].checkoutToken;
                        bookingNo = value.bookings[0].booking_no;
                    }
                }
                catch { /* Raw response is in the private journal. */ }
            };
            if (command.mode === 'live')
                responseCaptures.set(workerId, capture);
            stage('FRESH_VERIFICATION_AND_PROOFS', { workerId });
            let hold;
            try {
                hold = await submitCalendarFreeTwoHourCheckout({ page: session.page, plan: chunkPlan,
                    availability,
                    customer, approval: { courts: chunkPlan.courts.map(court => court.court), date: command.date,
                        startTime: chunkPlan.startTime, endTime: chunkPlan.endTime,
                        maximumAmount: chunkPlan.totalPrice, customerId: customer.customerId,
                        approvalReference: `desktop-api-first-${workerId}-${key}` }, journal,
                    additionalJournals: journals.slice(1), captureCheckoutResponse: capture, transport: releaseTransports.get(workerId),
                    onPhase: phase => stage(phase, workerTiming()),
                    onHumanVerificationRequired: async () => {
                        await session.page.evaluate(id => { document.title = `THIRSTY BOT ${id} - VERIFY HERE`; }, workerId);
                        await showWorkerPage(session.page, workerId);
                        stage('HUMAN_VERIFICATION_REQUIRED', { workerId });
                    },
                    onHumanVerificationCompleted: async () => { stage('HUMAN_VERIFICATION_COMPLETE', { workerId }); } });
            }
            catch (error) {
                const code = error instanceof Error ? error.message : '';
                if (/TURNSTILE|SECURITY_CONTEXT|CHALLENGE/.test(code)) {
                    await showWorkerPage(session.page, workerId);
                    stage('HUMAN_VERIFICATION_REQUIRED', { workerId, code });
                }
                throw error;
            }
            verifiedHold = true;
            retainLiveLock = true;
            if (!latestVerifiedHoldExpiry || Date.parse(hold.holdExpiresAt) > Date.parse(latestVerifiedHoldExpiry))
                latestVerifiedHoldExpiry = hold.holdExpiresAt;
            const bookingTarget = { date: command.date, court: chunkPlan.courts[0].court, ...(chunkPlan.courts[1] ? { courtB: chunkPlan.courts[1].court } : {}),
                startTime: chunkPlan.startTime, durationHours: chunkPlan.durationHours };
            stage('PENDING_HOLD', { ...workerTiming(), ...bookingTarget, bookingId: hold.bookingIds[0], bookingNo: bookingNo ?? '',
                holdExpiresAt: hold.holdExpiresAt, price: chunkPlan.totalPrice });
            diagnostics.observe('DIAGNOSTIC_VERIFIED_HOLD', attempt, { ...bookingTarget, price: chunkPlan.totalPrice });
            if (!token || !bookingNo)
                throw Error('OFFICIAL_CHECKOUT_TOKEN_MISSING');
            const grant = await session.page.evaluate(async ({ bookingNo, token }) => {
                const url = new URL(`/api/public/bookings/booking-no/${encodeURIComponent(bookingNo)}`, location.origin);
                url.searchParams.set('checkoutToken', token);
                url.searchParams.set('grantCheckoutAccess', '1');
                const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
                return response.status;
            }, { bookingNo, token });
            if (grant !== 200)
                throw Error('OFFICIAL_CHECKOUT_ACCESS_FAILED');
            await session.page.goto(officialCheckoutUrl(hold.bookingIds[0]), { waitUntil: 'domcontentloaded', timeout: 45_000 });
            await session.page.getByText('QRPH', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 });
            const body = await session.page.locator('body').innerText();
            if (!body.includes('Pending') || !body.replaceAll(',', '').includes(chunkPlan.totalPrice.toFixed(2)))
                throw Error('OFFICIAL_CHECKOUT_STATE_MISMATCH');
            await showWorkerPage(session.page, workerId);
            stage('OFFICIAL_QRPH_HANDOFF', { ...workerTiming(), ...bookingTarget, bookingId: hold.bookingIds[0], bookingNo,
                holdExpiresAt: hold.holdExpiresAt, price: chunkPlan.totalPrice });
            diagnostics.observe('DIAGNOSTIC_QR_HANDOFF', attempt, { ...bookingTarget, price: chunkPlan.totalPrice });
            return hold;
        };
        const executeAttempt = async (attempt) => {
            activeAttemptContexts.set(attempt.workerId, attempt);
            diagnostics.observe('DIAGNOSTIC_ATTEMPT_STARTED', attempt, { court: attempt.chunkPlan.courts[0].court,
                startTime: attempt.chunkPlan.startTime, durationHours: attempt.chunkPlan.durationHours });
            try {
                const value = await executeAttemptInner(attempt);
                diagnostics.observe('DIAGNOSTIC_ATTEMPT_COMPLETED', attempt, { workerOutcome: 'VERIFIED_HOLD' });
                return value;
            }
            catch (error) {
                diagnostics.observe('DIAGNOSTIC_ATTEMPT_COMPLETED', attempt, { workerOutcome: 'FAILED',
                    failureCategory: safeDiagnosticCode(error, 'CHECKOUT_ATTEMPT_FAILED') });
                throw error;
            }
            finally {
                if (activeAttemptContexts.get(attempt.workerId)?.attemptId === attempt.attemptId)
                    activeAttemptContexts.delete(attempt.workerId);
            }
        };
        const makeProoflessAttempts = (plans, ids) => plans.map((plan, index) => {
            const workerId = ids[index];
            if (!workerId)
                throw Error('API_CHECKOUT_WORKER_MISSING');
            const session = sessions.find(value => value.workerId === workerId), customer = customers?.[workerId], transport = releaseTransports.get(workerId);
            if (!session || !customer || !transport)
                throw Error('API_CHECKOUT_WORKER_MISSING');
            const keys = standardPlanJournalKeys(plan, THIRSTY_PICKLE_FACILITY_ID);
            const directories = keys.map(key => resolve('.local/api-booking/api-first-journals', key));
            const lane = diagnosticLaneForWorker(workerId), attemptType = 'official';
            return { plan, workerId, session, customer, transport, keys, directories, lane, attemptType,
                attemptId: diagnostics.nextAttemptId(lane, workerId, attemptType),
                journals: directories.map(directory => new DurableSubmissionJournal(directory)) };
        });
        const executeProoflessAttempt = async (attempt, releaseMs) => {
            const { plan, workerId, session, customer, transport, keys, directories, journals, lane, attemptType, attemptId } = attempt;
            const correlation = { workerId, lane, attemptType, attemptId };
            activeAttemptContexts.set(workerId, correlation);
            diagnostics.observe('DIAGNOSTIC_ATTEMPT_STARTED', correlation, { court: plan.courts[0].court, startTime: plan.startTime, durationHours: plan.durationHours });
            const workerStarted = performance.now(), workerTiming = () => ({ workerId, workerElapsedMs: Math.round(performance.now() - workerStarted) });
            let token, bookingNo;
            responseCaptures.set(workerId, async (response) => {
                await saveOnce(directories[0], 'checkout-response-private.json', sanitizedCheckoutCapture(response));
                try {
                    const value = JSON.parse(response.body);
                    bookingNo = value.bookings?.[0]?.booking_no;
                    token = value.bookings?.[0]?.checkoutToken;
                }
                catch { }
            });
            try {
                const hold = await submitDirectCheckout(plan, customer, transport, journals[0], releaseMs, journals.slice(1), nowMs);
                verifiedHold = true;
                retainLiveLock = true;
                if (!latestVerifiedHoldExpiry || Date.parse(hold.holdExpiresAt) > Date.parse(latestVerifiedHoldExpiry))
                    latestVerifiedHoldExpiry = hold.holdExpiresAt;
                const bookingTarget = { date: command.date, court: plan.courts[0].court, ...(plan.courts[1] ? { courtB: plan.courts[1].court } : {}),
                    startTime: plan.startTime, durationHours: plan.durationHours };
                stage('PENDING_HOLD', { ...workerTiming(), ...bookingTarget, bookingId: hold.bookingIds[0], bookingNo: bookingNo ?? '',
                    holdExpiresAt: hold.holdExpiresAt, price: plan.totalPrice });
                diagnostics.observe('DIAGNOSTIC_VERIFIED_HOLD', correlation, { ...bookingTarget, price: plan.totalPrice });
                if (!token || !bookingNo)
                    throw Error('OFFICIAL_CHECKOUT_TOKEN_MISSING');
                const grant = await session.page.evaluate(async ({ bookingNo, token }) => {
                    const url = new URL(`/api/public/bookings/booking-no/${encodeURIComponent(bookingNo)}`, location.origin);
                    url.searchParams.set('checkoutToken', token);
                    url.searchParams.set('grantCheckoutAccess', '1');
                    return (await fetch(url, { credentials: 'include', cache: 'no-store' })).status;
                }, { bookingNo, token });
                if (grant !== 200)
                    throw Error('OFFICIAL_CHECKOUT_ACCESS_FAILED');
                await session.page.goto(officialCheckoutUrl(hold.bookingIds[0]), { waitUntil: 'domcontentloaded', timeout: 45_000 });
                await session.page.getByText('QRPH', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 });
                const body = await session.page.locator('body').innerText();
                if (!body.includes('Pending') || !body.replaceAll(',', '').includes(plan.totalPrice.toFixed(2)))
                    throw Error('OFFICIAL_CHECKOUT_STATE_MISMATCH');
                await showWorkerPage(session.page, workerId);
                stage('OFFICIAL_QRPH_HANDOFF', { ...workerTiming(), ...bookingTarget, bookingId: hold.bookingIds[0], bookingNo,
                    holdExpiresAt: hold.holdExpiresAt, price: plan.totalPrice });
                diagnostics.observe('DIAGNOSTIC_QR_HANDOFF', correlation, { ...bookingTarget, price: plan.totalPrice });
                diagnostics.observe('DIAGNOSTIC_ATTEMPT_COMPLETED', correlation, { workerOutcome: 'VERIFIED_HOLD' });
                return hold;
            }
            catch (error) {
                diagnostics.observe('DIAGNOSTIC_ATTEMPT_COMPLETED', correlation, { workerOutcome: 'FAILED',
                    failureCategory: safeDiagnosticCode(error, 'CHECKOUT_ATTEMPT_FAILED') });
                throw error;
            }
            finally {
                if (activeAttemptContexts.get(workerId)?.attemptId === attemptId)
                    activeAttemptContexts.delete(workerId);
            }
        };
        const recordWarmFailures = (name, workers, results, fallback) => results.forEach((result, index) => {
            if (result.status === 'rejected')
                stage(name, { workerId: workers[index], status: 'rejected',
                    code: safeApiFailureCode(result.reason, fallback) });
        });
        let warmup;
        let warmupStartedAt;
        let warmupWorkers = workerIds;
        const startWarmup = (workers = workerIds) => {
            if (warmup)
                return;
            warmupWorkers = [...workers];
            warmupStartedAt = Date.now();
            stage('SECURITY_PREWARM_STARTED');
            warmup = Promise.allSettled(workers.map(async (workerId) => {
                const transport = releaseTransports.get(workerId);
                if (!transport)
                    throw Error('API_CHECKOUT_WORKER_MISSING');
                await transport.prepareCheckoutContext();
                stage('SECURITY_PREWARM_READY', { workerId });
            }));
        };
        const finishWarmup = async (retryOnce = false) => {
            if (!warmup)
                return;
            let results = await warmup;
            recordWarmFailures('SECURITY_PREWARM_FAILED', warmupWorkers, results, 'SECURITY_PREWARM_FAILED');
            let failure = results.find((result) => result.status === 'rejected');
            if (failure && retryOnce) {
                const retryWorkers = warmupWorkers;
                warmup = undefined;
                warmupStartedAt = undefined;
                startWarmup(retryWorkers);
                results = await warmup;
                recordWarmFailures('SECURITY_PREWARM_RETRY_FAILED', warmupWorkers, results, 'SECURITY_PREWARM_FAILED');
                failure = results.find((result) => result.status === 'rejected');
            }
            if (failure)
                throw Error(safeApiFailureCode(failure.reason, 'SECURITY_PREWARM_FAILED'));
        };
        const preferences = { mode: strategy, targetDate: command.date, durationHours: duration,
            preferredStartTimes: [requested?.start ?? config.START_TIME], fallbackStartTimes: requested?.fallbackStarts ?? config.FALLBACK_TIMES,
            courtPriority: requested?.priority ?? config.PREFERRED_COURTS, fallbackCourts: requested ? [] : config.FALLBACK_COURTS,
            courtCount, exactCourts: requested?.exact, maximumTotalPrice: requested?.maximum ?? config.MAX_PRICE, currency: 'PHP' };
        let primaryProoflessPlans;
        let primaryProoflessAttempts;
        if (command.checkoutMethod === 'proofless') {
            // A scheduled release starts this same warmup shortly before 08:00. An
            // immediate Proofless Test has no waiting window, so overlap genuine,
            // page-bound security acquisition with the read-only block audit and
            // journal checks instead of paying for it after dispatch is announced.
            if (command.mode === 'live-now')
                startWarmup(workerIds);
            let snapshot;
            if (command.mode === 'live') {
                const auditAt = command.releaseMs - 30 * 60_000;
                stage('WAITING_FOR_BLOCK_AUDIT', { releaseMs: command.releaseMs });
                while (nowMs() < auditAt) {
                    ensureActive();
                    await pause(Math.min(30_000, auditAt - nowMs()));
                }
                snapshot = await readAvailabilitySnapshot(command.date);
            }
            else if (command.mode === 'dry')
                snapshot = await readAvailabilitySnapshot(command.date);
            const publicRecords = await readKnownCourtHourBlocks(command.date);
            const blockAudit = prooflessCourtHourStatuses(snapshot, command.date, publicRecords.blocks, publicRecords.failedCourts);
            for (const value of blockAudit)
                trace('COURT_HOUR_STATUS', { court: value.court, hour: value.hour, status: value.status, source: value.source, ...(value.price !== undefined ? { price: value.price } : {}) });
            emitUiEvent({ type: 'blockAudit', date: command.date, cells: blockAudit });
            const releasePlan = command.mode === 'live-now' ? prooflessReleasePlan(preferences) : resolveProoflessReleasePlan(preferences, snapshot, publicRecords.blocks, publicRecords.failedCourts);
            primaryProoflessPlans = standardCheckoutChunks(releasePlan);
            if (primaryProoflessPlans.length !== workerIds.length)
                throw Error('DIRECT_WORKER_PLAN_MISMATCH');
            if (command.mode !== 'dry') {
                primaryProoflessAttempts = makeProoflessAttempts(primaryProoflessPlans, workerIds);
                for (const attempt of primaryProoflessAttempts)
                    for (const [index, journal] of attempt.journals.entries()) {
                        const disposition = await journal.recycleReusable(attempt.keys[index]);
                        if (disposition === 'blocked')
                            throw Error('DUPLICATE_LOGICAL_BOOKING_BLOCKED');
                        if (disposition === 'reused')
                            stage('FINISHED_ATTEMPT_REUSABLE', { workerId: attempt.workerId });
                    }
            }
            stage('PRIMARY_PROOFLESS_PLAN_READY', { court: releasePlan.courts[0].court,
                ...(releasePlan.courts[1] ? { courtB: releasePlan.courts[1].court } : {}), date: command.date, startTime: releasePlan.startTime,
                durationHours: releasePlan.durationHours, assumedPrice: releasePlan.totalPrice });
        }
        if (command.mode === 'live') {
            const releaseMs = command.releaseMs;
            if (releaseMs <= nowMs())
                throw Error('RELEASE_MISSED');
            stage('WAITING_FOR_RELEASE', { releaseMs });
            while (nowMs() < releaseMs) {
                ensureActive();
                const remaining = releaseMs - nowMs();
                if (remaining <= API_SECURITY_PREWARM_LEAD_MS)
                    startWarmup();
                await pause(Math.min(500, Math.max(1, remaining), warmup ? 500 : Math.max(1, remaining - API_SECURITY_PREWARM_LEAD_MS)));
            }
            assertApiReleaseFresh(releaseMs, nowMs());
            stage('RELEASE_TRIGGERED');
            await finishWarmup();
        }
        ensureActive();
        let discovery;
        let checkoutPlans;
        if (primaryProoflessPlans) {
            checkoutPlans = primaryProoflessPlans;
        }
        else {
            stage('FETCHING_AVAILABILITY');
            discovery = await discoverApiAvailability(new OndaLiveAvailabilityProvider(), preferences);
            ensureActive();
            diagnostics.observe('RELEASE_AVAILABILITY_MATRIX', {}, { ...availabilityObservation(discovery.snapshot, command.date),
                durationMs: Math.round(discovery.timing.totalMs ?? 0) });
            if (command.mode === 'live')
                for (const value of prooflessCourtHourStatuses(discovery.snapshot, command.date))
                    trace('COURT_HOUR_STATUS', { court: value.court, hour: value.hour, status: value.status, ...(value.price !== undefined ? { price: value.price } : {}) });
            if (!discovery.candidates.length)
                throw Error('API_NO_AVAILABLE_CANDIDATE');
            const selected = command.mode === 'dry' ? { plan: discovery.candidates[0] } :
                await firstUnjournaledAvailableCandidate(discovery.snapshot, preferences, THIRSTY_PICKLE_FACILITY_ID, async (key) => {
                    const directory = resolve('.local/api-booking/api-first-journals', key);
                    const disposition = await new DurableSubmissionJournal(directory).recycleReusable(key);
                    if (disposition === 'reused')
                        stage('FINISHED_ATTEMPT_REUSABLE');
                    return disposition === 'blocked';
                });
            if (!selected)
                throw Error('API_NO_UNUSED_CANDIDATE');
            const plan = selected.plan;
            stage('CANDIDATE_READY', { date: command.date, court: plan.courts[0].court,
                ...(plan.courts[1] ? { courtB: plan.courts[1].court } : {}), startTime: plan.startTime,
                durationHours: duration, price: plan.totalPrice, availabilityMs: Math.round(discovery.timing.totalMs ?? 0) });
            checkoutPlans = standardCheckoutChunks(plan);
        }
        if (command.mode === 'dry') {
            // The dry path has no customer lookup, checkout security context, or submission permit.
            stage('DRY_RUN_COMPLETE');
        }
        else if (primaryProoflessPlans) {
            ensureActive();
            const attempts = primaryProoflessAttempts;
            // This does not submit anything. It only makes the already-started
            // security preparation a prerequisite for entering the dispatch state.
            // Failure therefore remains conclusively pre-dispatch and releases the
            // automation lock through the normal finally path.
            if (command.mode === 'live-now')
                await finishWarmup();
            await liveLock?.dispatching();
            retainLiveLock = true;
            stage('PRIMARY_PROOFLESS_DISPATCHING', { workerCount: attempts.length });
            const outcomes = await Promise.allSettled(attempts.map(attempt => executeProoflessAttempt(attempt, command.releaseMs)));
            attempts.forEach((attempt, index) => {
                const outcome = outcomes[index];
                const code = outcome.status === 'rejected' && outcome.reason instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(outcome.reason.message)
                    ? outcome.reason.message : outcome.status === 'rejected' ? 'DIRECT_WORKER_FAILED' : 'COMPLETED';
                stage('PRIMARY_PROOFLESS_OUTCOME', { workerId: attempt.workerId, status: outcome.status, code,
                    court: attempt.plan.courts[0].court, startTime: attempt.plan.startTime, durationHours: attempt.plan.durationHours });
            });
            await persistLatestVerifiedHold();
            const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
            if (failures.length) {
                if (!verifiedHold) {
                    const states = await Promise.all(attempts.flatMap(attempt => attempt.journals.map((journal, index) => journal.read(attempt.keys[index]).then(record => record.state).catch(() => 'unknown'))));
                    if (canReleaseApiLockAfterParallelFailure(false, failures.map(failure => failure.reason), states, attempts.length)) {
                        retainLiveLock = false;
                        await liveLock?.release();
                        liveLock = undefined;
                    }
                }
                throw failures[0].reason;
            }
        }
        else {
            ensureActive();
            const attempts = makeAttempts(checkoutPlans, workerIds, discovery.snapshot);
            await liveLock?.dispatching();
            retainLiveLock = true;
            const outcomes = await Promise.allSettled(attempts.map(executeAttempt));
            attempts.forEach((attempt, index) => {
                const outcome = outcomes[index];
                const code = outcome.status === 'rejected' && outcome.reason instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(outcome.reason.message)
                    ? outcome.reason.message : outcome.status === 'rejected' ? 'CHECKOUT_WORKER_FAILED' : 'COMPLETED';
                stage('WORKER_OUTCOME', { workerId: attempt.workerId, status: outcome.status, code,
                    court: attempt.chunkPlan.courts[0].court, startTime: attempt.chunkPlan.startTime, durationHours: attempt.chunkPlan.durationHours });
            });
            // Persist the newest verified expiry only after every worker has settled,
            // so the durable lock can never expire earlier than an active hold.
            await persistLatestVerifiedHold();
            const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
            if (failures.length) {
                if (!verifiedHold) {
                    const states = await Promise.all(attempts.flatMap(attempt => attempt.journals.map((journal, index) => journal.read(attempt.keys[index]).then(record => record.state).catch(() => 'unknown'))));
                    if (canReleaseApiLockAfterParallelFailure(false, failures.map(failure => failure.reason), states, attempts.length)) {
                        retainLiveLock = false;
                        await liveLock?.release();
                        liveLock = undefined;
                    }
                }
                throw failures[0].reason;
            }
        }
    }
}
catch (error) {
    if (error instanceof Error && error.message === 'BLOCK_AUDIT_COMPLETE') {
        finalDiagnosticCode = 'BLOCK_AUDIT_COMPLETE';
    }
    else {
        const code = safeApiFailureCode(error, 'API_FIRST_RUN_FAILED');
        finalDiagnosticCode = code;
        stage('FAILED', { code });
        process.exitCode = 1;
    }
}
finally {
    // This is also required on exceptional exits that bypass the normal summary
    // path: one worker may have created a verified hold before another worker
    // failed. Keep that latest expiry durable before closing browser transports.
    await persistLatestVerifiedHold().catch(() => { retainLiveLock = true; });
    // This process attaches to a browser owned by the desktop installation.
    // Closing a CDP attachment closes its transport; the independently launched Chrome windows stay open.
    await Promise.allSettled(connectedBrowsers.map(browser => browser.close()));
    if (liveLock && !retainLiveLock)
        await liveLock.release().catch(() => undefined);
    diagnostics.finish(finalDiagnosticCode, finalDiagnosticCode === 'USER_ABORT');
    progressLog.record('PROCESS_EXIT', new Date(nowMs()).toISOString(), stamp(), { exitCode: process.exitCode ?? 0 });
    await progressLog.close();
    if (process.connected)
        process.disconnect();
}
//# sourceMappingURL=desktop-runner.js.map