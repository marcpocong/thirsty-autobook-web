import { createHash } from 'node:crypto';
import { PRECISION_FAN_OUT_ATTEMPTS, PRECISION_MAX_ATTEMPTS, PRECISION_WORKER_IDS } from '../workers.js';
import { COURT_TO_SPACE_ID } from './availability-parser.js';
import { DurableSubmissionJournal } from './durable-submission-journal.js';
import { SubmissionDispatchError } from './submission-errors.js';
import { THIRSTY_PICKLE_FACILITY_ID } from './live-availability-provider.js';
import { DIRECT_ASSUMED_DAY_RATE, DIRECT_ASSUMED_EVENING_RATE, DIRECT_MAX_DISPATCH_LATENESS_MS, prooflessReleasePlan } from './proofless-checkout.js';
import { isReleaseOffsetMs } from '../release-offset.js';
/**
 * Precision Release v1: the operator wants ONE court and authorizes 1-7 exact,
 * independent one-court targets, each sent by its own worker (A-G, in row order). This is
 * deliberately not COURT_COUNT: every target is a separate single-court
 * Proofless checkout and success means at least one verified hold.
 */
export const PRECISION_MAX_TARGETS = PRECISION_MAX_ATTEMPTS;
export const PRECISION_DESIRED_HOLDS = 1;
const hourText = (hour) => `${String(hour).padStart(2, '0')}:00`;
export function precisionTargetEnd(target) {
    return hourText(Number(target.start.slice(0, 2)) + target.durationHours);
}
/** Validates the exact authorized target set. Rejects duplicates and any same-court overlap. */
export function validatePrecisionTargets(inputs, date, fanOut = false) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
        throw Error('PRECISION_DATE_INVALID');
    if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > PRECISION_MAX_TARGETS)
        throw Error('PRECISION_TARGET_COUNT_INVALID');
    const targets = inputs.map((input, index) => {
        const start = Number(input.start?.slice?.(0, 2));
        if (!Number.isInteger(input.court) || !COURT_TO_SPACE_ID[input.court] ||
            !/^(0[89]|1\d|2[0-3]):00$/.test(input.start) || !Number.isInteger(input.durationHours) ||
            input.durationHours < 1 || input.durationHours > 3 || start + input.durationHours > 24 ||
            !isReleaseOffsetMs(input.releaseOffsetMs ?? 0) || input.fanOutReleaseOffsetsMs?.some((value) => !isReleaseOffsetMs(value)))
            throw Error('PRECISION_TARGET_INVALID');
        const workerId = PRECISION_WORKER_IDS[index];
        const end = precisionTargetEnd(input);
        const spaceId = COURT_TO_SPACE_ID[input.court];
        const assumedAmount = Array.from({ length: input.durationHours }, (_, offset) => start + offset >= 16 ? DIRECT_ASSUMED_EVENING_RATE : DIRECT_ASSUMED_DAY_RATE).reduce((sum, value) => sum + value, 0);
        return { court: input.court, start: input.start, durationHours: input.durationHours, workerId, end, assumedAmount,
            targetKey: DurableSubmissionJournal.key(THIRSTY_PICKLE_FACILITY_ID, spaceId, date, input.start, end),
            ...(input.releaseOffsetMs ? { releaseOffsetMs: input.releaseOffsetMs } : {}),
            ...(input.fanOutReleaseOffsetsMs ? { fanOutReleaseOffsetsMs: Object.freeze([...input.fanOutReleaseOffsetsMs]) } : {}) };
    });
    if (fanOut && targets.some(target => target.fanOutReleaseOffsetsMs?.length !== PRECISION_FAN_OUT_ATTEMPTS))
        throw Error('PRECISION_FAN_OUT_OFFSETS_INVALID');
    if (!fanOut && targets.some(target => target.fanOutReleaseOffsetsMs !== undefined))
        throw Error('PRECISION_FAN_OUT_DISABLED');
    for (const [index, target] of targets.entries())
        for (const other of targets.slice(index + 1)) {
            if (target.targetKey === other.targetKey)
                throw Error('PRECISION_TARGET_DUPLICATE');
            if (target.court === other.court && target.start < other.end && other.start < target.end)
                throw Error('PRECISION_TARGET_OVERLAP');
        }
    return targets;
}
/** Expands each configured worker goal into either one ordinary attempt or four fan-out children. */
export function precisionAttemptSet(targets, date, fanOut) {
    return targets.flatMap(target => (fanOut ? target.fanOutReleaseOffsetsMs ?? [] : [target.releaseOffsetMs ?? 0]).map(releaseOffsetMs => {
        const { fanOutReleaseOffsetsMs: _fanOut, releaseOffsetMs: _single, ...base } = target;
        const child = { ...base, ...(releaseOffsetMs ? { releaseOffsetMs } : {}) };
        return { target: child, plan: precisionTargetPlan(child, date) };
    }));
}
/** The exact single-court Proofless plan for one target; never combined with another target. */
export function precisionTargetPlan(target, date) {
    return prooflessReleasePlan({ mode: 'standard', targetDate: date, durationHours: target.durationHours,
        preferredStartTimes: [target.start], fallbackStartTimes: [], courtPriority: [target.court], fallbackCourts: [],
        courtCount: 1, exactCourts: [[target.court]], maximumTotalPrice: Infinity, currency: 'PHP' });
}
export function precisionFingerprint(date, releaseMs, targets, fanOut = false) {
    // A non-zero Release Offset is appended, so a set without offsets keeps its previous fingerprint.
    return createHash('sha256').update(JSON.stringify({ kind: fanOut ? 'precision-fan-out-v1' : 'precision-v1', date, releaseMs, desiredHolds: PRECISION_DESIRED_HOLDS,
        targets: targets.map(target => [target.workerId, target.court, target.start, target.end, target.assumedAmount,
            ...(target.releaseOffsetMs ? [target.releaseOffsetMs] : [])]) })).digest('hex');
}
export const PRECISION_UNSENT_STATES = new Set(['EXCLUDED_BEFORE_FREEZE', 'BROWSER_FAILED',
    'IDENTITY_FAILED', 'JOURNAL_BLOCKED', 'PREWARM_FAILED', 'WINDOW_MISSED', 'NOT_DISPATCHED']);
