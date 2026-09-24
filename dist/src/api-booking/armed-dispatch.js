import { resolve } from 'node:path';
import { armCheckoutRequest } from './browser-session-transport.js';
import { DurableSubmissionJournal, revokeSubmissionPermit } from './durable-submission-journal.js';
import { THIRSTY_PICKLE_FACILITY_ID } from './live-availability-provider.js';
import { assertPrecisionFreezeIntact, classifyPrecisionDispatchError } from './precision-race.js';
import { assertDirectDispatchWindow, DIRECT_MAX_DISPATCH_LATENESS_MS, prooflessPlanFingerprint, prooflessRequest, recordDirectCheckoutOutcome } from './proofless-checkout.js';
import { SubmissionDispatchError } from './submission-errors.js';
import { standardPlanJournalKeys } from './two-hour-reservation.js';
import { DEFAULT_SPIN_TAIL_MS, waitForMonotonicDeadline } from '../release-clock.js';
const safeCode = (error, fallback) => error instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.message) ? error.message : fallback;
function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value))
            deepFreeze(child);
    }
    return value;
}
/** Pre-release, durable arming of every frozen attempt. Never sends anything. */
export async function armPrecisionRace(race, deps) {
    assertPrecisionFreezeIntact(race);
    if (race.releaseMs !== deps.releaseMs || !Number.isSafeInteger(deps.releaseMs))
        throw Error('PRECISION_ARM_RELEASE_MISMATCH');
    if (!race.attempts.length)
        throw Error('PRECISION_NOTHING_TO_ARM');
    if (!(deps.now() < deps.releaseMs))
        throw Error('PRECISION_ARM_TOO_LATE');
    const dispatchDeadlineMs = deps.releaseMs + (deps.dispatchWindowMs ?? DIRECT_MAX_DISPATCH_LATENESS_MS);
    const prepared = race.attempts.map(attempt => {
        const request = deepFreeze(prooflessRequest(attempt.plan, deps.customerFor(attempt.target.workerId)));
        const keys = standardPlanJournalKeys(attempt.plan, THIRSTY_PICKLE_FACILITY_ID);
        if (keys.length !== 1 || keys[0] !== attempt.target.targetKey || armCheckoutRequest(request).key !== keys[0])
            throw Error('PRECISION_TARGET_KEY_MISMATCH');
        return { attempt, request, key: keys[0], fingerprint: prooflessPlanFingerprint(attempt.plan) };
    });
    // The global lock is armed before any per-target record, so every armed journal is covered by it.
    await deps.lock?.armed(deps.releaseMs, dispatchDeadlineMs, prepared.length);
    const settled = await Promise.allSettled(prepared.map(async ({ attempt, request, key, fingerprint }) => {
        const journal = deps.journalFor?.(key) ?? new DurableSubmissionJournal(resolve(deps.journalRoot, key));
        await journal.arm(key, new Date(deps.now()), { attemptId: key, planFingerprint: fingerprint, targetDate: attempt.plan.targetDate,
            courtIds: attempt.plan.courts.map(court => court.court),
            hourlyBoundaries: attempt.plan.courts.flatMap(court => court.slots.map(slot => ({ startTime: slot.startTime, endTime: slot.endTime }))),
            expectedBookingCount: request.items.length, maximumAmount: attempt.plan.totalPrice, stage: 'armed',
            releaseMs: deps.releaseMs, dispatchDeadlineMs });
        let permit;
        try {
            permit = await journal.claimArmedOneShot(key, new Date(deps.now()));
        }
        catch (error) {
            // Armed but never claimed: no permit exists; record it as provably unsent.
            await journal.mark(key, 'rejected', new Date(deps.now()), undefined, undefined, 'ARMED_NOT_DISPATCHED').catch(() => undefined);
            throw error;
        }
        return { target: attempt.target, plan: attempt.plan, key, request, journal, permit, state: 'armed' };
    }));
    const attempts = [], unarmed = [];
    settled.forEach((result, index) => {
        if (result.status === 'fulfilled')
            attempts.push(result.value);
        else {
            const code = safeCode(result.reason, 'PRECISION_ARM_FAILED');
            unarmed.push({ attempt: prepared[index].attempt, state: code === 'DUPLICATE_LOGICAL_BOOKING_BLOCKED' ? 'JOURNAL_BLOCKED' : 'NOT_DISPATCHED', code });
        }
    });
    return Object.freeze({ race, releaseMs: deps.releaseMs, dispatchDeadlineMs, attempts: Object.freeze(attempts), unarmed: Object.freeze(unarmed) });
}
/**
 * The release-instant action for one armed attempt. Synchronous up to the transport
 * call and in-memory only. Refusals happen before the one-shot flips and before the
 * transport is invoked, so they are provably unsent. Never throws synchronously.
 */
