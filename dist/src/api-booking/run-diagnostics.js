import { performance } from 'node:perf_hooks';
import { specialAdaptivePlans, specialBonusLanePlans, specialBonusPlansForCourt, specialSessionPlans } from './special-session.js';
const safeCode = /^[A-Z][A-Z0-9_]{0,79}$/;
const allowedFields = new Set([
    'workerId', 'lane', 'attemptId', 'attemptType', 'operation', 'timingKind', 'eventAt', 'durationMs', 'networkDurationMs',
    'status', 'statusCode', 'failureCategory', 'dispatchState', 'initiationEvidence', 'resultCategory', 'success', 'isAvailable',
    'targetDatePresent', 'responseComplete', 'slotCount', 'availableCount', 'courtHourSummary', 'coreFeasible', 'corePlanExact',
    'adaptiveFeasible', 'adaptivePlanExact', 'bonusFeasible', 'bonusPlanExact', 'securitySource', 'preparedContextAgeMs',
    'challengeState', 'activeAvailability', 'activeSecurity', 'activeSlotChecks', 'activeCheckouts', 'droppedCount', 'retryCount',
    'verifiedHoldCount', 'qrHandoffCount', 'partialHolds', 'coreElapsedMs', 'adaptiveElapsedMs', 'bonusElapsedMs', 'slowestStages',
    'absentEvidence', 'finalCode', 'aborted', 'workerOutcome', 'court', 'startTime', 'durationHours', 'price', 'responseObserved',
]);
export function diagnosticLaneForWorker(workerId) {
    if (workerId === 'E' || workerId === 'F')
        return 'adaptive';
    if (workerId === 'G' || workerId === 'H')
        return 'bonus';
    return 'core';
}
export function safeDiagnosticCode(error, fallback) {
    return error instanceof Error && safeCode.test(error.message) ? error.message : fallback;
}
/** Keep diagnostic payloads scalar and allowlisted even if a hook is accidentally called with raw data. */
export function sanitizeDiagnosticExtra(extra) {
    const safe = {};
    for (const [key, value] of Object.entries(extra)) {
        if (!allowedFields.has(key) || !['string', 'number', 'boolean'].includes(typeof value))
            continue;
        if (typeof value === 'number' && !Number.isFinite(value))
            continue;
        if (typeof value === 'string' && (value.length > 240 || /(?:https?:\/\/|token|cookie|fingerprint|authorization)/i.test(value)))
            continue;
        safe[key] = value;
    }
    return safe;
}
export function specialAvailabilityObservation(snapshot, targetDate, context = {}) {
    const targetDatePresent = snapshot.returnedDates[targetDate] === true;
    const responseComplete = targetDatePresent && !snapshot.incompleteDates.includes(targetDate);
    const hours = ['17:00', '18:00', '19:00', '20:00', '21:00', '22:00'];
    const courtHourSummary = Array.from({ length: 7 }, (_, offset) => {
        const court = offset + 1;
        const mask = hours.map(hour => {
            const slot = snapshot.slots.find(value => value.date === targetDate && value.court === court && value.startTime === hour);
            return slot ? (slot.isAvailable ? '1' : '0') : '-';
        }).join('');
        return `${court}:${mask}`;
    }).join(',');
    const core = context.coreAssignment
        ? specialSessionPlans(snapshot, undefined, context.coreAssignment)
        : specialSessionPlans(snapshot, undefined, undefined, context.directCourt ? [context.directCourt] : []);
    const adaptive = context.directCourt === undefined ? undefined : specialAdaptivePlans(snapshot, context.directCourt);
    const bonus = context.bonusCourt !== undefined ? specialBonusPlansForCourt(snapshot, context.bonusCourt)
        : context.coreAssignment ? specialBonusLanePlans(snapshot, [context.coreAssignment.earlyCourt, context.coreAssignment.lateCourt, ...(context.directCourt ? [context.directCourt] : [])])?.plans : undefined;
    return { targetDatePresent, responseComplete, slotCount: snapshot.slots.length,
        availableCount: snapshot.slots.filter(slot => slot.date === targetDate && slot.isAvailable).length,
        courtHourSummary, coreFeasible: !!core, corePlanExact: context.coreAssignment !== undefined,
        adaptiveFeasible: !!adaptive, adaptivePlanExact: context.directCourt !== undefined,
        bonusFeasible: !!bonus, bonusPlanExact: context.bonusCourt !== undefined };
}
export class RunDiagnostics {
    log;
    started;
    wallClock;
    monotonic;
    active = { availability: 0, security: 0, slotCheck: 0, checkout: 0 };
    observations = [];
    attemptCounter = 0;
    finished = false;
    constructor(log, started = performance.now(), wallClock = () => new Date(), monotonic = () => performance.now()) {
        this.log = log;
        this.started = started;
        this.wallClock = wallClock;
        this.monotonic = monotonic;
    }
    nextAttemptId(lane, workerId, attemptType) {
        return `${lane}-${workerId}-${attemptType}-${++this.attemptCounter}`;
    }
    observe(stage, correlation = {}, extra = {}) {
        try {
            const elapsedMs = Math.max(0, Math.round(this.monotonic() - this.started));
            const at = this.wallClock().toISOString();
            const safe = sanitizeDiagnosticExtra({ ...correlation, timingKind: 'EVENT_TIMESTAMP', eventAt: at, ...extra,
                activeAvailability: this.active.availability, activeSecurity: this.active.security,
                activeSlotChecks: this.active.slotCheck, activeCheckouts: this.active.checkout });
            this.observations.push({ stage, elapsedMs, extra: safe });
            this.log.recordDiagnostic(stage, at, elapsedMs, safe);
        }
        catch { /* Diagnostics must never change a booking outcome. */ }
    }
    begin(operation, stage, correlation = {}, extra = {}) {
        const began = this.monotonic();
        this.active[operation]++;
        this.observe(stage, correlation, { ...extra, operation });
        let ended = false;
        return (endStage, endExtra = {}) => {
            if (ended)
                return;
            ended = true;
            this.active[operation] = Math.max(0, this.active[operation] - 1);
            this.observe(endStage, correlation, { ...endExtra, operation, timingKind: 'MEASURED_DURATION',
                durationMs: Math.max(0, Math.round(this.monotonic() - began)) });
        };
    }
    finish(finalCode, aborted) {
        if (this.finished)
            return;
        this.finished = true;
        const laneElapsed = (lane) => {
            const events = this.observations.filter(value => value.extra.lane === lane);
            return events.length ? Math.max(...events.map(value => value.elapsedMs)) - Math.min(...events.map(value => value.elapsedMs)) : 0;
        };
        const durations = this.observations.flatMap(value => {
            const duration = typeof value.extra.networkDurationMs === 'number' ? value.extra.networkDurationMs
                : typeof value.extra.durationMs === 'number' ? value.extra.durationMs : undefined;
            return duration === undefined ? [] : [{ stage: value.stage, duration }];
        }).sort((a, b) => b.duration - a.duration).slice(0, 5);
        const stages = new Set(this.observations.map(value => value.stage));
        const holds = this.observations.filter(value => value.stage === 'DIAGNOSTIC_VERIFIED_HOLD').length;
        const qr = this.observations.filter(value => value.stage === 'DIAGNOSTIC_QR_HANDOFF').length;
        const attempts = this.observations.filter(value => value.stage === 'DIAGNOSTIC_ATTEMPT_STARTED');
        const absent = [];
        if (!stages.has('AVAILABILITY_REQUEST_COMPLETED'))
            absent.push('availability-response');
        if (attempts.length && !stages.has('SECURITY_PREPARATION_COMPLETED'))
            absent.push('security-completion');
        if (stages.has('CHECKOUT_FUNCTION_ENTERED') && !stages.has('CHECKOUT_HTTP_POST_INITIATED'))
            absent.push('post-initiation');
        if (stages.has('CHECKOUT_HTTP_POST_INITIATED') && !stages.has('CHECKOUT_RESPONSE_COMPLETED'))
            absent.push('checkout-response');
        if (holds > qr)
            absent.push('qr-handoff');
        if (!attempts.some(value => value.extra.lane === 'core'))
            absent.push('core-attempt');
        this.observe('RUN_DIAGNOSTIC_SUMMARY', {}, { finalCode, aborted,
            retryCount: attempts.filter(value => value.extra.attemptType === 'retry').length,
            verifiedHoldCount: holds, qrHandoffCount: qr, partialHolds: holds > 0 && qr < holds,
            coreElapsedMs: laneElapsed('core'), adaptiveElapsedMs: laneElapsed('adaptive'), bonusElapsedMs: laneElapsed('bonus'),
            slowestStages: durations.map(value => `${value.stage}:${value.duration}`).join(','),
            absentEvidence: absent.length ? absent.join(',') : 'NONE' });
    }
}
//# sourceMappingURL=run-diagnostics.js.map