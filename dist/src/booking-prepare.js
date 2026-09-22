import { resolve } from 'node:path';
import { readFile, open, unlink, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { chromium } from 'playwright';
import { identifyWorkerPage } from './browser-window.js';
import { DateTime } from 'luxon';
import { browserIdentity, candidateBrowserIdentity, cdpCodes, rememberBrowserPort, verifyDedicatedChrome, verifyCandidateChrome, monitorConnection } from './browser.js';
import { ONDA_URL, VENUE } from './config.js';
import { inspectLockPage } from './lock-browser.js';
import { snapshot, validateSnapshot, navigateDate } from './grid.js';
import { securityReason } from './safety.js';
import { assertDiagnosticSchedule } from './diagnostic-schedule.js';
import { pidAlive } from '../ui/locks.js';
import { WORKER_IDS } from './workers.js';
export class PreparationBlockedError extends Error {
    browserId;
    review;
    constructor(code, browserId, review) {
        super(code);
        this.browserId = browserId;
        this.review = review;
    }
}
export function assertResetSafe(record, browser, now = Date.now()) {
    if (record?.stage === 'FINAL_ACTION_DISPATCHING') {
        if (browser.hold === 'Expired')
            return;
        const stageAt = Date.parse(record.stageAt ?? '');
        // New records may recover after the validated ten-minute maximum plus a
        // conservative minute, but legacy records never recover from Schedule alone.
        if (Number.isFinite(stageAt) && now - stageAt > 660000 && browser.clean && browser.page === 'Schedule' && browser.selected === 0 && browser.hold === 'Not detected')
            return;
        throw Error('PAYMENT_HOLD_MAY_BE_ACTIVE');
    }
    if (!record?.stage && ['checkout', 'unknown'].includes(record?.state ?? ''))
        throw Error('PAYMENT_HOLD_MAY_BE_ACTIVE');
    if (record?.stage === 'HOLD_VERIFIED' || record?.handoff || record?.state === 'hold') {
        // A verified hold is already a known outcome. A fresh, clean schedule tab
        // may be prepared while its QR tab and durable evidence remain available.
        if (record.stage === 'HOLD_VERIFIED' && Number.isFinite(Date.parse(record.holdExpiresAt ?? '')) && browser.clean && browser.page === 'Schedule' && browser.selected === 0 && browser.hold === 'Not detected')
            return;
        if (browser.hold === 'Expired')
            return;
        const expires = Date.parse(record.holdExpiresAt ?? '');
        if (Number.isFinite(expires) && expires <= now && browser.clean && browser.page === 'Schedule' && browser.hold === 'Not detected')
            return;
        throw Error('PAYMENT_HOLD_MAY_BE_ACTIVE');
    }
    if (browser.hold === 'Active' || browser.hold === 'Unknown' || browser.page === 'QR Checkout' && browser.hold !== 'Expired')
        throw Error('PAYMENT_HOLD_MAY_BE_ACTIVE');
    if (browser.hold === 'Expired')
        return;
    if (browser.page === 'Schedule' && browser.hold === 'Not detected')
        return;
    if (['Review Booking', 'Payment Summary'].includes(browser.page) && browser.hold === 'Not detected' && (!record || ['SELECTION', 'SELECTION_VERIFIED', 'REVIEW', 'PAYMENT_SUMMARY'].includes(record.stage ?? '')))
        return;
    throw Error('PAYMENT_HOLD_MAY_BE_ACTIVE');
}
async function maybeRead(path) { try {
    return await readFile(path, 'utf8');
}
catch (e) {
    if (e.code === 'ENOENT')
        return undefined;
    throw e;
} }
function browserPreparationError(workerId, error) {
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.message) ? error.message : 'PREPARATION_FAILED';
    return Error(`BROWSER_${workerId}_${code}`);
}
export async function resetAndPrepare(strategy, safety, deps = {}, date, requestedWorkers = []) {
    const root = deps.root ?? '.', alive = deps.alive ?? pidAlive;
    deps.progress?.('starting');
    const path = resolve(root, '.local/automation.lock'), raw = await maybeRead(path);
    let expectedRaw = raw;
    const record = raw ? JSON.parse(raw) : undefined;
    if (record && (!Number.isSafeInteger(record.pid) || record.pid <= 0 || alive(record.pid) !== false))
        throw Error('LOCK_PID_RUNNING');
    const legacy = record?.mode === 'dual';
    const recordedWorkers = Array.isArray(record?.workers) && record.workers.every((id) => WORKER_IDS.includes(id)) ? record.workers : [];
    const previousWorkers = recordedWorkers.length ? recordedWorkers : legacy || record?.mode === 'extended' ? ['A', 'B'] : [];
    const requiredWorkers = [...new Set([...previousWorkers, ...(requestedWorkers.length ? requestedWorkers : strategy === 'extended' ? ['A', 'B'] : ['A'])])];
    const workerPaths = ['.local/dual/worker-a.lock', '.local/dual/worker-b.lock'].map(p => resolve(root, p));
    const guardPath = resolve(root, '.local/preparation.lock');
    const subordinate = await Promise.all(workerPaths.map(maybeRead));
    const sharedRecord = !!record && recordedWorkers.length > 0 && subordinate.every(value => value === undefined);
    if (!record && subordinate.some(Boolean))
        throw Error('ORPHAN_WORKER_STATE');
    if (record && !legacy && record.mode !== 'extended' && subordinate.some(Boolean))
        throw Error('ORPHAN_WORKER_STATE');
    const records = subordinate.map(r => r ? JSON.parse(r) : undefined);
    if (legacy || record?.mode === 'extended' && !sharedRecord)
        for (const r of records)
            if (!r || r.pid !== record.pid || r.runID !== record.runID || alive(r.pid) !== false)
                throw Error('WORKER_STATE_UNKNOWN');
    const same = async () => {
        safety.check();
        if (await maybeRead(path) !== expectedRaw)
            throw Error('LOCK_REPLACED');
        const now = await Promise.all(workerPaths.map(maybeRead));
        if (now.some((r, i) => r !== subordinate[i]))
            throw Error('LOCK_REPLACED');
        if (record && alive(record.pid) !== false)
            throw Error('LOCK_PID_RUNNING');
    };
    // Serialize preparation instances separately; ordinary automation is still excluded
    // by the retained global lock, or a temporary reservation when starting clean.
    const previous = await maybeRead(guardPath);
    if (previous) {
        const p = JSON.parse(previous);
        if (!Number.isSafeInteger(p.pid) || alive(p.pid) !== false)
            throw Error('PREPARATION_ALREADY_RUNNING');
        if (await maybeRead(guardPath) !== previous)
            throw Error('LOCK_REPLACED');
        await unlink(guardPath);
    }
    const guardRaw = JSON.stringify({ pid: process.pid, runID: `prepare-${Date.now()}-${Math.random().toString(16).slice(2)}` });
    const guard = await open(guardPath, 'wx').catch(() => { throw Error('PREPARATION_ALREADY_RUNNING'); });
    await guard.writeFile(guardRaw);
    await guard.sync();
    await guard.close();
    let reservedRaw;
    let result;
    try {
        await same();
        deps.progress?.('previous-session');
        if (!raw) {
            const f = await open(path, 'wx');
            reservedRaw = JSON.stringify({ pid: process.pid, runID: JSON.parse(guardRaw).runID, mode: 'preparing' });
            expectedRaw = reservedRaw;
            await f.writeFile(reservedRaw);
            await f.sync();
            await f.close();
        }
        let identities = requiredWorkers.map(browserIdentity);
        // Start/reuse every required browser before inspecting any Onda state. The
        // built-in starter may move a worker to its recorded fallback endpoint when
        // another application owns the preferred port; it never closes that owner.
        if (!deps.inspect || deps.start) {
            const started = [];
            for (const identity of identities)
                started.push(await (deps.start ?? startForPreparation)(identity) ?? identity);
            identities = started;
        }
        const browsers = [];
        deps.progress?.('onda');
        for (const [i, b] of identities.entries()) {
            const workerRecord = sharedRecord ? record : legacy || record?.mode === 'extended' ? records[i] : i === 0 ? record : undefined;
            const preserveHold = workerRecord?.stage === 'HOLD_VERIFIED' && Number.isFinite(Date.parse(workerRecord.holdExpiresAt ?? ''));
            let prepared;
            try {
                prepared = await (deps.inspect ?? ((identity, guard) => inspectForPreparation(identity, guard, preserveHold)))(b, safety);
            }
            catch (error) {
                throw browserPreparationError(requiredWorkers[i], error);
            }
            browsers.push(prepared);
        }
        // Inspect every required browser before deciding whether any state is safe
        // to normalize. In particular, a FINAL_ACTION_DISPATCHING record in A must
        // not prevent inspection of B's independent Onda checkout.
        deps.progress?.('holds');
        for (const [i, browser] of browsers.entries()) {
            const workerRecord = sharedRecord ? record : legacy || record?.mode === 'extended' ? records[i] : i === 0 ? record : undefined;
            try {
                assertResetSafe(workerRecord, browser.observed);
            }
            catch (error) {
                throw new PreparationBlockedError(error instanceof Error ? error.message : 'PAYMENT_HOLD_MAY_BE_ACTIVE', requiredWorkers[i], browser.observed);
            }
        }
        // Only normalize after all browser state and durable records are safe.
        deps.progress?.('calendar');
        const normalized = [];
        for (const [i, browser] of browsers.entries()) {
            await same();
            safety.check();
            let prepared;
            try {
                prepared = await browser.normalize(date);
            }
            catch (error) {
                throw browserPreparationError(requiredWorkers[i], error);
            }
            normalized.push({ id: requiredWorkers[i], ...(prepared ? { snapshot: prepared } : {}) });
        }
        deps.progress?.('grids');
        if (raw) {
            await same();
            const verifiedHold = record?.stage === 'HOLD_VERIFIED' || records.some(r => r?.stage === 'HOLD_VERIFIED');
            if (verifiedHold) {
                const directory = resolve(root, '.local/retained-holds');
                await mkdir(directory, { recursive: true, mode: 0o700 });
                const archive = await open(resolve(directory, `${randomUUID()}.json`), 'wx', 0o600);
                try {
                    await archive.writeFile(JSON.stringify({ archivedAt: new Date().toISOString(), lock: record, workers: records.filter(Boolean) }));
                    await archive.sync();
                }
                finally {
                    await archive.close();
                }
            }
            for (const [i, r] of subordinate.entries())
                if (r)
                    await unlink(workerPaths[i]);
            await unlink(path);
        }
        result = { browsers: normalized };
        return result;
    }
    finally {
        if (reservedRaw) {
            const current = await maybeRead(path);
            if (current === reservedRaw)
                await unlink(path);
            else if (current !== undefined)
                throw Error('LOCK_REPLACED');
        }
        const currentGuard = await maybeRead(guardPath);
        if (currentGuard === guardRaw)
            await unlink(guardPath);
        else if (currentGuard !== undefined)
            throw Error('LOCK_REPLACED');
    }
}
async function inspectForPreparation(b, safety, preserveVerifiedHold = false) {
    safety.check();
    verifyDedicatedChrome(b);
    const browser = await chromium.connectOverCDP(b.cdpUrl, { timeout: 10000 }).catch(() => { throw Error('CDP_ENDPOINT_UNAVAILABLE'); });
    const candidates = browser.contexts().flatMap(c => c.pages()).filter(p => { try {
        return new URL(p.url()).origin === new URL(ONDA_URL).origin;
    }
    catch {
        return false;
    } });
    const schedulePages = candidates.filter(p => p.url() === ONDA_URL);
    if (!preserveVerifiedHold && candidates.length !== 1 || preserveVerifiedHold && schedulePages.length > 1)
        throw Error('ONDA_TAB_AMBIGUOUS_OR_MISSING');
    const context = browser.contexts()[0];
    if (!context)
        throw Error('CDP_BROWSER_CONTEXT_MISSING');
    const page = preserveVerifiedHold ? (schedulePages[0] ?? await context.newPage()) : candidates[0];
    if (preserveVerifiedHold && page.url() !== ONDA_URL)
        await page.goto(ONDA_URL, { waitUntil: 'domcontentloaded' });
    // Eight-browser preparation must tolerate a newly launched Chrome finishing
    // its initial Onda render. The command remains bounded, but a single slow
    // first load no longer fails at the old ten-second locator deadline.
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);
    monitorConnection(browser, page, safety);
    const reason = securityReason(await page.locator('body').innerText());
    if (reason)
        throw Error(reason);
    const observed = await inspectLockPage(page, { scheduleHydrationTimeoutMs: 30000 });
    if (['Review Booking', 'Payment Summary'].includes(observed.page) && (page.url() !== ONDA_URL || await page.locator('h2').count() !== 1 || (await page.locator('h2').innerText()).trim() !== VENUE))
        throw Error('WRONG_VENUE');
    await identifyWorkerPage(page, b.workerId).catch(() => undefined);
    return { observed, normalize: async (date) => { const prepared = await prepareSchedule(page, safety, date); await identifyWorkerPage(page, b.workerId).catch(() => undefined); return prepared; } };
}
async function available(port) {
    return new Promise(resolveAvailable => {
        const server = createServer();
        server.unref();
        server.once('error', () => resolveAvailable(false));
        server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(() => resolveAvailable(true)));
    });
}
function failureCode(error) {
    const e = error;
    const text = [e?.message, e?.stdout, e?.stderr].filter(v => typeof v === 'string').join('\n');
    return [...cdpCodes, 'CHROME_NOT_INSTALLED', 'CHROME_START_TIMEOUT'].find(code => new RegExp(`(?:^|[^A-Z_])${code}(?:$|[^A-Z_])`).test(text));
}
async function launch(b) {
    try {
        await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('scripts/start-onda-chrome.ps1'), '-Worker', b.workerId, '-Port', String(b.port)], { windowsHide: true, timeout: 60000 });
    }
    catch (error) {
        throw Error(failureCode(error) ?? 'CHROME_START_FAILED');
    }
}
export async function startForPreparation(initial, deps = {}) {
    const launchBrowser = deps.launch ?? launch, portAvailable = deps.available ?? available, verify = deps.verify ?? verifyCandidateChrome, persist = deps.persist ?? rememberBrowserPort;
    try {
        await launchBrowser(initial);
        return initial;
    }
    catch (error) {
        const code = error instanceof Error ? error.message : 'CHROME_START_FAILED';
        if (!cdpCodes.includes(code))
            throw error;
    }
    const occupied = new Set(WORKER_IDS.filter(id => id !== initial.workerId).map(id => browserIdentity(id).port)), base = 19222 + WORKER_IDS.indexOf(initial.workerId);
    for (let port = base; port <= base + 38; port += 2) {
        if (occupied.has(port) || !await portAvailable(port))
            continue;
        const candidate = candidateBrowserIdentity(initial.workerId, port);
        try {
            await launchBrowser(candidate);
            verify(candidate);
            return persist(initial.workerId, port);
        }
        catch (error) {
            const code = error instanceof Error ? error.message : 'CHROME_START_FAILED';
            if (!cdpCodes.includes(code))
                throw error;
        }
    }
    throw Error('CDP_ENDPOINT_UNAVAILABLE');
}
export async function prepareSchedule(page, safety, date) {
    safety.check();
    await page.goto(ONDA_URL, { waitUntil: 'domcontentloaded' });
    const target = date ?? DateTime.now().setZone('Asia/Manila').toISODate();
    await navigateDate(page, target, safety);
    const current = await snapshot(page), cells = validateSnapshot(current, target);
    if (cells.some(c => c.state === 'SELECTED'))
        throw Error('PREEXISTING_SELECTION');
    await assertDiagnosticSchedule(page, safety);
    return current;
}
//# sourceMappingURL=booking-prepare.js.map