export function fireArmedAttempt(attempt, transport, clock, window, isAborted) {
    const refuse = (code) => {
        if (attempt.state === 'armed') {
            attempt.state = 'refused';
            revokeSubmissionPermit(attempt.permit);
        }
        return Promise.reject(new SubmissionDispatchError(code, false));
    };
    try {
        if (attempt.state !== 'armed')
            return Promise.reject(new SubmissionDispatchError('SUPERVISED_ONE_SHOT_ALREADY_USED', false));
        if (isAborted())
            return refuse('USER_ABORT');
        const now = clock.nowMs();
        // Final trusted no-early / maximum-lateness gate (same anchored clock as the wait).
        if (now < window.releaseMs)
            return refuse('DIRECT_RELEASE_NOT_REACHED');
        if (now > window.dispatchDeadlineMs)
            return refuse('DIRECT_RELEASE_WINDOW_MISSED');
        attempt.state = 'fired';
        // Checked once more as the transport's last step before the network.
        const beforePost = () => {
            try {
                assertDirectDispatchWindow(window.releaseMs, clock.nowMs());
            }
            catch {
                throw new SubmissionDispatchError('DIRECT_RELEASE_WINDOW_MISSED', false);
            }
        };
        return transport.publicCheckoutProofless(attempt.request, attempt.permit, { requirePreparedContext: true, beforePost });
    }
    catch (error) {
        // Only reachable if the transport threw synchronously; it may already have been invoked.
        return Promise.reject(error);
    }
}
/** Awaits one fired attempt's response and records it durably (post-response, off the hot path). */
export function settleArmedAttempt(attempt, sent, now) {
    return recordDirectCheckoutOutcome(() => sent, attempt.request, attempt.plan, [{ journal: attempt.journal, key: attempt.key }], now);
}
/**
 * Durably records an attempt that was never fired as provably unsent. Only the live
 * process can do this: the permit must still be unspent in this process, which proves
 * the transport was never invoked for it.
 */
export async function disarmAttempt(attempt, code, now) {
    if (attempt.state !== 'armed' || !revokeSubmissionPermit(attempt.permit))
        return false;
    attempt.state = 'disarmed';
    await attempt.journal.mark(attempt.key, 'rejected', new Date(now()), undefined, undefined, /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : 'ARMED_NOT_DISPATCHED');
    return true;
}
export async function disarmUnfired(armed, code, now) {
    const results = await Promise.allSettled(armed.attempts.map(attempt => disarmAttempt(attempt, code, now)));
    return armed.attempts.flatMap((attempt, index) => results[index].status === 'fulfilled' && results[index].value ? [attempt.target.workerId] : []);
}
/** True when no armed attempt ever reached the transport (every one refused or disarmed). */
export const armedNothingFired = (armed) => armed.attempts.every(attempt => attempt.state !== 'fired');
export const FINAL_APPROACH_MS = 1_000;
/**
 * Per-attempt readiness and independent dispatch for an armed race. Prewarm runs
 * prewarmLeadMs before release; the final wait is on the monotonic deadline of the
 * trusted clock; at the deadline every ready attempt is fired in one synchronous pass.
 * An attempt that is not ready by the dispatch deadline is disarmed as unsent.
 */
