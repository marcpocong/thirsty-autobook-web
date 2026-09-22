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
import { parseAvailability, COURT_TO_SPACE_ID } from './availability-parser.js';
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
import { canReleaseApiLockAfterParallelFailure, conclusiveNoHoldFromStates } from './api-lock-outcome.js';
import { requiredWorkerIds } from '../workers.js';
import { showWorkerPage } from '../browser-window.js';
import { SPECIAL_SESSION_MODE, SPECIAL_SESSION_WORKERS, SPECIAL_SESSION_REQUIRED_WORKERS, SPECIAL_ADAPTIVE_WORKERS, SPECIAL_BONUS_WORKERS, specialSessionCourtAssignment, specialSessionPlans, specialAdaptivePlans, specialBonusLanePlans, specialBonusPlansForCourt } from './special-session.js';
import { assertDirectDispatchWindow, chooseDirectCourt, DIRECT_COURT_PRIORITY, directPlan, submitDirectCheckout } from './special-direct-checkout.js';
import { AdaptiveDirectLaneGate } from './adaptive-direct-lane.js';
import { API_DIRECT_SECURITY_PREWARM_LEAD_MS, API_SECURITY_PREWARM_LEAD_MS, safeApiFailureCode } from './run-observability.js';
const preferencesSchema = z.object({ strategy: z.enum(['standard', 'extended']), date: z.iso.date(), start: z.string().regex(/^(0[89]|1\d|2[0-3]):00$/),
    duration: z.number().int().min(1).max(6), courtCount: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7)]), maximum: z.number().optional(),
    priority: z.array(z.number().int().min(1).max(7)).min(1),
    fallbackStarts: z.array(z.string().regex(/^(0[89]|1\d|2[0-3]):00$/)),
    exact: z.array(z.array(z.number().int().min(1).max(7))).optional() }).strict();