export const PRECISION_HOLD_STATES = new Set(['HOLD_VERIFIED_QR_ATTENTION', 'QR_READY']);
/** Race-group reduction. Unknown outranks rejection; any verified hold achieves the objective. */
export function reducePrecisionOutcome(states) {
    const count = (predicate) => states.filter(predicate).length;
    const verifiedCount = count(state => PRECISION_HOLD_STATES.has(state));
    const unknownCount = count(state => state === 'UNKNOWN');
    const rejectedCount = count(state => state === 'REJECTED');
    const unsentCount = count(state => PRECISION_UNSENT_STATES.has(state));
    const qrAttention = states.includes('HOLD_VERIFIED_QR_ATTENTION');
    const outcome = verifiedCount >= PRECISION_DESIRED_HOLDS
        ? unknownCount ? 'OBJECTIVE_ACHIEVED_UNRESOLVED_EXTRA_ATTEMPT' : verifiedCount > PRECISION_DESIRED_HOLDS ? 'OBJECTIVE_ACHIEVED_EXTRA_HOLD' : 'OBJECTIVE_ACHIEVED'
        : unknownCount ? 'OBJECTIVE_NOT_CONFIRMED_MANUAL_RECONCILIATION'
            : rejectedCount ? 'OBJECTIVE_NOT_ACHIEVED_ALL_REJECTED' : 'OBJECTIVE_NOT_ACHIEVED_NOTHING_DISPATCHED';
    return { outcome, achieved: verifiedCount >= PRECISION_DESIRED_HOLDS, verifiedCount, unknownCount, rejectedCount, unsentCount,
        qrAttention, lockReleasable: states.length > 0 && verifiedCount === 0 && unknownCount === 0 &&
            states.every(state => state === 'REJECTED' || PRECISION_UNSENT_STATES.has(state)) };
}
/** A real, validated pending booking whose official QR page could not be opened afterwards. */
export class VerifiedHoldQrError extends Error {
    code;
    hold;
    constructor(code, hold) {
        super(code);
        this.code = code;
        this.hold = hold;
        this.name = 'VerifiedHoldQrError';
    }
}
const PRE_DISPATCH_CODES = new Set(['DUPLICATE_LOGICAL_BOOKING_BLOCKED', 'SUPERVISED_ONE_SHOT_ALREADY_USED']);
/**
 * Classifies one dispatch failure from evidence only: the error type when it
 * proves the request never left, otherwise this target's durable journal. No
 * journal record means nothing was begun; an unreadable record is UNKNOWN.
 */
export async function classifyPrecisionDispatchError(error, journalState) {
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.message) ? error.message : 'PRECISION_DISPATCH_FAILED';
    if (error instanceof VerifiedHoldQrError)
        return { state: 'HOLD_VERIFIED_QR_ATTENTION', code };
    if (error instanceof SubmissionDispatchError && !error.dispatched)
        return { state: code === 'DIRECT_RELEASE_WINDOW_MISSED' ? 'WINDOW_MISSED' : 'NOT_DISPATCHED', code };
    if (PRE_DISPATCH_CODES.has(code))
        return { state: 'NOT_DISPATCHED', code };
    if (code === 'SUBMISSION_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED')
        return { state: 'UNKNOWN', code };
    let state;
    try {
        state = await journalState();
    }
    catch {
        return { state: 'UNKNOWN', code };
    }
    if (state === undefined)
        return { state: 'NOT_DISPATCHED', code };
    if (state === 'rejected')
        return { state: 'REJECTED', code };
    if (state === 'verified')
        return { state: 'HOLD_VERIFIED_QR_ATTENTION', code };
    return { state: 'UNKNOWN', code };
}
const precisionAttemptId = (date, releaseMs, target, index) => createHash('sha256').update(JSON.stringify(['precision-attempt-v1', date, releaseMs, target.targetKey, target.workerId,
    target.releaseOffsetMs ?? 0, index])).digest('hex');