export async function dispatchArmedPrecisionRace(armed, deps) {
    const { clock } = deps, { releaseMs, dispatchDeadlineMs } = armed;
    const now = () => clock.nowMs();
    const retryCutoff = releaseMs - (deps.prewarmRetryCutoffMs ?? 7_000);
    const spinTailMs = deps.spinTailMs ?? DEFAULT_SPIN_TAIL_MS;
    // Observers must never change an outcome (a failed trace write is not a failed prewarm or an unknown POST).
    const emit = (event) => { try {
        deps.onEvent?.(event);
    }
    catch { /* observability only */ } };
    const waitFor = (epochMs, isAborted = deps.isAborted, sleep = deps.sleep) => waitForMonotonicDeadline(() => clock.monotonicDeadline(epochMs), { spinTailMs, isAborted, ...(sleep ? { sleep } : {}) });
    let readiness;
    try {
        assertPrecisionFreezeIntact(armed.race);
        await waitFor(releaseMs - deps.prewarmLeadMs);
        readiness = armed.attempts.map(attempt => {
            const entry = { settled: false, ok: false, promise: Promise.resolve(false) };
            entry.promise = (async () => {
                for (let round = 1; round <= 2; round++) {
                    try {
                        await deps.prewarm(attempt);
                    }
                    catch (error) {
                        emit({ kind: 'prewarm-failed', workerId: attempt.target.workerId, code: safeCode(error, 'SECURITY_PREWARM_FAILED') });
                        if (round === 1 && now() < retryCutoff) {
                            emit({ kind: 'prewarm-retry', workerId: attempt.target.workerId });
                            continue;
                        }
                        return false;
                    }
                    emit({ kind: 'prewarm-ready', workerId: attempt.target.workerId });
                    return true;
                }
                return false;
            })().then(ok => { entry.settled = true; entry.ok = ok; return ok; });
            return entry;
        });
        // Integrity of the frozen set is verified before the final wait, never after T-0.
        assertPrecisionFreezeIntact(armed.race);
        if (deps.onFinalApproach) {
            await waitFor(releaseMs - FINAL_APPROACH_MS);
            try {
                deps.onFinalApproach();
            }
            catch { /* optional tuning */ }
        }
        await waitFor(releaseMs);
    }
    catch (error) {
        try {
            deps.onReleaseWindowEnd?.();
        }
        catch { /* optional tuning */ }
        // Aborted (or failed) before release: nothing was fired; record every attempt as provably unsent.
        await disarmUnfired(armed, safeCode(error, 'ARMED_NOT_DISPATCHED'), now);
        throw error;
    }
    deps.onWake?.();
    // ---- T-0: one synchronous, in-memory pass. No I/O, hashing or request building here. ----
    const sends = new Array(armed.attempts.length);
    for (let index = 0; index < armed.attempts.length; index++) {
        const attempt = armed.attempts[index], ready = readiness[index];
        if (!ready.settled || !ready.ok)
            continue;
        const transport = deps.transportFor(attempt.target.workerId);
        if (!transport)
            continue;
        deps.onMark?.(attempt.target.workerId, 'transportCall');
        const sent = fireArmedAttempt(attempt, transport, clock, armed, deps.isAborted);
        sent.catch(() => undefined); // observed below; marked handled so a refusal is never an unhandled rejection meanwhile
        sends[index] = sent;
    }
    // The CDP messages leave in the microtasks after this pass; run no bookkeeping on this thread until they have.
    await new Promise(done => setImmediate(done));
    try {
        deps.onReleaseWindowEnd?.();
    }
    catch { /* optional tuning */ }
    // ---- Everything below runs after every ready POST has been started. ----
    const afterFire = deps.afterFire && sends.some(Boolean)
        ? deps.afterFire().then(() => undefined, (error) => safeCode(error, 'AFTER_FIRE_FAILED'))
        : Promise.resolve(undefined);
    const settleInner = async (index) => {
        const attempt = armed.attempts[index], ready = readiness[index];
        let sent = sends[index];
        if (!sent) {
            if (!ready.settled) {
                // Not ready at T-0: it may still dispatch inside the window, exactly like a late prewarm before.
                const timedOut = Symbol('timeout');
                // A late prewarm keeps its window even if Stop arrives now (fireArmedAttempt still refuses once aborted).
                const outcome = await Promise.race([ready.promise, waitFor(dispatchDeadlineMs, () => false, undefined).then(() => timedOut)]);
                if (outcome === timedOut) {
                    await disarmAttempt(attempt, 'PREWARM_NOT_READY_IN_WINDOW', now).catch(() => undefined);
                    return { state: 'WINDOW_MISSED', code: 'PREWARM_NOT_READY_IN_WINDOW' };
                }
            }
            if (!ready.ok) {
                await disarmAttempt(attempt, 'SECURITY_PREWARM_FAILED', now).catch(() => undefined);
                return { state: 'PREWARM_FAILED', code: 'SECURITY_PREWARM_FAILED' };
            }
            const transport = deps.transportFor(attempt.target.workerId);
            if (!transport) {
                await disarmAttempt(attempt, 'API_CHECKOUT_WORKER_MISSING', now).catch(() => undefined);
                return { state: 'NOT_DISPATCHED', code: 'API_CHECKOUT_WORKER_MISSING' };
            }
            sent = fireArmedAttempt(attempt, transport, clock, armed, deps.isAborted);
        }
        emit({ kind: 'dispatch-start', workerId: attempt.target.workerId });
        try {
            const verified = await settleArmedAttempt(attempt, sent, now);
            return deps.onVerifiedHold ? await deps.onVerifiedHold(attempt, verified) : { state: 'QR_READY' };
        }
        catch (error) {
            return classifyPrecisionDispatchError(error, async () => {
                try {
                    return (await attempt.journal.read(attempt.key)).state;
                }
                catch (readError) {
                    if (readError.code === 'ENOENT')
                        return undefined;
                    throw readError;
                }
            });
        }
    };
    const settleOne = async (index) => {
        // settleInner classifies its own failures; an unexpected throw may have happened after the POST.
        const result = await settleInner(index).catch(() => ({ state: 'UNKNOWN', code: 'PRECISION_DISPATCH_UNCLASSIFIED' }));
        const attempt = armed.attempts[index];
        emit({ kind: 'settled', workerId: attempt.target.workerId, state: result.state, ...(result.code ? { code: result.code } : {}) });
        return result;
    };
    const settled = await Promise.all(armed.attempts.map((_, index) => settleOne(index)));
    const disarmed = await disarmUnfired(armed, 'ARMED_NOT_DISPATCHED', now);
    const afterFireError = await afterFire;
    const byWorker = new Map(armed.attempts.map((attempt, index) => [attempt.target.workerId, settled[index]]));
    for (const value of armed.unarmed)
        byWorker.set(value.attempt.target.workerId, { state: value.state, code: value.code });
    return { results: armed.race.attempts.map(attempt => ({ attempt, ...(byWorker.get(attempt.target.workerId) ?? { state: 'NOT_DISPATCHED', code: 'PRECISION_NOT_ARMED' }) })),
        disarmed, ...(afterFireError ? { afterFireError } : {}) };
}
//# sourceMappingURL=armed-dispatch.js.map