const command = z.object({ mode: z.enum(['prepare', 'dry', 'live', 'live-now']), date: z.iso.date(),
    releaseMs: z.number().int().positive().optional(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    preferences: preferencesSchema.optional() }).strict().parse(JSON.parse(process.argv[2] ?? '{}'));
const abort = new AbortController();
process.on('message', message => { if (message?.type === 'abort')
    abort.abort(); });
const started = performance.now();
const SPECIAL_RELEASE_GUARD_MS = 11_000;
const SPECIAL_VERSION_POLL_MS = 1_000;
const SPECIAL_AVAILABILITY_POLL_MS = 5_000;
const SPECIAL_SIGNAL_AVAILABILITY_POLL_MS = 2_000;
const SPECIAL_SIGNAL_BURST_MS = 15_000;
const SPECIAL_SIGNAL_BURST_POLL_MS = 500;
const stamp = () => Math.round(performance.now() - started);
const progressLog = new ApiRunProgressLog(command.mode, command.date);
const stage = (name, extra = {}) => {
    const entry = progressLog.record(name, new Date().toISOString(), stamp(), extra);
    emitUiEvent({ type: 'apiStage', stage: name, at: entry.at, elapsedMs: entry.elapsedMs,
        sincePreviousMs: entry.sincePreviousMs, ...(name === 'RUN_STARTED' ? { runId: progressLog.runId } : {}), ...extra });
};
// High-frequency forensic evidence stays in the append-only local trace and
// does not flood the operator UI or Previous Runs activity list.
const trace = (name, extra = {}) => progressLog.record(name, new Date().toISOString(), stamp(), extra);
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
    return { capturedAt: new Date().toISOString(), status: response.status, contentType: response.contentType,
        diagnostic: checkoutDiagnostic(response), observed: observedResponse(parsed, 'RESPONSE_CAPTURED') };
};
const connectedBrowsers = [];
let liveLock, retainLiveLock = false, verifiedHold = false;
let latestVerifiedHoldExpiry;
let persistedVerifiedHoldExpiry;
let directTask;
let efProofTask;
let bonusDispatchTask;
const efGate = new AdaptiveDirectLaneGate();
const settleSpecialSideTasks = async () => {
    const tasks = [efProofTask, directTask, bonusDispatchTask].filter((task) => task !== undefined);
    if (tasks.length)
        await Promise.allSettled(tasks);
};
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
async function readSpecialSnapshot(date) {
    ensureActive();
    const requestedAt = performance.now();
    try {
        const provider = new OndaLiveAvailabilityProvider({ allowIncompleteRange: true });
        const envelope = await provider.getAvailability({ startDate: date, endDate: date });
        const snapshot = parseAvailability(envelope.raw, { startDate: date, endDate: date, capturedAt: envelope.capturedAt,
            fixtureKind: envelope.fixtureKind, label: envelope.label, now: new Date(), maximumAgeMs: 15_000, requireCompleteRange: false });
        trace('SPECIAL_AVAILABILITY_SAMPLE', { durationMs: Math.round(performance.now() - requestedAt),
            dateReturned: snapshot.returnedDates[date] === true, slotCount: snapshot.slots.length,
            availableCount: snapshot.slots.filter(slot => slot.date === date && slot.isAvailable).length });
        return snapshot;
    }
    catch (error) {
        const code = error instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.message)
            ? error.message : 'SPECIAL_AVAILABILITY_READ_FAILED';
        trace('SPECIAL_AVAILABILITY_SAMPLE', { durationMs: Math.round(performance.now() - requestedAt),
            dateReturned: false, slotCount: 0, availableCount: 0, code });
        return;
    }
}
async function readOndaVersion() {
    const requestedAt = performance.now();
    try {
        const response = await fetch('https://app.onda.fit/version.json', { headers: { Accept: 'application/json' },
            redirect: 'error', signal: AbortSignal.timeout(2500), cache: 'no-store' });
        if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
            trace('SPECIAL_VERSION_SAMPLE', { durationMs: Math.round(performance.now() - requestedAt), ok: false, status: response.status });
            return;
        }
        const value = await response.json();
        const version = typeof value.version === 'string' && value.version.length <= 160 ? value.version : undefined;
        trace('SPECIAL_VERSION_SAMPLE', { durationMs: Math.round(performance.now() - requestedAt), ok: !!version,
            status: response.status, ...(version ? { version } : {}) });
        return version;
    }
    catch {
        trace('SPECIAL_VERSION_SAMPLE', { durationMs: Math.round(performance.now() - requestedAt), ok: false, status: 0 });
        return;
    }
}
async function readKnownDirectCourtBlocks(date) {
    const results = await Promise.all(DIRECT_COURT_PRIORITY.map(async (court) => {
        const spaceId = COURT_TO_SPACE_ID[court];
        try {
            const url = new URL('/api/public/spaces/bookings', 'https://app.onda.fit');
            url.searchParams.set('spaceIds', spaceId);
            url.searchParams.set('date', date);
            const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(2500) });
            if (!response.ok)
                return false;
            const value = await response.json();
            return (value.data?.[spaceId] ?? []).some(booking => booking.date === date &&
                typeof booking.startTime === 'string' && typeof booking.endTime === 'string' &&
                booking.startTime.slice(0, 5) < '22:00' && booking.endTime.slice(0, 5) > '17:00');
        }
        catch {
            trace('DIRECT_BLOCK_READ_FAILED', { court });
            return false;
        }
    }));
    return DIRECT_COURT_PRIORITY.filter((_, index) => results[index]);
}
async function updateNotificationVisible(sessions) {
    const observations = await Promise.allSettled(sessions.map(async ({ page }) => await page.getByText('Update available', { exact: true }).first().isVisible().catch(() => false)));
    return observations.some(result => result.status === 'fulfilled' && result.value);
}
function plansInWorkerOrder(plans, workers) {
    return workers.map(worker => { const plan = plans.get(worker); if (!plan)
        throw Error('SPECIAL_SESSION_PLAN_MISSING'); return plan; });
}
// Safe A-D/G-H release-boundary retry: routes each worker to its own lane's
// exact-court plan builder using the court(s) already assigned at the early trigger.
function planForRetryWorker(snapshot, workerId, assignedCourts) {
    if (SPECIAL_SESSION_WORKERS.includes(workerId))
        return specialSessionPlans(snapshot, [workerId], { earlyCourt: assignedCourts.earlyCourt, lateCourt: assignedCourts.lateCourt })?.get(workerId);
    if (SPECIAL_BONUS_WORKERS.includes(workerId) && assignedCourts.bonusCourt !== undefined)
        return specialBonusPlansForCourt(snapshot, assignedCourts.bonusCourt, [workerId])?.get(workerId);
    return undefined;
}
try {
    if (process.env.THIRSTY_API_INSTALLATION !== '1' && process.env.THIRSTY_API_TEST_INSTALLATION !== '1')
        throw Error('API_INSTALLATION_REQUIRED');
    const config = loadConfig();
    const requested = command.preferences;
    const specialSession = !requested && config.SESSION_MODE === SPECIAL_SESSION_MODE;
    stage('RUN_CONFIGURATION', { sessionMode: config.SESSION_MODE, bookingMethod: config.BOOKING_METHOD,
        workerCount: specialSession ? SPECIAL_SESSION_REQUIRED_WORKERS.length : requiredWorkerIds(config.BOOKING_TYPE, config.COURT_COUNT).length,
        prewarmLeadMs: API_SECURITY_PREWARM_LEAD_MS, directPrewarmLeadMs: API_DIRECT_SECURITY_PREWARM_LEAD_MS,
        ...(command.releaseMs ? { releaseMs: command.releaseMs } : {}) });
    if (specialSession && !['prepare', 'live'].includes(command.mode))
        throw Error('SPECIAL_SESSION_RELEASE_ONLY');
    if (specialSession && new Date(`${command.date}T12:00:00Z`).getUTCDay() !== 5)
        throw Error('SPECIAL_SESSION_TARGET_NOT_FRIDAY');
    const strategy = requested?.strategy ?? config.BOOKING_TYPE;
    const duration = requested?.duration ?? config.DURATION_HOURS;
    const courtCount = requested?.courtCount ?? config.COURT_COUNT;
    if (!command.preferences && config.BOOKING_METHOD !== 'api-first')
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
    const workerIds = specialSession ? [...SPECIAL_SESSION_REQUIRED_WORKERS] : requiredWorkerIds(strategy, courtCount);
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
        if (command.mode === 'live')
            for (const session of sessions) {
                const workerId = session.workerId;
                releaseTransports.set(workerId, new OndaBrowserSessionTransport(session.page, () => calendarFreeSecurityContext(session.page)(), response => responseCaptures.get(workerId)?.(response) ?? Promise.reject(Error('CHECKOUT_RESPONSE_CAPTURE_MISSING')), { onHumanVerificationRequired: async () => {
                        await session.page.evaluate(id => { document.title = `THIRSTY BOT ${id} - VERIFY HERE`; }, workerId);
                        await showWorkerPage(session.page, workerId);
                        stage('HUMAN_VERIFICATION_REQUIRED', { workerId });
                    }, onHumanVerificationCompleted: async () => { stage('HUMAN_VERIFICATION_COMPLETE', { workerId }); } }));
            }
        // Hoisted so the E/F adaptive lane can dispatch a proof-based attempt as
        // soon as its court is ready, through the exact same verified path as the
        // main A-D/G-H batch dispatched later.
        const makeAttempts = (plans, ids, availability) => plans.map((chunkPlan, index) => {
            const workerId = ids[index];
            if (!workerId)
                throw Error('API_CHECKOUT_WORKER_MISSING');
            const session = sessions.find(value => value.workerId === workerId), customer = customers?.[workerId];
            if (!session || !customer)
                throw Error('API_CHECKOUT_WORKER_MISSING');
            const keys = standardPlanJournalKeys(chunkPlan, THIRSTY_PICKLE_FACILITY_ID);
            const directories = keys.map(key => resolve('.local/api-booking/api-first-journals', key));
            return { chunkPlan, workerId, session, customer, keys, directories, availability,
                journals: directories.map(directory => new DurableSubmissionJournal(directory)) };
        });
        const executeAttempt = async (attempt) => {
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
            return hold;
        };
        const conclusiveNoHold = async (attempt, error) => {
            const states = await Promise.all(attempt.journals.map((journal, index) => journal.read(attempt.keys[index]).then(record => record.state).catch(() => undefined)));
            return conclusiveNoHoldFromStates(states, error);
        };
        const warmWorkers = (workers, readyStage) => Promise.allSettled(workers.map(async (workerId) => {
            const transport = releaseTransports.get(workerId);
            if (!transport)
                throw Error('API_CHECKOUT_WORKER_MISSING');
            await transport.prepareCheckoutContext();
            if (readyStage)
                stage(readyStage, { workerId });
        }));
        const recordWarmFailures = (name, workers, results, fallback) => results.forEach((result, index) => {
            if (result.status === 'rejected')
                stage(name, { workerId: workers[index], status: 'rejected',
                    code: safeApiFailureCode(result.reason, fallback) });
        });
        let specialDispatchOrder = [];
        let efProofAttempted = false;
        // outcome is for telemetry/summary purposes only: 'skipped' until a court
        // is even found, then pessimistically 'failed' until one of the two E/F
        // paths actually settles a real result. Never read before both
        // efProofTask and directTask have been awaited.
        // (An object property, not a bare let, so mutations inside the async
        // proof/proofless closures below are not over-narrowed by the compiler.)
        const efLane = { outcome: 'skipped' };
        // Optimistic (false = conclusively never dispatched) until a specific
        // mechanism proves or cannot rule out a dispatch. Tracked separately per
        // mechanism — rather than one pessimistic flag flipped to true the moment
        // a court is found — so a proven pre-dispatch failure on one mechanism
        // (e.g. DIRECT_SECURITY_PREWARM_FAILED, which happens strictly before any
        // commitment or network call) does not have to poison the other's safety
        // just because a court exists. Read only after both tasks are awaited.
        let efProofMayHaveDispatched = false;
        let efProoflessMayHaveDispatched = false;
        // Same shape, for the fully independent G/H bonus lane (see runBonusLane,
        // defined below once directCourt/releaseMs are known). bonusDispatchTask
        // itself is declared at true top-level scope (with directTask/efProofTask)
        // so the outer finally can await it on every exit path, not just the
        // normal-completion path.
        const bonusLane = { outcome: 'skipped' };
        let bonusMayHaveDispatched = false;
        /**
         * The instant the E/F reserved court shows complete 17:00-22:00 availability
         * with a fresh snapshot, dispatch E/F through the normal proof-based path
         * (fresh proofs, same as A-D/G-H) instead of waiting for release. Fail-closed:
         * commits the adaptive gate synchronously before any await, so the existing
         * proofless release-time fallback can never also dispatch for this block.
         */
        const maybeStartEfProofLane = (snapshot, directCourt) => {
            if (efProofTask || efProofAttempted || !snapshot || !directCourt)
                return;
            const efPlans = specialAdaptivePlans(snapshot, directCourt);
            if (!efPlans)
                return;
            if (!efGate.tryCommit('proof'))
                return;
            efProofAttempted = true;
            const price = [...efPlans.values()].reduce((sum, plan) => sum + plan.totalPrice, 0);
            stage('ADAPTIVE_DIRECT_PROOF_AVAILABLE', { court: directCourt, price });
            efProofTask = (async () => {
                try {
                    const warmed = await warmWorkers(SPECIAL_ADAPTIVE_WORKERS, 'ADAPTIVE_SECURITY_READY');
                    recordWarmFailures('ADAPTIVE_SECURITY_FAILED', SPECIAL_ADAPTIVE_WORKERS, warmed, 'ADAPTIVE_PROOF_SECURITY_FAILED');
                    if (warmed.some(result => result.status === 'rejected')) {
                        efGate.releaseProofCommitment();
                        stage('ADAPTIVE_DIRECT_FALLBACK_ELIGIBLE', { code: 'ADAPTIVE_PROOF_SECURITY_FAILED' });
                        return;
                    }
                    ensureActive();
                    await liveLock?.dispatching();
                    retainLiveLock = true;
                    stage('ADAPTIVE_DIRECT_PROOF_DISPATCHING', { court: directCourt });
                    const efAttempts = makeAttempts(plansInWorkerOrder(efPlans, SPECIAL_ADAPTIVE_WORKERS), SPECIAL_ADAPTIVE_WORKERS, snapshot);
                    // From this point an unexpected error must be treated as possibly
                    // dispatched until every durable journal proves otherwise.
                    efProofMayHaveDispatched = true;
                    const results = await Promise.allSettled(efAttempts.map(executeAttempt));
                    efAttempts.forEach((attempt, index) => {
                        const outcome = results[index];
                        const code = outcome.status === 'rejected' && outcome.reason instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(outcome.reason.message)
                            ? outcome.reason.message : outcome.status === 'rejected' ? 'SPECIAL_WORKER_FAILED' : 'COMPLETED';
                        stage('SPECIAL_WORKER_OUTCOME', { workerId: attempt.workerId, attempt: 'initial', status: outcome.status, code,
                            court: attempt.chunkPlan.courts[0].court, startTime: attempt.chunkPlan.startTime, durationHours: attempt.chunkPlan.durationHours });
                    });
                    // A fulfilled attempt (which records the verified expiry well before
                    // QR restoration) is an unambiguous dispatch. For a rejected attempt, the
                    // exception type alone is unsafe once a hold may already exist (QR
                    // restoration errors are ordinary Errors thrown AFTER the hold is
                    // verified) — the durable journal is the only trustworthy signal.
                    const dispatchChecks = await Promise.all(efAttempts.map(async (attempt, index) => {
                        const result = results[index];
                        if (result.status === 'fulfilled')
                            return true;
                        return !(await conclusiveNoHold(attempt, result.reason));
                    }));
                    const anyMayHaveDispatched = dispatchChecks.some(Boolean);
                    if (!anyMayHaveDispatched) {
                        efGate.releaseProofCommitment();
                        stage('ADAPTIVE_DIRECT_FALLBACK_ELIGIBLE', {});
                        // Proofless remains eligible and will determine the final E/F outcome.
                    }
                    else {
                        stage('ADAPTIVE_DIRECT_FALLBACK_DISABLED', { court: directCourt });
                        const succeeded = results.filter(result => result.status === 'fulfilled').length;
                        efLane.outcome = succeeded === results.length ? 'success' : succeeded > 0 ? 'partial' : 'failed';
                    }
                    efProofMayHaveDispatched = anyMayHaveDispatched;
                }
                catch (error) {
                    // Fail closed: an unexpected/unclassified error here must never
                    // silently reopen the proofless fallback while a proof-based
                    // dispatch may be outstanding.
                    retainLiveLock = true;
                    efLane.outcome = 'failed';
                    stage('FAILED', { code: error instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.message) ? error.message : 'ADAPTIVE_DIRECT_PROOF_LANE_FAILED' });
                }
            })();
        };
        let specialPlansAtTrigger;
        let specialSnapshotAtTrigger;
        let specialTriggeredEarly = false;
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
        if (command.mode === 'live' && specialSession) {
            const releaseMs = command.releaseMs;
            if (releaseMs <= Date.now())
                throw Error('RELEASE_MISSED');
            stage('WAITING_FOR_RELEASE', { releaseMs });
            const watchAt = releaseMs - 10 * 60_000;
            while (Date.now() < watchAt) {
                ensureActive();
                await pause(Math.min(30_000, watchAt - Date.now()));
            }
            stage('SPECIAL_AVAILABILITY_WATCHING');
            const [initialDirectSnapshot, knownBlocked] = await Promise.all([readSpecialSnapshot(command.date), readKnownDirectCourtBlocks(command.date)]);
            const directCourt = chooseDirectCourt(initialDirectSnapshot, knownBlocked);
            if (directCourt) {
                // A reserved E/F court exists, so some outcome is now expected for
                // telemetry; stay pessimistic ('failed') until either path actually
                // settles a result. This alone does not mark either mechanism as
                // having possibly dispatched — see efProofMayHaveDispatched /
                // efProoflessMayHaveDispatched, set only once a dispatch is proven or
                // cannot be ruled out.
                efLane.outcome = 'failed';
                const directPlans = ['E', 'F'].map(workerId => ({ workerId, ...directPlan(command.date, directCourt, workerId, initialDirectSnapshot) }));
                const directTotal = directPlans.reduce((sum, item) => sum + item.plan.totalPrice, 0);
                stage('DIRECT_LANE_PREPARED', { court: directCourt, rateSource: directPlans[0].rateSource,
                    ...(directPlans[0].rateSource === 'UNVERIFIED_PRIOR_RATE' ? { assumedPrice: directTotal } : { price: directTotal }) });
                directTask = (async () => {
                    let directWarmup;
                    const warmDirect = () => directWarmup ??= Promise.allSettled(['E', 'F'].map(async (worker) => {
                        const transport = releaseTransports.get(worker);
                        if (!transport)
                            throw Error('DIRECT_WORKER_MISSING');
                        await transport.prepareCheckoutContext();
                        stage('DIRECT_SECURITY_READY', { workerId: worker });
                    }));
                    while (Date.now() < releaseMs) {
                        ensureActive();
                        const remaining = releaseMs - Date.now();
                        if (remaining <= API_SECURITY_PREWARM_LEAD_MS)
                            startWarmup(SPECIAL_SESSION_WORKERS);
                        if (remaining <= API_DIRECT_SECURITY_PREWARM_LEAD_MS)
                            warmDirect();
                        await pause(Math.min(250, Math.max(1, remaining), warmup ? 250 : Math.max(1, remaining - API_SECURITY_PREWARM_LEAD_MS)));
                    }
                    assertApiReleaseFresh(releaseMs);
                    const directWarmResults = await warmDirect();
                    recordWarmFailures('DIRECT_SECURITY_FAILED', SPECIAL_ADAPTIVE_WORKERS, directWarmResults, 'DIRECT_SECURITY_PREWARM_FAILED');
                    if (directWarmResults.some(result => result.status === 'rejected'))
                        throw Error('DIRECT_SECURITY_PREWARM_FAILED');
                    ensureActive();
                    assertDirectDispatchWindow(releaseMs);
                    // Fail-closed hand-off: if the E/F proof-based lane already committed
                    // (dispatched or in flight), never also send the proofless request.
                    if (!efGate.tryCommit('proofless')) {
                        stage('ADAPTIVE_DIRECT_FALLBACK_DISABLED', { court: directCourt });
                        return;
                    }
                    await liveLock?.dispatching();
                    retainLiveLock = true;
                    stage('DIRECT_LANE_DISPATCHING', { court: directCourt, rateSource: directPlans[0].rateSource });
                    efProoflessMayHaveDispatched = true;
                    const results = await Promise.allSettled(directPlans.map(async ({ workerId, plan }) => {
                        const session = sessions.find(value => value.workerId === workerId), customer = customers?.[workerId], transport = releaseTransports.get(workerId);
                        if (!session || !customer || !transport)
                            throw Error('DIRECT_WORKER_MISSING');
                        const key = DurableSubmissionJournal.key(THIRSTY_PICKLE_FACILITY_ID, plan.courts[0].spaceId, command.date, plan.startTime, plan.endTime);
                        const directory = resolve('.local/api-booking/api-first-journals', key);
                        let token, bookingNo;
                        responseCaptures.set(workerId, async (response) => {
                            await saveOnce(directory, 'checkout-response-private.json', sanitizedCheckoutCapture(response));
                            try {
                                const value = JSON.parse(response.body);
                                bookingNo = value.bookings?.[0]?.booking_no;
                                token = value.bookings?.[0]?.checkoutToken;
                            }
                            catch { }
                        });
                        const startedAt = performance.now();
                        const hold = await submitDirectCheckout(plan, customer, transport, new DurableSubmissionJournal(directory), releaseMs);
                        verifiedHold = true;
                        retainLiveLock = true;
                        if (!latestVerifiedHoldExpiry || Date.parse(hold.holdExpiresAt) > Date.parse(latestVerifiedHoldExpiry))
                            latestVerifiedHoldExpiry = hold.holdExpiresAt;
                        stage('PENDING_HOLD', { workerId, court: directCourt, date: command.date, startTime: plan.startTime, durationHours: plan.durationHours,
                            bookingId: hold.bookingIds[0], bookingNo: bookingNo ?? '', holdExpiresAt: hold.holdExpiresAt, price: plan.totalPrice,
                            workerElapsedMs: Math.round(performance.now() - startedAt) });
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
                        stage('OFFICIAL_QRPH_HANDOFF', { workerId, court: directCourt, date: command.date, startTime: plan.startTime,
                            durationHours: plan.durationHours, bookingId: hold.bookingIds[0], bookingNo, holdExpiresAt: hold.holdExpiresAt,
                            price: plan.totalPrice, workerElapsedMs: Math.round(performance.now() - startedAt) });
                        return hold;
                    }));
                    const successful = results.filter((result) => result.status === 'fulfilled');
                    if (successful.length) {
                        const newest = successful.map(result => result.value.holdExpiresAt).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
                        if (!latestVerifiedHoldExpiry || Date.parse(newest) > Date.parse(latestVerifiedHoldExpiry))
                            latestVerifiedHoldExpiry = newest;
                    }
                    results.forEach((result, index) => stage('DIRECT_WORKER_OUTCOME', { workerId: directPlans[index].workerId, status: result.status,
                        code: result.status === 'fulfilled' ? 'COMPLETED' : result.reason instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(result.reason.message) ? result.reason.message : 'DIRECT_WORKER_FAILED' }));
                    efLane.outcome = successful.length === results.length ? 'success' : successful.length > 0 ? 'partial' : 'failed';
                    if (successful.length === 0) {
                        // Every attempt rejected: prove via the durable journal (not the
                        // exception type) that neither request may have actually dispatched.
                        const dispatchChecks = await Promise.all(results.map(async (result, index) => {
                            if (result.status === 'fulfilled')
                                return false;
                            const plan = directPlans[index].plan;
                            const key = DurableSubmissionJournal.key(THIRSTY_PICKLE_FACILITY_ID, plan.courts[0].spaceId, command.date, plan.startTime, plan.endTime);
                            const state = await new DurableSubmissionJournal(resolve('.local/api-booking/api-first-journals', key))
                                .read(key).then(record => record.state).catch(() => undefined);
                            return !conclusiveNoHoldFromStates([state], result.reason);
                        }));
                        efProoflessMayHaveDispatched = dispatchChecks.some(Boolean);
                    }
                    else
                        efProoflessMayHaveDispatched = true;
                })().catch(error => {
                    retainLiveLock = true;
                    // Only claim this outcome if the proofless path actually owned the
                    // commitment; otherwise leave it to whichever path did (or to the
                    // pessimistic default if neither ever committed). commitment!=='proofless'
                    // here proves this specific error happened strictly before any
                    // proofless dispatch attempt (tryCommit is the only place commitment
                    // becomes 'proofless', called synchronously right before dispatch),
                    // so efProoflessMayHaveDispatched correctly stays false in that case.
                    if (efGate.commitment === 'proofless')
                        efLane.outcome = 'failed';
                    stage('DIRECT_LANE_FAILED', { code: error instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.message) ? error.message : 'DIRECT_LANE_FAILED' });
                });
            }
            else
                stage('DIRECT_LANE_SKIPPED', { code: 'NO_THIRD_COURT_AVAILABLE' });
            // G/H bonus lane: fully independent of A-D, started the instant A-D's
            // court assignment is known (see checkCore below). Polls on its own
            // cadence up to release, then a short post-release burst matching the
            // pattern used elsewhere, and dispatches G/H the moment a fourth
            // distinct court is complete — never delaying, and never delayed by,
            // A-D. Proof-based only; never falls back to the proofless transport.
            const runBonusLane = async (assigned, initialSnapshot) => {
                const excluded = [...(directCourt ? [directCourt] : []), assigned.earlyCourt, assigned.lateCourt];
                let found;
                let usedSnapshot;
                let pendingSnapshot = initialSnapshot;
                const tryOnce = async () => {
                    const snapshot = pendingSnapshot ?? await readSpecialSnapshot(command.date);
                    pendingSnapshot = undefined;
                    if (!snapshot)
                        return;
                    const bonus = specialBonusLanePlans(snapshot, excluded);
                    if (bonus) {
                        found = bonus;
                        usedSnapshot = snapshot;
                    }
                };
                while (!found && Date.now() < releaseMs) {
                    ensureActive();
                    await tryOnce();
                    if (found)
                        break;
                    await pause(Math.min(SPECIAL_SIGNAL_AVAILABILITY_POLL_MS, Math.max(1, releaseMs - Date.now())));
                }
                const foundEarly = !!found;
                if (!found)
                    for (const delay of [0, 250, 500, 1000, 2000]) {
                        ensureActive();
                        if (delay)
                            await pause(delay);
                        await tryOnce();
                        if (found)
                            break;
                    }
                if (!found) {
                    stage('SPECIAL_BONUS_LANE_SKIPPED', { code: 'NO_FOURTH_COURT_AVAILABLE' });
                    return;
                }
                bonusLane.outcome = 'failed';
                stage('SPECIAL_BONUS_LANE_READY', { court: found.court, price: [...found.plans.values()].reduce((sum, plan) => sum + plan.totalPrice, 0) });
                const warmed = await warmWorkers(SPECIAL_BONUS_WORKERS, 'BONUS_SECURITY_READY');
                recordWarmFailures('BONUS_SECURITY_FAILED', SPECIAL_BONUS_WORKERS, warmed, 'BONUS_SECURITY_PREWARM_FAILED');
                const warmFailure = warmed.find((result) => result.status === 'rejected');
                if (warmFailure)
                    throw warmFailure.reason;
                ensureActive();
                await liveLock?.dispatching();
                retainLiveLock = true;
                let attempts = makeAttempts(plansInWorkerOrder(found.plans, SPECIAL_BONUS_WORKERS), SPECIAL_BONUS_WORKERS, usedSnapshot);
                bonusMayHaveDispatched = true;
                const outcomes = await Promise.allSettled(attempts.map(executeAttempt));
                attempts.forEach((attempt, index) => {
                    const outcome = outcomes[index];
                    const code = outcome.status === 'rejected' && outcome.reason instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(outcome.reason.message)
                        ? outcome.reason.message : outcome.status === 'rejected' ? 'SPECIAL_WORKER_FAILED' : 'COMPLETED';
                    stage('SPECIAL_WORKER_OUTCOME', { workerId: attempt.workerId, attempt: 'initial', status: outcome.status, code,
                        court: attempt.chunkPlan.courts[0].court, startTime: attempt.chunkPlan.startTime, durationHours: attempt.chunkPlan.durationHours });
                });
                const finalByWorker = new Map(attempts.map((attempt, index) => [attempt.workerId, outcomes[index]]));
                if (foundEarly && Date.now() < releaseMs) {
                    const retryWorkers = [];
                    for (const [index, outcome] of outcomes.entries())
                        if (outcome.status === 'rejected' &&
                            await conclusiveNoHold(attempts[index], outcome.reason))
                            retryWorkers.push(attempts[index].workerId);
                    if (retryWorkers.length) {
                        stage('SPECIAL_SAFE_RETRY_WAITING', { releaseMs });
                        let retryWarmup;
                        while (Date.now() < releaseMs) {
                            ensureActive();
                            const remaining = releaseMs - Date.now();
                            if (remaining <= API_SECURITY_PREWARM_LEAD_MS)
                                retryWarmup ??= warmWorkers(retryWorkers, 'BONUS_RETRY_SECURITY_READY');
                            await pause(Math.min(500, Math.max(1, remaining)));
                        }
                        assertApiReleaseFresh(releaseMs);
                        retryWarmup ??= warmWorkers(retryWorkers, 'BONUS_RETRY_SECURITY_READY');
                        const retryWarmResults = await retryWarmup;
                        recordWarmFailures('BONUS_RETRY_SECURITY_FAILED', retryWorkers, retryWarmResults, 'BONUS_SECURITY_PREWARM_FAILED');
                        const retryWarmFailure = retryWarmResults.find((result) => result.status === 'rejected');
                        if (retryWarmFailure)
                            throw retryWarmFailure.reason;
                        let retryPlans = new Map();
                        let retrySnapshot;
                        for (const delay of [0, 250, 500, 1000, 2000]) {
                            if (delay)
                                await pause(delay);
                            const snapshot = await readSpecialSnapshot(command.date);
                            if (!snapshot)
                                continue;
                            const plansForSnapshot = new Map();
                            for (const workerId of retryWorkers) {
                                const plan = specialBonusPlansForCourt(snapshot, found.court, [workerId])?.get(workerId);
                                if (plan)
                                    plansForSnapshot.set(workerId, plan);
                            }
                            if (plansForSnapshot.size > retryPlans.size) {
                                retrySnapshot = snapshot;
                                retryPlans = plansForSnapshot;
                            }
                            if (retryPlans.size === retryWorkers.length)
                                break;
                        }
                        if (retrySnapshot && retryPlans.size) {
                            const retryIds = retryWorkers.filter(worker => retryPlans.has(worker));
                            for (const workerId of retryIds) {
                                const prior = attempts.find(attempt => attempt.workerId === workerId);
                                for (const [index, journal] of prior.journals.entries()) {
                                    const disposition = await journal.recycleReusable(prior.keys[index]);
                                    if (disposition === 'blocked')
                                        throw Error('SPECIAL_SESSION_RETRY_BLOCKED');
                                }
                            }
                            const retryAttempts = makeAttempts(plansInWorkerOrder(retryPlans, retryIds), retryIds, retrySnapshot);
                            attempts = [...attempts, ...retryAttempts];
                            const retried = await Promise.allSettled(retryAttempts.map(executeAttempt));
                            retryAttempts.forEach((attempt, index) => {
                                const outcome = retried[index];
                                const code = outcome.status === 'rejected' && outcome.reason instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(outcome.reason.message)
                                    ? outcome.reason.message : outcome.status === 'rejected' ? 'SPECIAL_WORKER_FAILED' : 'COMPLETED';
                                stage('SPECIAL_WORKER_OUTCOME', { workerId: attempt.workerId, attempt: 'retry', status: outcome.status, code,
                                    court: attempt.chunkPlan.courts[0].court, startTime: attempt.chunkPlan.startTime, durationHours: attempt.chunkPlan.durationHours });
                            });
                            retryAttempts.forEach((attempt, index) => finalByWorker.set(attempt.workerId, retried[index]));
                        }
                    }
                }
                const finalOutcomes = [...finalByWorker.values()];
                const succeeded = finalOutcomes.filter(outcome => outcome.status === 'fulfilled').length;
                bonusLane.outcome = succeeded === finalOutcomes.length ? 'success' : succeeded > 0 ? 'partial' : 'failed';
                if (succeeded === 0) {
                    const dispatchChecks = await Promise.all(attempts.map(async (attempt) => {
                        const outcome = finalByWorker.get(attempt.workerId);
                        if (outcome.status === 'fulfilled')
                            return false;
                        return !(await conclusiveNoHold(attempt, outcome.reason));
                    }));
                    bonusMayHaveDispatched = dispatchChecks.some(Boolean);
                }
                else
                    bonusMayHaveDispatched = true;
            };
            // Core A-D proof-based plans. Once found, A-D commits and dispatches
            // immediately — it is never delayed waiting for G/H (see runBonusLane
            // below, a fully independent lane started the instant A-D's court
            // assignment is known).
            let coreAssignment;
            const checkCore = (snapshot) => {
                const core = coreAssignment
                    ? specialSessionPlans(snapshot, SPECIAL_SESSION_WORKERS, coreAssignment)
                    : specialSessionPlans(snapshot, SPECIAL_SESSION_WORKERS, undefined, directCourt ? [directCourt] : []);
                if (!core)
                    return undefined;
                if (!coreAssignment) {
                    coreAssignment = specialSessionCourtAssignment(core);
                    stage('SPECIAL_PROOF_LANE_READY', { court: coreAssignment.earlyCourt, courtB: coreAssignment.lateCourt,
                        price: [...core.values()].reduce((sum, plan) => sum + plan.totalPrice, 0) });
                    // Start watching for a fourth distinct court right away; this never
                    // gates or delays A-D's own commit below.
                    bonusDispatchTask = runBonusLane(coreAssignment, snapshot).catch(error => {
                        retainLiveLock = true;
                        bonusLane.outcome = 'failed';
                        stage('FAILED', { code: error instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.message) ? error.message : 'SPECIAL_BONUS_LANE_FAILED' });
                    });
                }
                return core;
            };
            const commitCore = (snapshot, core, early) => {
                specialPlansAtTrigger = core;
                specialSnapshotAtTrigger = snapshot;
                specialTriggeredEarly = early;
                specialDispatchOrder = ['A', 'B', 'C', 'D'].filter(worker => core.has(worker));
                const assigned = coreAssignment;
                stage(early ? 'SPECIAL_EARLY_AVAILABILITY_READY' : 'SPECIAL_RELEASE_AVAILABILITY_READY', { date: command.date, court: assigned.earlyCourt, courtB: assigned.lateCourt,
                    price: [...core.values()].reduce((sum, plan) => sum + plan.totalPrice, 0) });
            };
            let observedVersion = await readOndaVersion();
            let nextVersionAt = Date.now(), nextAvailabilityAt = Date.now();
            let releaseSignalSeen = false, signalBurstUntil = 0;
            while (Date.now() < releaseMs) {
                ensureActive();
                const remaining = releaseMs - Date.now();
                if (remaining <= API_SECURITY_PREWARM_LEAD_MS)
                    startWarmup(SPECIAL_SESSION_WORKERS);
                // Do not let a final pre-release GET overlap and delay the official
                // release fetch. The live provider has a ten-second timeout.
                if (remaining <= SPECIAL_RELEASE_GUARD_MS) {
                    if (warmup && warmupStartedAt !== undefined && Date.now() - warmupStartedAt > 90_000) {
                        await finishWarmup(true);
                        warmup = undefined;
                        warmupStartedAt = undefined;
                    }
                    startWarmup(SPECIAL_SESSION_WORKERS);
                    await pause(Math.max(1, releaseMs - Date.now()));
                    break;
                }
                const loopStarted = Date.now();
                const checkVersion = loopStarted >= nextVersionAt, checkAvailability = loopStarted >= nextAvailabilityAt;
                const [version, notification, snapshot] = await Promise.all([
                    checkVersion ? readOndaVersion() : Promise.resolve(undefined),
                    updateNotificationVisible(sessions),
                    checkAvailability ? readSpecialSnapshot(command.date) : Promise.resolve(undefined),
                ]);
                const versionChanged = !!version && !!observedVersion && version !== observedVersion;
                if ((versionChanged || notification) && !releaseSignalSeen) {
                    releaseSignalSeen = true;
                    signalBurstUntil = Date.now() + SPECIAL_SIGNAL_BURST_MS;
                    stage(notification ? 'SPECIAL_UPDATE_NOTIFICATION_OBSERVED' : 'SPECIAL_VERSION_CHANGE_OBSERVED');
                    startWarmup(SPECIAL_SESSION_WORKERS);
                    if (!checkAvailability)
                        nextAvailabilityAt = 0;
                }
                if (version)
                    observedVersion = version;
                if (checkVersion)
                    nextVersionAt = loopStarted + SPECIAL_VERSION_POLL_MS;
                if (checkAvailability) {
                    const interval = !releaseSignalSeen ? SPECIAL_AVAILABILITY_POLL_MS :
                        Date.now() < signalBurstUntil ? SPECIAL_SIGNAL_BURST_POLL_MS : SPECIAL_SIGNAL_AVAILABILITY_POLL_MS;
                    nextAvailabilityAt = loopStarted + interval;
                }
                // E/F is independent of A-D readiness: dispatch its proof-based
                // upgrade the instant its own reserved court is complete, whether or
                // not the core lane has resolved yet.
                maybeStartEfProofLane(snapshot, directCourt);
                if (snapshot) {
                    const core = checkCore(snapshot);
                    if (core) {
                        commitCore(snapshot, core, Date.now() < releaseMs);
                        break;
                    }
                }
                const nextCheck = Math.min(nextVersionAt, nextAvailabilityAt, releaseMs - SPECIAL_RELEASE_GUARD_MS);
                await pause(Math.min(250, Math.max(1, nextCheck - Date.now())));
            }
            if (!specialPlansAtTrigger) {
                assertApiReleaseFresh(releaseMs);
                stage('RELEASE_TRIGGERED');
                await finishWarmup(true);
                for (const delay of [0, 250, 500, 1000, 2000]) {
                    if (delay)
                        await pause(delay);
                    const snapshot = await readSpecialSnapshot(command.date);
                    maybeStartEfProofLane(snapshot, directCourt);
                    if (!snapshot)
                        continue;
                    const core = checkCore(snapshot);
                    if (core) {
                        commitCore(snapshot, core, false);
                        break;
                    }
                }
                if (!specialPlansAtTrigger)
                    throw Error('SPECIAL_SESSION_NOT_AVAILABLE');
            }
            // Availability can arrive before the ordinary eight-second prewarm
            // window. Finish all four security contexts before any branch dispatches.
            if (warmup && warmupStartedAt !== undefined && Date.now() - warmupStartedAt > 90_000) {
                await finishWarmup(true);
                warmup = undefined;
                warmupStartedAt = undefined;
            }
            startWarmup(SPECIAL_SESSION_WORKERS);
            await finishWarmup(true);
        }
        else if (command.mode === 'live') {
            const releaseMs = command.releaseMs;
            if (releaseMs <= Date.now())
                throw Error('RELEASE_MISSED');
            stage('WAITING_FOR_RELEASE', { releaseMs });
            while (Date.now() < releaseMs) {
                ensureActive();
                const remaining = releaseMs - Date.now();
                if (remaining <= API_SECURITY_PREWARM_LEAD_MS)
                    startWarmup();
                await pause(Math.min(500, Math.max(1, remaining), warmup ? 500 : Math.max(1, remaining - API_SECURITY_PREWARM_LEAD_MS)));
            }
            assertApiReleaseFresh(releaseMs);
            stage('RELEASE_TRIGGERED');
            await finishWarmup();
        }
        ensureActive();
        const preferences = { mode: strategy, targetDate: command.date,
            durationHours: duration, preferredStartTimes: [requested?.start ?? config.START_TIME],
            fallbackStartTimes: requested?.fallbackStarts ?? config.FALLBACK_TIMES,
            courtPriority: requested?.priority ?? config.PREFERRED_COURTS,
            fallbackCourts: requested ? [] : config.FALLBACK_COURTS, courtCount, exactCourts: requested?.exact,
            maximumTotalPrice: requested?.maximum ?? config.MAX_PRICE, currency: 'PHP' };
        let discovery;
        let checkoutPlans;
        if (specialSession) {
            if (!specialPlansAtTrigger)
                throw Error('SPECIAL_SESSION_NOT_AVAILABLE');
            checkoutPlans = plansInWorkerOrder(specialPlansAtTrigger, specialDispatchOrder);
            const assigned = specialSessionCourtAssignment(specialPlansAtTrigger);
            stage('CANDIDATE_READY', { date: command.date, court: assigned.earlyCourt, courtB: assigned.lateCourt, startTime: '17:00', durationHours: 5,
                price: checkoutPlans.reduce((sum, plan) => sum + plan.totalPrice, 0) });
        }
        else {
            stage('FETCHING_AVAILABILITY');
            discovery = await discoverApiAvailability(new OndaLiveAvailabilityProvider(), preferences);
            ensureActive();
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
        else {
            ensureActive();
            const dispatchIds = specialSession ? specialDispatchOrder : workerIds;
            let attempts = makeAttempts(checkoutPlans, dispatchIds, specialSnapshotAtTrigger ?? discovery.snapshot);
            await liveLock?.dispatching();
            retainLiveLock = true;
            let outcomes = await Promise.allSettled(attempts.map(executeAttempt));
            attempts.forEach((attempt, index) => {
                const outcome = outcomes[index];
                const code = outcome.status === 'rejected' && outcome.reason instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(outcome.reason.message)
                    ? outcome.reason.message : outcome.status === 'rejected' ? 'SPECIAL_WORKER_FAILED' : 'COMPLETED';
                stage('SPECIAL_WORKER_OUTCOME', { workerId: attempt.workerId, attempt: 'initial', status: outcome.status, code,
                    court: attempt.chunkPlan.courts[0].court, startTime: attempt.chunkPlan.startTime, durationHours: attempt.chunkPlan.durationHours });
            });
            const finalByWorker = new Map(attempts.map((attempt, index) => [attempt.workerId, outcomes[index]]));
            if (specialSession && specialTriggeredEarly) {
                const assignedCourts = specialSessionCourtAssignment(specialPlansAtTrigger);
                const retryWorkers = [];
                for (const [index, outcome] of outcomes.entries())
                    if (outcome?.status === 'rejected' &&
                        await conclusiveNoHold(attempts[index], outcome.reason))
                        retryWorkers.push(attempts[index].workerId);
                if (retryWorkers.length) {
                    stage('SPECIAL_SAFE_RETRY_WAITING', { releaseMs: command.releaseMs });
                    warmup = undefined;
                    warmupStartedAt = undefined;
                    while (Date.now() < command.releaseMs) {
                        ensureActive();
                        const remaining = command.releaseMs - Date.now();
                        if (remaining <= API_SECURITY_PREWARM_LEAD_MS)
                            startWarmup(retryWorkers);
                        await pause(Math.min(500, Math.max(1, remaining), warmup ? 500 : Math.max(1, remaining - API_SECURITY_PREWARM_LEAD_MS)));
                    }
                    assertApiReleaseFresh(command.releaseMs);
                    stage('RELEASE_TRIGGERED');
                    await finishWarmup(true);
                    let retryPlans = new Map();
                    let retrySnapshot;
                    for (const delay of [0, 250, 500, 1000, 2000]) {
                        if (delay)
                            await pause(delay);
                        const snapshot = await readSpecialSnapshot(command.date);
                        if (!snapshot)
                            continue;
                        const plansForSnapshot = new Map();
                        for (const workerId of retryWorkers) {
                            const plan = planForRetryWorker(snapshot, workerId, assignedCourts);
                            if (plan)
                                plansForSnapshot.set(workerId, plan);
                        }
                        if (plansForSnapshot.size > retryPlans.size) {
                            retrySnapshot = snapshot;
                            retryPlans = plansForSnapshot;
                        }
                        if (retryPlans.size === retryWorkers.length)
                            break;
                    }
                    if (retrySnapshot && retryPlans.size) {
                        const retryIds = retryWorkers.filter(worker => retryPlans.has(worker));
                        for (const workerId of retryIds) {
                            const prior = attempts.find(attempt => attempt.workerId === workerId);
                            for (const [index, journal] of prior.journals.entries()) {
                                const disposition = await journal.recycleReusable(prior.keys[index]);
                                if (disposition === 'blocked')
                                    throw Error('SPECIAL_SESSION_RETRY_BLOCKED');
                            }
                        }
                        const retryAttempts = makeAttempts(plansInWorkerOrder(retryPlans, retryIds), retryIds, retrySnapshot);
                        attempts = [...attempts, ...retryAttempts];
                        const retried = await Promise.allSettled(retryAttempts.map(executeAttempt));
                        retryAttempts.forEach((attempt, index) => {
                            const outcome = retried[index];
                            const code = outcome.status === 'rejected' && outcome.reason instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(outcome.reason.message)
                                ? outcome.reason.message : outcome.status === 'rejected' ? 'SPECIAL_WORKER_FAILED' : 'COMPLETED';
                            stage('SPECIAL_WORKER_OUTCOME', { workerId: attempt.workerId, attempt: 'retry', status: outcome.status, code,
                                court: attempt.chunkPlan.courts[0].court, startTime: attempt.chunkPlan.startTime, durationHours: attempt.chunkPlan.durationHours });
                        });
                        retryAttempts.forEach((attempt, index) => finalByWorker.set(attempt.workerId, retried[index]));
                    }
                }
            }
            // Fold in E/F's and G/H's final outcomes before deciding this run's
            // overall result: all three side-lane tasks catch their own errors
            // internally and never reject, but their success/failure must still be
            // reflected in the summary and exit code, not silently swallowed while
            // the A-D batch alone succeeds.
            if (specialSession) {
                await settleSpecialSideTasks();
            }
            // Side lanes can finish after A-D. Persist exactly the newest verified
            // expiry only after every lane has settled, so the durable lock can never
            // expire earlier than an active E/F or G/H hold.
            await persistLatestVerifiedHold();
            outcomes = [...finalByWorker.values()];
            const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
            const efFailed = specialSession && (efLane.outcome === 'failed' || efLane.outcome === 'partial');
            const bonusFailed = specialSession && (bonusLane.outcome === 'failed' || bonusLane.outcome === 'partial');
            const laneWorkerCounts = (lane) => {
                if (lane.outcome === 'skipped')
                    return { workers: 0, completed: 0 };
                return { workers: 2, completed: lane.outcome === 'success' ? 2 : lane.outcome === 'partial' ? 1 : 0 };
            };
            const efCounts = specialSession ? laneWorkerCounts(efLane) : { workers: 0, completed: 0 };
            const bonusCounts = specialSession ? laneWorkerCounts(bonusLane) : { workers: 0, completed: 0 };
            if (specialSession)
                stage('SPECIAL_RUN_SUMMARY', {
                    workerCount: outcomes.length + efCounts.workers + bonusCounts.workers,
                    completedWorkers: (outcomes.length - failures.length) + efCounts.completed + bonusCounts.completed,
                    failedWorkers: (failures.length + (efCounts.workers - efCounts.completed) + (bonusCounts.workers - bonusCounts.completed)),
                    verifiedHold
                });
            if (failures.length || efFailed || bonusFailed) {
                if (!verifiedHold) {
                    const finalAttempts = (specialSession ? specialDispatchOrder : workerIds).map(worker => [...attempts].reverse().find(attempt => attempt.workerId === worker)).filter(Boolean);
                    const safe = specialSession
                        ? (await Promise.all(finalAttempts.map(attempt => {
                            const outcome = finalByWorker.get(attempt.workerId);
                            return outcome?.status === 'rejected' && conclusiveNoHold(attempt, outcome.reason);
                        }))).every(Boolean)
                        : await (async () => {
                            const states = (await Promise.all(attempts.flatMap(attempt => attempt.journals.map((journal, index) => journal.read(attempt.keys[index]).then(record => record.state).catch(() => 'unknown')))));
                            return canReleaseApiLockAfterParallelFailure(false, failures.map(failure => failure.reason), states, attempts.length);
                        })();
                    // Both side lanes have already been awaited above, so their journal-
                    // proven conclusive safety here is final, not a race with an
                    // in-flight task. A 'success'/'partial' outcome always implies
                    // verifiedHold, which already short-circuits this whole block.
                    const sideLanesSafe = !specialSession ||
                        (!efProofMayHaveDispatched && !efProoflessMayHaveDispatched && !bonusMayHaveDispatched);
                    if (safe && sideLanesSafe) {
                        retainLiveLock = false;
                        await liveLock?.release();
                        liveLock = undefined;
                    }
                }
                throw failures[0]?.reason ?? Error(efFailed ? 'ADAPTIVE_DIRECT_LANE_FAILED' : 'SPECIAL_BONUS_LANE_FAILED');
            }
        }
    }
}
catch (error) {
    const code = safeApiFailureCode(error, 'API_FIRST_RUN_FAILED');
    stage('FAILED', { code });
    process.exitCode = 1;
}
finally {
    await settleSpecialSideTasks();
    // This is also required on exceptional exits that bypass the normal summary
    // path: a side lane may have created a verified hold before another lane
    // failed. Keep that latest expiry durable before closing browser transports.
    await persistLatestVerifiedHold().catch(() => { retainLiveLock = true; });
    // This process attaches to a browser owned by the desktop installation.
    // Closing a CDP attachment closes its transport; the independently launched Chrome windows stay open.
    await Promise.allSettled(connectedBrowsers.map(browser => browser.close()));
    if (liveLock && !retainLiveLock)
        await liveLock.release().catch(() => undefined);
    progressLog.record('PROCESS_EXIT', new Date().toISOString(), stamp(), { exitCode: process.exitCode ?? 0 });
    progressLog.close();
    if (process.connected)
        process.disconnect();
}
//# sourceMappingURL=desktop-runner.js.map