/** Freezes the exact dispatch set: an immutable copy plus a fingerprint re-checked before dispatch. */
export function freezePrecisionRace(date, releaseMs, attempts) {
    const counts = new Map();
    for (const attempt of attempts)
        counts.set(attempt.target.targetKey, (counts.get(attempt.target.targetKey) ?? 0) + 1);
    const seen = new Map();
    const copy = Object.freeze(attempts.map((attempt, index) => {
        const fanOutIndex = seen.get(attempt.target.targetKey) ?? 0;
        seen.set(attempt.target.targetKey, fanOutIndex + 1);
        return Object.freeze({ id: attempt.id ?? precisionAttemptId(date, releaseMs, attempt.target, index),
            target: Object.freeze({ ...attempt.target }), plan: attempt.plan, fanOutIndex, fanOutCount: counts.get(attempt.target.targetKey) });
    }));
    const fanOut = [...counts.values()].some(count => count > 1);
    return Object.freeze({ date, releaseMs, attempts: copy, fanOut,
        fingerprint: precisionFingerprint(date, releaseMs, copy.map(attempt => attempt.target), fanOut) });
}
export function assertPrecisionFreezeIntact(race) {
    if (precisionFingerprint(race.date, race.releaseMs, race.attempts.map(attempt => attempt.target), race.fanOut) !== race.fingerprint)
        throw Error('PRECISION_FROZEN_SET_CHANGED');
}
/**
 * Per-attempt readiness and independent dispatch. Each worker prewarms on its
 * own; at the release instant every ready attempt dispatches without waiting
 * for any other. An attempt not ready by the end of the direct dispatch window
 * is recorded as not dispatched. One attempt can never veto another.
 */
export async function dispatchPrecisionRace(race, deps) {
    const windowMs = deps.dispatchWindowMs ?? DIRECT_MAX_DISPATCH_LATENESS_MS;
    const retryCutoff = race.releaseMs - (deps.prewarmRetryCutoffMs ?? 7_000);
    const deadline = race.releaseMs + windowMs;
    assertPrecisionFreezeIntact(race);
    await deps.waitUntil(race.releaseMs - deps.prewarmLeadMs);
    const readiness = race.attempts.map(attempt => (async () => {
        for (let round = 1; round <= 2; round++) {
            try {
                await deps.prewarm(attempt);
                deps.onEvent?.({ kind: 'prewarm-ready', workerId: attempt.target.workerId, attemptId: attempt.id });
                return true;
            }
            catch (error) {
                const code = error instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.message) ? error.message : 'SECURITY_PREWARM_FAILED';
                deps.onEvent?.({ kind: 'prewarm-failed', workerId: attempt.target.workerId, attemptId: attempt.id, code });
                if (round === 1 && deps.now() < retryCutoff) {
                    deps.onEvent?.({ kind: 'prewarm-retry', workerId: attempt.target.workerId, attemptId: attempt.id });
                    continue;
                }
                return false;
            }
        }
        return false;
    })());
    await deps.waitUntil(race.releaseMs);
    assertPrecisionFreezeIntact(race);
    const timedOut = Symbol('timeout');
    const settled = await Promise.allSettled(race.attempts.map(async (attempt, index) => {
        const ready = await Promise.race([readiness[index], deps.waitUntil(deadline).then(() => timedOut)]);
        if (ready === timedOut)
            return { state: 'WINDOW_MISSED', code: 'PREWARM_NOT_READY_IN_WINDOW' };
        if (!ready)
            return { state: 'PREWARM_FAILED', code: 'SECURITY_PREWARM_FAILED' };
        if (deps.now() > deadline)
            return { state: 'WINDOW_MISSED', code: 'DIRECT_RELEASE_WINDOW_MISSED' };
        deps.onEvent?.({ kind: 'dispatch-start', workerId: attempt.target.workerId, attemptId: attempt.id });
        return deps.dispatch(attempt);
    }));
    return race.attempts.map((attempt, index) => {
        const outcome = settled[index];
        // dispatch() classifies its own failures; an unexpected throw may have happened after the POST.
        const result = outcome.status === 'fulfilled' ? outcome.value : { state: 'UNKNOWN', code: 'PRECISION_DISPATCH_UNCLASSIFIED' };
        deps.onEvent?.({ kind: 'settled', workerId: attempt.target.workerId, attemptId: attempt.id, state: result.state, ...(result.code ? { code: result.code } : {}) });
        return { attempt, ...result };
    });
}
//# sourceMappingURL=precision-race.js.map