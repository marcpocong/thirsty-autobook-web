import { mkdir, open, realpath } from 'node:fs/promises';
import { attach, browserA, browserB } from './browser.js';
import { assertDiagnosticSchedule } from './diagnostic-schedule.js';
import { bookingPlayers, releaseCalendar, planFingerprint, loadConfig } from './config.js';
import { snapshot, navigateDate } from './grid.js';
import { Safety } from './safety.js';
import { selectionPort } from './selection.js';
import { fullBookingToQr } from './booking-checkout.js';
import { observeRelease } from './release.js';
import { dualArmGate } from './dual-coordinator.js';
import { coordinateBooking } from './booking-coordinator.js';
import { lifecycleWriter, removeOwnedRecord } from './checkout-lifecycle.js';
import { describeBookingPlan } from './booking-plan.js';
import { emitUiEvent } from './ui-events.js';
import { DateTime } from 'luxon';
import { observePassiveReleaseNetwork } from './passive-release-network.js';
import { observePreferredCells } from './passive-target-cells.js';
import { releaseNavigationTarget } from './release-navigation.js';
export async function runBooking(config, mode, safety, t, options = {}) {
    if (options.scheduledTarget) {
        t.mark('scheduledWorkerWake');
        t.mark('workerStart');
    }
    const full = mode === 'test' || mode === 'race';
    if (full && !options.authorizeTerms)
        throw Error('TERMS_AUTHORIZATION_REQUIRED');
    if (mode === 'test' && (!options.request || !options.confirm))
        throw Error('TEST_CONFIRMATION_REQUIRED');
    const target = options.scheduledTarget ?? releaseCalendar(config);
    const scheduledTargetDate = DateTime.fromMillis(target.releaseMs, { zone: config.TIMEZONE }).startOf('day').plus({ days: config.BOOKING_HORIZON_DAYS }).toISODate();
    if (options.scheduledTarget && (Date.now() >= target.releaseMs || target.targetDate !== scheduledTargetDate || options.scheduledFingerprint !== planFingerprint(config)))
        throw Error(Date.now() >= target.releaseMs ? 'RELEASE_MISSED' : 'SCHEDULE_CONTEXT_MISMATCH');
    const request = options.request ?? { strategy: config.BOOKING_TYPE, date: target.targetDate, start: config.START_TIME, duration: config.DURATION_HOURS, courtCount: config.COURT_COUNT, priority: [...config.PREFERRED_COURTS, ...config.FALLBACK_COURTS], fallbackStarts: config.FALLBACK_TIMES };
    if (request.courtCount > 2)
        throw Error('API_FIRST_METHOD_REQUIRED');
    const players = bookingPlayers(config, request.strategy);
    const identities = request.strategy === 'extended' ? [browserA, browserB] : [browserA];
    await mkdir('.local/dual', { recursive: true });
    await mkdir('DiagnosticsLocal', { recursive: true });
    const identity = { pid: process.pid, runID: t.runID };
    const lock = await open('.local/automation.lock', 'wx').catch(() => { throw Error('AUTOMATION_LOCK_EXISTS'); });
    await lock.writeFile(JSON.stringify({ ...identity, mode: request.strategy, stage: 'SELECTION', stageAt: new Date().toISOString(), workers: identities.map(i => i.workerId) }));
    await lock.sync();
    await lock.close();
    const records = [];
    const safeties = identities.map(() => new Safety());
    const abort = () => safeties.forEach(s => s.stop('USER_ABORT'));
    safety.signal.addEventListener('abort', abort, { once: true });
    let clean = false;
    const diagnosticCleanup = [];
    try {
        for (const [i, b] of identities.entries()) {
            const path = identities.length === 1 ? '.local/automation.lock' : `.local/dual/worker-${b.workerId.toLowerCase()}.lock`;
            if (identities.length > 1) {
                const f = await open(path, 'wx');
                await f.writeFile(JSON.stringify({ ...identity, id: b.workerId, stage: 'SELECTION', stageAt: new Date().toISOString() }));
                await f.sync();
                await f.close();
                records.push(path);
            }
            safeties[i].persistStage = lifecycleWriter(path, identity);
        }
        const workerTelemetry = identities.map((_, i) => t.worker(i === 0 ? 'A' : 'B'));
        const connected = await Promise.allSettled(identities.map((b, i) => attach(safeties[i], workerTelemetry[i], b)));
        const connections = connected.map(c => { if (c.status === 'rejected')
            throw c.reason; return c.value; });
        if (mode !== 'test')
            for (const [i, connection] of connections.entries()) {
                try {
                    diagnosticCleanup.push(observePassiveReleaseNetwork(connection.page, workerTelemetry[i]));
                }
                catch { /* passive */ }
                const preferred = request.priority[0];
                if (preferred !== undefined)
                    try {
                        const heading = releaseNavigationTarget(request.date).heading;
                        diagnosticCleanup.push(await observePreferredCells(connection.page, workerTelemetry[i], {
                            date: request.date, heading, court: preferred, hours: Array.from({ length: request.duration }, (_, offset) => `${String(Number(request.start.slice(0, 2)) + offset).padStart(2, '0')}:00`)
                        }));
                    }
                    catch { /* passive */ }
            }
        if (options.scheduledTarget)
            connections.forEach((_, i) => workerTelemetry[i].mark('browserAttached'));
        if (identities.length === 2) {
            const paths = await Promise.all(identities.map(i => realpath(i.expectedProfile)));
            if (paths[0].toLowerCase() === paths[1].toLowerCase())
                throw Error('DUAL_PROFILE_NOT_ISOLATED');
        }
        const workers = connections.map((c, i) => {
            const id = i === 0 ? 'A' : 'B';
            return { id, safety: safeties[i], telemetry: workerTelemetry[i], port: selectionPort(c.page, safeties[i]), state: async () => { }, checkout: async (selected) => {
                    await fullBookingToQr(c.page, selected, players[id], (options.maximum ?? config.MAX_PRICE) * request.courtCount, true, config.PAYMENT_HANDOFF_VERIFY_TIMEOUT_MS, safeties[i], workerTelemetry[i], config.PAYMENT_SUMMARY_READY_TIMEOUT_MS);
                } };
        });
        const gate = dualArmGate(target, safety, t);
        const gridResults = await Promise.allSettled(workers.map(async (w, i) => {
            if (mode === 'test') {
                await assertDiagnosticSchedule(connections[i].page, w.safety);
                await navigateDate(connections[i].page, request.date, w.safety);
                return snapshot(connections[i].page);
            }
            return (await observeRelease(connections[i].page, { ...config, AVAILABILITY_DISCOVERY_MODE: 'ui' }, w.safety, w.telemetry, mode === 'race:dry', true, { target, beforeArmed: identities.length === 2 ? () => gate(w.id) : async () => { }, verifyContext: options.scheduledFingerprint ? () => { if (planFingerprint(loadConfig()) !== options.scheduledFingerprint)
                    throw Error('SCHEDULE_CONTEXT_MISMATCH'); } : undefined })).grid;
        }));
        const failed = gridResults.flatMap((result, i) => result.status === 'rejected' ? [{ result, worker: workers[i] }] : []);
        if (failed.length) {
            if (mode !== 'test')
                for (const { result, worker } of failed)
                    if (!worker.telemetry.hasReleaseFailure()) {
                        const code = result.reason instanceof Error && /^[A-Z_]{1,80}$/.test(result.reason.message) ? result.reason.message : 'RELEASE_SHELL_UNCLASSIFIED';
                        const classification = code === 'CHROME_DISCONNECTED' ? 'BROWSER_DISCONNECTED' : code === 'SECURITY_CHALLENGE' ? 'SECURITY_CHALLENGE' : code === 'RATE_LIMITED' ? 'RATE_LIMITED' : code === 'ACCESS_BLOCKED' ? 'ACCESS_BLOCKED' : code === 'UNEXPECTED_REDIRECT' || code === 'WRONG_URL' ? 'UNEXPECTED_NAVIGATION' : code === 'USER_ABORT' ? 'ABORTED' : 'UNCLASSIFIED';
                        worker.telemetry.recordReleaseFailure('RELEASE_WORKER', code, classification);
                    }
            abort();
            throw failed[0].result.reason;
        }
        const grids = gridResults.map(result => { if (result.status !== 'fulfilled')
            throw Error('RELEASE_WORKER_FAILED'); return result.value; });
        const result = await coordinateBooking(workers, request, grids, options.maximum ?? config.MAX_PRICE, config.MAX_SELECTION_ATTEMPTS, mode === 'race:dry' ? 'dry' : mode === 'race:selection' ? 'selection' : 'full', options.confirm);
        clean = result.status === 'CANCELLED' || result.status === 'AVAILABLE';
        emitUiEvent({ type: 'bookingResult', status: result.status, description: describeBookingPlan(result.plan, options.maximum ?? config.MAX_PRICE), outcomes: result.outcomes ?? [] });
        if (['PARTIAL SUCCESS', 'BOOKING FAILED'].includes(result.status))
            throw Error(result.status === 'PARTIAL SUCCESS' ? 'PARTIAL_SUCCESS' : 'BOOKING_FAILED');
        return result;
    }
    finally {
        for (const cleanup of diagnosticCleanup)
            try {
                cleanup();
            }
            catch { /* passive */ }
        safety.signal.removeEventListener('abort', abort);
        if (clean) {
            for (const path of records)
                await removeOwnedRecord(path, identity.pid, identity.runID);
            await removeOwnedRecord('.local/automation.lock', identity.pid, identity.runID);
        }
    }
}
//# sourceMappingURL=booking-runtime.js.map